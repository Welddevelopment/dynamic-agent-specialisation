import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { digest } from "../src/core/canonical.js";
import { createCaseVault } from "../src/evaluation/case-vault.js";
import { createCommercialSupportPack } from "../src/product/commercial-support-pack.js";
import { generateBatchedCandidatePortfolio } from "../src/experiments/candidate-scale/batched-architect.js";
import { DeterministicCandidateBatchArchitect } from "../src/experiments/candidate-scale/deterministic-fixtures.js";
import { DeterministicPairedV7BatchArchitect } from "../src/experiments/candidate-scale/paired-v7-architect.js";
import { createPairedCampaignClock } from "../src/experiments/candidate-scale/paired-campaign-clock.js";
import { assertPairedV7EvaluationEntryState, assertPairedV7EvaluationInputs, assertPairedV7PostGenerationAudit, summarizePairedV7Participant } from "../src/experiments/candidate-scale/paired-v7-evaluation-contract.js";
import { analyzePairedCandidateScaleV7Result } from "../src/experiments/candidate-scale/analyze-paired-v7-result.js";
import { PAIRED_V6_ARTIFACT_ROOT, V5_FAILURE_RECEIPT_HASH } from "../src/experiments/candidate-scale/paired-v6-protocol.js";
import { createFreshPairedV7PrivateCasePack, pairedV7PrivateCasePackHash } from "../src/experiments/candidate-scale/paired-v7-private-case-pack.js";
import { createPairedV7ProtocolCore, sealPairedV7Protocol, V6_CONSERVATIVE_SPEND_UPPER_BOUND_USD, V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH, V7_HARD_CEILING_USD, V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD } from "../src/experiments/candidate-scale/paired-v7-protocol.js";
import { PAIRED_SCALE_ARTIFACT_ROOT } from "../src/experiments/candidate-scale/paired-protocol.js";
import { freezePairedStructuralSelection } from "../src/experiments/candidate-scale/paired-selection.js";

function seal(value, key = "integrityHash") { const copy = structuredClone(value); delete copy[key]; copy[key] = digest(copy); return copy; }
function batchSeal(value) { const copy = structuredClone(value); delete copy.batchHash; copy.batchHash = digest(copy); return copy; }

async function buildFixture() {
  const protocol = createPairedV7ProtocolCore(); const v5Root = path.resolve(PAIRED_SCALE_ARTIFACT_ROOT); const v6Root = path.resolve(PAIRED_V6_ARTIFACT_ROOT);
  const read = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
  const casePack = await createFreshPairedV7PrivateCasePack({ seed: Buffer.alloc(32, 77), createdAt: "2026-08-12T00:00:00.000Z" });
  const casePackReceiptCore = { schemaVersion: "das.candidate-scale-paired-case-preflight-receipt.v7-single-writer-recovery", protocolCoreHash: protocol.protocolCoreHash, casePackHash: pairedV7PrivateCasePackHash(casePack), caseCounts: casePack.caseCounts, caseHashes: casePack.caseHashes, roleHash: casePack.roleHash, verifierHash: casePack.verifierHash, baselineHashesHash: casePack.baselineHashesHash, independentReferenceReceipt: casePack.independentReferenceReceipt, shortcutControlReceipt: casePack.shortcutControlReceipt, v5FailureReceiptHash: V5_FAILURE_RECEIPT_HASH, v6InfrastructureFailureReceiptHash: V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH, v6ConservativeSpendUpperBoundUsd: V6_CONSERVATIVE_SPEND_UPPER_BOUND_USD, modelCalls: 0, spendUsd: 0, evidenceBoundary: casePack.evidenceBoundary };
  const casePackReceipt = { ...casePackReceiptCore, receiptHash: digest(casePackReceiptCore) }; const plan = sealPairedV7Protocol({ casePackHash: casePackReceipt.casePackHash, casePackReceiptHash: casePackReceipt.receiptHash });
  const v5Failure = read(path.join(v5Root, "model-campaign", "generation-failure-receipt.json")); const v5BudgetPath = path.join(v5Root, "model-campaign", "budget.json"); const v5BudgetBytes = fs.readFileSync(v5BudgetPath); const v5BudgetState = read(v5BudgetPath);
  const v6Failure = read(path.join(v6Root, "infrastructure-failure-receipt.json"));
  const brief = createCommercialSupportPack().roleDraft.compiled.brief;
  const generated = await generateBatchedCandidatePortfolio({ brief, architect: new DeterministicPairedV7BatchArchitect({ sourceArchitect: new DeterministicCandidateBatchArchitect() }), targetCount: 150, batchSize: 10, executionModel: { family: protocol.generation.executionModel, tier: "paired-v6-normalized-execution" } });
  const batches = generated.receipt.batches.map((batch) => batchSeal({ ...batch, modelReceipt: { ...batch.modelReceipt, model: "candidate-architect-policy", resolvedModel: protocol.generation.architectModel } }));
  const receiptCore = { ...generated.receipt, batches, architectSpendUsd: 0 }; delete receiptCore.portfolioHash;
  const receipt = { ...receiptCore, portfolioHash: digest({ candidates: generated.candidates, rejected: generated.rejected, receipt: receiptCore }) };
  const budget = seal({ schemaVersion: "das.durable-model-budget.v1", campaignId: protocol.campaignId, hardLimitUsd: V7_HARD_CEILING_USD, warningUsd: V7_HARD_CEILING_USD * 0.8, calls: [] });
  const structural = freezePairedStructuralSelection({ candidates: generated.candidates, brief, prefixCount: protocol.prefixCandidateCount, globalCount: protocol.structuralScreen.globalFinalistCount, meaningfulDistance: protocol.structuralScreen.meaningfulDistanceThreshold });
  const writerLockHash = digest("v7-test-writer-lock");
  const portfolio = seal({ schemaVersion: "das.candidate-scale-paired-generated-portfolio.v7-single-writer-recovery", planHash: plan.planHash, protocolCoreHash: protocol.protocolCoreHash, roleHash: protocol.bindings.roleHash, model: protocol.generation.architectModel, candidates: generated.candidates, rejected: [], receipt, v5FailureReceiptHash: V5_FAILURE_RECEIPT_HASH, v6InfrastructureFailureReceiptHash: V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH, v6ConservativeSpendUpperBoundUsd: V6_CONSERVATIVE_SPEND_UPPER_BOUND_USD, priorSharedSpendUpperBoundUsd: V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD, cumulativePriorAndV7SpendUsd: V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD, writerLockHash, budget: { campaignId: protocol.campaignId, hardLimitUsd: V7_HARD_CEILING_USD, warningUsd: V7_HARD_CEILING_USD * 0.8, spentUsd: 0, reservedUsd: 0, calls: [] }, evidenceLedgerValid: true });
  const checkpoint = seal({ schemaVersion: "das.candidate-scale-paired-generation-checkpoint.v7-single-writer-recovery", planHash: plan.planHash, protocolCoreHash: protocol.protocolCoreHash, casePackHash: plan.casePackHash, pricingHash: protocol.pricingHash, generationReceiptHash: digest(receipt), portfolioIntegrityHash: portfolio.integrityHash, firstFiveCandidateIds: structural.firstFiveCandidateIds, globalFinalistIds: structural.globalFinalistIds, protectedFirstFiveFinalistIds: structural.protectedFirstFiveFinalistIds, evaluationUnionIds: structural.evaluationUnionIds, structuralSelectionFreezeHash: structural.freezeHash, generatedCount: 150, validCount: 150, rejectedCount: 0, exactUniqueCount: structural.exactUniqueCount, exactDuplicateCount: structural.exactDuplicates.length, v6InfrastructureFailureReceiptHash: V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH, v6ConservativeSpendUpperBoundUsd: V6_CONSERVATIVE_SPEND_UPPER_BOUND_USD, priorSharedSpendUpperBoundUsd: V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD, writerLockHash, budget: portfolio.budget, cumulativePriorAndV7SpendUsd: V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD, evidenceLedgerValid: true });
  const singleWriterReceipt = seal({ schemaVersion: "das.candidate-scale-paired-single-writer-generation-receipt.v7-single-writer-recovery", planHash: plan.planHash, campaignId: protocol.campaignId, writerLockHash, writerOwnerIdHash: digest("test-owner"), writerPid: 1, acquiredAt: "2026-08-12T00:00:00.000Z", runnerVersion: "paired-v7-generation.v1", checkpointIntegrityHash: checkpoint.integrityHash, evidenceLedgerValid: true, unresolvedReservations: 0, rule: "test" }, "receiptHash");
  return { plan, casePack, casePackReceipt, portfolio, checkpoint, structural, singleWriterReceipt, v5Failure, v5BudgetState, v5BudgetBytes, v6Failure, protocol, budget };
}

let baseFixturePromise;
async function createFixture() {
  baseFixturePromise ??= buildFixture();
  const base = await baseFixturePromise; const copy = structuredClone(base); copy.v5BudgetBytes = Buffer.from(base.v5BudgetBytes); return copy;
}

test("V7 evaluation contract accepts a deterministic 150-valid/0-rejected portfolio and recomputes the structural freeze", async () => {
  const fixture = await createFixture();
  assert.doesNotThrow(() => assertPairedV7EvaluationInputs(fixture));
});

test("V7 evaluation contract rejects changed V5 source bytes", async () => {
  const fixture = await createFixture(); fixture.v5BudgetBytes = Buffer.concat([fixture.v5BudgetBytes, Buffer.from("\n")]);
  assert.throws(() => assertPairedV7EvaluationInputs(fixture), /V5 source budget bytes changed/);
});

test("V7 evaluation contract rejects a structural freeze that no longer reproduces", async () => {
  const fixture = await createFixture(); fixture.structural = seal({ ...fixture.structural, globalFinalistIds: [...fixture.structural.globalFinalistIds].reverse() }, "freezeHash");
  assert.throws(() => assertPairedV7EvaluationInputs(fixture), /structural checkpoint|structural selection does not reproduce/);
});

test("V7 evaluation contract rejects missing or mismatched single-writer evidence", async () => {
  const missing = await createFixture(); missing.singleWriterReceipt = null;
  assert.throws(() => assertPairedV7EvaluationInputs(missing), /single-writer generation receipt/);
  const changed = await createFixture(); changed.singleWriterReceipt = seal({ ...changed.singleWriterReceipt, writerLockHash: digest("different-lock") }, "receiptHash");
  assert.throws(() => assertPairedV7EvaluationInputs(changed), /exclusive writer lock/);
});

test("V7 evaluation contract rejects changed V6 history and cumulative accounting", async () => {
  const history = await createFixture(); history.v6Failure = seal({ ...history.v6Failure, scientificResultUsable: true }, "receiptHash");
  assert.throws(() => assertPairedV7EvaluationInputs(history), /V6 failure|infrastructure-failure receipt/);
  const cumulative = await createFixture(); cumulative.portfolio = seal({ ...cumulative.portfolio, cumulativePriorAndV7SpendUsd: 0 });
  assert.throws(() => assertPairedV7EvaluationInputs(cumulative), /generation checkpoint does not authorize|portfolio cumulative spend/);
});

test("V7 evaluation entry refuses unresolved reservations and an existing result", () => {
  assert.equal(assertPairedV7EvaluationEntryState({ budgetState: { calls: [] }, combinedResultExists: false }), true);
  assert.throws(() => assertPairedV7EvaluationEntryState({ budgetState: { calls: [{ status: "outcome-unknown" }] }, combinedResultExists: false }), /unresolved provider outcomes/);
  assert.throws(() => assertPairedV7EvaluationEntryState({ budgetState: { calls: [] }, combinedResultExists: true }), /sealed combined result/);
});

test("V7 paid evaluation requires the explicit audit verdict bound to the exact generation checkpoint", async () => {
  const { checkpoint } = await createFixture();
  assert.throws(() => assertPairedV7PostGenerationAudit({ checkpoint, environment: {} }), /explicit 150-valid/);
  assert.throws(() => assertPairedV7PostGenerationAudit({ checkpoint, environment: { DAS_CANDIDATE_SCALE_V7_GENERATION_AUDIT: "GO_150_VALID_0_REJECTED", DAS_CANDIDATE_SCALE_V7_GENERATION_CHECKPOINT_HASH: "wrong" } }), /exact generation checkpoint/);
  assert.deepEqual(assertPairedV7PostGenerationAudit({ checkpoint, environment: { DAS_CANDIDATE_SCALE_V7_GENERATION_AUDIT: "GO_150_VALID_0_REJECTED", DAS_CANDIDATE_SCALE_V7_GENERATION_CHECKPOINT_HASH: checkpoint.integrityHash } }), { checkpointHash: checkpoint.integrityHash, verdict: "GO_150_VALID_0_REJECTED" });
});

function failedObservation(participant, record) {
  const row = {
    verifierId: createPairedV7ProtocolCore().bindings.verifierId, independentlyVerified: true, passed: false, outcomeScore: 0,
    unsafeAttempts: 1, incorrectSideEffects: 0, modelCostUsd: 0, campaignSpendUsd: 0, elapsedMs: 1, modelCalls: 0, humanInterventions: 0,
    phase: "selection", stage: record.stage, caseId: record.caseId, caseHash: record.caseHash,
    participantId: participant.id, participantType: participant.type, configurationHash: participant.configurationHash,
    candidateFingerprint: participant.candidateFingerprint, acceptedPosition: participant.acceptedPosition ?? null, budgetCallReceipts: [],
  };
  row.receiptHash = digest(row); return row;
}

async function createCompletedNoWinnerFixture() {
  const fixture = await createFixture(); const { protocol, plan, casePack, portfolio, checkpoint, structural, v5Failure, v6Failure } = fixture;
  const support = createCommercialSupportPack();
  const candidateById = new Map(portfolio.candidates.map((candidate, index) => [candidate.id, { id: candidate.id, type: "compiler-candidate", configurationHash: candidate.fingerprint, candidateFingerprint: candidate.fingerprint, acceptedPosition: index + 1 }]));
  const candidates = structural.evaluationUnionIds.map((id) => candidateById.get(id));
  const baselines = support.participants.filter((entry) => ["current-agent", "strong-general", "ordinary-manual", "expert-manual"].includes(entry.type)).map((entry) => ({ id: entry.id, type: entry.type, configurationHash: entry.configurationHash, candidateFingerprint: entry.candidate.fingerprint }));
  const selectionCases = ["development", "validation", "adversarial"].flatMap((stage) => casePack.cases[stage].map((testCase) => ({ stage, caseId: testCase.id, caseHash: digest(testCase) })));
  const firstCase = selectionCases[0]; const allParticipants = [...candidates, ...baselines]; const allRows = allParticipants.map((participant) => failedObservation(participant, firstCase));
  const summaries = allParticipants.map((participant) => summarizePairedV7Participant(participant, allRows.filter((row) => row.participantId === participant.id), selectionCases.length));
  const candidateIds = new Set(candidates.map((entry) => entry.id)); const baselineIds = new Set(baselines.map((entry) => entry.id));
  const holdout = createCaseVault(`paired-v7:${protocol.protocolCoreHash}:holdout`, casePack.cases.holdout); const repeat = createCaseVault(`paired-v7:${protocol.protocolCoreHash}:repeat`, casePack.cases.repeat);
  const preFinalSelectionFreeze = seal({ schemaVersion: "das.candidate-scale-paired-pre-final-freeze.v7-single-writer-recovery", planHash: plan.planHash, protocolCoreHash: protocol.protocolCoreHash, structuralSelectionFreezeHash: structural.freezeHash, selectionObservationHash: digest(allRows), prefixWinner: null, globalWinner: null, baselineHashesHash: protocol.bindings.baselineHashesHash, holdoutDigest: holdout.digest, repeatDigest: repeat.digest, rule: protocol.evaluation.confirmationRule, v5FailureReceiptHash: V5_FAILURE_RECEIPT_HASH, v6InfrastructureFailureReceiptHash: V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH }, "freezeHash");
  const prefixObservationSharing = seal({ schemaVersion: "das.candidate-scale-paired-prefix-observation-sharing.v7-single-writer-recovery", planHash: plan.planHash, exactFirstFiveCandidateIds: structural.firstFiveCandidateIds, protectedFirstFiveFinalistIds: structural.protectedFirstFiveFinalistIds, globalFinalistIds: structural.globalFinalistIds, commonEvaluationUnionIds: structural.evaluationUnionIds, selectionObservationCorpusHash: digest(allRows), prefixObservationHashes: allRows.filter((row) => candidateIds.has(row.participantId) && structural.protectedFirstFiveFinalistIds.includes(row.participantId)).map((row) => digest(row)), duplicateParticipantCaseKeys: 0, separatePrefixEvaluationCalls: 0, rule: "Every candidate in the union is evaluated once per case; both arms reference the same immutable selection corpus." }, "receiptHash");
  const conditions = [
    { id: "first-five-prefix", poolCandidateIds: structural.firstFiveCandidateIds, fullEvaluationCandidateIds: structural.protectedFirstFiveFinalistIds, selectedCandidateId: null, selectionSummary: null, confirmationSummary: null },
    { id: "adaptive-150-search", poolCandidateIds: portfolio.candidates.map((candidate) => candidate.id), fullEvaluationCandidateIds: structural.globalFinalistIds, selectedCandidateId: null, selectionSummary: null, confirmationSummary: null },
  ];
  const result = seal({
    schemaVersion: "das.candidate-scale-paired-combined-result.v7-single-writer-recovery", planHash: plan.planHash, protocolCoreHash: protocol.protocolCoreHash, protocol, casePackHash: plan.casePackHash, casePackReceiptHash: plan.casePackReceiptHash, pricingHash: protocol.pricingHash,
    v5History: { failureReceiptHash: V5_FAILURE_RECEIPT_HASH, budgetSourceHash: v5Failure.sourceBindings.budgetSha256, spendUsd: fixture.v5BudgetState.calls.reduce((sum, call) => sum + Number(call.actualUsd ?? 0), 0), resultStatus: v5Failure.resultStatus, performanceEvaluationStarted: false },
    v6History: { infrastructureFailureReceiptHash: V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH, resultStatus: v6Failure.resultStatus, performanceEvaluationStarted: false, scientificResultUsable: false, conservativeSpendUpperBoundUsd: V6_CONSERVATIVE_SPEND_UPPER_BOUND_USD },
    singleWriterGenerationReceiptHash: fixture.singleWriterReceipt.receiptHash, evaluationWriterLockHash: digest("evaluation-writer"), sharedBindings: { ...protocol.bindings },
    generation: { receipt: portfolio.receipt, candidates: portfolio.candidates, rejected: [], portfolioIntegrityHash: portfolio.integrityHash, checkpointIntegrityHash: checkpoint.integrityHash }, structuralScreen: structural, prefixObservationSharing, conditions,
    selectionEvaluation: { caseHashes: selectionCases, observations: allRows.filter((row) => candidateIds.has(row.participantId)), summaries: summaries.filter((row) => candidateIds.has(row.participantId)) }, preFinalSelectionFreeze,
    finalConfirmation: { observations: [], summaries: [], holdoutReleaseCount: 0, repeatReleaseCount: 0, status: "no-safe-winner" },
    baselines: { participants: baselines.map(({ candidateFingerprint, ...entry }) => entry), selectionObservations: allRows.filter((row) => baselineIds.has(row.participantId)), selectionSummaries: summaries.filter((row) => baselineIds.has(row.participantId)), confirmationObservations: [], confirmationSummaries: [] },
    stageUsage: { selection: { observations: allRows.length, modelCalls: 0, participantEconomicsUsd: 0, elapsedMs: allRows.length }, confirmation: { observations: 0, modelCalls: 0, participantEconomicsUsd: 0, elapsedMs: 0 } },
    durableBudgetSnapshot: { campaignId: protocol.campaignId, hardLimitUsd: V7_HARD_CEILING_USD, warningUsd: V7_HARD_CEILING_USD * 0.8, spentUsd: 0, reservedUsd: 0, calls: [] }, cumulativePriorAndV7SpendUsd: V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD, evidenceLedgerValid: true, claimBoundary: protocol.metrics.forbiddenInference,
  });
  return { result, context: { ...fixture, campaignClock: createPairedCampaignClock({ planHash: plan.planHash, startedAt: "2026-08-12T00:00:00.000Z" }), v7BudgetState: fixture.budget, evidenceLedgerValid: true } };
}

test("V7 analyzer accepts a complete sealed no-winner result and preserves V5/V6 boundaries", async () => {
  const { result, context } = await createCompletedNoWinnerFixture(); const report = analyzePairedCandidateScaleV7Result(result, context);
  assert.equal(report.history.v5.status, "negative-generation-validity-gate"); assert.equal(report.history.v6.status, "invalid-concurrent-writer-infrastructure-run");
  assert.equal(report.v7.decision.action, "no-recommendation"); assert.equal(report.v7.resources.cumulativePriorAndV7SpendUsd, V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD);
});

test("V7 analyzer rejects a partial/corrupt completed result", async () => {
  const { result, context } = await createCompletedNoWinnerFixture(); const changed = seal({ ...result, singleWriterGenerationReceiptHash: digest("wrong") });
  assert.throws(() => analyzePairedCandidateScaleV7Result(changed, context), /single-writer generation receipt/);
});
