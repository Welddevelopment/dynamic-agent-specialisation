import { digest } from "./canonical.js";

function redact(value, secrets) {
  let text = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of secrets) if (secret) text = text.replaceAll(secret, "[REDACTED]");
  return text;
}

export class ModelResponseCache {
  #values = new Map();
  key(request) { return digest(request); }
  get(request) { const value = this.#values.get(this.key(request)); return value ? structuredClone(value) : null; }
  set(request, response) { this.#values.set(this.key(request), structuredClone(response)); }
  size() { return this.#values.size; }
}

export class MeteredModelGateway {
  constructor({ provider, budget, cache, evidence, secrets = [] }) {
    this.provider = provider; this.budget = budget; this.cache = cache; this.evidence = evidence; this.secrets = secrets;
  }
  async generate(request) {
    const cached = this.cache.get(request);
    if (cached) { this.evidence?.append("model.cache-hit", { requestHash: digest(request), model: request.model }); return { ...cached, cached: true }; }
    const projectedUsd = this.provider.projectCost(request);
    const reservation = this.budget.reserve({ provider: this.provider.id, model: request.model, projectedUsd, purpose: request.purpose });
    this.evidence?.append("model.call-reserved", { ...reservation, requestHash: digest(request), redactedRequest: redact(request, this.secrets) });
    try {
      const response = await this.provider.generate(request);
      this.budget.settle(reservation.id, response.actualUsd, response.usage);
      const safe = { output: response.output, usage: response.usage, actualUsd: response.actualUsd, provider: this.provider.id, model: request.model };
      this.cache.set(request, safe);
      this.evidence?.append("model.call-settled", { reservationId: reservation.id, actualUsd: response.actualUsd, usage: response.usage, responseHash: digest(response.output) });
      return { ...safe, cached: false };
    } catch (error) {
      this.budget.cancel(reservation.id, error instanceof Error ? error.message : String(error));
      this.evidence?.append("model.call-failed", { reservationId: reservation.id, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}

export class PaidCallsDisabledProvider {
  constructor() { this.id = "paid-calls-disabled"; }
  projectCost() { return 0.01; }
  async generate() { throw new Error("Paid model calls are disabled pending Joel's approval"); }
}

