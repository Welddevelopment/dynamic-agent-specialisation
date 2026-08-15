import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { digest } from "../src/core/canonical.js";
import { createCaseVault } from "../src/evaluation/case-vault.js";
import { createCommercialSupportPack } from "../src/product/commercial-support-pack.js";
import { generateBatchedCandidatePortfolio } from "../src/experiments/candidate-scale/batched-architect.js";
import { DeterministicCandidateBatchArchitect } from "../src/experiments/candidate-scale/deterministic-fixtures.js";
import { DeterministicPairedV6BatchArchitect } from "../src/experiments/candidate-scale/paired-v6-architect.js";
import { assertPairedV6EvaluationInputs, assertPairedV6PostGenerationAudit, rankPairedV6Eligible, summarizePairedV6Participant } from "../src/experiments/candidate-scale/paired-v6-evaluation-contract.js";
import { analyzePairedCandidateScaleV6Result, operationalDecision } from "../src/experiments/candidate-scale/analyze-paired-v6-result.js";
import { createPairedCampaignClock } from "../src/experiments/candidate-scale/paired-campaign-clock.js";
import { createPairedV6ProtocolCore, PAIRED_V6_ARTIFACT_ROOT, V5_FAILURE_RECEIPT_HASH, V5_PRIOR_SPEND_USD, V6_HARD_CEILING_USD } from "../src/experiments/candidate-scale/paired-v6-protocol.js";
import { PAIRED_SCALE_ARTIFACT_ROOT } from "../src/experiments/candidate-scale/paired-protocol.js";
import { freezePairedStructuralSelection } from "../src/experiments/candidate-scale/paired-selection.js";

function seal(value, key = "integrityHash") { const copy = structuredClone(value); delete copy[key]; copy[key] = digest(copy); return copy; }
function batchSeal(value) { const copy = structuredClone(value); delete copy.batchHash; copy.batchHash = digest(copy); return copy; }

async function createFixture() {
  const protocol = createPairedV6ProtocolCore(); const root = path.resolve(PAIRED_V6_ARTIFACT_ROOT); const v5Root = path.resolve(PAIRED_SCALE_ARTIFACT_ROOT);
  const read = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
  const plan = read(path.join(root, "live-plan.json")); const casePack = read(path.join(root, "private-case-pack.json")); const casePackReceipt = read(path.join(root, "private-case-pack-preflight-receipt.json"));
  const v5Failure = read(path.join(v5Root, "model-campaign", "generation-failure-receipt.json")); const v5BudgetPath = path.join(v5Root, "model-campaign", "budget.json"); const v5BudgetBytes = fs.readFileSync(v5BudgetPath); const v5BudgetState = read(v5BudgetPath);
  const brief = createCommercialSupportPack().roleDraft.compiled.brief;
  const generated = await generateBatchedCandidatePortfolio({ brief, architect: new DeterministicPairedV6BatchArchitect({ sourceArchitect: new DeterministicCandidateBatchArchitect() }), targetCount: 150, batchSize: 10, executionModel: { family: protocol.generation.executionModel, tier: "paired-v6-normalized-execution" } });
  const batches = generated.receipt.batches.map((batch) => batchSeal({ ...batch, modelReceipt: { ...batch.modelReceipt, model: "candidate-architect-policy", resolvedModel: protocol.generation.architectModel } }));
  const receiptCore = { ...generated.receipt, batches, architectSpendUsd: 0 }; delete receiptCore.portfolioHash;
  const receipt = { ...receiptCore, portfolioHash: digest({ candidates: generated.candidates, rejected: generated.rejected, receipt: receiptCore }) };
  const budget = seal({ schemaVersion: "das.durable-model-budget.v1", campaignId: protocol.campaignId, hardLimitUsd: V6_HARD_CEILING_USD, warningUsd: V6_HARD_CEILING_USD * 0.8, calls: [] });
  const structural = freezePairedStructuralSelection({ candidates: generated.candidates, brief, prefixCount: protocol.prefixCandidateCount, globalCount: protocol.structuralScreen.globalFinalistCount, meaningfulDistance: protocol.structuralScreen.meaningfulDistanceThreshold });
  const portfolio = seal({ schemaVersion: "das.candidate-scale-paired-generated-portfolio.v6-contract-repair", planHash: plan.planHash, protocolCoreHash: protocol.protocolCoreHash, roleHash: protocol.bindings.roleHash, model: protocol.generation.architectModel, candidates: generated.candidates, rejected: [], receipt, v5FailureReceiptHash: V5_FAILURE_RECEIPT_HASH, cumulativeSpendThroughGenerationUsd: V5_PRIOR_SPEND_USD, budget: { campaignId: protocol.campaignId, hardLimitUsd: V6_HARD_CEILING_USD, warningUsd: V6_HARD_CEILING_USD * 0.8, spentUsd: 0, reservedUsd: 0, calls: [] }, evidenceLedgerValid: true });
  const checkpoint = seal({ schemaVersion: "das.candidate-scale-paired-generation-checkpoint.v6-contract-repair", planHash: plan.planHash, protocolCoreHash: protocol.protocolCoreHash, casePackHash: plan.casePackHash, pricingHash: protocol.pricingHash, generationReceiptHash: digest(receipt), portfolioIntegrityHash: portfolio.integrityHash, firstFiveCandidateIds: structural.firstFiveCandidateIds, globalFinalistIds: structural.globalFinalistIds, protectedFirstFiveFinalistIds: structural.protectedFirstFiveFinalistIds, evaluationUnionIds: structural.evaluationUnionIds, structuralSelectionFreezeHash: structural.freezeHash, generatedCount: 150, validCount: 150, rejectedCount: 0, exactUniqueCount: structural.exactUniqueCount, exactDuplicateCount: structural.exactDuplicates.length, budget: portfolio.budget, cumulativeSpendUsd: V5_PRIOR_SPEND_USD, evidenceLedgerValid: true });
  return { plan, casePack, casePackReceipt, portfolio, checkpoint, structural, v5Failure, v5BudgetState, v5BudgetBytes, protocol, budget };
}

test("V6 evaluation contract accepts a deterministic 150-valid/0-rejected portfolio and recomputes the structural freeze", async () => {
  const fixture = await createFixture();
  assert.doesNotThrow(() => assertPairedV6EvaluationInputs(fixture));
});

test("V6 evaluation contract rejects changed V5 source bytes", async () => {
  const fixture = await createFixture(); fixture.v5BudgetBytes = Buffer.concat([fixture.v5BudgetBytes, Buffer.from("\n")]);
  assert.throws(() => assertPairedV6EvaluationInputs(fixture), /V5 source budget bytes changed/);
});

test("V6 evaluation contract rejects a structural freeze that no longer reproduces", async () => {
  const fixture = await createFixture(); fixture.structural = seal({ ...fixture.structural, globalFinalistIds: [...fixture.structural.globalFinalistIds].reverse() }, "freezeHash");
  assert.throws(() => assertPairedV6EvaluationInputs(fixture), /structural checkpoint|structural selection does not reproduce/);
});

test("V6 paid evaluation requires the explicit audit verdict bound to the exact generation checkpoint", async () => {
  const { checkpoint } = await createFixture();
  assert.throws(() => assertPairedV6PostGenerationAudit({ checkpoint, environment: {} }), /explicit 150-valid/);
  assert.throws(() => assertPairedV6PostGenerationAudit({ checkpoint, environment: { DAS_CANDIDATE_SCALE_V6_GENERATION_AUDIT: "GO_150_VALID_0_REJECTED", DAS_CANDIDATE_SCALE_V6_GENERATION_CHECKPOINT_HASH: "wrong" } }), /exact generation checkpoint/);
  assert.deepEqual(assertPairedV6PostGenerationAudit({ checkpoint, environment: { DAS_CANDIDATE_SCALE_V6_GENERATION_AUDIT: "GO_150_VALID_0_REJECTED", DAS_CANDIDATE_SCALE_V6_GENERATION_CHECKPOINT_HASH: checkpoint.integrityHash } }), { checkpointHash: checkpoint.integrityHash, verdict: "GO_150_VALID_0_REJECTED" });
});

test("V6 operational decision uses the confirmed summaries for distinct winners", () => {
  const condition = (id, score) => ({ selectedCandidateId: id, confirmationSummary: { completeSafePass: true, meanOutcomeScore: score } });
  assert.equal(operationalDecision(condition("prefix", 0.81), condition("global", 0.91)).action, "prefer-adaptive-150");
  assert.equal(operationalDecision(condition("prefix", 0.91), condition("global", 0.81)).action, "retain-first-five");
});

function observation(participant, record, phase, score) {
  const row = {
    verifierId: createPairedV6ProtocolCore().bindings.verifierId,
    independentlyVerified: true,
    passed: true,
    outcomeScore: score,
    unsafeAttempts: 0,
    incorrectSideEffects: 0,
    modelCostUsd: 0,
    campaignSpendUsd: 0,
    elapsedMs: 1,
    modelCalls: 0,
    humanInterventions: 0,
    phase,
    stage: record.stage,
    caseId: record.caseId,
    caseHash: record.caseHash,
    participantId: participant.id,
    participantType: participant.type,
    configurationHash: participant.configurationHash,
    candidateFingerprint: participant.candidateFingerprint,
    acceptedPosition: participant.acceptedPosition ?? null,
    budgetCallReceipts: [],
  };
  row.receiptHash = digest(row); return row;
}

async function createCompletedResultFixture() {
  const fixture = await createFixture(); const { protocol, portfolio, structural, plan, casePack, checkpoint, v5Failure } = fixture;
  const support = createCommercialSupportPack();
  const candidatesById = new Map(portfolio.candidates.map((candidate, index) => [candidate.id, { id: candidate.id, type: "compiler-candidate", configurationHash: candidate.fingerprint, candidateFingerprint: candidate.fingerprint, acceptedPosition: index + 1 }]));
  const candidateParticipants = structural.evaluationUnionIds.map((id) => candidatesById.get(id));
  const baselineParticipants = support.participants.filter((entry) => ["current-agent", "strong-general", "ordinary-manual", "expert-manual"].includes(entry.type)).map((entry) => ({ id: entry.id, type: entry.type, configurationHash: entry.configurationHash, candidateFingerprint: entry.candidate.fingerprint }));
  const selectionCases = ["development", "validation", "adversarial"].flatMap((stage) => casePack.cases[stage].map((testCase) => ({ stage, caseId: testCase.id, caseHash: digest(testCase) })));
  const confirmationCases = ["holdout", "repeat"].flatMap((stage) => casePack.cases[stage].map((testCase) => ({ stage, caseId: testCase.id, caseHash: digest(testCase) })));
  const prefixTargetId = structural.protectedFirstFiveFinalistIds[0];
  const globalTargetId = structural.globalFinalistIds.find((id) => id !== prefixTargetId) ?? structural.globalFinalistIds[0];
  assert.notEqual(prefixTargetId, globalTargetId, "fixture needs distinct arm winners");
  const selectionScore = (id) => id === globalTargetId ? 0.96 : id === prefixTargetId ? 0.91 : 0.80;
  const allSelectionParticipants = [...candidateParticipants, ...baselineParticipants];
  const allSelection = allSelectionParticipants.flatMap((participant) => selectionCases.map((record) => observation(participant, record, "selection", selectionScore(participant.id))));
  const allSelectionSummaries = allSelectionParticipants.map((participant) => summarizePairedV6Participant(participant, allSelection.filter((row) => row.participantId === participant.id), selectionCases.length));
  const positionById = new Map(portfolio.candidates.map((candidate, index) => [candidate.id, index + 1]));
  const prefixWinner = rankPairedV6Eligible(allSelectionSummaries.filter((row) => structural.protectedFirstFiveFinalistIds.includes(row.participantId)), positionById)[0];
  const globalWinner = rankPairedV6Eligible(allSelectionSummaries.filter((row) => structural.globalFinalistIds.includes(row.participantId)), positionById)[0];
  assert.equal(prefixWinner.participantId, prefixTargetId); assert.equal(globalWinner.participantId, globalTargetId);
  const winnerParticipants = [prefixTargetId, globalTargetId].map((id) => candidatesById.get(id));
  const allConfirmationParticipants = [...winnerParticipants, ...baselineParticipants];
  const confirmationScore = (id) => id === globalTargetId ? 0.95 : id === prefixTargetId ? 0.85 : 0.77;
  const allConfirmation = allConfirmationParticipants.flatMap((participant) => confirmationCases.map((record) => observation(participant, record, "confirmation", confirmationScore(participant.id))));
  const allConfirmationSummaries = allConfirmationParticipants.map((participant) => summarizePairedV6Participant(participant, allConfirmation.filter((row) => row.participantId === participant.id), confirmationCases.length));
  const confirmationById = new Map(allConfirmationSummaries.map((row) => [row.participantId, row]));
  const holdoutVault = createCaseVault(`paired-v6:${protocol.protocolCoreHash}:holdout`, casePack.cases.holdout); const repeatVault = createCaseVault(`paired-v6:${protocol.protocolCoreHash}:repeat`, casePack.cases.repeat);
  const preFinal = seal({ schemaVersion: "das.candidate-scale-paired-pre-final-freeze.v6-contract-repair", planHash: plan.planHash, protocolCoreHash: protocol.protocolCoreHash, structuralSelectionFreezeHash: structural.freezeHash, selectionObservationHash: digest(allSelection), prefixWinner: { id: prefixWinner.participantId, configurationHash: prefixWinner.configurationHash }, globalWinner: { id: globalWinner.participantId, configurationHash: globalWinner.configurationHash }, baselineHashesHash: protocol.bindings.baselineHashesHash, holdoutDigest: holdoutVault.digest, repeatDigest: repeatVault.digest, rule: protocol.evaluation.confirmationRule, v5FailureReceiptHash: V5_FAILURE_RECEIPT_HASH }, "freezeHash");
  const conditions = [
    { id: "first-five-prefix", poolCandidateIds: structural.firstFiveCandidateIds, fullEvaluationCandidateIds: structural.protectedFirstFiveFinalistIds, selectedCandidateId: prefixWinner.participantId, selectionSummary: prefixWinner, confirmationSummary: confirmationById.get(prefixWinner.participantId) },
    { id: "adaptive-150-search", poolCandidateIds: portfolio.candidates.map((candidate) => candidate.id), fullEvaluationCandidateIds: structural.globalFinalistIds, selectedCandidateId: globalWinner.participantId, selectionSummary: globalWinner, confirmationSummary: confirmationById.get(globalWinner.participantId) },
  ];
  const candidateIds = new Set(candidateParticipants.map((entry) => entry.id)); const baselineIds = new Set(baselineParticipants.map((entry) => entry.id));
  const prefixSharing = seal({ schemaVersion: "das.candidate-scale-paired-prefix-observation-sharing.v6-contract-repair", planHash: plan.planHash, exactFirstFiveCandidateIds: structural.firstFiveCandidateIds, protectedFirstFiveFinalistIds: structural.protectedFirstFiveFinalistIds, globalFinalistIds: structural.globalFinalistIds, commonEvaluationUnionIds: structural.evaluationUnionIds, selectionObservationCorpusHash: digest(allSelection), prefixObservationHashes: allSelection.filter((row) => candidateIds.has(row.participantId) && structural.protectedFirstFiveFinalistIds.includes(row.participantId)).map((row) => digest(row)), duplicateParticipantCaseKeys: 0, separatePrefixEvaluationCalls: 0, rule: "Every candidate in the union is evaluated once per case; both arms reference the same immutable selection corpus." }, "receiptHash");
  const stageUsage = Object.fromEntries([["selection", allSelection], ["confirmation", allConfirmation]].map(([phase, rows]) => [phase, { observations: rows.length, modelCalls: 0, participantEconomicsUsd: 0, elapsedMs: rows.length }]));
  const budgetSnapshot = { campaignId: protocol.campaignId, hardLimitUsd: V6_HARD_CEILING_USD, warningUsd: V6_HARD_CEILING_USD * 0.8, spentUsd: 0, reservedUsd: 0, calls: [] };
  const result = seal({
    schemaVersion: "das.candidate-scale-paired-combined-result.v6-contract-repair", planHash: plan.planHash, protocolCoreHash: protocol.protocolCoreHash, protocol, casePackHash: plan.casePackHash, casePackReceiptHash: plan.casePackReceiptHash, pricingHash: protocol.pricingHash,
    v5History: { failureReceiptHash: V5_FAILURE_RECEIPT_HASH, budgetSourceHash: fixture.v5Failure.sourceBindings.budgetSha256, spendUsd: V5_PRIOR_SPEND_USD, resultStatus: v5Failure.resultStatus, performanceEvaluationStarted: false }, sharedBindings: { ...protocol.bindings },
    generation: { receipt: portfolio.receipt, candidates: portfolio.candidates, rejected: [], portfolioIntegrityHash: portfolio.integrityHash, checkpointIntegrityHash: checkpoint.integrityHash }, structuralScreen: structural, prefixObservationSharing: prefixSharing, conditions,
    selectionEvaluation: { caseHashes: selectionCases, observations: allSelection.filter((row) => candidateIds.has(row.participantId)), summaries: allSelectionSummaries.filter((row) => candidateIds.has(row.participantId)) }, preFinalSelectionFreeze: preFinal,
    finalConfirmation: { observations: allConfirmation.filter((row) => candidateIds.has(row.participantId)), summaries: allConfirmationSummaries.filter((row) => candidateIds.has(row.participantId)), holdoutReleaseCount: 1, repeatReleaseCount: 1, status: "confirmation-complete", caseHashes: confirmationCases },
    baselines: { participants: baselineParticipants.map(({ candidateFingerprint, ...entry }) => entry), selectionObservations: allSelection.filter((row) => baselineIds.has(row.participantId)), selectionSummaries: allSelectionSummaries.filter((row) => baselineIds.has(row.participantId)), confirmationObservations: allConfirmation.filter((row) => baselineIds.has(row.participantId)), confirmationSummaries: allConfirmationSummaries.filter((row) => baselineIds.has(row.participantId)) },
    stageUsage, durableBudgetSnapshot: budgetSnapshot, cumulativeV5V6SpendUsd: V5_PRIOR_SPEND_USD, evidenceLedgerValid: true, claimBoundary: protocol.metrics.forbiddenInference,
  });
  return { result, context: { plan, casePack, casePackReceipt: fixture.casePackReceipt, portfolio, checkpoint, structural, campaignClock: createPairedCampaignClock({ planHash: plan.planHash, startedAt: "2026-08-12T00:00:00.000Z" }), v6BudgetState: fixture.budget, v5Failure, v5BudgetState: fixture.v5BudgetState, v5BudgetBytes: fixture.v5BudgetBytes, evidenceLedgerValid: true } };
}

test("V6 analyzer validates a complete sealed zero-cost fixture and keeps V5 separate", async () => {
  const { result, context } = await createCompletedResultFixture(); const report = analyzePairedCandidateScaleV6Result(result, context);
  assert.equal(report.history.v5.status, "negative-generation-validity-gate");
  assert.equal(report.history.v5.performanceEvaluationStarted, false);
  assert.equal(report.v6.generation.validCandidates, 150);
  assert.equal(report.v6.decision.action, "prefer-adaptive-150");
});

test("V6 analyzer rejects a claimed rerun of shared first-five observations", async () => {
  const { result, context } = await createCompletedResultFixture();
  const changed = structuredClone(result); delete changed.integrityHash; delete changed.prefixObservationSharing.receiptHash; changed.prefixObservationSharing.separatePrefixEvaluationCalls = 1; changed.prefixObservationSharing.receiptHash = digest(changed.prefixObservationSharing); changed.integrityHash = digest(changed);
  assert.throws(() => analyzePairedCandidateScaleV6Result(changed, context), /first-five observations were not shared exactly/);
});
