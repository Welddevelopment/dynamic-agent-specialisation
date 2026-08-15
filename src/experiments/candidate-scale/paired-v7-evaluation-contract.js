import { validateCandidate } from "../../compiler/candidate.js";
import { digest } from "../../core/canonical.js";
import { createCommercialSupportPack } from "../../product/commercial-support-pack.js";
import { freezePairedStructuralSelection } from "./paired-selection.js";
import { assertPairedV7ContextInvariant, pairedV7ContextModeForBatch } from "./paired-v7-contract.js";
import { V5_BUDGET_SOURCE_HASH, V5_FAILURE_RECEIPT_HASH, V5_PRIOR_SPEND_USD } from "./paired-v6-protocol.js";
import { createPairedV7ProtocolCore, V6_CONSERVATIVE_SPEND_UPPER_BOUND_USD, V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH, V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD } from "./paired-v7-protocol.js";
import { assertPairedV7PrivateCasePack, pairedV7PrivateCasePackHash } from "./paired-v7-private-case-pack.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function withoutHash(value, key = "integrityHash") { const copy = structuredClone(value); delete copy[key]; return copy; }
function exact(left, right, message) { requireCondition(digest(left) === digest(right), message); }

export function summarizePairedV7Participant(participant, rows, expectedCases) {
  const modelCostUsd = rows.reduce((sum, row) => sum + row.modelCostUsd, 0);
  const elapsedMs = rows.reduce((sum, row) => sum + row.elapsedMs, 0);
  return {
    participantId: participant.id,
    participantType: participant.type,
    configurationHash: participant.configurationHash,
    casesRun: rows.length,
    expectedCases,
    passed: rows.filter((row) => row.passed).length,
    passRate: rows.filter((row) => row.passed).length / expectedCases,
    meanOutcomeScore: rows.reduce((sum, row) => sum + row.outcomeScore, 0) / expectedCases,
    unsafeAttempts: rows.reduce((sum, row) => sum + row.unsafeAttempts, 0),
    incorrectSideEffects: rows.reduce((sum, row) => sum + row.incorrectSideEffects, 0),
    modelCostUsd,
    elapsedMs,
    modelCalls: rows.reduce((sum, row) => sum + row.modelCalls, 0),
    completeSafePass: rows.length === expectedCases && rows.every((row) => row.passed) && rows.every((row) => row.unsafeAttempts === 0 && row.incorrectSideEffects === 0),
    observationHashes: rows.map((row) => digest(row)),
  };
}

export function rankPairedV7Eligible(summaries, positionById) {
  return summaries.filter((row) => row.completeSafePass).sort((a, b) =>
    b.meanOutcomeScore - a.meanOutcomeScore
    || a.modelCostUsd - b.modelCostUsd
    || a.elapsedMs - b.elapsedMs
    || (positionById.get(a.participantId) ?? Number.MAX_SAFE_INTEGER) - (positionById.get(b.participantId) ?? Number.MAX_SAFE_INTEGER)
    || a.participantId.localeCompare(b.participantId));
}

export function assertPairedV7PostGenerationAudit({ checkpoint, environment = process.env }) {
  requireCondition(checkpoint?.schemaVersion === "das.candidate-scale-paired-generation-checkpoint.v7-single-writer-recovery", "V7 post-generation audit needs the sealed checkpoint");
  requireCondition(environment.DAS_CANDIDATE_SCALE_V7_GENERATION_AUDIT === "GO_150_VALID_0_REJECTED", "V7 paid evaluation is waiting for the explicit 150-valid/0-rejected generation audit");
  requireCondition(environment.DAS_CANDIDATE_SCALE_V7_GENERATION_CHECKPOINT_HASH === checkpoint.integrityHash, "V7 paid evaluation audit is not bound to the exact generation checkpoint");
  return Object.freeze({ checkpointHash: checkpoint.integrityHash, verdict: "GO_150_VALID_0_REJECTED" });
}

export function assertPairedV7EvaluationEntryState({ budgetState, combinedResultExists }) {
  requireCondition(combinedResultExists === false, "V7 already has a sealed combined result; preserve it instead of rerunning evaluation");
  requireCondition(budgetState && Array.isArray(budgetState.calls), "V7 evaluation needs a durable budget state");
  requireCondition(budgetState.calls.every((call) => !["reserved", "outcome-unknown"].includes(call.status)), "V7 evaluation refuses a budget with unresolved provider outcomes");
  return true;
}

export function assertPairedV7EvaluationResumeState({ combinedResultExists, budgetSnapshot }) {
  requireCondition(combinedResultExists === false, "V7 already has a combined result; preserve it instead of evaluating again");
  requireCondition(budgetSnapshot && Array.isArray(budgetSnapshot.calls), "V7 evaluation needs a durable budget snapshot");
  const unresolved = budgetSnapshot.calls.filter((call) => ["reserved", "outcome-unknown"].includes(call.status));
  requireCondition(budgetSnapshot.reservedUsd === 0 && unresolved.length === 0, "V7 evaluation refuses unresolved or unknown provider calls; resolve them through an audited recovery before retrying");
  return true;
}

export function assertPairedV7EvaluationInputs({ plan, casePack, casePackReceipt, portfolio, checkpoint, structural, singleWriterReceipt, v5Failure, v5BudgetState, v5BudgetBytes, v6Failure, protocol = createPairedV7ProtocolCore() }) {
  assertPairedV7PrivateCasePack(casePack, { protocol });
  requireCondition(pairedV7PrivateCasePackHash(casePack) === plan.casePackHash, "V7 evaluation plan/private-pack binding mismatch");
  requireCondition(plan.schemaVersion === "das.candidate-scale-paired-live-plan.v7-single-writer-recovery" && plan.protocolCoreHash === protocol.protocolCoreHash && digest(withoutHash(plan, "planHash")) === plan.planHash, "V7 evaluation live-plan binding mismatch");
  exact(plan.protocol, protocol, "V7 evaluation protocol changed after sealing");
  requireCondition(casePackReceipt?.schemaVersion === "das.candidate-scale-paired-case-preflight-receipt.v7-single-writer-recovery" && digest(withoutHash(casePackReceipt, "receiptHash")) === casePackReceipt.receiptHash, "V7 private-case preflight receipt integrity mismatch");
  requireCondition(casePackReceipt.receiptHash === plan.casePackReceiptHash && casePackReceipt.casePackHash === plan.casePackHash && casePackReceipt.protocolCoreHash === protocol.protocolCoreHash, "V7 private-case receipt is not bound to the live plan");
  for (const key of ["caseCounts", "caseHashes", "independentReferenceReceipt", "shortcutControlReceipt"]) exact(casePackReceipt[key], casePack[key], `V7 private-case receipt ${key} changed`);
  requireCondition(casePackReceipt.roleHash === casePack.roleHash && casePackReceipt.verifierHash === casePack.verifierHash && casePackReceipt.baselineHashesHash === casePack.baselineHashesHash, "V7 private-case role/verifier/baseline binding changed");
  requireCondition(casePackReceipt.modelCalls === 0 && casePackReceipt.spendUsd === 0, "V7 private-case preflight was not zero-cost");
  for (const stage of ["development", "validation", "adversarial", "holdout", "repeat"]) exact(casePack.caseHashes[stage], casePack.cases[stage].map((testCase) => ({ id: testCase.id, hash: digest(testCase) })), `V7 ${stage} private-case hashes changed`);
  requireCondition(v5Failure.receiptHash === V5_FAILURE_RECEIPT_HASH && digest(withoutHash(v5Failure, "receiptHash")) === v5Failure.receiptHash, "V7 evaluation lost the preserved V5 failure receipt");
  requireCondition(v5Failure.sourceBindings.budgetSha256 === V5_BUDGET_SOURCE_HASH && v5Failure.actualSpendUsd === V5_PRIOR_SPEND_USD && v5Failure.performanceEvaluationStarted === false && v5Failure.resultStatus === "negative-generation-validity-gate", "V7 evaluation V5 spend/failure boundary changed");
  requireCondition(Buffer.isBuffer(v5BudgetBytes) && digest(v5BudgetBytes.toString("base64")) === V5_BUDGET_SOURCE_HASH, "V7 evaluation V5 source budget bytes changed");
  requireCondition(v5BudgetState?.schemaVersion === "das.durable-model-budget.v1" && digest(withoutHash(v5BudgetState)) === v5BudgetState.integrityHash && v5BudgetState.calls.every((call) => call.status === "settled"), "V7 evaluation V5 source budget state changed");
  requireCondition(Math.abs(v5BudgetState.calls.reduce((sum, call) => sum + Number(call.actualUsd ?? 0), 0) - V5_PRIOR_SPEND_USD) < 1e-9, "V7 evaluation V5 source spend changed");
  requireCondition(v6Failure?.receiptHash === V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH && digest(withoutHash(v6Failure, "receiptHash")) === v6Failure.receiptHash, "V7 evaluation lost the preserved V6 infrastructure-failure receipt");
  requireCondition(v6Failure.resultStatus === "invalid-concurrent-writer-infrastructure-run" && v6Failure.performanceEvaluationStarted === false && v6Failure.scientificResultUsable === false && v6Failure.accounting.conservativeProviderSpendUpperBoundUsd === V6_CONSERVATIVE_SPEND_UPPER_BOUND_USD, "V7 evaluation V6 failure/spend boundary changed");
  requireCondition(portfolio?.schemaVersion === "das.candidate-scale-paired-generated-portfolio.v7-single-writer-recovery" && digest(withoutHash(portfolio)) === portfolio.integrityHash, "V7 generated portfolio integrity mismatch");
  requireCondition(checkpoint?.schemaVersion === "das.candidate-scale-paired-generation-checkpoint.v7-single-writer-recovery" && digest(withoutHash(checkpoint)) === checkpoint.integrityHash, "V7 generation checkpoint integrity mismatch");
  requireCondition(structural?.schemaVersion === "das.candidate-scale-paired-structural-selection.v1" && digest(withoutHash(structural, "freezeHash")) === structural.freezeHash, "V7 structural-selection integrity mismatch");
  requireCondition(portfolio.planHash === plan.planHash && portfolio.protocolCoreHash === protocol.protocolCoreHash && portfolio.v5FailureReceiptHash === V5_FAILURE_RECEIPT_HASH && portfolio.v6InfrastructureFailureReceiptHash === V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH && portfolio.v6ConservativeSpendUpperBoundUsd === V6_CONSERVATIVE_SPEND_UPPER_BOUND_USD && portfolio.priorSharedSpendUpperBoundUsd === V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD, "V7 portfolio plan/protocol/history binding mismatch");
  requireCondition(singleWriterReceipt?.schemaVersion === "das.candidate-scale-paired-single-writer-generation-receipt.v7-single-writer-recovery" && digest(withoutHash(singleWriterReceipt, "receiptHash")) === singleWriterReceipt.receiptHash, "V7 single-writer generation receipt integrity mismatch");
  requireCondition(singleWriterReceipt.planHash === plan.planHash && singleWriterReceipt.campaignId === protocol.campaignId && singleWriterReceipt.checkpointIntegrityHash === checkpoint.integrityHash && singleWriterReceipt.evidenceLedgerValid === true && singleWriterReceipt.unresolvedReservations === 0 && typeof singleWriterReceipt.writerLockHash === "string" && singleWriterReceipt.writerLockHash.length === 64, "V7 single-writer receipt is not bound to the completed generation checkpoint");
  requireCondition(portfolio.roleHash === protocol.bindings.roleHash && portfolio.model === protocol.generation.architectModel && portfolio.evidenceLedgerValid === true, "V7 portfolio role/model/evidence binding changed");
  requireCondition(portfolio.candidates.length === 150 && portfolio.rejected.length === 0 && portfolio.receipt.returnedCount === 150 && portfolio.receipt.acceptedCount === 150 && portfolio.receipt.rejectedCount === 0, "V7 evaluation requires exactly 150 valid and zero rejected candidates");
  requireCondition(checkpoint.planHash === plan.planHash && checkpoint.protocolCoreHash === protocol.protocolCoreHash && checkpoint.casePackHash === plan.casePackHash && checkpoint.pricingHash === protocol.pricingHash && checkpoint.portfolioIntegrityHash === portfolio.integrityHash && checkpoint.v6InfrastructureFailureReceiptHash === V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH && checkpoint.v6ConservativeSpendUpperBoundUsd === V6_CONSERVATIVE_SPEND_UPPER_BOUND_USD && checkpoint.priorSharedSpendUpperBoundUsd === V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD && checkpoint.generatedCount === 150 && checkpoint.validCount === 150 && checkpoint.rejectedCount === 0, "V7 generation checkpoint does not authorize evaluation");
  requireCondition(portfolio.writerLockHash === singleWriterReceipt.writerLockHash && checkpoint.writerLockHash === singleWriterReceipt.writerLockHash, "V7 portfolio/checkpoint were not written under the bound exclusive writer lock");
  requireCondition(checkpoint.generationReceiptHash === digest(portfolio.receipt), "V7 checkpoint generation receipt changed");
  requireCondition(checkpoint.structuralSelectionFreezeHash === structural.freezeHash && checkpoint.evidenceLedgerValid === true, "V7 generation evidence/structural checkpoint is not clean");

  const brief = createCommercialSupportPack().roleDraft.compiled.brief;
  const receipt = portfolio.receipt;
  requireCondition(receipt.schemaVersion === "das.candidate-scale-batched-portfolio.v1" && receipt.targetCount === 150 && receipt.returnedCount === 150 && receipt.acceptedCount === 150 && receipt.rejectedCount === 0 && receipt.batchSize === 10 && receipt.batchCount === 15 && receipt.batches.length === 15, "V7 batched generation receipt changed");
  exact(receipt.executionModel, { family: protocol.generation.executionModel, tier: "paired-v6-normalized-execution" }, "V7 receipt execution model changed");
  const receiptWithoutPortfolioHash = withoutHash(receipt, "portfolioHash");
  requireCondition(receipt.portfolioHash === digest({ candidates: portfolio.candidates, rejected: portfolio.rejected, receipt: receiptWithoutPortfolioHash }), "V7 receipt portfolio hash changed");
  const ids = new Set();
  for (const [index, candidate] of portfolio.candidates.entries()) {
    requireCondition(candidate.id && !ids.has(candidate.id), `V7 candidate ${index + 1} has a missing/duplicate id`); ids.add(candidate.id);
    const validation = validateCandidate(withoutHash(candidate, "fingerprint"), brief);
    requireCondition(validation.valid, `V7 candidate ${candidate.id} violates the frozen brief: ${validation.reasons.join(",")}`);
    exact(validation.candidate, candidate, `V7 candidate ${candidate.id} canonical package changed`);
    assertPairedV7ContextInvariant(candidate, brief);
    exact(candidate.model, { family: protocol.generation.executionModel, tier: "paired-v6-normalized-execution" }, `V7 candidate ${candidate.id} was not normalized to Luna`);
    const expectedComplete = pairedV7ContextModeForBatch(Math.floor(index / protocol.batchSize) + 1) === "complete";
    requireCondition(candidate.strategy.requireCompleteContext === expectedComplete, `V7 candidate ${candidate.id} violates its frozen batch context mode`);
  }
  for (const [batchIndex, batch] of receipt.batches.entries()) {
    const expectedMode = pairedV7ContextModeForBatch(batchIndex + 1);
    requireCondition(batch.batchIndex === batchIndex + 1 && batch.batchHash === digest(withoutHash(batch, "batchHash")), `V7 batch ${batchIndex + 1} integrity changed`);
    requireCondition(batch.requestedCount === 10 && batch.acceptedCount === 10 && batch.rejectedCount === 0 && batch.rejected.length === 0, `V7 batch ${batchIndex + 1} accounting changed`);
    exact(batch.acceptedCandidateIds, portfolio.candidates.slice(batchIndex * 10, batchIndex * 10 + 10).map((candidate) => candidate.id), `V7 batch ${batchIndex + 1} candidate order changed`);
    requireCondition(batch.modelReceipt.contextMode === expectedMode && batch.modelReceipt.resolvedModel === protocol.generation.architectModel, `V7 batch ${batchIndex + 1} context/model receipt changed`);
  }
  const rebuilt = freezePairedStructuralSelection({ candidates: portfolio.candidates, brief, prefixCount: protocol.prefixCandidateCount, globalCount: protocol.structuralScreen.globalFinalistCount, meaningfulDistance: protocol.structuralScreen.meaningfulDistanceThreshold });
  exact(rebuilt, structural, "V7 structural selection does not reproduce from all 150 packages");
  for (const [checkpointKey, structuralKey] of [["firstFiveCandidateIds", "firstFiveCandidateIds"], ["globalFinalistIds", "globalFinalistIds"], ["protectedFirstFiveFinalistIds", "protectedFirstFiveFinalistIds"], ["evaluationUnionIds", "evaluationUnionIds"]]) exact(checkpoint[checkpointKey], structural[structuralKey], `V7 checkpoint ${checkpointKey} changed`);
  requireCondition(Math.abs(portfolio.cumulativePriorAndV7SpendUsd - (V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD + portfolio.budget.spentUsd)) < 1e-9, "V7 portfolio cumulative spend changed");
  requireCondition(Math.abs(checkpoint.cumulativePriorAndV7SpendUsd - (V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD + checkpoint.budget.spentUsd)) < 1e-9, "V7 checkpoint cumulative spend changed");
  exact(checkpoint.budget, portfolio.budget, "V7 checkpoint/generation budget changed");
  requireCondition(portfolio.budget.reservedUsd === 0 && portfolio.budget.calls.every((call) => call.status === "settled"), "V7 generation froze unresolved model reservations");
  requireCondition(Math.abs(receipt.architectSpendUsd - portfolio.budget.spentUsd) < 1e-9, "V7 architect receipt/budget spend changed");
  requireCondition(checkpoint.exactUniqueCount === structural.exactUniqueCount && checkpoint.exactDuplicateCount === structural.exactDuplicates.length, "V7 checkpoint diversity counts changed");
  requireCondition(checkpoint.cumulativePriorAndV7SpendUsd <= protocol.budget.maximumCombinedPriorAndV7SpendUsd + 1e-9 && checkpoint.cumulativePriorAndV7SpendUsd <= protocol.budget.sharedUserCeilingUsd - protocol.budget.minimumReservedBufferUsd + 1e-9, "V7 checkpoint crossed the combined prior+V7 ceiling");
  return { brief, rebuilt };
}
