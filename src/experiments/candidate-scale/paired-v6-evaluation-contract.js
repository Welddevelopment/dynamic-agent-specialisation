import { validateCandidate } from "../../compiler/candidate.js";
import { digest } from "../../core/canonical.js";
import { createCommercialSupportPack } from "../../product/commercial-support-pack.js";
import { freezePairedStructuralSelection } from "./paired-selection.js";
import { assertPairedV6ContextInvariant, pairedV6ContextModeForBatch } from "./paired-v6-contract.js";
import { createPairedV6ProtocolCore, V5_BUDGET_SOURCE_HASH, V5_FAILURE_RECEIPT_HASH, V5_PRIOR_SPEND_USD } from "./paired-v6-protocol.js";
import { assertPairedV6PrivateCasePack, pairedV6PrivateCasePackHash } from "./paired-v6-private-case-pack.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function withoutHash(value, key = "integrityHash") { const copy = structuredClone(value); delete copy[key]; return copy; }
function exact(left, right, message) { requireCondition(digest(left) === digest(right), message); }

export function summarizePairedV6Participant(participant, rows, expectedCases) {
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

export function rankPairedV6Eligible(summaries, positionById) {
  return summaries.filter((row) => row.completeSafePass).sort((a, b) =>
    b.meanOutcomeScore - a.meanOutcomeScore
    || a.modelCostUsd - b.modelCostUsd
    || a.elapsedMs - b.elapsedMs
    || (positionById.get(a.participantId) ?? Number.MAX_SAFE_INTEGER) - (positionById.get(b.participantId) ?? Number.MAX_SAFE_INTEGER)
    || a.participantId.localeCompare(b.participantId));
}

export function assertPairedV6PostGenerationAudit({ checkpoint, environment = process.env }) {
  requireCondition(checkpoint?.schemaVersion === "das.candidate-scale-paired-generation-checkpoint.v6-contract-repair", "V6 post-generation audit needs the sealed checkpoint");
  requireCondition(environment.DAS_CANDIDATE_SCALE_V6_GENERATION_AUDIT === "GO_150_VALID_0_REJECTED", "V6 paid evaluation is waiting for the explicit 150-valid/0-rejected generation audit");
  requireCondition(environment.DAS_CANDIDATE_SCALE_V6_GENERATION_CHECKPOINT_HASH === checkpoint.integrityHash, "V6 paid evaluation audit is not bound to the exact generation checkpoint");
  return Object.freeze({ checkpointHash: checkpoint.integrityHash, verdict: "GO_150_VALID_0_REJECTED" });
}

export function assertPairedV6EvaluationInputs({ plan, casePack, casePackReceipt, portfolio, checkpoint, structural, v5Failure, v5BudgetState, v5BudgetBytes, protocol = createPairedV6ProtocolCore() }) {
  assertPairedV6PrivateCasePack(casePack, { protocol });
  requireCondition(pairedV6PrivateCasePackHash(casePack) === plan.casePackHash, "V6 evaluation plan/private-pack binding mismatch");
  requireCondition(plan.schemaVersion === "das.candidate-scale-paired-live-plan.v6-contract-repair" && plan.protocolCoreHash === protocol.protocolCoreHash && digest(withoutHash(plan, "planHash")) === plan.planHash, "V6 evaluation live-plan binding mismatch");
  exact(plan.protocol, protocol, "V6 evaluation protocol changed after sealing");
  requireCondition(casePackReceipt?.schemaVersion === "das.candidate-scale-paired-case-preflight-receipt.v6-contract-repair" && digest(withoutHash(casePackReceipt, "receiptHash")) === casePackReceipt.receiptHash, "V6 private-case preflight receipt integrity mismatch");
  requireCondition(casePackReceipt.receiptHash === plan.casePackReceiptHash && casePackReceipt.casePackHash === plan.casePackHash && casePackReceipt.protocolCoreHash === protocol.protocolCoreHash, "V6 private-case receipt is not bound to the live plan");
  for (const key of ["caseCounts", "caseHashes", "independentReferenceReceipt", "shortcutControlReceipt"]) exact(casePackReceipt[key], casePack[key], `V6 private-case receipt ${key} changed`);
  requireCondition(casePackReceipt.roleHash === casePack.roleHash && casePackReceipt.verifierHash === casePack.verifierHash && casePackReceipt.baselineHashesHash === casePack.baselineHashesHash, "V6 private-case role/verifier/baseline binding changed");
  requireCondition(casePackReceipt.modelCalls === 0 && casePackReceipt.spendUsd === 0, "V6 private-case preflight was not zero-cost");
  for (const stage of ["development", "validation", "adversarial", "holdout", "repeat"]) exact(casePack.caseHashes[stage], casePack.cases[stage].map((testCase) => ({ id: testCase.id, hash: digest(testCase) })), `V6 ${stage} private-case hashes changed`);
  requireCondition(v5Failure.receiptHash === V5_FAILURE_RECEIPT_HASH && digest(withoutHash(v5Failure, "receiptHash")) === v5Failure.receiptHash, "V6 evaluation lost the preserved V5 failure receipt");
  requireCondition(v5Failure.sourceBindings.budgetSha256 === V5_BUDGET_SOURCE_HASH && v5Failure.actualSpendUsd === V5_PRIOR_SPEND_USD && v5Failure.performanceEvaluationStarted === false && v5Failure.resultStatus === "negative-generation-validity-gate", "V6 evaluation V5 spend/failure boundary changed");
  requireCondition(Buffer.isBuffer(v5BudgetBytes) && digest(v5BudgetBytes.toString("base64")) === V5_BUDGET_SOURCE_HASH, "V6 evaluation V5 source budget bytes changed");
  requireCondition(v5BudgetState?.schemaVersion === "das.durable-model-budget.v1" && digest(withoutHash(v5BudgetState)) === v5BudgetState.integrityHash && v5BudgetState.calls.every((call) => call.status === "settled"), "V6 evaluation V5 source budget state changed");
  requireCondition(Math.abs(v5BudgetState.calls.reduce((sum, call) => sum + Number(call.actualUsd ?? 0), 0) - V5_PRIOR_SPEND_USD) < 1e-9, "V6 evaluation V5 source spend changed");
  requireCondition(portfolio?.schemaVersion === "das.candidate-scale-paired-generated-portfolio.v6-contract-repair" && digest(withoutHash(portfolio)) === portfolio.integrityHash, "V6 generated portfolio integrity mismatch");
  requireCondition(checkpoint?.schemaVersion === "das.candidate-scale-paired-generation-checkpoint.v6-contract-repair" && digest(withoutHash(checkpoint)) === checkpoint.integrityHash, "V6 generation checkpoint integrity mismatch");
  requireCondition(structural?.schemaVersion === "das.candidate-scale-paired-structural-selection.v1" && digest(withoutHash(structural, "freezeHash")) === structural.freezeHash, "V6 structural-selection integrity mismatch");
  requireCondition(portfolio.planHash === plan.planHash && portfolio.protocolCoreHash === protocol.protocolCoreHash && portfolio.v5FailureReceiptHash === V5_FAILURE_RECEIPT_HASH, "V6 portfolio plan/protocol/V5 binding mismatch");
  requireCondition(portfolio.roleHash === protocol.bindings.roleHash && portfolio.model === protocol.generation.architectModel && portfolio.evidenceLedgerValid === true, "V6 portfolio role/model/evidence binding changed");
  requireCondition(portfolio.candidates.length === 150 && portfolio.rejected.length === 0 && portfolio.receipt.returnedCount === 150 && portfolio.receipt.acceptedCount === 150 && portfolio.receipt.rejectedCount === 0, "V6 evaluation requires exactly 150 valid and zero rejected candidates");
  requireCondition(checkpoint.planHash === plan.planHash && checkpoint.protocolCoreHash === protocol.protocolCoreHash && checkpoint.casePackHash === plan.casePackHash && checkpoint.pricingHash === protocol.pricingHash && checkpoint.portfolioIntegrityHash === portfolio.integrityHash && checkpoint.generatedCount === 150 && checkpoint.validCount === 150 && checkpoint.rejectedCount === 0, "V6 generation checkpoint does not authorize evaluation");
  requireCondition(checkpoint.generationReceiptHash === digest(portfolio.receipt), "V6 checkpoint generation receipt changed");
  requireCondition(checkpoint.structuralSelectionFreezeHash === structural.freezeHash && checkpoint.evidenceLedgerValid === true, "V6 generation evidence/structural checkpoint is not clean");

  const brief = createCommercialSupportPack().roleDraft.compiled.brief;
  const receipt = portfolio.receipt;
  requireCondition(receipt.schemaVersion === "das.candidate-scale-batched-portfolio.v1" && receipt.targetCount === 150 && receipt.returnedCount === 150 && receipt.acceptedCount === 150 && receipt.rejectedCount === 0 && receipt.batchSize === 10 && receipt.batchCount === 15 && receipt.batches.length === 15, "V6 batched generation receipt changed");
  exact(receipt.executionModel, { family: protocol.generation.executionModel, tier: "paired-v6-normalized-execution" }, "V6 receipt execution model changed");
  const receiptWithoutPortfolioHash = withoutHash(receipt, "portfolioHash");
  requireCondition(receipt.portfolioHash === digest({ candidates: portfolio.candidates, rejected: portfolio.rejected, receipt: receiptWithoutPortfolioHash }), "V6 receipt portfolio hash changed");
  const ids = new Set();
  for (const [index, candidate] of portfolio.candidates.entries()) {
    requireCondition(candidate.id && !ids.has(candidate.id), `V6 candidate ${index + 1} has a missing/duplicate id`); ids.add(candidate.id);
    const validation = validateCandidate(withoutHash(candidate, "fingerprint"), brief);
    requireCondition(validation.valid, `V6 candidate ${candidate.id} violates the frozen brief: ${validation.reasons.join(",")}`);
    exact(validation.candidate, candidate, `V6 candidate ${candidate.id} canonical package changed`);
    assertPairedV6ContextInvariant(candidate, brief);
    exact(candidate.model, { family: protocol.generation.executionModel, tier: "paired-v6-normalized-execution" }, `V6 candidate ${candidate.id} was not normalized to Luna`);
    const expectedComplete = pairedV6ContextModeForBatch(Math.floor(index / protocol.batchSize) + 1) === "complete";
    requireCondition(candidate.strategy.requireCompleteContext === expectedComplete, `V6 candidate ${candidate.id} violates its frozen batch context mode`);
  }
  for (const [batchIndex, batch] of receipt.batches.entries()) {
    const expectedMode = pairedV6ContextModeForBatch(batchIndex + 1);
    requireCondition(batch.batchIndex === batchIndex + 1 && batch.batchHash === digest(withoutHash(batch, "batchHash")), `V6 batch ${batchIndex + 1} integrity changed`);
    requireCondition(batch.requestedCount === 10 && batch.acceptedCount === 10 && batch.rejectedCount === 0 && batch.rejected.length === 0, `V6 batch ${batchIndex + 1} accounting changed`);
    exact(batch.acceptedCandidateIds, portfolio.candidates.slice(batchIndex * 10, batchIndex * 10 + 10).map((candidate) => candidate.id), `V6 batch ${batchIndex + 1} candidate order changed`);
    requireCondition(batch.modelReceipt.contextMode === expectedMode && batch.modelReceipt.resolvedModel === protocol.generation.architectModel, `V6 batch ${batchIndex + 1} context/model receipt changed`);
  }
  const rebuilt = freezePairedStructuralSelection({ candidates: portfolio.candidates, brief, prefixCount: protocol.prefixCandidateCount, globalCount: protocol.structuralScreen.globalFinalistCount, meaningfulDistance: protocol.structuralScreen.meaningfulDistanceThreshold });
  exact(rebuilt, structural, "V6 structural selection does not reproduce from all 150 packages");
  for (const [checkpointKey, structuralKey] of [["firstFiveCandidateIds", "firstFiveCandidateIds"], ["globalFinalistIds", "globalFinalistIds"], ["protectedFirstFiveFinalistIds", "protectedFirstFiveFinalistIds"], ["evaluationUnionIds", "evaluationUnionIds"]]) exact(checkpoint[checkpointKey], structural[structuralKey], `V6 checkpoint ${checkpointKey} changed`);
  requireCondition(Math.abs(portfolio.cumulativeSpendThroughGenerationUsd - (V5_PRIOR_SPEND_USD + portfolio.budget.spentUsd)) < 1e-9, "V6 portfolio cumulative spend changed");
  requireCondition(Math.abs(checkpoint.cumulativeSpendUsd - (V5_PRIOR_SPEND_USD + checkpoint.budget.spentUsd)) < 1e-9, "V6 checkpoint cumulative spend changed");
  exact(checkpoint.budget, portfolio.budget, "V6 checkpoint/generation budget changed");
  requireCondition(portfolio.budget.reservedUsd === 0 && portfolio.budget.calls.every((call) => call.status === "settled"), "V6 generation froze unresolved model reservations");
  requireCondition(Math.abs(receipt.architectSpendUsd - portfolio.budget.spentUsd) < 1e-9, "V6 architect receipt/budget spend changed");
  requireCondition(checkpoint.exactUniqueCount === structural.exactUniqueCount && checkpoint.exactDuplicateCount === structural.exactDuplicates.length, "V6 checkpoint diversity counts changed");
  requireCondition(checkpoint.cumulativeSpendUsd <= protocol.budget.maximumCombinedV5V6SpendUsd + 1e-9, "V6 checkpoint crossed the combined V5+V6 ceiling");
  return { brief, rebuilt };
}
