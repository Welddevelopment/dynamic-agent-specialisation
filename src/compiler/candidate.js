import { digest } from "../core/canonical.js";

export const REQUIRED_CANDIDATE_FIELDS = ["id", "roleId", "model", "instructions", "context", "tools", "memory", "authority", "escalation", "verifier", "limits", "strategy", "provenance", "version"];

export function validateCandidate(candidate, brief) {
  const reasons = [];
  for (const field of REQUIRED_CANDIDATE_FIELDS) if (candidate[field] == null) reasons.push(`missing:${field}`);
  if (candidate.roleId !== brief.id) reasons.push("role-mismatch");
  if (!Array.isArray(candidate.tools) || candidate.tools.length === 0) reasons.push("no-tools");
  if (!candidate.escalation?.enabled) reasons.push("no-escalation");
  if (candidate.verifier?.kind === "self-report") reasons.push("self-grading-verifier");
  const allowedActions = new Set(brief.authority.allowedActions ?? []);
  for (const action of candidate.authority?.allowedActions ?? []) if (!allowedActions.has(action)) reasons.push(`excess-authority:${action}`);
  if ((candidate.limits?.maxCostPerTaskUsd ?? Infinity) > (brief.priorities.maxCostPerTaskUsd ?? Infinity)) reasons.push("cost-limit-exceeded");
  if ((candidate.limits?.maxLatencyMs ?? Infinity) > (brief.priorities.maxLatencyMs ?? Infinity)) reasons.push("latency-limit-exceeded");
  if ((candidate.context?.sources ?? []).some((source) => source.includes("secret:"))) reasons.push("credential-in-context");
  const sealed = { ...structuredClone(candidate), fingerprint: digest(candidate) };
  return { candidate: sealed, valid: reasons.length === 0, reasons };
}

export function differenceDimensions(a, b) {
  const dimensions = ["model", "instructions", "context", "tools", "memory", "authority", "escalation", "strategy", "limits"];
  return dimensions.filter((dimension) => digest(a[dimension]) !== digest(b[dimension]));
}

