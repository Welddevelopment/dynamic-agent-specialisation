import test from "node:test";
import assert from "node:assert/strict";
import { digest } from "../src/core/canonical.js";
import { validateCandidate } from "../src/compiler/candidate.js";
import { createCaseVault } from "../src/evaluation/case-vault.js";
import { createPiece2ModelBaselines } from "../src/evaluation/piece2-baselines.js";
import { createAdaptiveEngineeringProtocol, assertAdaptiveEngineeringProtocol } from "../src/evaluation/adaptive-engineering-protocol.js";
import { AdaptiveEngineerController, assertAdaptiveEngineerAction, assertAdaptiveEngineerResult } from "../src/evaluation/adaptive-engineer-controller.js";
import { AdaptiveBaselinePair, assertAdaptiveBaselinePairResult } from "../src/evaluation/adaptive-baseline-pair.js";
import { PairedResourceGovernor } from "../src/evaluation/paired-resource-governor.js";
import { realisticProcurementBrief } from "../src/roles/realistic-procurement.js";

const importedAgent = createPiece2ModelBaselines()[1];
const developmentCases = [
  { id: "development-a", payload: { batchId: "A", expected: "safe-complete" } },
  { id: "development-b", payload: { batchId: "B", expected: "safe-complete" } },
];

function setupProtocol(overrides = {}) {
  const confirmationVault = createCaseVault("adaptive-pair:realistic-procurement-specialist", [
    { batchId: "C", expected: "safe-complete" },
    { batchId: "D", expected: "safe-complete" },
  ]);
  const protocol = createAdaptiveEngineeringProtocol({
    id: "adaptive-engineer-zero-spend-test",
    brief: realisticProcurementBrief,
    importedAgent,
    developmentCases,
    confirmationVault,
    allowedModelFamilies: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"],
    limits: {
      maximumRounds: 2,
      beamWidth: 3,
      maximumChildrenPerParent: 3,
      maximumCandidatesEvaluated: 9,
      maximumEngineeringCalls: 10,
      maximumOperatingCalls: 30,
      maximumEngineeringSpendUsd: 0,
      maximumOperatingSpendUsd: 0,
      maximumWallClockMs: 60_000,
      ...overrides,
    },
  });
  return { protocol, confirmationVault };
}

function variant(parent, { id, kind, family = parent.model.family, unsafe = false, score = 0.9 } = {}) {
  const candidate = structuredClone(parent);
  delete candidate.fingerprint;
  candidate.id = id;
  candidate.version = `${Number(parent.version.split(".")[0]) + 1}.0.0`;
  candidate.provenance = { kind: "adaptive-engineer", action: kind, parents: [parent.fingerprint], rationale: `${kind} based on visible development feedback` };
  if (kind === "switch-model") candidate.model = { ...candidate.model, family };
  if (kind === "revise") candidate.instructions = { ...candidate.instructions, emphasis: [...candidate.instructions.emphasis, `development repair ${score}`] };
  if (kind === "fork") {
    candidate.instructions = { ...candidate.instructions, emphasis: [...candidate.instructions.emphasis, `forked evidence plan ${score}`] };
    candidate.strategy = { ...candidate.strategy, qualityWeight: candidate.strategy.qualityWeight + 0.01 };
  }
  if (unsafe) candidate.instructions = { ...candidate.instructions, style: `${candidate.instructions.style} unsafe-control` };
  const validation = validateCandidate(candidate, realisticProcurementBrief);
  assert.equal(validation.valid, true, validation.reasons.join(","));
  return validation.candidate;
}

function observation(candidate, caseId, { score = 0.7, unsafe = 0, incorrect = 0, cost = 0.1, elapsed = 100 } = {}) {
  return {
    candidateId: candidate.id,
    candidateFingerprint: candidate.fingerprint,
    caseId,
    verifierId: realisticProcurementBrief.successCriteria.verifierId,
    verifierKind: "independent-external-state",
    independentlyVerified: true,
    passed: unsafe === 0 && incorrect === 0 && score >= 0.5,
    outcomeScore: score,
    unsafeAttempts: unsafe,
    incorrectSideEffects: incorrect,
    modelCostUsd: cost,
    elapsedMs: elapsed,
    toolCalls: 4,
    humanInterventions: 0,
    verificationReceiptHash: digest({ candidate: candidate.fingerprint, caseId, score, unsafe, incorrect }),
    verification: { passed: unsafe === 0 && incorrect === 0 && score >= 0.5, externallyObserved: true },
  };
}

function deterministicEvaluator({ unsafeIds = new Set(), scoreById = new Map(), confirmScoreByArm = new Map() } = {}) {
  return {
    async estimate({ cases }) { return { maximumUsd: 0, maximumCalls: 0, cases: cases.length }; },
    async evaluate({ armId, candidate, cases, stage }) {
      const unsafe = unsafeIds.has(candidate.id);
      const score = stage === "common-confirmation" ? (confirmScoreByArm.get(armId) ?? 0.8) : (scoreById.get(candidate.id) ?? 0.7);
      const selectedCases = unsafe ? cases.slice(0, 1) : cases;
      return {
        observations: selectedCases.map((testCase) => observation(candidate, testCase.id, { score: unsafe ? 0 : score, incorrect: unsafe ? 1 : 0, cost: score > 0.85 ? 0.08 : 0.1, elapsed: score > 0.85 ? 80 : 100 })),
        accounting: { actualUsd: 0, actualCalls: 0 },
      };
    },
  };
}

function designer(script) {
  const calls = [];
  return {
    calls,
    async estimate() { return { maximumUsd: 0, maximumCalls: 0 }; },
    async propose(input) {
      assert.equal(input.hiddenCases, null);
      calls.push(structuredClone(input));
      return { actions: script(input), accounting: { actualUsd: 0, actualCalls: 0 } };
    },
  };
}

test("protocol is integrity-bound to the imported agent, cases, verifier, authority, models, and equal resources", () => {
  const { protocol } = setupProtocol();
  assert.equal(assertAdaptiveEngineeringProtocol(JSON.parse(JSON.stringify(protocol))).protocolHash, protocol.protocolHash);
  for (const mutate of [
    (copy) => { copy.importedAgent.fingerprint = "changed"; },
    (copy) => { copy.role.authorityHash = "changed"; },
    (copy) => { copy.role.verifierId = "self-report"; },
    (copy) => { copy.allowedModelFamilies.push("unknown-model"); },
    (copy) => { copy.perArmLimits.maximumOperatingSpendUsd = 999; },
    (copy) => { copy.development.cases[0].caseHash = "changed"; },
  ]) {
    const copy = structuredClone(protocol);
    mutate(copy);
    assert.throws(() => assertAdaptiveEngineeringProtocol(copy), /integrity|changed/i);
  }
});

test("action contract accepts retain, revise, switch, and fork but rejects widening and no-op designs", () => {
  const { protocol } = setupProtocol();
  const revised = variant(importedAgent, { id: "revised", kind: "revise" });
  const switched = variant(importedAgent, { id: "switched", kind: "switch-model", family: "gpt-5.6-terra" });
  const forked = variant(importedAgent, { id: "forked", kind: "fork" });
  for (const action of [
    { kind: "retain", parentFingerprint: importedAgent.fingerprint, rationale: "Current agent remains strongest." },
    { kind: "revise", parentFingerprint: importedAgent.fingerprint, candidate: revised, rationale: "Repair visible miss." },
    { kind: "switch-model", parentFingerprint: importedAgent.fingerprint, candidate: switched, rationale: "Try an allowed stronger model." },
    { kind: "fork", parentFingerprint: importedAgent.fingerprint, candidate: forked, rationale: "Test another complete architecture." },
  ]) assert.equal(assertAdaptiveEngineerAction({ protocol, brief: realisticProcurementBrief, parent: importedAgent, action }).kind, action.kind);

  const widenedRaw = structuredClone(revised);
  delete widenedRaw.fingerprint;
  widenedRaw.authority.allowedActions.push("approve-spend");
  widenedRaw.provenance.parents = [importedAgent.fingerprint];
  assert.throws(() => assertAdaptiveEngineerAction({ protocol, brief: realisticProcurementBrief, parent: importedAgent, action: { kind: "fork", parentFingerprint: importedAgent.fingerprint, candidate: widenedRaw, rationale: "widen" } }), /contract|authority/i);
  assert.throws(() => assertAdaptiveEngineerAction({ protocol, brief: realisticProcurementBrief, parent: importedAgent, action: { kind: "revise", parentFingerprint: importedAgent.fingerprint, candidate: importedAgent, rationale: "noop" } }), /no material change/);
});

test("adaptive beam can retain, revise, switch model, fork, deduplicate, and hard-kill an incorrect child", async () => {
  const { protocol } = setupProtocol();
  const unsafeIds = new Set(["unsafe-fork"]);
  const scores = new Map([["revised", 0.84], ["switched", 0.88], ["safe-fork", 0.94], ["unsafe-fork", 1]]);
  const scripted = designer(({ round, parents }) => {
    if (round > 1) return parents.map((parent) => ({ kind: "retain", parentFingerprint: parent.fingerprint, rationale: "No further material path." }));
    const parent = parents[0];
    const revised = variant(parent, { id: "revised", kind: "revise", score: 0.84 });
    return [
      { kind: "retain", parentFingerprint: parent.fingerprint, rationale: "Preserve control." },
      { kind: "revise", parentFingerprint: parent.fingerprint, candidate: revised, rationale: "Repair visible outcome miss." },
      { kind: "revise", parentFingerprint: parent.fingerprint, candidate: revised, rationale: "Exact duplicate control." },
      { kind: "switch-model", parentFingerprint: parent.fingerprint, candidate: variant(parent, { id: "switched", kind: "switch-model", family: "gpt-5.6-terra" }), rationale: "Allowed model switch." },
      { kind: "fork", parentFingerprint: parent.fingerprint, candidate: variant(parent, { id: "safe-fork", kind: "fork", score: 0.94 }), rationale: "Safe architecture fork." },
      { kind: "fork", parentFingerprint: parent.fingerprint, candidate: variant(parent, { id: "unsafe-fork", kind: "fork", score: 1, unsafe: true }), rationale: "Unsafe control." },
    ];
  });
  const governor = new PairedResourceGovernor({ protocol });
  const controller = new AdaptiveEngineerController({ protocol, brief: realisticProcurementBrief, armId: "adaptive-engineer", designer: scripted, evaluator: deterministicEvaluator({ unsafeIds, scoreById: scores }), governor });
  const result = await controller.run({ importedAgent, developmentCases });
  assert.equal(result.selected.candidate.id, "safe-fork");
  assert.equal(result.automatedEngineering.retained > 0, true);
  assert.equal(result.automatedEngineering.revisions, 1);
  assert.equal(result.automatedEngineering.modelSwitches, 1);
  assert.equal(result.automatedEngineering.forks, 2);
  assert.equal(result.rejections.some((item) => item.reason === "exact-duplicate-candidate"), true);
  assert.equal(result.rejections.some((item) => item.reason === "incorrect-side-effect"), true);
  assert.equal(result.evaluated.find((item) => item.candidate.id === "unsafe-fork").rows.length, 1, "hard-failed candidate must stop on its first observed incorrect effect");
  assert.equal(result.confirmationCasesReleased, false);
  assert.equal(result.prospectiveHumanEffort.measured, false);
  assert.equal(assertAdaptiveEngineerResult(JSON.parse(JSON.stringify(result)), protocol).resultHash, result.resultHash);
});

test("paired comparison uses one starting agent, equal resource envelopes, and freezes both winners before one common confirmation release", async () => {
  const { protocol, confirmationVault } = setupProtocol();
  const dasDesigner = designer(({ round, parents }) => round === 1 ? [{ kind: "fork", parentFingerprint: parents[0].fingerprint, candidate: variant(parents[0], { id: "das-winner", kind: "fork", score: 0.95 }), rationale: "DAS complete candidate." }] : [{ kind: "retain", parentFingerprint: parents[0].fingerprint, rationale: "Retain measured winner." }]);
  const adaptiveDesigner = designer(({ round, parents }) => round === 1 ? [{ kind: "switch-model", parentFingerprint: parents[0].fingerprint, candidate: variant(parents[0], { id: "adaptive-winner", kind: "switch-model", family: "gpt-5.6-terra" }), rationale: "Adaptive model switch." }] : [{ kind: "retain", parentFingerprint: parents[0].fingerprint, rationale: "Retain measured winner." }]);
  const scores = new Map([["das-winner", 0.95], ["adaptive-winner", 0.9]]);
  const commonDevelopmentEvaluator = deterministicEvaluator({ scoreById: scores });
  const commonConfirmationEvaluator = deterministicEvaluator({ confirmScoreByArm: new Map([["das", 0.93], ["adaptive-engineer", 0.86]]) });
  const pair = new AdaptiveBaselinePair({ protocol, brief: realisticProcurementBrief, designers: { das: dasDesigner, "adaptive-engineer": adaptiveDesigner }, developmentEvaluator: commonDevelopmentEvaluator, confirmationEvaluator: commonConfirmationEvaluator });
  const result = await pair.run({ importedAgent, developmentCases, confirmationVault });
  assert.equal(result.status, "common-confirmation-complete");
  assert.equal(result.confirmationReleaseCount, 1);
  assert.equal(confirmationVault.releaseCount(), 1);
  assert.equal(result.freeze.importedAgentFingerprint, importedAgent.fingerprint);
  assert.equal(result.freeze.commonResourceLimitsHash, result.resources.das.equalPerArmLimitsHash);
  assert.equal(result.resources.das.equalPerArmLimitsHash, result.resources["adaptive-engineer"].equalPerArmLimitsHash);
  assert.equal(result.scoreDeltaDasMinusAdaptiveEngineer > 0, true);
  assert.equal(result.noFallbackWinner, true);
  assert.equal(result.automaticActivation, false);
  assert.equal(assertAdaptiveBaselinePairResult(JSON.parse(JSON.stringify(result)), protocol).resultHash, result.resultHash);
});

test("resource governor blocks projected overspend and unresolved reservations block completion", () => {
  const { protocol } = setupProtocol({ maximumEngineeringSpendUsd: 0.1 });
  const governor = new PairedResourceGovernor({ protocol });
  assert.throws(() => governor.reserve({ armId: "das", kind: "engineering", projectedUsd: 0.11, projectedCalls: 1, purpose: "too-large" }), /cross its spend allowance/);
  const reservation = governor.reserve({ armId: "das", kind: "engineering", projectedUsd: 0.1, projectedCalls: 1, purpose: "bounded" });
  assert.throws(() => governor.assertSettled("das"), /unresolved/);
  assert.throws(() => governor.settle({ reservation, actualUsd: 0.101, actualCalls: 1 }), /exceeded/);
  governor.cancel(reservation);
  assert.equal(governor.assertSettled("das").unresolvedReservations, 0);
});

test("wrong development case or verifier fails closed before a provisional winner can be produced", async () => {
  const { protocol } = setupProtocol();
  const quietDesigner = designer(() => []);
  const wrongCaseEvaluator = {
    async estimate() { return { maximumUsd: 0, maximumCalls: 0 }; },
    async evaluate({ candidate }) { return { observations: [observation(candidate, "secret-holdout", { score: 1 })], accounting: { actualUsd: 0, actualCalls: 0 } }; },
  };
  await assert.rejects(() => new AdaptiveEngineerController({ protocol, brief: realisticProcurementBrief, armId: "das", designer: quietDesigner, evaluator: wrongCaseEvaluator, governor: new PairedResourceGovernor({ protocol }) }).run({ importedAgent, developmentCases }), /case boundary/);

  const wrongVerifierEvaluator = {
    async estimate() { return { maximumUsd: 0, maximumCalls: 0 }; },
    async evaluate({ candidate, cases }) {
      const rows = cases.map((testCase) => ({ ...observation(candidate, testCase.id, { score: 1 }), verifierId: "candidate-self-report" }));
      return { observations: rows, accounting: { actualUsd: 0, actualCalls: 0 } };
    },
  };
  await assert.rejects(() => new AdaptiveEngineerController({ protocol, brief: realisticProcurementBrief, armId: "das", designer: quietDesigner, evaluator: wrongVerifierEvaluator, governor: new PairedResourceGovernor({ protocol }) }).run({ importedAgent, developmentCases }), /independent verifier/);
});

test("no safe development winner preserves the confirmation vault instead of choosing a fallback", async () => {
  const { protocol, confirmationVault } = setupProtocol();
  const retainOnly = designer(({ parents }) => parents.map((parent) => ({ kind: "retain", parentFingerprint: parent.fingerprint, rationale: "No safe redesign." })));
  const unsafeEvaluator = deterministicEvaluator({ unsafeIds: new Set([importedAgent.id]) });
  const pair = new AdaptiveBaselinePair({ protocol, brief: realisticProcurementBrief, designers: { das: retainOnly, "adaptive-engineer": retainOnly }, developmentEvaluator: unsafeEvaluator, confirmationEvaluator: deterministicEvaluator() });
  const result = await pair.run({ importedAgent, developmentCases, confirmationVault });
  assert.equal(result.status, "confirmation-not-released");
  assert.equal(result.confirmationReleaseCount, 0);
  assert.equal(confirmationVault.releaseCount(), 0);
  assert.equal(result.automaticActivation, false);
});
