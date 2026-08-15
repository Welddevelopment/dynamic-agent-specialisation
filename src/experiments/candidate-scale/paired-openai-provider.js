function estimateTokens(value) { return Math.ceil(JSON.stringify(value).length / 4); }
function requireCondition(condition, message) { if (!condition) throw new Error(message); }

function extractOutput(body) {
  if (body.output_parsed != null) return body.output_parsed;
  if (typeof body.output_text === "string") return body.output_text;
  const text = (body.output ?? []).flatMap((item) => item.type === "message" ? item.content ?? [] : [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text).join("");
  if (text) return text;
  throw new Error(`OpenAI Responses payload contained no extractable output (${body.incomplete_details?.reason ?? body.status ?? "unknown"})`);
}

function textFormat(responseFormat) {
  if (!responseFormat) return undefined;
  if (responseFormat.type === "json_schema") return { format: { type: "json_schema", name: responseFormat.name, strict: true, schema: responseFormat.schema } };
  throw new Error("Paired scale provider requires an explicit JSON schema");
}

function providerFailure(status, body) {
  const code = String(body?.error?.code ?? ""); const type = String(body?.error?.type ?? ""); const message = String(body?.error?.message ?? "");
  const combined = `${code} ${type} ${message}`.toLowerCase();
  const fundingBlocked = status === 429 && /(insufficient_quota|billing|credit|quota)/.test(combined);
  const error = new Error(`OpenAI Responses request failed with ${status}${message ? `: ${message.slice(0, 500)}` : ""}`);
  error.name = "ModelProviderRequestError"; error.status = status; error.providerCode = code || null; error.providerType = type || null;
  error.retryClass = fundingBlocked ? "funding" : status === 429 ? "rate-limit" : [401, 403].includes(status) ? "authentication" : status >= 500 ? "provider" : "request";
  error.definitivelyNotCharged = [400, 401, 403, 404, 409, 422, 429].includes(status); error.resumable = ["funding", "rate-limit"].includes(error.retryClass);
  return error;
}

export class PairedScaleOpenAIProvider {
  constructor({ apiKey, pricingByModel, modelMap = {}, fetchImpl = fetch, environment = process.env }) {
    requireCondition(apiKey, "OpenAI API key is required");
    requireCondition(environment.DAS_ENABLE_PAID_MODEL_CALLS === "JOEL_APPROVED", "Paid calls are disabled");
    this.id = "openai-responses-paired-scale"; this.apiKey = apiKey; this.pricingByModel = structuredClone(pricingByModel); this.modelMap = structuredClone(modelMap); this.fetchImpl = fetchImpl;
  }
  pricingFor(request) {
    const model = this.modelMap[request.model] ?? request.model; const pricing = this.pricingByModel[model];
    requireCondition(pricing?.inputPerMillionUsd && pricing?.outputPerMillionUsd && pricing?.cacheWritePerMillionUsd, `Incomplete paired-scale pricing for ${model}`);
    return pricing;
  }
  projectCost(request) {
    const inputTokens = estimateTokens(request.input); requireCondition(inputTokens < 272_000, "Paired-scale request would cross the frozen short-context pricing class");
    const pricing = this.pricingFor(request);
    const reservableInputRate = Math.max(pricing.inputPerMillionUsd, pricing.cacheWritePerMillionUsd);
    return inputTokens / 1_000_000 * reservableInputRate + (request.maxOutputTokens ?? 4_000) / 1_000_000 * pricing.outputPerMillionUsd;
  }
  async generate(request) {
    const model = this.modelMap[request.model] ?? request.model;
    const body = { model, input: typeof request.input === "string" ? request.input : JSON.stringify(request.input), max_output_tokens: request.maxOutputTokens ?? 4_000, store: false, service_tier: "default", reasoning: { effort: request.reasoningEffort ?? "low" }, text: textFormat(request.responseFormat) };
    const response = await this.fetchImpl("https://api.openai.com/v1/responses", { method: "POST", headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw providerFailure(response.status, await response.json().catch(() => ({})));
    const responseBody = await response.json(); const usage = responseBody.usage ?? {};
    const details = usage.input_tokens_details ?? {}; const cached = Number(details.cached_tokens ?? 0); const cacheWrite = Number(details.cache_write_tokens ?? usage.cache_write_tokens ?? 0); const input = Number(usage.input_tokens ?? 0); const output = Number(usage.output_tokens ?? 0);
    for (const [name, value] of Object.entries({ input, cached, cacheWrite, output })) requireCondition(Number.isFinite(value) && value >= 0, `OpenAI returned invalid ${name} token usage`);
    requireCondition(cached + cacheWrite <= input, "OpenAI returned cached/cache-write usage greater than total input");
    const uncached = input - cached - cacheWrite; const pricing = this.pricingFor(request);
    const actualUsd = uncached / 1_000_000 * pricing.inputPerMillionUsd + cached / 1_000_000 * (pricing.cachedInputPerMillionUsd ?? pricing.inputPerMillionUsd) + cacheWrite / 1_000_000 * pricing.cacheWritePerMillionUsd + output / 1_000_000 * pricing.outputPerMillionUsd;
    return { output: extractOutput(responseBody), usage: { ...usage, pairedScaleAccounting: { uncachedInputTokens: uncached, cachedInputTokens: cached, cacheWriteTokens: cacheWrite, outputTokens: output, requestedServiceTier: "default", returnedServiceTier: responseBody.service_tier ?? null } }, actualUsd, responseId: responseBody.id, resolvedModel: model, requestedServiceTier: "default", returnedServiceTier: responseBody.service_tier ?? null };
  }
}
