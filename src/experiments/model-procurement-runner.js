import { SpecialistAgentRuntime } from "../runtime/agent-runtime.js";
import { TenantRoleMemory } from "../runtime/memory.js";
import { ModelDecisionEngine } from "../runtime/model-decision-engine.js";
import { RealisticProcurementCompany, RealisticProcurementVerifier } from "../worlds/realistic-procurement-company.js";

export async function runModelProcurementCase({ candidate, testCase, gateway, evidence, executionModel, maxTurns = 20, tenantPrefix = "piece2" }) {
  const world = new RealisticProcurementCompany({ task: testCase, loseWriteResponseFor: testCase.executionFault });
  const verifier = new RealisticProcurementVerifier({ task: testCase, initialState: world.initial });
  const runtime = new SpecialistAgentRuntime({ decisionEngine: new ModelDecisionEngine({ gateway }), memory: new TenantRoleMemory(), evidence, maxTurns });
  const beforeSpend = gateway.budget.spentUsd;
  const startedAt = Date.now();
  const result = await runtime.run({ tenantId: `${tenantPrefix}:${candidate.id}:${testCase.id}`, candidate, goal: testCase.goal, toolHost: world, externalVerifier: verifier });
  const verification = result.verification ?? await verifier.verify({ externalState: world.externalState(), resolution: { kind: "error", blocker: result.reason ?? result.status } });
  return {
    candidateId: candidate.id,
    candidateFingerprint: candidate.fingerprint,
    caseId: testCase.id,
    expectedResolution: testCase.expectedResolution,
    executionModel,
    status: result.status,
    blocker: result.blocker ?? null,
    reason: result.reason ?? null,
    passed: verification.passed,
    verification,
    toolCalls: result.session?.toolReceipts?.length ?? 0,
    modelCostUsd: gateway.budget.spentUsd - beforeSpend,
    elapsedMs: Date.now() - startedAt,
  };
}

export function summarizeStage(candidates, results) {
  return candidates.map((candidate) => {
    const rows = results.filter((row) => row.candidateId === candidate.id);
    return {
      candidateId: candidate.id,
      fingerprint: candidate.fingerprint,
      passed: rows.filter((row) => row.passed).length,
      total: rows.length,
      successRate: rows.length ? rows.filter((row) => row.passed).length / rows.length : 0,
      unsafeAttempts: rows.filter((row) => row.verification?.checks?.noDeniedAttempts === false).length,
      correctHandoffs: rows.filter((row) => row.verification?.correctHandoff).length,
      incorrectHandoffs: rows.filter((row) => row.status === "handoff" && !row.verification?.correctHandoff).length,
      costUsd: rows.reduce((sum, row) => sum + row.modelCostUsd, 0),
      elapsedMs: rows.reduce((sum, row) => sum + row.elapsedMs, 0),
      toolCalls: rows.reduce((sum, row) => sum + row.toolCalls, 0),
    };
  });
}
