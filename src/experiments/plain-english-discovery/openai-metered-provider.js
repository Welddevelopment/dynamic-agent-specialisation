function estimateTokens(value) { return Math.ceil(JSON.stringify(value).length / 4); }

function requireCondition(condition, message) { if (!condition) throw new Error(message); }

function extractOutput(body) {
  if (body.output_parsed != null) return body.output_parsed;
  if (typeof body.output_text === "string") return body.output_text;
  const text = (body.output ?? []).flatMap((item) => item.type === "message" ? item.content ?? [] : [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("");
  if (text) return text;
  throw new Error(`OpenAI Responses payload contained no extractable output (${body.incomplete_details?.reason ?? body.status ?? "unknown"})`);
}

function textFormat(responseFormat) {
  requireCondition(responseFormat?.type === "json_schema", "Plain-English discovery requires strict JSON-schema output");
  return { format: { type: "json_schema", name: responseFormat.name, strict: true, schema: responseFormat.schema } };
}

function providerFailure({ status, body }) {
  const code = String(body?.error?.code ?? "").trim();
  const type = String(body?.error?.type ?? "").trim();
  const providerMessage = String(body?.error?.message ?? "").trim();
  const combined = `${code} ${type} ${providerMessage}`.toLowerCase();
  const fundingBlocked = status === 429 && /(insufficient_quota|billing|credit|quota)/.test(combined);
  const error = new Error(`OpenAI Responses request failed with ${status}${providerMessage ? `: ${providerMessage.slice(0, 500)}` : ""}`);
  error.name = "ModelProviderRequestError";
  error.status = status;
  error.providerCode = code || null;
  error.providerType = type || null;
  error.retryClass = fundingBlocked ? "funding" : status === 429 ? "rate-limit" : [401, 403].includes(status) ? "authentication" : status >= 500 ? "provider" : "request";
  error.definitivelyNotCharged = [400, 401, 403, 404, 409, 422, 429].includes(status);
  error.resumable = ["funding", "rate-limit"].includes(error.retryClass);
  return error;
}

export class OpenAIPlainEnglishDiscoveryProvider {
  constructor({ apiKey, pricing, fetchImpl = fetch, environment = process.env, allowPaidCalls = false }) {
    requireCondition(apiKey, "OpenAI API key is required");
    requireCondition(
      Number.isFinite(pricing?.inputPerMillionUsd)
        && Number.isFinite(pricing?.cachedInputPerMillionUsd)
        && Number.isFinite(pricing?.cacheWritePerMillionUsd)
        && Number.isFinite(pricing?.outputPerMillionUsd),
      "Exact current input, cached-input, cache-write, and output pricing is required",
    );
    this.id = "openai-responses-plain-english-discovery";
    this.apiKey = apiKey;
    this.pricing = structuredClone(pricing);
    this.fetchImpl = fetchImpl;
    this.enabled = allowPaidCalls && environment.DAS_ENABLE_PAID_MODEL_CALLS === "JOEL_APPROVED";
  }

  projectCost(request) {
    const input = estimateTokens(request.input);
    const output = request.maxOutputTokens ?? 3_200;
    // Conservatively reserve every new input token at the cache-write rate. The
    // settled receipt uses the provider's actual cache-read/write token fields.
    return input / 1_000_000 * this.pricing.cacheWritePerMillionUsd
      + output / 1_000_000 * this.pricing.outputPerMillionUsd;
  }

  async generate(request) {
    requireCondition(this.enabled, "Paid model calls require Joel approval and DAS_ENABLE_PAID_MODEL_CALLS=JOEL_APPROVED");
    const body = {
      model: request.model,
      input: request.input,
      max_output_tokens: request.maxOutputTokens ?? 3_200,
      store: false,
      text: textFormat(request.responseFormat),
      reasoning: { effort: request.reasoningEffort ?? "low" },
    };
    const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw providerFailure({ status: response.status, body: await response.json().catch(() => ({})) });
    const responseBody = await response.json();
    const usage = responseBody.usage ?? { input_tokens: 0, output_tokens: 0, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } };
    const details = usage.input_tokens_details ?? {};
    const cached = Number(details.cached_tokens ?? 0);
    const cacheWrite = Number(details.cache_write_tokens ?? 0);
    const uncached = Math.max(0, Number(usage.input_tokens ?? 0) - cached - cacheWrite);
    const actualUsd = uncached / 1_000_000 * this.pricing.inputPerMillionUsd
      + cached / 1_000_000 * this.pricing.cachedInputPerMillionUsd
      + cacheWrite / 1_000_000 * this.pricing.cacheWritePerMillionUsd
      + Number(usage.output_tokens ?? 0) / 1_000_000 * this.pricing.outputPerMillionUsd;
    return {
      output: extractOutput(responseBody),
      usage,
      actualUsd,
      responseId: responseBody.id,
      resolvedModel: responseBody.model ?? request.model,
    };
  }
}

