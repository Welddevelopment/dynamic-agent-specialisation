import { validateCandidate } from "./candidate.js";

function object(properties) { return { type: "object", properties, required: Object.keys(properties), additionalProperties: false }; }

export function candidatePortfolioResponseFormat(brief, count) {
  const candidate = object({
    id: { type: "string" },
    roleId: { type: "string", enum: [brief.id] },
    model: object({ family: { type: "string" }, tier: { type: "string" } }),
    instructions: object({ style: { type: "string" }, emphasis: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 } }),
    context: object({ sources: { type: "array", items: { type: "string", enum: brief.environment.contextSources }, minItems: 1 }, selection: { type: "string" } }),
    tools: { type: "array", items: { type: "string", enum: brief.environment.tools }, minItems: 1 },
    memory: object({ kind: { type: "string" }, scope: { type: "string" } }),
    authority: object({ allowedActions: { type: "array", items: { type: "string", enum: brief.authority.allowedActions } } }),
    escalation: object({ enabled: { type: "boolean", enum: [true] }, threshold: { type: "number" }, mode: { type: "string" } }),
    verifier: object({ kind: { type: "string", enum: ["independent-external-state"] }, binding: { type: "string", enum: [brief.successCriteria.verifierId] } }),
    limits: object({ maxCostPerTaskUsd: { type: "number" }, maxLatencyMs: { type: "number" } }),
    strategy: object({ qualityWeight: { type: "number" }, costWeight: { type: "number" }, speedWeight: { type: "number" }, riskTolerance: { type: "number" }, requireCompleteContext: { type: "boolean" } }),
    provenance: object({ kind: { type: "string", enum: ["compiler-generated"] }, parents: { type: "array", items: { type: "string" } }, rationale: { type: "string" } }),
    version: { type: "string" },
  });
  return { type: "json_schema", name: "specialist_candidate_portfolio", schema: object({ candidates: { type: "array", items: candidate, minItems: count, maxItems: count } }) };
}

function parse(value) {
  if (typeof value === "string") return JSON.parse(value);
  return structuredClone(value);
}

export class ModelCandidateArchitect {
  constructor({ gateway, minimumCandidates = 4, maxOutputTokens = 8_000 }) { this.gateway = gateway; this.minimumCandidates = minimumCandidates; this.maxOutputTokens = maxOutputTokens; }
  async propose({ brief, knowledgeEntries, priorSpecialists }) {
    const response = await this.gateway.generate({
      model: "candidate-architect-policy",
      purpose: "construct-complete-specialist-candidates",
      input: {
        instruction: "Return JSON only. Return exactly the requested number of materially different complete specialist candidates. Use the supplied engineering knowledge as design priors while keeping candidates materially different. Keep every string concise but include the operational rules required for complete outcomes. Do not add explanations outside candidate fields. Do not invent authority. The verifier must be independent, and every field in the candidate contract is required. If requireCompleteContext is true, include every declared environment context source; never claim complete context while omitting one.",
        brief, knowledgeEntries, priorSpecialists: priorSpecialists.map((entry) => ({ id: entry.id, version: entry.version, compatibility: entry.compatibility, evidence: entry.evidence })),
        requiredCandidateFields: ["id", "roleId", "model", "instructions", "context", "tools", "memory", "authority", "escalation", "verifier", "limits", "strategy", "provenance", "version"],
        minimumCandidates: this.minimumCandidates,
      },
      responseFormat: candidatePortfolioResponseFormat(brief, this.minimumCandidates),
      maxOutputTokens: this.maxOutputTokens,
    });
    const payload = parse(response.output);
    if (!Array.isArray(payload.candidates) || payload.candidates.length < this.minimumCandidates) throw new Error("Model architect returned too few candidates");
    const validations = payload.candidates.map((candidate) => validateCandidate(candidate, brief));
    return { candidates: validations.filter((entry) => entry.valid).map((entry) => entry.candidate), rejected: validations.filter((entry) => !entry.valid), modelReceipt: { provider: response.provider, model: response.model, actualUsd: response.actualUsd, cached: response.cached } };
  }
}
