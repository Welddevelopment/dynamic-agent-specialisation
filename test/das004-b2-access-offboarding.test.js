import test from "node:test";
import assert from "node:assert/strict";
import { digest } from "../src/core/canonical.js";
import { validateCandidate } from "../src/compiler/candidate.js";
import { accessOffboardingBrief, importedAccessOffboardingAgent } from "../src/roles/access-offboarding.js";
import { AccessOffboardingVerifier, AccessOffboardingWorld } from "../src/worlds/access-offboarding-world.js";
import { accessOffboardingConfirmationPayloads, accessOffboardingDevelopmentCases } from "../src/worlds/access-offboarding-cases.js";
import { runReferenceAccessOffboardingCase } from "../src/experiments/das004-b2/reference-preflight.js";
import { analyzeDas004B2Result } from "../src/experiments/das004-b2/analyze-result.js";
import { assertDas004B2Authorization } from "../src/experiments/das004-b2/authorization.js";
import { ModelAdaptiveDesigner } from "../src/experiments/das004-b2/model-adaptive-designer.js";
import { assertDas004B2Preregistration, createDas004B2Preregistration, DAS004_B2_APPROVAL, DAS004_B2_PRICING_DATE, DAS004_B2_PRICING_HASH } from "../src/experiments/das004-b2/protocol.js";

function containsKey(value, key) {
  if (!value || typeof value !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(value, key)) return true;
  return Object.values(value).some((entry) => containsKey(entry, key));
}

test("fresh access-offboarding role and imported agent satisfy the bounded candidate contract", () => {
  const validation = validateCandidate(importedAccessOffboardingAgent, accessOffboardingBrief);
  assert.equal(validation.valid, true);
  assert.equal(accessOffboardingBrief.successCriteria.independent, true);
  assert.deepEqual(importedAccessOffboardingAgent.context.sources, accessOffboardingBrief.environment.contextSources);
});

test("deterministic reference passes every prospective development and confirmation case", async () => {
  const cases = [...accessOffboardingDevelopmentCases, ...accessOffboardingConfirmationPayloads.map((payload, index) => ({ id: `confirmation-${index + 1}`, ...payload }))];
  for (const testCase of cases) {
    const { result, externalState } = await runReferenceAccessOffboardingCase(testCase);
    assert.equal(result.status, "completed", testCase.id);
    assert.equal(result.verification.passed, true, testCase.id);
    assert.equal(result.verification.outcomeScore, 1, testCase.id);
    assert.equal(externalState.deniedAttempts.length, 0, testCase.id);
  }
});

test("world blocks privileged revocation and verifier rejects do-nothing completion", async () => {
  const task = accessOffboardingDevelopmentCases[2];
  const world = new AccessOffboardingWorld({ task });
  await assert.rejects(world.execute("revoke-access-grant", { workerId: "worker-dana", grantId: "grant-dana-prod", idempotencyKey: "attack" }), /requires-handoff/);
  assert.equal(world.externalState().deniedAttempts.length, 1);
  const clean = new AccessOffboardingWorld({ task });
  const verifier = new AccessOffboardingVerifier({ task, initialState: clean.initial });
  const result = await verifier.verify({ externalState: clean.externalState(), resolution: { kind: "complete" } });
  assert.equal(result.passed, false);
  assert.ok(result.outcomeScore < 1);
});

test("preregistration freezes equal access, resources, hidden confirmation and current pricing", () => {
  const plan = assertDas004B2Preregistration(createDas004B2Preregistration());
  assert.equal(plan.sharedAccess.sameImportedAgent, true);
  assert.equal(plan.sharedAccess.sameRoleToolsContextPoliciesAuthorityVerifier, true);
  assert.equal(plan.sharedAccess.sameDevelopmentCases, true);
  assert.equal(plan.sharedAccess.sameConfirmationVault, true);
  assert.equal(plan.caseFreeze.confirmationVisibleDuringEngineering, false);
  assert.equal(plan.resources.plannedCombinedMaximumUsd, 2.7);
  assert.equal(plan.resources.hardCampaignCeilingUsd, 3);
  assert.equal(plan.pricing.pricingHash, DAS004_B2_PRICING_HASH);
  const mutated = structuredClone(plan); mutated.protocol.perArmLimits.maximumEngineeringCalls = 3;
  assert.throws(() => assertDas004B2Preregistration(mutated), /integrity/);
});

test("paid authorization is exact, current-date and plan-bound", () => {
  const plan = createDas004B2Preregistration();
  const environment = {
    DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED",
    DAS004_B2_APPROVAL: DAS004_B2_APPROVAL,
    DAS004_B2_PLAN_HASH: plan.planHash,
    DAS004_B2_PRICING_HASH,
    DAS004_B2_PRICING_DATE,
    DAS004_B2_LIMIT_USD: "3",
    OPENAI_API_KEY: "test-key-that-is-long-enough-for-validation",
  };
  assert.equal(assertDas004B2Authorization({ plan, environment, now: () => new Date("2026-08-13T19:00:00Z") }).limitUsd, 3);
  assert.throws(() => assertDas004B2Authorization({ plan, environment: { ...environment, DAS004_B2_LIMIT_USD: "3.01" }, now: () => new Date("2026-08-13T19:00:00Z") }), /limit/);
  assert.throws(() => assertDas004B2Authorization({ plan, environment, now: () => new Date("2026-08-14T00:00:00Z") }), /current/);
});

test("adaptive designer emits an OpenAI-compatible schema while preserving array uniqueness fail-closed", async () => {
  const parent = structuredClone(importedAccessOffboardingAgent);
  let request;
  const duplicate = structuredClone(parent);
  duplicate.id = "duplicate-output";
  duplicate.version = "2";
  duplicate.context.sources = [duplicate.context.sources[0], duplicate.context.sources[0]];
  duplicate.provenance = { kind: "das-compiler-generated", parents: [parent.fingerprint], rationale: "test" };
  const gateway = {
    projectCost: (value) => { request = structuredClone(value); return 0; },
    generate: async () => ({ output: { actions: [{ kind: "fork", parentFingerprint: parent.fingerprint, rationale: "test", candidate: duplicate }] }, actualUsd: 0, usage: {} }),
  };
  const designer = new ModelAdaptiveDesigner({ armId: "das", brief: accessOffboardingBrief, gateway });
  await assert.rejects(designer.propose({ round: 1, parents: [parent], developmentFeedback: [], allowedModelFamilies: ["gpt-5.6-luna", "gpt-5.6-terra"], maximumChildrenPerParent: 1, hiddenCases: null }), /duplicate values/);
  assert.equal(containsKey(request.responseFormat.schema, "uniqueItems"), false);
});

function fakeDevelopmentResult({ armId, candidateId, fingerprint, confirmationScore, confirmationCost, confirmationLatency }) {
  const summary = { safe: true, passRate: 1, meanOutcomeScore: confirmationScore, unsafeAttempts: 0, incorrectSideEffects: 0, operatingCostUsd: confirmationCost, meanElapsedMs: confirmationLatency };
  return {
    development: {
      schemaVersion: "das.adaptive-engineer-result.v1",
      armId,
      selected: { candidate: { id: candidateId, fingerprint }, summary, developmentRecordHash: digest({ armId, candidateId }) },
      evaluated: [{ candidate: { id: candidateId, fingerprint }, summary }],
      rejections: [], actions: [],
      resources: { engineering: { spentUsd: 0.01, settledCalls: 1 }, operating: { spentUsd: 0.02, settledCalls: 2 } },
      automatedEngineering: { actionCount: 0, retained: 0, revisions: 0, modelSwitches: 0, forks: 0 },
      developmentDiversity: { exactUniqueDesigns: 1 }, stopReason: "no-new-valid-candidate",
    },
    confirmation: { summary, rows: [{ caseId: "confirmation-1", passed: true, outcomeScore: confirmationScore, unsafeAttempts: 0, incorrectSideEffects: 0, modelCostUsd: confirmationCost, elapsedMs: confirmationLatency, toolCalls: 3, verificationReceiptHash: digest({ armId }) }] },
  };
}

test("analysis preserves a tie and does not invent a winner", () => {
  const plan = createDas004B2Preregistration();
  const das = fakeDevelopmentResult({ armId: "das", candidateId: "das-final", fingerprint: "a", confirmationScore: 1, confirmationCost: 0.02, confirmationLatency: 1000 });
  const adaptive = fakeDevelopmentResult({ armId: "adaptive-engineer", candidateId: "adaptive-final", fingerprint: "b", confirmationScore: 1, confirmationCost: 0.021, confirmationLatency: 990 });
  const pairResult = {
    schemaVersion: "das.adaptive-baseline-pair-result.v1", protocolHash: plan.protocol.protocolHash, resultHash: "pair-hash", noFallbackWinner: true, confirmationReleaseCount: 1,
    armResults: { das: das.development, "adaptive-engineer": adaptive.development }, confirmation: { das: das.confirmation, "adaptive-engineer": adaptive.confirmation },
  };
  const result = analyzeDas004B2Result({ plan, pairResult, budget: { spentUsd: 0.1, calls: [] }, confirmationReleaseCount: 1, startedAt: "2026-08-14T00:00:00Z", completedAt: "2026-08-14T00:01:00Z" });
  assert.equal(result.verdict, "tie-or-mixed-under-materiality-rule");
  assert.equal(result.materiallyBetterArm, null);
  assert.match(result.strongestAccurateClaim, /neither/);
});
