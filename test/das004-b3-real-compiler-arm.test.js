import test from "node:test";
import assert from "node:assert/strict";
import { attestInstanceEntryPoint, attestorForSealedEntryPoints, declareArmEntryPoints } from "../src/evaluation/execution-attestation.js";
import { accessOffboardingBrief, importedAccessOffboardingAgent } from "../src/roles/access-offboarding.js";
import { assertAdaptiveEngineerAction } from "../src/evaluation/adaptive-engineer-controller.js";
import { CompilerArchitectDesigner } from "../src/experiments/das004-b3/compiler-architect-designer.js";
import { assertDas004B3Authorization } from "../src/experiments/das004-b3/authorization.js";
import { runDas004B3Preflight, assertDas004B3PreflightReady } from "../src/experiments/das004-b3/preflight.js";
import {
  DAS004_B3_APPROVAL, DAS004_B3_ARM_ENTRY_POINTS, DAS004_B3_HARD_LIMIT_USD, DAS004_B3_PRICING_DATE, DAS004_B3_PRICING_HASH,
  armEntryPointsAreDistinct, assertDas004B3Preregistration, createDas004B3Preregistration, createDas004B3ProtocolBundle,
} from "../src/experiments/das004-b3/protocol.js";

const B = accessOffboardingBrief;

function stubPortfolioCandidate(i) {
  return {
    id: `stub-${i}`, roleId: B.id, model: { family: "whatever-the-model-says", tier: "t" },
    instructions: { style: `style-${i}`, emphasis: [`emphasis-${i}`, "verify before completing"] },
    context: { sources: [...B.environment.contextSources], selection: `selection-${i}` },
    tools: [...B.environment.tools], memory: { kind: "task-scoped", scope: "one batch" },
    authority: { allowedActions: [...B.authority.allowedActions] },
    escalation: { enabled: true, threshold: 0.7 + i / 100, mode: "precise-blocker" },
    verifier: { kind: "independent-external-state", binding: B.successCriteria.verifierId },
    limits: { maxCostPerTaskUsd: 0.09, maxLatencyMs: 170_000 },
    strategy: { qualityWeight: 1, costWeight: 0.1, speedWeight: 0.05, riskTolerance: 0.05, requireCompleteContext: true },
    provenance: { kind: "compiler-generated", parents: [], rationale: `rationale-${i}` }, version: "1.0.0",
  };
}
const stubGateway = () => ({ calls: 0, projectCost: () => 0, async generate(request) { this.calls += 1; return { output: JSON.stringify({ candidates: [stubPortfolioCandidate(1), stubPortfolioCandidate(2)] }), actualUsd: 0, model: request.model, provider: "stub", cached: false }; } });

const newDesigner = (gateway) => new CompilerArchitectDesigner({ armId: "das", brief: B, gateway, executionModelFamily: "gpt-5.6-luna", minimumCandidates: 2 });
const proposeArgs = { round: 1, parents: [importedAccessOffboardingAgent], developmentFeedback: [], allowedModelFamilies: ["gpt-5.6-luna", "gpt-5.6-terra"], maximumChildrenPerParent: 2, hiddenCases: null };

// ── The reason B3 exists ───────────────────────────────────────────────────────

test("B3 declares two genuinely distinct arm entry points, unlike B2", () => {
  const plan = assertDas004B3Preregistration(createDas004B3Preregistration());
  assert.equal(plan.distinctArmEntryPoints, true);
  assert.equal(armEntryPointsAreDistinct(), true);
  const das = plan.armEntryPoints.arms.find((row) => row.armId === "das");
  assert.equal(das.module, "src/compiler/model-architect.js");
  assert.equal(das.exportName, "ModelCandidateArchitect");
  assert.equal(das.methodName, "propose");
  const adaptive = plan.armEntryPoints.arms.find((row) => row.armId === "adaptive-engineer");
  assert.notEqual(`${das.module}#${das.exportName}`, `${adaptive.module}#${adaptive.exportName}`);
});

test("a B3 preregistration whose arms are the same code is rejected outright", () => {
  const plan = structuredClone(createDas004B3Preregistration());
  plan.armEntryPoints = declareArmEntryPoints([
    { armId: "das", module: "src/experiments/das004-b2/model-adaptive-designer.js", exportName: "ModelAdaptiveDesigner", methodName: "propose" },
    { armId: "adaptive-engineer", module: "src/experiments/das004-b2/model-adaptive-designer.js", exportName: "ModelAdaptiveDesigner", methodName: "propose" },
  ]);
  plan.distinctArmEntryPoints = false;
  assert.throws(() => assertDas004B3Preregistration(plan), /integrity mismatch|distinct arm entry points|differs from the campaign definition/);
});

test("both declared entry points resolve against real modules", async () => {
  const attestor = await attestorForSealedEntryPoints(DAS004_B3_ARM_ENTRY_POINTS);
  assert.equal(attestor.resolutionState, "resolved");
  assert.equal(attestor.declarations().length, 2);
});

// ── The compiler arm actually runs the compiler ────────────────────────────────

test("the das arm invokes the declared ModelCandidateArchitect.propose and it is attested", async () => {
  const attestor = await attestorForSealedEntryPoints(DAS004_B3_ARM_ENTRY_POINTS);
  const gateway = stubGateway();
  const designer = newDesigner(gateway);
  attestInstanceEntryPoint(attestor, "das", designer.architect);
  assert.throws(() => attestor.assertAllReached(), /never executed/);

  const response = await designer.propose(proposeArgs);
  assert.equal(response.responseReceipt.compilerPath, "ModelCandidateArchitect.propose");
  assert.equal(designer.calls.architect, 1);
  assert.equal(gateway.calls, 1);
  const dasArm = attestor.receipt().arms.find((row) => row.armId === "das");
  assert.equal(dasArm.invocations, 1, "the declared compiler entry point must have executed");
});

test("compiler-generated actions satisfy the controller's action contract", async () => {
  const designer = newDesigner(stubGateway());
  const { protocol } = createDas004B3ProtocolBundle();
  const response = await designer.propose(proposeArgs);
  assert.ok(response.actions.length >= 1);
  for (const action of response.actions) {
    const validated = assertAdaptiveEngineerAction({ protocol, brief: B, parent: importedAccessOffboardingAgent, action });
    assert.ok(["fork", "retain"].includes(validated.kind));
    if (validated.kind === "retain") continue;
    assert.equal(validated.candidate.model.family, "gpt-5.6-luna", "normalized onto the frozen execution family");
    assert.ok(validated.candidate.provenance.parents.includes(importedAccessOffboardingAgent.fingerprint), "lineage stamped");
    assert.ok(validated.differences.length > 0, "must differ from the parent on a scored dimension");
    assert.equal(validated.candidate.verifier.binding, B.successCriteria.verifierId, "verifier never changed");
    assert.deepEqual(validated.candidate.authority.allowedActions, [...B.authority.allowedActions], "authority never widened");
  }
});

test("an empty portfolio fails loudly rather than silently producing nothing", async () => {
  const emptyGateway = { projectCost: () => 0, async generate() { return { output: JSON.stringify({ candidates: [] }), actualUsd: 0, provider: "stub" }; } };
  await assert.rejects(() => newDesigner(emptyGateway).propose(proposeArgs), /returned too few candidates|no valid candidates/);
});

test("the compiler arm emits retain when nothing it generated validates", async () => {
  // Reaching this needs the architect to return something that survives its own validation
  // but not the frozen role contract, so the architect is stubbed on the instance directly.
  const designer = newDesigner(stubGateway());
  designer.architect = { async propose() { return { candidates: [{ id: "broken", roleId: B.id }], rejected: [], modelReceipt: { actualUsd: 0 } }; } };
  const response = await designer.propose(proposeArgs);
  assert.equal(response.actions.length, 1);
  assert.equal(response.actions[0].kind, "retain");
  assert.equal(response.actions[0].candidate, null);
  const { protocol } = createDas004B3ProtocolBundle();
  assert.equal(assertAdaptiveEngineerAction({ protocol, brief: B, parent: importedAccessOffboardingAgent, action: response.actions[0] }).kind, "retain");
});

test("the incumbent is a real competitor, so retain-existing stays reachable by ranking", () => {
  // Campaign-level retain-existing is a ranking outcome, not something the designer emits.
  // The frozen imported agent enters the beam unchanged and can win, exactly as it did twice
  // in the Level 1 three-role campaign.
  const { protocol, importedAgent } = createDas004B3ProtocolBundle();
  assert.equal(importedAgent.fingerprint, protocol.importedAgent.fingerprint);
  assert.equal(importedAgent.provenance.kind, "ordinary-manual-baseline");
  const plan = createDas004B3Preregistration();
  assert.equal(plan.role.importedAgentFingerprint, importedAgent.fingerprint);
  assert.match(plan.confirmationVerdictRule.retainExisting, /retain-existing is the correct outcome/);
});

test("the compiler arm refuses hidden confirmation material", async () => {
  const designer = newDesigner(stubGateway());
  await assert.rejects(() => designer.propose({ ...proposeArgs, hiddenCases: [{ id: "leak" }] }), /hidden confirmation material/);
});

test("the compiler arm refuses an execution family outside the frozen allowlist", async () => {
  const designer = newDesigner(stubGateway());
  await assert.rejects(() => designer.propose({ ...proposeArgs, allowedModelFamilies: ["some-other-model"] }), /outside the campaign allowlist/);
});

// ── Money and freshness gates ──────────────────────────────────────────────────

test("authorization demands all six variables and binds to the exact plan", () => {
  const plan = createDas004B3Preregistration();
  const now = () => new Date(`${DAS004_B3_PRICING_DATE}T12:00:00Z`);
  const env = {
    DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED",
    DAS004_B3_APPROVAL,
    DAS004_B3_PLAN_HASH: plan.planHash,
    DAS004_B3_PRICING_HASH,
    DAS004_B3_PRICING_DATE,
    DAS004_B3_LIMIT_USD: String(DAS004_B3_HARD_LIMIT_USD),
    OPENAI_API_KEY: "x".repeat(24),
  };
  assert.equal(assertDas004B3Authorization({ plan, environment: env, now }).limitUsd, DAS004_B3_HARD_LIMIT_USD);

  for (const key of Object.keys(env)) {
    const missing = { ...env }; delete missing[key];
    assert.throws(() => assertDas004B3Authorization({ plan, environment: missing, now }), new RegExp("."), `missing ${key} must refuse`);
  }
  assert.throws(() => assertDas004B3Authorization({ plan, environment: { ...env, DAS004_B3_PLAN_HASH: "0".repeat(64) }, now }), /not bound to the exact preregistration/);
  assert.throws(() => assertDas004B3Authorization({ plan, environment: { ...env, DAS004_B3_LIMIT_USD: "5" }, now }), /must equal the frozen/);
  assert.throws(() => assertDas004B3Authorization({ plan, environment: env, now: () => new Date("2030-01-01T00:00:00Z") }), /not the current UTC date/);
});

test("preflight is ready, spends nothing, and proves the cases are fresh and solvable", async () => {
  const report = assertDas004B3PreflightReady(await runDas004B3Preflight());
  assert.equal(report.ready, true);
  assert.equal(report.spendUsd, 0);
  assert.equal(report.modelCallsMade, 0);
  assert.equal(report.reusedIdentifiers.length, 0, "no consumed B2 case may be reused");
  assert.equal(report.leakedConfirmation.length, 0, "no confirmation payload may appear in the sealed plan");
  assert.ok(report.reference.every((row) => row.passed), "every case must be solvable");
  assert.ok(report.control.every((row) => !row.passed), "the verifier must reject a do-nothing control");
  assert.match(report.preflightHash, /^[a-f0-9]{64}$/);
});

test("the campaign records the ceiling override and does not claim re-verified pricing", () => {
  const plan = createDas004B3Preregistration();
  assert.equal(plan.resources.hardCampaignCeilingUsd, 3);
  assert.match(plan.resources.ceilingNote, /overriding APR-0003/);
  // Honesty gate: the pricing table was carried forward, not re-checked against the provider.
  assert.equal(plan.pricing.independentlyReverifiedOnThisDate, false);
  assert.match(plan.pricing.carriedForwardFrom, /unchanged/);
  assert.equal(plan.caseFreeze.reusesConsumedCases, false);
});

// ── v3 semantics: an unsafe baseline no longer blocks the comparison ───────────

test("v3: an unsafe baseline seeds the beam, engineering runs, and the baseline can never win", async () => {
  const { AdaptiveEngineerController } = await import("../src/evaluation/adaptive-engineer-controller.js");
  const { PairedResourceGovernor } = await import("../src/evaluation/paired-resource-governor.js");
  const { digest } = await import("../src/core/canonical.js");
  const bundle = createDas004B3ProtocolBundle();
  const imported = bundle.importedAgent;
  const caseIds = bundle.developmentCases.map((row) => row.id);

  const row = (candidate, caseId, { passed, unsafe }) => ({
    candidateId: candidate.id, candidateFingerprint: candidate.fingerprint, caseId,
    verifierId: bundle.protocol.role.verifierId, verifierKind: "independent-external-state",
    independentlyVerified: true, passed, outcomeScore: passed ? 1 : 0.4,
    unsafeAttempts: unsafe ? 1 : 0, incorrectSideEffects: 0, modelCostUsd: 0.001,
    elapsedMs: 50, toolCalls: 3, humanInterventions: 0,
    verificationReceiptHash: digest({ c: candidate.fingerprint, caseId }), verification: null,
  });

  // The baseline attempts a denied write on the first case - unsafe, exactly like the
  // three real screenings that stopped v1 and v2. Children evaluate safe and passing.
  const evaluator = {
    async estimate() { return { maximumUsd: 0.01, maximumCalls: 1 }; },
    async evaluate({ candidate, cases }) {
      const observations = candidate.id === imported.id
        ? [row(candidate, cases[0].id, { passed: false, unsafe: true })]
        : cases.map((c) => row(candidate, c.id, { passed: true, unsafe: false }));
      return { observations, accounting: { actualUsd: 0, actualCalls: 1 } };
    },
  };

  let designerCalls = 0;
  const child = (await newDesigner(stubGateway()).propose(proposeArgs)).actions[0].candidate;
  const designer = {
    async estimate() { return { maximumUsd: 0.01, maximumCalls: 1 }; },
    async propose({ round }) {
      designerCalls += 1;
      if (round === 1) return { actions: [{ kind: "fork", parentFingerprint: imported.fingerprint, rationale: "repair the baseline's unsafe write", candidate: child }], accounting: { actualUsd: 0, actualCalls: 1 } };
      return { actions: [{ kind: "retain", parentFingerprint: imported.fingerprint, rationale: "nothing further", candidate: null }], accounting: { actualUsd: 0, actualCalls: 1 } };
    },
  };

  const controller = new AdaptiveEngineerController({ protocol: bundle.protocol, brief: bundle.brief, armId: "das", designer, evaluator, governor: new PairedResourceGovernor({ protocol: bundle.protocol }) });
  const result = await controller.run({ importedAgent: imported, developmentCases: bundle.developmentCases });

  // THE FIX: pre-v3 this arm died with no-safe-candidate and designerCalls stayed 0.
  assert.ok(designerCalls >= 1, "engineering must run despite the unsafe baseline");
  assert.notEqual(result.stopReason, "no-safe-candidate");
  // Integrity unchanged: the unsafe baseline is recorded but can never be selected.
  assert.equal(result.selected.candidate.id, child.id);
  const baselineRecord = result.evaluated.find((r) => r.candidate.id === imported.id);
  assert.equal(baselineRecord.summary.safe, false);
  assert.equal(baselineRecord.summary.score, -Infinity);
});

test("v3: the preregistration discloses the controller-semantics divergence from B2", () => {
  const plan = createDas004B3Preregistration();
  assert.match(plan.controllerSemantics, /DIVERGENCE FROM B2.*approved by Joel 2026-08-22/s);
  assert.match(plan.controllerSemantics, /can never be selected as winner/);
  assert.equal(plan.campaignId, "das004-b3-access-offboarding-real-compiler-v3");
});
