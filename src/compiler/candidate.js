import { validateGuards } from "../runtime/guards.js";
import { digest } from "../core/canonical.js";

export const REQUIRED_CANDIDATE_FIELDS = ["id", "roleId", "model", "instructions", "context", "tools", "memory", "authority", "escalation", "verifier", "limits", "strategy", "provenance", "version"];

export function validateCandidate(candidate, brief) {
  const reasons = [];
  reasons.push(...validateGuards(candidate.guards, candidate));
  for (const field of REQUIRED_CANDIDATE_FIELDS) if (candidate[field] == null) reasons.push(`missing:${field}`);
  if (candidate.roleId !== brief.id) reasons.push("role-mismatch");
  if (!Array.isArray(candidate.tools) || candidate.tools.length === 0) reasons.push("no-tools");
  if ((candidate.tools ?? []).some((tool) => !(brief.environment.tools ?? []).includes(tool))) reasons.push("unknown-tool");
  if (!candidate.escalation?.enabled) reasons.push("no-escalation");
  if (candidate.escalation && (typeof candidate.escalation.threshold !== "number" || candidate.escalation.threshold < 0 || candidate.escalation.threshold > 1)) reasons.push("invalid-escalation-threshold");
  if (candidate.verifier?.kind === "self-report") reasons.push("self-grading-verifier");
  if (candidate.verifier?.kind !== "independent-external-state") reasons.push("non-independent-verifier");
  if (candidate.verifier?.binding !== brief.successCriteria.verifierId) reasons.push("verifier-binding-mismatch");
  const allowedActions = new Set(brief.authority.allowedActions ?? []);
  for (const action of candidate.authority?.allowedActions ?? []) if (!allowedActions.has(action)) reasons.push(`excess-authority:${action}`);
  if ((candidate.limits?.maxCostPerTaskUsd ?? Infinity) > (brief.priorities.maxCostPerTaskUsd ?? Infinity)) reasons.push("cost-limit-exceeded");
  if ((candidate.limits?.maxLatencyMs ?? Infinity) > (brief.priorities.maxLatencyMs ?? Infinity)) reasons.push("latency-limit-exceeded");
  if ((candidate.context?.sources ?? []).some((source) => source.includes("secret:"))) reasons.push("credential-in-context");
  if ((candidate.context?.sources ?? []).some((source) => !(brief.environment.contextSources ?? []).includes(source))) reasons.push("unknown-context-source");
  if (candidate.strategy?.requireCompleteContext) {
    const selectedSources = new Set(candidate.context?.sources ?? []);
    for (const source of brief.environment.contextSources ?? []) if (!selectedSources.has(source)) reasons.push(`incomplete-context:${source}`);
  }
  if (typeof candidate.limits?.maxCostPerTaskUsd !== "number" || !(candidate.limits.maxCostPerTaskUsd > 0)) reasons.push("invalid-cost-limit");
  if (typeof candidate.limits?.maxLatencyMs !== "number" || !(candidate.limits.maxLatencyMs > 0)) reasons.push("invalid-latency-limit");
  for (const metric of ["qualityWeight", "costWeight", "speedWeight", "riskTolerance"]) if (typeof candidate.strategy?.[metric] !== "number" || candidate.strategy[metric] < 0) reasons.push(`invalid-strategy:${metric}`);
  if (typeof candidate.strategy?.requireCompleteContext !== "boolean") reasons.push("invalid-strategy:requireCompleteContext");
  if (!String(candidate.memory?.kind ?? "").trim() || !String(candidate.memory?.scope ?? "").trim()) reasons.push("invalid-memory-policy");
  const sealed = { ...structuredClone(candidate), fingerprint: digest(candidate) };
  return { candidate: sealed, valid: reasons.length === 0, reasons };
}

export function differenceDimensions(a, b) {
  const dimensions = ["model", "instructions", "context", "tools", "memory", "authority", "escalation", "strategy", "limits"];
  return dimensions.filter((dimension) => digest(a[dimension]) !== digest(b[dimension]));
}
