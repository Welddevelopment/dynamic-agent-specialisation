function estimateTokens(value) { return Math.ceil(JSON.stringify(value).length / 4); }

const SERVICE_TIERS = new Set(["default", "auto", "flex", "fast", "priority"]);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function finiteNonnegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function cacheWriteRate(pricing) {
  return pricing.cacheWritePerMillionUsd ?? pricing.cacheWriteInputPerMillionUsd ?? null;
}

function extractOutput(body) {
  if (body.output_parsed != null) return body.output_parsed;
  if (typeof body.output_text === "string") return body.output_text;
  const text = (body.output ?? []).flatMap((item) => item.type === "message" ? item.content ?? [] : [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("");
  if (text) return text;
  const reason = body.incomplete_details?.reason ?? body.status ?? "unknown";
  throw new Error(`OpenAI Responses payload contained no extractable model output (${reason})`);
}

function textFormat(responseFormat) {
  if (!responseFormat) return undefined;
  if (responseFormat === "json") return { format: { type: "json_object" } };
  if (responseFormat.type === "json_schema") return { format: { type: "json_schema", name: responseFormat.name, strict: true, schema: responseFormat.schema } };
  if (typeof responseFormat === "object") return { format: { type: "json_object" } };
  throw new Error("Unsupported response format");
}

function providerFailure({ status, body }) {
  const code = String(body?.error?.code ?? "").trim();
  const type = String(body?.error?.type ?? "").trim();
  const providerMessage = String(body?.error?.message ?? "").trim();
  const combined = `${code} ${type} ${providerMessage}`.toLowerCase();
  const fundingBlocked = status === 429 && /(insufficient_quota|billing|credit|quota)/.test(combined);
  const retryClass = fundingBlocked ? "funding" : status === 429 ? "rate-limit" : [401, 403].includes(status) ? "authentication" : status >= 500 ? "provider" : "request";
  const definitivelyNotCharged = [400, 401, 403, 404, 409, 422, 429].includes(status);
  const suffix = providerMessage ? `: ${providerMessage.slice(0, 500)}` : "";
  const error = new Error(`OpenAI Responses request failed with ${status}${suffix}`);
  error.name = "ModelProviderRequestError";
  error.status = status;
  error.providerCode = code || null;
  error.providerType = type || null;
  error.retryClass = retryClass;
  error.definitivelyNotCharged = definitivelyNotCharged;
  error.resumable = ["funding", "rate-limit"].includes(retryClass);
  return error;
}

export class OpenAIResponsesProvider {
  constructor({ apiKey, pricing = null, pricingByModel = {}, fetchImpl = fetch, allowPaidCalls = false, environment = process.env, modelMap = {}, serviceTier = "default" }) {
    if (!apiKey) throw new Error("OpenAI API key is required");
    if (!pricing?.inputPerMillionUsd && !Object.keys(pricingByModel).length) throw new Error("Explicit current pricing is required");
    for (const [model, value] of Object.entries(pricingByModel)) if (!value?.inputPerMillionUsd || !value?.outputPerMillionUsd) throw new Error(`Explicit current pricing is incomplete for ${model}`);
    requireCondition(SERVICE_TIERS.has(serviceTier), `Unsupported OpenAI service tier: ${serviceTier}`);
    this.id = "openai-responses"; this.apiKey = apiKey; this.pricing = pricing; this.pricingByModel = structuredClone(pricingByModel); this.fetchImpl = fetchImpl; this.modelMap = structuredClone(modelMap); this.serviceTier = serviceTier;
    this.enabled = allowPaidCalls && environment.DAS_ENABLE_PAID_MODEL_CALLS === "JOEL_APPROVED";
  }
  pricingFor(request) {
    const resolvedModel = this.modelMap[request.model] ?? request.model;
    const value = this.pricingByModel[resolvedModel] ?? this.pricing;
    if (!value?.inputPerMillionUsd || !value?.outputPerMillionUsd) throw new Error(`No explicit current pricing for resolved model: ${resolvedModel}`);
    return value;
  }
  projectCost(request) {
    const pricing = this.pricingFor(request);
    const input = estimateTokens(request.input);
    const output = request.maxOutputTokens ?? 4_000;
    // A GPT-5.6 cache miss may report input tokens as cache writes. Reserve at
    // the higher of uncached-input and cache-write price so the durable budget
    // cannot be weakened merely by enabling prompt caching.
    const projectedInputRate = Math.max(pricing.inputPerMillionUsd, cacheWriteRate(pricing) ?? pricing.inputPerMillionUsd);
    return input / 1_000_000 * projectedInputRate + output / 1_000_000 * pricing.outputPerMillionUsd;
  }
  async generate(request) {
    if (!this.enabled) throw new Error("Paid model calls require Joel approval and DAS_ENABLE_PAID_MODEL_CALLS=JOEL_APPROVED");
    const model = this.modelMap[request.model] ?? request.model;
    const requestedServiceTier = request.serviceTier ?? this.serviceTier;
    requireCondition(SERVICE_TIERS.has(requestedServiceTier), `Unsupported OpenAI request service tier: ${requestedServiceTier}`);
    requireCondition(requestedServiceTier === this.serviceTier, `OpenAI request service tier ${requestedServiceTier} does not match the provider pricing tier ${this.serviceTier}`);
    const body = { model, input: typeof request.input === "string" ? request.input : JSON.stringify(request.input), max_output_tokens: request.maxOutputTokens ?? 4_000, store: false, service_tier: requestedServiceTier };
    const format = textFormat(request.responseFormat);
    if (format) body.text = format;
    if (request.reasoningEffort) body.reasoning = { effort: request.reasoningEffort };
    const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw providerFailure({ status: response.status, body: errorBody });
    }
    const responseBody = await response.json();
    const usage = responseBody.usage ?? { input_tokens: 0, output_tokens: 0, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } };
    const inputTokens = Number(usage.input_tokens ?? 0);
    const outputTokens = Number(usage.output_tokens ?? 0);
    const cached = Number(usage.input_tokens_details?.cached_tokens ?? 0);
    const cacheWrites = Number(usage.input_tokens_details?.cache_write_tokens ?? 0);
    requireCondition([inputTokens, outputTokens, cached, cacheWrites].every(finiteNonnegative), "OpenAI Responses returned invalid token usage");
    requireCondition(cached + cacheWrites <= inputTokens, "OpenAI Responses cache usage exceeds total input tokens");
    const uncached = inputTokens - cached - cacheWrites;
    const pricing = this.pricingFor(request);
    const writeRate = cacheWriteRate(pricing);
    requireCondition(cacheWrites === 0 || finiteNonnegative(writeRate), `OpenAI Responses reported cache writes but explicit cache-write pricing is missing for ${model}`);
    const actualUsd = uncached / 1_000_000 * pricing.inputPerMillionUsd
      + cached / 1_000_000 * (pricing.cachedInputPerMillionUsd ?? pricing.inputPerMillionUsd)
      + cacheWrites / 1_000_000 * (writeRate ?? 0)
      + outputTokens / 1_000_000 * pricing.outputPerMillionUsd;
    return { output: extractOutput(responseBody), usage, actualUsd, responseId: responseBody.id, resolvedModel: model, requestedServiceTier, resolvedServiceTier: responseBody.service_tier ?? requestedServiceTier };
  }
}
