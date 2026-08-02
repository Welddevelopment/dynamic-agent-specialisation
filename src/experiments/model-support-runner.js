import { SpecialistAgentRuntime } from "../runtime/agent-runtime.js";
import { TenantRoleMemory } from "../runtime/memory.js";
import { ModelDecisionEngine } from "../runtime/model-decision-engine.js";
import { RealisticSupportCompany, RealisticSupportVerifier } from "../worlds/realistic-support-company.js";

export async function runModelSupportCase({ candidate, testCase, gateway, evidence, executionModel, maxTurns = 48, tenantPrefix = "piece3" }) {
  const world = new RealisticSupportCompany({ task: testCase, loseWriteResponseFor: testCase.executionFault });
  const verifier = new RealisticSupportVerifier({ task: testCase, initialState: world.initial });
  const runtime = new SpecialistAgentRuntime({ decisionEngine: new ModelDecisionEngine({ gateway }), memory: new TenantRoleMemory(), evidence, maxTurns });
  const beforeSpend = gateway.budget.spentUsd;
  const startedAt = Date.now();
  const result = await runtime.run({ tenantId: `${tenantPrefix}:${candidate.id}:${testCase.id}`, candidate, goal: testCase.goal, toolHost: world, externalVerifier: verifier });
  const verification = result.verification ?? await verifier.verify({ externalState: world.externalState(), resolution: { kind: "error", blocker: result.reason ?? result.status, reconciled: false } });
  return {
    candidateId: candidate.id,
    candidateFingerprint: candidate.fingerprint,
    caseId: testCase.id,
    executionModel,
    status: result.status,
    blocker: result.blocker ?? null,
    reason: result.reason ?? null,
    passed: verification.passed,
    outcomeScore: verification.outcomeScore,
    unsafeAttempts: verification.checks.noDeniedAttempts ? 0 : 1,
    verification,
    toolCalls: result.session?.toolReceipts?.length ?? 0,
    modelCostUsd: gateway.budget.spentUsd - beforeSpend,
    elapsedMs: Date.now() - startedAt,
  };
}

export function summarizeSupportStage(candidates, results) {
  return candidates.map((candidate) => {
    const rows = results.filter((row) => row.candidateId === candidate.id);
    return {
      candidateId: candidate.id,
      fingerprint: candidate.fingerprint,
      passed: rows.filter((row) => row.passed).length,
      total: rows.length,
      successRate: rows.length ? rows.filter((row) => row.passed).length / rows.length : 0,
      meanOutcomeScore: rows.length ? rows.reduce((sum, row) => sum + row.outcomeScore, 0) / rows.length : 0,
      unsafeAttempts: rows.reduce((sum, row) => sum + row.unsafeAttempts, 0),
      correctHandoffs: rows.filter((row) => row.verification?.correctHandoff).length,
      costUsd: rows.reduce((sum, row) => sum + row.modelCostUsd, 0),
      elapsedMs: rows.reduce((sum, row) => sum + row.elapsedMs, 0),
      toolCalls: rows.reduce((sum, row) => sum + row.toolCalls, 0),
    };
  });
}
