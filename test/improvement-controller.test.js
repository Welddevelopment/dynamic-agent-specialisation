import test from "node:test";
import assert from "node:assert/strict";
import { tenPercentCostAndSpeedContract } from "../src/optimization/improvement-contract.js";
import { TargetDrivenImprovementController } from "../src/optimization/improvement-controller.js";

const obs = (caseId, { passed = true, unsafeAttempts = 0, outcomeScore = 1, modelCostUsd, elapsedMs, toolCalls = 5, verification = null }) => ({ caseId, passed, unsafeAttempts, outcomeScore, modelCostUsd, elapsedMs, toolCalls, toolSequence: ["read", "act"], verification });

test("target loop refines a plausible near miss until both cost and speed clear 10%", async () => {
  const contract = tenPercentCostAndSpeedContract({ id: "ten-ten", baselineId: "manual", maximumRounds: 3 });
  const metrics = {
    manual: [obs("a", { modelCostUsd: 1, elapsedMs: 100 }), obs("b", { modelCostUsd: 1, elapsedMs: 100 }), obs("c", { modelCostUsd: 1, elapsedMs: 100 })],
    first: [obs("a", { modelCostUsd: .91, elapsedMs: 102, verification: { passed: false, checks: { allHandled: false }, itemChecks: [{ ticketId: "ticket-a", expected: "response", passed: false, requiredOutcomes: ["response:resolved"], observedOutcomes: [], missingOutcomes: ["response:resolved"] }] } }), obs("b", { modelCostUsd: .91, elapsedMs: 98 }), obs("c", { modelCostUsd: .91, elapsedMs: 100 })],
    improved: [obs("a", { modelCostUsd: .88, elapsedMs: 88 }), obs("b", { modelCostUsd: .88, elapsedMs: 89 }), obs("c", { modelCostUsd: .88, elapsedMs: 90 })],
  };
  const diagnoses = [];
  const controller = new TargetDrivenImprovementController({
    contract,
    evaluate: async (candidate) => metrics[candidate.id],
    refine: async ({ diagnosis }) => { diagnoses.push(diagnosis); return { id: "improved" }; },
  });
  const result = await controller.run({ baseline: { id: "manual" }, initialCandidates: [{ id: "first" }] });
  assert.equal(result.status, "target-achieved-on-development");
  assert.equal(result.provisionalWinner.candidate.id, "improved");
  assert.deepEqual(diagnoses[0].missedObjectives.map((item) => item.metric), ["modelCostUsd", "medianElapsedMs"]);
  assert.equal(diagnoses[0].pairedCaseMeasurements.length, 3);
  assert.deepEqual(diagnoses[0].pairedCaseMeasurements[0].candidate.toolSequence, ["read", "act"]);
  assert.equal(diagnoses[0].pairedCaseMeasurements.find((item) => item.caseId === "a").candidate.verificationSummary.itemChecks[0].expected, "response");
  assert.deepEqual(diagnoses[0].pairedCaseMeasurements.find((item) => item.caseId === "a").candidate.verificationSummary.itemChecks[0].missingOutcomes, ["response:resolved"]);
  assert.equal(result.unseenCasesReleased, false);
  assert.equal(result.stopReason, "target-achieved");
});

test("target loop refuses an unsafe fast candidate and stops honestly", async () => {
  const contract = tenPercentCostAndSpeedContract({ id: "ten-ten", baselineId: "manual", maximumRounds: 2 });
  const baseline = [obs("a", { modelCostUsd: 1, elapsedMs: 100 }), obs("b", { modelCostUsd: 1, elapsedMs: 100 }), obs("c", { modelCostUsd: 1, elapsedMs: 100 })];
  let refinements = 0;
  const controller = new TargetDrivenImprovementController({
    contract,
    evaluate: async (candidate) => candidate.id === "manual" ? baseline : baseline.map((item) => ({ ...item, modelCostUsd: .5, elapsedMs: 50, unsafeAttempts: 1 })),
    refine: async () => { refinements += 1; return null; },
  });
  const result = await controller.run({ baseline: { id: "manual" }, initialCandidates: [{ id: "unsafe-fast" }] });
  assert.equal(result.status, "target-not-achieved-within-limits");
  assert.equal(result.provisionalWinner, null);
  assert.equal(refinements, 0);
  assert.equal(result.stopReason, "no-plausible-improvement-path");
});

test("target loop respects a company hard spend limit", async () => {
  const contract = tenPercentCostAndSpeedContract({ id: "budgeted", baselineId: "manual", maximumRounds: 5, maximumModelSpendUsd: .20 });
  let spent = 0;
  const baseline = ["a", "b", "c"].map((caseId) => obs(caseId, { modelCostUsd: 1, elapsedMs: 100 }));
  const controller = new TargetDrivenImprovementController({
    contract,
    spentUsd: () => spent,
    evaluate: async (candidate) => {
      if (candidate.id !== "manual") spent = .20;
      return candidate.id === "manual" ? baseline : baseline.map((item) => ({ ...item, modelCostUsd: .91, elapsedMs: 100 }));
    },
    refine: async () => ({ id: "must-not-run" }),
  });
  const result = await controller.run({ baseline: { id: "manual" }, initialCandidates: [{ id: "near-miss" }] });
  assert.equal(result.stopReason, "hard-model-budget-reached");
  assert.equal(result.status, "target-not-achieved-within-limits");
});

test("target loop can stop when evidence says further improvement is implausible", async () => {
  const contract = tenPercentCostAndSpeedContract({ id: "rational-stop", baselineId: "manual", maximumRounds: 5 });
  const baseline = ["a", "b", "c"].map((caseId) => obs(caseId, { modelCostUsd: 1, elapsedMs: 100 }));
  let refined = false;
  const controller = new TargetDrivenImprovementController({
    contract,
    evaluate: async (candidate) => candidate.id === "manual" ? baseline : baseline.map((item) => ({ ...item, modelCostUsd: .91, elapsedMs: 99 })),
    estimatePotential: async () => 0.05,
    refine: async () => { refined = true; return null; },
  });
  const result = await controller.run({ baseline: { id: "manual" }, initialCandidates: [{ id: "near-miss" }] });
  assert.equal(result.stopReason, "no-plausible-improvement-path");
  assert.equal(refined, false);
  assert.equal(result.bestCandidateFound.candidate.id, "near-miss");
});

test("target loop cannot achieve a target using fewer than the required repeats", async () => {
  const contract = tenPercentCostAndSpeedContract({ id: "ten-ten", baselineId: "manual", maximumRounds: 1 });
  const controller = new TargetDrivenImprovementController({
    contract,
    evaluate: async (candidate) => [obs("single", { modelCostUsd: candidate.id === "manual" ? 1 : .5, elapsedMs: candidate.id === "manual" ? 100 : 50 })],
    refine: async () => null,
  });
  const result = await controller.run({ baseline: { id: "manual" }, initialCandidates: [{ id: "lucky" }] });
  assert.equal(result.status, "target-not-achieved-within-limits");
  assert.equal(result.rounds[0].results[0].assessment.qualityChecks.repeatedEnough, false);
});
