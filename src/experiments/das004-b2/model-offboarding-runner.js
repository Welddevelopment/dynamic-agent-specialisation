import { digest } from "../../core/canonical.js";
import { SpecialistAgentRuntime } from "../../runtime/agent-runtime.js";
import { TenantRoleMemory } from "../../runtime/memory.js";
import { ModelDecisionEngine } from "../../runtime/model-decision-engine.js";
import { AccessOffboardingVerifier, AccessOffboardingWorld } from "../../worlds/access-offboarding-world.js";

export const ACCESS_OFFBOARDING_MODEL_TURN_CEILING = 16;

export async function runModelAccessOffboardingCase({ candidate, testCase, gateway, evidence, armId, stage, maxTurns = ACCESS_OFFBOARDING_MODEL_TURN_CEILING }) {
  const task = testCase.payload ? { id: testCase.id, ...structuredClone(testCase.payload) } : structuredClone(testCase);
  const world = new AccessOffboardingWorld({ task });
  const verifier = new AccessOffboardingVerifier({ task, initialState: world.initial });
  const runtime = new SpecialistAgentRuntime({ decisionEngine: new ModelDecisionEngine({ gateway }), memory: new TenantRoleMemory(), evidence, maxTurns });
  const logicalCallsBefore = gateway.logicalCalls ?? null;
  const startedAt = Date.now();
  const result = await runtime.run({ tenantId: `das004-b2:${armId}:${stage}:${candidate.id}:${testCase.id}`, candidate, goal: task.goal, toolHost: world, externalVerifier: verifier });
  const verification = result.verification ?? await verifier.verify({ externalState: world.externalState(), resolution: { kind: "error", blocker: result.reason ?? result.status } });
  const logicalCallsAfter = gateway.logicalCalls ?? null;
  const receipt = {
    candidateFingerprint: candidate.fingerprint,
    caseId: testCase.id,
    verifierId: verifier.id,
    verification,
    terminalStatus: result.status,
    toolSequence: result.session?.observations?.map((row) => row.tool) ?? [],
  };
  return {
    candidateId: candidate.id,
    candidateFingerprint: candidate.fingerprint,
    caseId: testCase.id,
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

export class AccessOffboardingAdaptiveEvaluator {
  constructor({ gatewaysByArm, evidence }) { this.gatewaysByArm = gatewaysByArm; this.evidence = evidence; }

  async estimate({ armId, candidate, cases }) {
    return { maximumUsd: candidate.limits.maxCostPerTaskUsd * cases.length, maximumCalls: ACCESS_OFFBOARDING_MODEL_TURN_CEILING * cases.length };
  }

  async evaluate({ armId, candidate, cases, round, stage = "development" }) {
    const gateway = this.gatewaysByArm[armId];
    if (!gateway) throw new Error(`Missing model gateway for ${armId}`);
    const observations = [];
    for (const testCase of cases) {
      const row = await runModelAccessOffboardingCase({ candidate, testCase, gateway, evidence: this.evidence, armId, stage: stage === "common-confirmation" ? stage : `development-round-${round}` });
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
