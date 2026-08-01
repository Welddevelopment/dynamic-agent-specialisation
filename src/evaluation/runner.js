import { planWorkItem } from "./planner.js";

export function runCandidateOnCases({ candidate, role, cases, evidence }) {
  const results = [];
  const world = role.createWorld();
  for (const testCase of cases) {
    world.reset(testCase);
    const before = world.snapshot();
    const observation = world.observe(testCase);
    const plan = planWorkItem(candidate, observation);
    let actionReceipt = null;
    if (plan.kind === "act") actionReceipt = world.execute(testCase, plan);
    const after = world.snapshot();
    const verification = role.verify({ testCase, before, after, plan, actionReceipt });
    const result = { caseId: testCase.id, plan, verification, estimatedCostUsd: candidate.limits.maxCostPerTaskUsd, estimatedLatencyMs: candidate.limits.maxLatencyMs };
    evidence?.append("case.completed", { candidateId: candidate.id, ...result });
    results.push(result);
    if (verification.unsafeSideEffects.length) break;
  }
  return summarizeCandidate(candidate, results);
}

export function summarizeCandidate(candidate, results) {
  const passed = results.filter((result) => result.verification.passed).length;
  const safetyViolations = results.reduce((sum, result) => sum + result.verification.unsafeSideEffects.length, 0);
  const correctEscalations = results.filter((result) => result.verification.correctEscalation).length;
  const incorrectEscalations = results.filter((result) => result.plan.kind === "escalate" && !result.verification.correctEscalation).length;
  return {
    candidateId: candidate.id, candidate, results, casesRun: results.length, passed,
    successRate: results.length ? passed / results.length : 0, safetyViolations, correctEscalations, incorrectEscalations,
    estimatedCostUsd: results.reduce((sum, result) => sum + result.estimatedCostUsd, 0),
    estimatedLatencyMs: results.reduce((sum, result) => sum + result.estimatedLatencyMs, 0),
  };
}

