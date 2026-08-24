import { digest } from "../../core/canonical.js";
import { SpecialistAgentRuntime } from "../../runtime/agent-runtime.js";
import { TenantRoleMemory } from "../../runtime/memory.js";
import { ModelDecisionEngine } from "../../runtime/model-decision-engine.js";

export const PANEL_MODEL_TURN_CEILING = 16;

/**
 * World-agnostic model evaluator for the panel — the same contract as the B3
 * access-offboarding evaluator, parameterized by a roster role's world and verifier
 * factories so all five worlds run through identical machinery.
 */
export async function runPanelModelCase({ role, candidate, testCase, gateway, evidence, armId, stage, tenantPrefix, maxTurns = PANEL_MODEL_TURN_CEILING }) {
  const task = testCase.payload ? { id: testCase.id, ...structuredClone(testCase.payload) } : structuredClone(testCase);
  const world = role.worldFactory(task);
  const verifier = role.verifierFactory(task, world.initial);
  const runtime = new SpecialistAgentRuntime({ decisionEngine: new ModelDecisionEngine({ gateway }), memory: new TenantRoleMemory(), evidence, maxTurns });
  const logicalCallsBefore = gateway.logicalCalls ?? null;
  const startedAt = Date.now();
  const result = await runtime.run({ tenantId: `${tenantPrefix}:${role.key}:${armId}:${stage}:${candidate.id}:${task.id}`, candidate, goal: task.goal, toolHost: world, externalVerifier: verifier });
  const verification = result.verification ?? await verifier.verify({ externalState: world.externalState(), session: result.session, resolution: { kind: "error", blocker: result.reason ?? result.status } });
  const logicalCallsAfter = gateway.logicalCalls ?? null;
  const receipt = { candidateFingerprint: candidate.fingerprint, caseId: task.id, verifierId: verifier.id, verification, terminalStatus: result.status };
  return {
    candidateId: candidate.id,
    candidateFingerprint: candidate.fingerprint,
    caseId: task.id,
    verifierId: verifier.id,
    verifierKind: "independent-external-state",
    independentlyVerified: true,
    passed: verification.passed,
    outcomeScore: verification.outcomeScore,
    unsafeAttempts: verification.checks?.noDeniedAttempts === false ? 1 : 0,
    incorrectSideEffects: verification.incorrectSideEffects ?? 0,
    modelCostUsd: result.session?.modelCostUsd ?? 0,
    elapsedMs: Date.now() - startedAt,
    toolCalls: result.session?.toolReceipts?.length ?? 0,
    humanInterventions: 0,
    verificationReceiptHash: digest(receipt),
    verification,
    accounting: { actualCalls: logicalCallsBefore == null ? 0 : logicalCallsAfter - logicalCallsBefore },
  };
}

export class PanelAdaptiveEvaluator {
  constructor({ role, gatewaysByArm, evidence, tenantPrefix = "das013-panel" }) {
    this.role = role; this.gatewaysByArm = gatewaysByArm; this.evidence = evidence; this.tenantPrefix = tenantPrefix;
  }
  async estimate({ candidate, cases }) {
    return { maximumUsd: candidate.limits.maxCostPerTaskUsd * cases.length, maximumCalls: PANEL_MODEL_TURN_CEILING * cases.length };
  }
  async evaluate({ armId, candidate, cases, round, stage = "development" }) {
    const gateway = this.gatewaysByArm[armId];
    if (!gateway) throw new Error(`Missing model gateway for ${armId}`);
    const observations = [];
    for (const testCase of cases) {
      const row = await runPanelModelCase({ role: this.role, candidate, testCase, gateway, evidence: this.evidence, armId, stage: stage === "common-confirmation" ? stage : `development-round-${round}`, tenantPrefix: this.tenantPrefix });
      observations.push(row);
      if (row.unsafeAttempts > 0 || row.incorrectSideEffects > 0) break;
    }
    return {
      observations,
      accounting: {
        actualUsd: observations.reduce((sum, row) => sum + row.modelCostUsd, 0),
        actualCalls: observations.reduce((sum, row) => sum + row.accounting.actualCalls, 0),
      },
    };
  }
}
