import test from "node:test";
import assert from "node:assert/strict";
import { EvidenceLedger } from "../src/core/evidence.js";
import { digest } from "../src/core/canonical.js";
import { createCommercialComparisonFreeze } from "../src/product/commercial-comparison.js";
import { CommercialComparisonRunner } from "../src/product/commercial-comparison-runner.js";

function fixture() {
  const intake = { sessionId: "joined-run", company: { name: "Acme" }, role: { templateId: "support-operations", outcome: "Resolve assigned work", completionRule: "External state passes", escalationOwner: "Owner" }, systems: [{ id: "tickets", name: "Tickets", access: "disposable-sandbox", adapterStatus: "verified", contextSources: ["queue"], tools: [{ name: "resolve", mode: "write" }] }], knowledgeSources: [], policies: [{ rule: "check scope", kind: "required-check", confirmed: true }, { rule: "approval", kind: "approval", confirmed: true }, { rule: "no unrelated", kind: "forbidden", confirmed: true }], authority: { allowedActions: ["resolve"], approvalActions: ["large"], forbiddenActions: ["unrelated"] }, examples: Array.from({ length: 5 }, (_, index) => ({ situation: `s${index}`, expected: `e${index}` })), success: { measures: ["correct", "bounded", "verified"], verifierMode: "independent-external-state", verifierStatus: "verified" }, priorities: {}, currentAgent: { mode: "provided", configurationHash: "current" }, dataHandling: { localOnly: true, productionDataIncluded: false, redactionConfirmed: true } };
  const driver = { id: "driver", version: "1", templateId: "support-operations", environment: "disposable-sandbox", status: "verified", operationNames: ["resolve"], verifier: { id: "verifier", status: "verified", independent: true }, systemBindings: [{ systemId: "tickets", adapterId: "a", adapterVersion: "1", status: "verified" }] };
  const stages = [["development", 5], ["validation", 2], ["adversarial", 3], ["unseen", 2]];
  const cases = stages.flatMap(([stage, count]) => Array.from({ length: count }, (_, index) => ({ id: `${stage}-${index}`, stage, payload: { stage, index } })));
  const frozen = [
    ["current", "current-agent", "c"], ["general", "strong-general", "g"], ["ordinary", "ordinary-manual", "o"], ["expert", "expert-manual", "e"], ["candidate", "compiler-candidate", "n"],
  ].map(([id, type, configurationHash]) => ({ id, type, label: id, configurationHash, runnerId: `runner-${id}` }));
  const { contract, unseenVault } = createCommercialComparisonFreeze({ intake, driver, cases, participants: frozen, thresholds: { minimumOutcomeImprovement: .05, minimumRepeatRuns: 3 }, budget: { maximumModelSpendUsd: 1, maximumWallClockMs: 60000, maximumCandidates: 5 } });
  const participants = frozen.map((item) => ({ ...item }));
  return { contract, unseenVault, participants };
}

test("joined runner preserves current agent when compiler improvement is not proved", async () => {
  const { contract, unseenVault, participants } = fixture();
  const evidence = new EvidenceLedger();
  const runner = new CommercialComparisonRunner({ evidence, evaluate: async ({ participant, caseId, verifierId }) => ({ verifierId, independentlyVerified: true, passed: true, outcomeScore: participant.id === "ordinary" ? .95 : 1, unsafeAttempts: 0, incorrectSideEffects: 0, modelCostUsd: 0, elapsedMs: participant.id === "candidate" ? 50 : 60, humanInterventions: 0, receiptHash: `receipt-${participant.id}-${caseId}` }) });
  const result = await runner.run({ contract, unseenVault, participants });
  assert.equal(result.decision, "retain-existing-unproved-upgrade");
  assert.equal(result.selectedParticipantId, "current");
  assert.equal(result.repeatability.runs, 3);
  assert.equal(evidence.verify(), true);
});

test("joined runner rejects an unsafe candidate before unseen release", async () => {
  const { contract, unseenVault, participants } = fixture();
  const runner = new CommercialComparisonRunner({ evaluate: async ({ participant, caseId, stage, verifierId }) => ({ verifierId, independentlyVerified: true, passed: participant.id !== "candidate", outcomeScore: participant.id === "candidate" ? 0 : 1, unsafeAttempts: participant.id === "candidate" && stage === "development" ? 1 : 0, incorrectSideEffects: 0, modelCostUsd: 0, elapsedMs: 1, receiptHash: `receipt-${participant.id}-${caseId}` }) });
  await assert.rejects(() => runner.run({ contract, unseenVault, participants }), /No compiler candidate passed/);
  assert.equal(unseenVault.releaseCount(), 0);
});

test("joined runner refuses to start a projected call beyond the frozen budget", async () => {
  const { contract, unseenVault, participants } = fixture();
  const runner = new CommercialComparisonRunner({ estimateCost: () => 2, evaluate: async () => { throw new Error("should not run"); } });
  await assert.rejects(() => runner.run({ contract, unseenVault, participants }), /hard model-spend limit before the next call/);
  assert.equal(unseenVault.releaseCount(), 0);
});

test("joined runner can prove an equal-quality upgrade through frozen cost and speed targets", async () => {
  const { contract: original, unseenVault, participants } = fixture();
  const contractWithoutHash = structuredClone(original);
  delete contractWithoutHash.freezeHash;
  contractWithoutHash.thresholds.minimumOutcomeImprovement = 0;
  contractWithoutHash.thresholds.minimumCostReduction = .2;
  contractWithoutHash.thresholds.minimumSpeedReduction = .2;
  const contract = Object.freeze({ ...contractWithoutHash, freezeHash: digest(contractWithoutHash) });
  const runner = new CommercialComparisonRunner({
    evaluate: async ({ participant, caseId, verifierId }) => ({
      verifierId,
      independentlyVerified: true,
      passed: true,
      outcomeScore: 1,
      unsafeAttempts: 0,
      incorrectSideEffects: 0,
      modelCostUsd: participant.id === "candidate" ? .001 : .003,
      elapsedMs: participant.id === "candidate" ? 40 : 100,
      humanInterventions: 0,
      receiptHash: `receipt-${participant.id}-${caseId}`,
    }),
  });
  const result = await runner.run({ contract, unseenVault, participants });
  assert.equal(result.decision, "activate-compiler");
  assert.equal(result.selectedParticipantId, "candidate");
  assert.equal(result.improvementAssessment.proved, true);
  assert.ok(result.improvementAssessment.measured.costReduction >= .2);
  assert.ok(result.improvementAssessment.measured.speedReduction >= .2);
});

test("runner separates measured operating cost from incremental cached campaign spend", async () => {
  const { contract: original, unseenVault, participants } = fixture();
  const record = structuredClone(original);
  delete record.freezeHash;
  record.thresholds.minimumOutcomeImprovement = 0;
  record.thresholds.minimumCostReduction = .2;
  record.thresholds.minimumSpeedReduction = .2;
  const contract = Object.freeze({ ...record, freezeHash: digest(record) });
  const runner = new CommercialComparisonRunner({ evaluate: async ({ participant, caseId, verifierId }) => ({ verifierId, independentlyVerified: true, passed: true, outcomeScore: 1, unsafeAttempts: 0, incorrectSideEffects: 0, modelCostUsd: participant.id === "candidate" ? .001 : .003, campaignSpendUsd: 0, elapsedMs: participant.id === "candidate" ? 40 : 100, humanInterventions: 0, receiptHash: `cached-${participant.id}-${caseId}` }) });
  const result = await runner.run({ contract, unseenVault, participants });
  assert.equal(result.decision, "activate-compiler");
  assert.equal(result.spendUsd, 0);
  assert.ok(result.operationalEvaluationCostUsd > 0);
  assert.ok(result.improvementAssessment.measured.costReduction >= .2);
});
