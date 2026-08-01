import { validateCandidate } from "./candidate.js";

function parse(value) {
  if (typeof value === "string") return JSON.parse(value);
  return structuredClone(value);
}

export class ModelCandidateArchitect {
  constructor({ gateway, minimumCandidates = 4 }) { this.gateway = gateway; this.minimumCandidates = minimumCandidates; }
  async propose({ brief, knowledgeEntries, priorSpecialists }) {
    const response = await this.gateway.generate({
      model: "candidate-architect-policy",
      purpose: "construct-complete-specialist-candidates",
      input: {
        instruction: "Return materially different complete specialist candidates. Do not invent authority. The verifier must be independent, and every field in the candidate contract is required.",
        brief, knowledgeEntries, priorSpecialists: priorSpecialists.map((entry) => ({ id: entry.id, version: entry.version, compatibility: entry.compatibility, evidence: entry.evidence })),
        requiredCandidateFields: ["id", "roleId", "model", "instructions", "context", "tools", "memory", "authority", "escalation", "verifier", "limits", "strategy", "provenance", "version"],
        minimumCandidates: this.minimumCandidates,
      },
      responseFormat: "json",
    });
    const payload = parse(response.output);
    if (!Array.isArray(payload.candidates) || payload.candidates.length < this.minimumCandidates) throw new Error("Model architect returned too few candidates");
    const validations = payload.candidates.map((candidate) => validateCandidate(candidate, brief));
    return { candidates: validations.filter((entry) => entry.valid).map((entry) => entry.candidate), rejected: validations.filter((entry) => !entry.valid), modelReceipt: { provider: response.provider, model: response.model, actualUsd: response.actualUsd, cached: response.cached } };
  }
}

