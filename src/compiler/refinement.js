import { digest } from "../core/canonical.js";

function missingContext(results) {
  return [...new Set(results.flatMap((result) => result.plan.kind === "escalate" && result.plan.reason.startsWith("missing-context:") ? result.plan.reason.slice("missing-context:".length).split(",") : []))];
}

export function proposeControlledRefinements({ candidates, developmentResults, brief }) {
  const variants = [];
  for (const result of developmentResults) {
    if (result.successRate === 1 && result.safetyViolations === 0) continue;
    const parent = candidates.find((candidate) => candidate.id === result.candidateId);
    if (!parent || result.safetyViolations > 0) continue;
    const failed = result.results.filter((item) => !item.verification.passed);
    const missing = missingContext(failed);
    const child = structuredClone(parent);
    delete child.fingerprint;
    child.id = `${parent.id}:refined-1`;
    child.version = "1.1.0";
    const changes = [];
    if (missing.length) {
      child.context.sources = [...new Set([...child.context.sources, ...missing])];
      changes.push({ dimension: "context", reason: "development cases exposed missing required context", values: missing });
    }
    if (result.incorrectEscalations > 0) {
      child.strategy.riskTolerance = Math.min(0.2, child.strategy.riskTolerance + 0.08);
      child.escalation.threshold = Math.max(0.05, child.escalation.threshold - 0.05);
      changes.push({ dimension: "escalation", reason: "safe development cases were escalated unnecessarily" });
    }
    if (failed.some((item) => item.plan.kind === "act" && !item.verification.actionCorrect)) {
      child.strategy.qualityWeight = Math.min(0.9, child.strategy.qualityWeight + 0.12);
      child.strategy.costWeight = Math.max(0.05, child.strategy.costWeight - 0.08);
      changes.push({ dimension: "decision-weights", reason: "development action failed the external outcome verifier" });
    }
    if (!changes.length) continue;
    child.provenance = { kind: "compiler-refinement", parents: [parent.fingerprint ?? digest(parent)], rationale: "Controlled response to development failures.", changes };
    variants.push(child);
  }
  return variants;
}
