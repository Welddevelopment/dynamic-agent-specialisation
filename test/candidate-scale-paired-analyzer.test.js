import assert from "node:assert/strict";
import test from "node:test";
import { digest } from "../src/core/canonical.js";
import { analyzePairedCandidateScaleResult, renderPairedCandidateScaleReportMarkdown } from "../src/experiments/candidate-scale/analyze-paired-result.js";

function seal(value, key) { const output = structuredClone(value); output[key] = digest(output); return output; }
function usage({ calls = 1, inputTokens = 10, outputTokens = 5, costUsd = .001, elapsedMs = 10 } = {}) { return { calls, inputTokens, outputTokens, costUsd, elapsedMs }; }

function candidate(ordinal, executionModelHash, candidateContractHash) {
  const configuration = { instructions: `candidate-${ordinal}`, model: "same-model", authority: ["read", "draft"] };
  return seal({
    schemaVersion: "das.candidate-scale-frozen-candidate.v1",
    id: `candidate-${ordinal}`,
    ordinal,
    valid: true,
    candidateContractHash,
    executionModelHash,
    designFingerprint: digest({ design: ordinal === 20 ? 2 : ordinal }),
    architectureSignature: `architecture-${ordinal === 20 ? 2 : Math.ceil(ordinal / 5)}`,
    configuration,
    configurationHash: digest(configuration),
  }, "candidateHash");
}

function baseline(id, executionModelHash) {
  const configuration = { id, instructions: `${id}-baseline`, model: "same-model" };
  return seal({ schemaVersion: "das.candidate-scale-executed-baseline.v1", id, executionModelHash, configuration, configurationHash: digest(configuration) }, "baselineHash");
}

function observation({ participant, phase, testCase, protocol, score, freezeHash = null, passed = true, unsafeAttempts = 0, authorityFailures = 0, incorrectSideEffects = 0, costUsd = .001 }) {
  return seal({
    schemaVersion: "das.candidate-scale-paired-observation.v1",
    participantId: participant.id,
    participantHash: participant.candidateHash ?? participant.baselineHash,
    phase,
    caseId: testCase.id,
    caseHash: testCase.caseHash,
    executionModelHash: protocol.executionModelHash,
    verifierId: protocol.verifier.id,
    verifierHash: protocol.verifier.hash,
    independentlyVerified: true,
    passed,
    score,
    unsafeAttempts,
    authorityFailures,
    incorrectSideEffects,
    ...(phase === "finalConfirmation" && freezeHash ? { selectionFreezeHash: freezeHash } : {}),
    usage: usage({ costUsd }),
  }, "receiptHash");
}

function phase({ name, participants, protocol, scoreFor, freezeHash = null, terminate = [] }) {
  const observations = [];
  const terminations = [];
  for (const participant of participants) {
    const cases = protocol.caseSets[name];
    const stop = terminate.includes(participant.id);
    for (const [index, testCase] of cases.entries()) {
      if (stop && index > 0) break;
      observations.push(observation({
        participant,
        phase: name,
        testCase,
        protocol,
        score: scoreFor(participant, index),
        freezeHash,
        passed: !stop,
        unsafeAttempts: stop ? 1 : 0,
      }));
    }
    if (stop) terminations.push(seal({ participantId: participant.id, phase: name, reason: "safety-gate", unsafeAttempts: 1, authorityFailures: 0, incorrectSideEffects: 0 }, "receiptHash"));
  }
  return seal({
    schemaVersion: "das.candidate-scale-paired-phase.v1",
    phase: name,
    protocolHash: protocol.protocolHash,
    caseSetHash: digest(protocol.caseSets[name]),
    participantIds: participants.map((participant) => participant.id),
    observations,
    terminations,
  }, "phaseHash");
}

function generation({ key, requested, candidates, protocol, dedup = [] }) {
  const records = dedup.map(([candidateId, duplicateOf, reason]) => seal({ candidateId, duplicateOf, reason }, "receiptHash"));
  return seal({
    schemaVersion: "das.candidate-scale-paired-generation.v1",
    protocolHash: protocol.protocolHash,
    architectModelHash: protocol.architectModelHash,
    requestedCount: requested,
    generatedCount: candidates.length,
    candidates,
    rejected: [],
    dedup: records,
    usage: usage({ calls: key === "first-five" ? 1 : 15, inputTokens: key === "first-five" ? 500 : 5_000, outputTokens: key === "first-five" ? 250 : 2_500, costUsd: key === "first-five" ? .05 : .5, elapsedMs: key === "first-five" ? 100 : 1_500 }),
  }, "generationReceiptHash");
}

function condition({ key, candidates, selected, protocol, dedup = [], screenScore }) {
  const generated = generation({ key, requested: key === "first-five" ? 5 : 150, candidates, protocol, dedup });
  const distinct = candidates.filter((item) => !dedup.some(([id]) => id === item.id));
  const fullParticipants = distinct.slice(0, Math.min(distinct.length, key === "first-five" ? 3 : 10));
  const screening = phase({ name: "screening", participants: distinct, protocol, scoreFor: screenScore });
  const fullEvaluation = phase({ name: "fullEvaluation", participants: fullParticipants, protocol, scoreFor: screenScore });
  const selectionFreeze = seal({
    schemaVersion: "das.candidate-scale-selection-freeze.v1",
    selectedCandidateId: selected.id,
    selectedCandidateHash: selected.candidateHash,
    generationReceiptHash: generated.generationReceiptHash,
    protocolHash: protocol.protocolHash,
    selectedBeforeFinalConfirmation: true,
  }, "freezeHash");
  const finalConfirmation = phase({ name: "finalConfirmation", participants: [selected], protocol, scoreFor: () => key === "first-five" ? .80 : .90, freezeHash: selectionFreeze.freezeHash });
  return seal({
    schemaVersion: "das.candidate-scale-paired-condition.v1",
    key,
    protocolHash: protocol.protocolHash,
    generation: generated,
    selectionFreeze,
    phases: { screening, fullEvaluation, finalConfirmation },
    wallClockMs: key === "first-five" ? 60_000 : 300_000,
  }, "conditionHash");
}

function fixture() {
  const executionModelHash = digest("same-execution-model");
  const candidateContractHash = digest("candidate-contract");
  const baselines = [baseline("current", executionModelHash), baseline("ordinary", executionModelHash), baseline("expert", executionModelHash)];
  const protocol = seal({
    schemaVersion: "das.candidate-scale-paired-protocol.v1",
    experimentId: "paired-support-v1",
    roleHash: digest("role"),
    candidateContractHash,
    architectModelHash: digest("architect-model"),
    executionModelHash,
    baselineSetHash: digest(baselines.map((item) => ({ id: item.id, baselineHash: item.baselineHash }))),
    verifier: { id: "support-verifier", hash: digest("support-verifier-code") },
    conditionCounts: { "first-five": 5, "full-search": 150 },
    caseSets: {
      screening: [{ id: "screen-1", caseHash: digest("screen-1") }, { id: "screen-2", caseHash: digest("screen-2") }],
      fullEvaluation: [{ id: "full-1", caseHash: digest("full-1") }],
      finalConfirmation: [{ id: "final-1", caseHash: digest("final-1") }, { id: "final-2", caseHash: digest("final-2") }],
    },
    budgets: {
      "first-five": { maximumCostUsd: 2, maximumCalls: 100, maximumTokens: 100_000, maximumWallClockMs: 120_000 },
      "full-search": { maximumCostUsd: 10, maximumCalls: 1_000, maximumTokens: 1_000_000, maximumWallClockMs: 600_000 },
      baselines: { maximumCostUsd: 2, maximumCalls: 100, maximumTokens: 100_000, maximumWallClockMs: 120_000 },
    },
    decisionRules: { minimumFinalScoreDelta: .05, minimumMarginalGainPerUsd: .001, minimumMarginalGainPerMinute: .001, retainWhenThresholdNotMet: true },
  }, "protocolHash");
  const candidates = Array.from({ length: 150 }, (_, index) => candidate(index + 1, executionModelHash, candidateContractHash));
  const sharedScore = (participant) => .60 + Number(participant.id.split("-").at(-1)) / 1_000;
  const first = condition({ key: "first-five", candidates: candidates.slice(0, 5), selected: candidates[0], protocol, screenScore: sharedScore });
  const full = condition({ key: "full-search", candidates, selected: candidates[149], protocol, dedup: [["candidate-20", "candidate-2", "exact-design"]], screenScore: sharedScore });
  const baselineScores = { current: .58, ordinary: .62, expert: .68 };
  const baselinePhases = Object.fromEntries(["screening", "fullEvaluation", "finalConfirmation"].map((name) => [name, phase({ name, participants: baselines, protocol, scoreFor: (participant) => baselineScores[participant.id] })]));
  const baselineResult = seal({ schemaVersion: "das.candidate-scale-executed-baselines.v1", protocolHash: protocol.protocolHash, participants: baselines, phases: baselinePhases, wallClockMs: 40_000 }, "baselineResultHash");
  return seal({
    schemaVersion: "das.candidate-scale-paired-combined-result.v1",
    protocol,
    protocolHash: protocol.protocolHash,
    conditions: { "first-five": first, "full-search": full },
    baselines: baselineResult,
  }, "combinedResultHash");
}

test("paired analyzer reconciles candidate accounting, final proof, baselines, resources and decision", () => {
  const report = analyzePairedCandidateScaleResult(fixture());
  assert.equal(report.inventory.firstFive.requested, 5);
  assert.equal(report.inventory.fullSearch.generated, 150);
  assert.equal(report.inventory.fullSearch.distinct, 149);
  assert.equal(report.inventory.fullSearch.deduplicated, 1);
  assert.equal(report.finalConfirmation.firstFive.score, .8);
  assert.equal(report.finalConfirmation.fullSearch.score, .9);
  assert.ok(Math.abs(report.finalConfirmation.scoreDelta - .1) < 1e-12);
  assert.equal(report.finalConfirmation.globalWinnerInFirstFive, false);
  assert.equal(report.decision.action, "switch");
  assert.equal(report.productionSearchRecommendation.candidateCount, 150);
  assert.equal(report.safetyAndAuthority.fullSearch.total.unsafeAttempts, 0);
  assert.ok(report.baselineComparisons.fullSearch.find((item) => item.baselineId === "current").safeCandidatesBeatingBaseline > 0);
  assert.ok(report.resourceUse.incremental.costUsd > 0);
  assert.match(renderPairedCandidateScaleReportMarkdown(report), /SWITCH/);
});

test("paired analyzer fails closed on post-freeze candidate mutation", () => {
  const input = fixture();
  input.conditions["full-search"].generation.candidates[149].configuration.instructions = "mutated-after-freeze";
  input.conditions["full-search"].generation.candidates[149].candidateHash = digest(Object.fromEntries(Object.entries(input.conditions["full-search"].generation.candidates[149]).filter(([key]) => key !== "candidateHash")));
  input.conditions["full-search"].generation.generationReceiptHash = digest(Object.fromEntries(Object.entries(input.conditions["full-search"].generation).filter(([key]) => key !== "generationReceiptHash")));
  input.conditions["full-search"].conditionHash = digest(Object.fromEntries(Object.entries(input.conditions["full-search"]).filter(([key]) => key !== "conditionHash")));
  input.combinedResultHash = digest(Object.fromEntries(Object.entries(input).filter(([key]) => key !== "combinedResultHash")));
  assert.throws(() => analyzePairedCandidateScaleResult(input), /configuration changed|selection freeze/);
});

test("paired analyzer fails closed on verifier, case and budget violations", () => {
  const verifier = fixture();
  verifier.conditions["full-search"].phases.finalConfirmation.observations[0].independentlyVerified = false;
  verifier.conditions["full-search"].phases.finalConfirmation.observations[0].receiptHash = digest(Object.fromEntries(Object.entries(verifier.conditions["full-search"].phases.finalConfirmation.observations[0]).filter(([key]) => key !== "receiptHash")));
  verifier.conditions["full-search"].phases.finalConfirmation.phaseHash = digest(Object.fromEntries(Object.entries(verifier.conditions["full-search"].phases.finalConfirmation).filter(([key]) => key !== "phaseHash")));
  verifier.conditions["full-search"].conditionHash = digest(Object.fromEntries(Object.entries(verifier.conditions["full-search"]).filter(([key]) => key !== "conditionHash")));
  verifier.combinedResultHash = digest(Object.fromEntries(Object.entries(verifier).filter(([key]) => key !== "combinedResultHash")));
  assert.throws(() => analyzePairedCandidateScaleResult(verifier), /independent verifier/);

  const budget = fixture();
  budget.conditions["full-search"].generation.usage.costUsd = 50;
  budget.conditions["full-search"].generation.generationReceiptHash = digest(Object.fromEntries(Object.entries(budget.conditions["full-search"].generation).filter(([key]) => key !== "generationReceiptHash")));
  budget.conditions["full-search"].selectionFreeze.generationReceiptHash = budget.conditions["full-search"].generation.generationReceiptHash;
  budget.conditions["full-search"].selectionFreeze.freezeHash = digest(Object.fromEntries(Object.entries(budget.conditions["full-search"].selectionFreeze).filter(([key]) => key !== "freezeHash")));
  for (const observation of budget.conditions["full-search"].phases.finalConfirmation.observations) {
    observation.selectionFreezeHash = budget.conditions["full-search"].selectionFreeze.freezeHash;
    observation.receiptHash = digest(Object.fromEntries(Object.entries(observation).filter(([key]) => key !== "receiptHash")));
  }
  budget.conditions["full-search"].phases.finalConfirmation.phaseHash = digest(Object.fromEntries(Object.entries(budget.conditions["full-search"].phases.finalConfirmation).filter(([key]) => key !== "phaseHash")));
  budget.conditions["full-search"].conditionHash = digest(Object.fromEntries(Object.entries(budget.conditions["full-search"]).filter(([key]) => key !== "conditionHash")));
  budget.combinedResultHash = digest(Object.fromEntries(Object.entries(budget).filter(([key]) => key !== "combinedResultHash")));
  assert.throws(() => analyzePairedCandidateScaleResult(budget), /cost budget/);
});

test("paired analyzer rejects a rerun shared-prefix observation", () => {
  const input = fixture();
  const shared = input.conditions["full-search"].phases.screening.observations.find((row) => row.participantId === "candidate-1" && row.caseId === "screen-1");
  shared.score = .99;
  shared.receiptHash = digest(Object.fromEntries(Object.entries(shared).filter(([key]) => key !== "receiptHash")));
  input.conditions["full-search"].phases.screening.phaseHash = digest(Object.fromEntries(Object.entries(input.conditions["full-search"].phases.screening).filter(([key]) => key !== "phaseHash")));
  input.conditions["full-search"].conditionHash = digest(Object.fromEntries(Object.entries(input.conditions["full-search"]).filter(([key]) => key !== "conditionHash")));
  input.combinedResultHash = digest(Object.fromEntries(Object.entries(input).filter(([key]) => key !== "combinedResultHash")));
  assert.throws(() => analyzePairedCandidateScaleResult(input), /rerun or mutated/);
});
