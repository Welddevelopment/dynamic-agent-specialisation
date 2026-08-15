import { digest } from "../../core/canonical.js";
import { validateCandidate } from "../../compiler/candidate.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function object(properties) { return { type: "object", properties, required: Object.keys(properties), additionalProperties: false }; }

export const PAIRED_V6_ARCHITECT_INSTRUCTION = "Return JSON only. Construct exactly the requested number of complete, materially different specialist packages. Every package must remain inside the frozen role, tools, authority, limits and independent-verifier contract. The request fixes one context source mode for the entire batch. In complete mode, do not choose a subset: the runtime deterministically binds every frozen role context source and sets requireCompleteContext=true. In selective mode, return a strict non-empty subset of frozen role context sources and the runtime deterministically sets requireCompleteContext=false. Never describe a selective subset as complete. Use compact prior-design memory to vary real operating architecture rather than ids or wording. Do not infer credentials or success criteria.";

export const PAIRED_V6_CONTEXT_MODE_SCHEDULE = Object.freeze([
  "complete", "selective", "complete", "selective", "complete",
  "selective", "complete", "selective", "complete", "selective",
  "complete", "selective", "complete", "selective", "complete",
]);

export function pairedV6ContextModeForBatch(batchIndex) {
  requireCondition(Number.isInteger(batchIndex) && batchIndex >= 1 && batchIndex <= PAIRED_V6_CONTEXT_MODE_SCHEDULE.length, "v6 batch index is outside the frozen context-mode schedule");
  return PAIRED_V6_CONTEXT_MODE_SCHEDULE[batchIndex - 1];
}

export function candidatePortfolioResponseFormatV6(brief, count, contextMode) {
  requireCondition(["complete", "selective"].includes(contextMode), "v6 response contract needs an explicit context mode");
  requireCondition((brief.environment.contextSources ?? []).length >= 2, "v6 selective context contract requires at least two frozen sources");
  const context = contextMode === "complete"
    ? object({ sourceMode: { type: "string", enum: ["complete"] }, selection: { type: "string" } })
    : object({ sourceMode: { type: "string", enum: ["selective"] }, sources: { type: "array", items: { type: "string", enum: brief.environment.contextSources }, minItems: 1, maxItems: brief.environment.contextSources.length - 1 }, selection: { type: "string" } });
  const candidate = object({
    id: { type: "string" },
    roleId: { type: "string", enum: [brief.id] },
    model: object({ family: { type: "string" }, tier: { type: "string" } }),
    instructions: object({ style: { type: "string" }, emphasis: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 } }),
    context,
    tools: { type: "array", items: { type: "string", enum: brief.environment.tools }, minItems: 1 },
    memory: object({ kind: { type: "string" }, scope: { type: "string" } }),
    authority: object({ allowedActions: { type: "array", items: { type: "string", enum: brief.authority.allowedActions } } }),
    escalation: object({ enabled: { type: "boolean", enum: [true] }, threshold: { type: "number" }, mode: { type: "string" } }),
    verifier: object({ kind: { type: "string", enum: ["independent-external-state"] }, binding: { type: "string", enum: [brief.successCriteria.verifierId] } }),
    limits: object({ maxCostPerTaskUsd: { type: "number" }, maxLatencyMs: { type: "number" } }),
    strategy: object({ qualityWeight: { type: "number" }, costWeight: { type: "number" }, speedWeight: { type: "number" }, riskTolerance: { type: "number" } }),
    provenance: object({ kind: { type: "string", enum: ["compiler-generated"] }, parents: { type: "array", items: { type: "string" } }, rationale: { type: "string" } }),
    version: { type: "string" },
  });
  return { type: "json_schema", name: `specialist_candidate_portfolio_v6_${contextMode}`, schema: object({ candidates: { type: "array", items: candidate, minItems: count, maxItems: count } }) };
}

export function canonicalizeV6RawCandidate(raw, brief, contextMode) {
  const candidate = structuredClone(raw);
  requireCondition(candidate.context?.sourceMode === contextMode, `v6 candidate ${candidate.id ?? "unknown"} returned the wrong context mode`);
  const sources = contextMode === "complete" ? [...brief.environment.contextSources] : [...(candidate.context.sources ?? [])];
  requireCondition(new Set(sources).size === sources.length, `v6 candidate ${candidate.id ?? "unknown"} repeated a context source`);
  if (contextMode === "selective") requireCondition(sources.length >= 1 && sources.length < brief.environment.contextSources.length, `v6 selective candidate ${candidate.id ?? "unknown"} must use a strict non-empty subset`);
  candidate.context = { sources, selection: candidate.context.selection };
  candidate.strategy = { ...candidate.strategy, requireCompleteContext: contextMode === "complete" };
  const validation = validateCandidate(candidate, brief);
  requireCondition(validation.valid, `v6 canonical candidate ${candidate.id ?? "unknown"} is invalid: ${validation.reasons.join(",")}`);
  assertPairedV6ContextInvariant(validation.candidate, brief);
  return validation.candidate;
}

export function assertPairedV6ContextInvariant(candidate, brief) {
  const frozen = brief.environment.contextSources;
  const selected = candidate.context.sources;
  const selectedSet = new Set(selected);
  requireCondition(selectedSet.size === selected.length, `v6 candidate ${candidate.id} has duplicate context sources`);
  requireCondition(selected.every((source) => frozen.includes(source)), `v6 candidate ${candidate.id} has an unknown context source`);
  if (candidate.strategy.requireCompleteContext) {
    requireCondition(selected.length === frozen.length && frozen.every((source) => selectedSet.has(source)), `v6 complete-context candidate ${candidate.id} omitted a frozen source`);
  } else {
    requireCondition(selected.length >= 1 && selected.length < frozen.length, `v6 selective-context candidate ${candidate.id} is not a strict subset`);
  }
  return true;
}

export function pairedV6ContractHash(brief) {
  return digest({ instruction: PAIRED_V6_ARCHITECT_INSTRUCTION, schedule: PAIRED_V6_CONTEXT_MODE_SCHEDULE, completeSchema: candidatePortfolioResponseFormatV6(brief, 10, "complete"), selectiveSchema: candidatePortfolioResponseFormatV6(brief, 10, "selective") });
}
