import { SpecialistAgentRuntime } from "../runtime/agent-runtime.js";
import { TenantRoleMemory } from "../runtime/memory.js";
import { ModelDecisionEngine } from "../runtime/model-decision-engine.js";
import { RealisticRevopsCompany, RealisticRevopsVerifier } from "../worlds/realistic-revops-company.js";

export async function runModelRevopsCase({ candidate, testCase, gateway, evidence, executionModel, maxTurns = 56, tenantPrefix = "piece4" }) {
  const world = new RealisticRevopsCompany({ task: testCase, loseWriteResponseFor: testCase.executionFault });
  const verifier = new RealisticRevopsVerifier({ task: testCase, initialState: world.initial });
  const runtime = new SpecialistAgentRuntime({ decisionEngine: new ModelDecisionEngine({ gateway }), memory: new TenantRoleMemory(), evidence, maxTurns });
  const beforeSpend = gateway.budget.spentUsd; const startedAt = Date.now();
  const result = await runtime.run({ tenantId: `${tenantPrefix}:${candidate.id}:${testCase.id}`, candidate, goal: testCase.goal, toolHost: world, externalVerifier: verifier });
  const verification = result.verification ?? await verifier.verify({ externalState: world.externalState(), resolution: { kind: "error", blocker: result.reason ?? result.status, reconciled: false } });
  return { candidateId: candidate.id, candidateFingerprint: candidate.fingerprint, caseId: testCase.id, executionModel, status: result.status, blocker: result.blocker ?? null, reason: result.reason ?? null, completionSource: result.completionSource ?? null, limitReason: result.limitReason ?? null, passed: verification.passed, outcomeScore: verification.outcomeScore, unsafeAttempts: verification.checks.noDeniedAttempts ? 0 : 1, verifierId: verifier.id, verifierKind: "independent-external-state", verificationRepairRounds: result.session?.verificationRepairRounds ?? 0, verification, toolCalls: result.session?.toolReceipts?.length ?? 0, toolSequence: result.session?.observations?.map((item) => item.tool) ?? [], modelCostUsd: gateway.budget.spentUsd - beforeSpend, elapsedMs: Date.now() - startedAt };
}

export function summarizeRevopsStage(candidates, results) { return candidates.map((candidate) => { const rows = results.filter((row) => row.candidateId === candidate.id); return { candidateId: candidate.id, fingerprint: candidate.fingerprint, passed: rows.filter((row) => row.passed).length, total: rows.length, successRate: rows.length ? rows.filter((row) => row.passed).length / rows.length : 0, meanOutcomeScore: rows.length ? rows.reduce((sum, row) => sum + row.outcomeScore, 0) / rows.length : 0, unsafeAttempts: rows.reduce((sum, row) => sum + row.unsafeAttempts, 0), verificationRepairRounds: rows.reduce((sum, row) => sum + (row.verificationRepairRounds ?? 0), 0), costUsd: rows.reduce((sum, row) => sum + row.modelCostUsd, 0), elapsedMs: rows.reduce((sum, row) => sum + row.elapsedMs, 0), toolCalls: rows.reduce((sum, row) => sum + row.toolCalls, 0) }; }); }
