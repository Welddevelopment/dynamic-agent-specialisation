function estimateTokens(value) { return Math.ceil(JSON.stringify(value).length / 4); }

export class OpenAIResponsesProvider {
  constructor({ apiKey, pricing, fetchImpl = fetch, allowPaidCalls = false, environment = process.env }) {
    if (!apiKey) throw new Error("OpenAI API key is required");
    if (!pricing?.inputPerMillionUsd || !pricing?.outputPerMillionUsd) throw new Error("Explicit current pricing is required");
    this.id = "openai-responses"; this.apiKey = apiKey; this.pricing = pricing; this.fetchImpl = fetchImpl;
    this.enabled = allowPaidCalls && environment.DAS_ENABLE_PAID_MODEL_CALLS === "JOEL_APPROVED";
  }
  projectCost(request) {
    const input = estimateTokens(request.input);
    const output = request.maxOutputTokens ?? 4_000;
    return input / 1_000_000 * this.pricing.inputPerMillionUsd + output / 1_000_000 * this.pricing.outputPerMillionUsd;
  }
  async generate(request) {
    if (!this.enabled) throw new Error("Paid model calls require Joel approval and DAS_ENABLE_PAID_MODEL_CALLS=JOEL_APPROVED");
    const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: request.model, input: request.input, max_output_tokens: request.maxOutputTokens ?? 4_000 }),
    });
    if (!response.ok) throw new Error(`OpenAI Responses request failed with ${response.status}`);
    const body = await response.json();
    const usage = body.usage ?? { input_tokens: 0, output_tokens: 0, input_tokens_details: { cached_tokens: 0 } };
    const cached = usage.input_tokens_details?.cached_tokens ?? 0;
    const uncached = Math.max(0, usage.input_tokens - cached);
    const actualUsd = uncached / 1_000_000 * this.pricing.inputPerMillionUsd + cached / 1_000_000 * (this.pricing.cachedInputPerMillionUsd ?? this.pricing.inputPerMillionUsd) + usage.output_tokens / 1_000_000 * this.pricing.outputPerMillionUsd;
    return { output: body.output_parsed ?? body.output_text ?? body.output, usage, actualUsd };
  }
}

