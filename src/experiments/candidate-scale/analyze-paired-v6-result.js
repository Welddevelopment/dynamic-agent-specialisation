import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "../../core/canonical.js";
import { EvidenceLedger } from "../../core/evidence.js";
import { createCaseVault } from "../../evaluation/case-vault.js";
import { createCommercialSupportPack } from "../../product/commercial-support-pack.js";
import { assertPairedCampaignClock } from "./paired-campaign-clock.js";
import { assertPairedV6EvaluationInputs, rankPairedV6Eligible, summarizePairedV6Participant } from "./paired-v6-evaluation-contract.js";
import { createPairedV6ProtocolCore, PAIRED_V6_ARTIFACT_ROOT, sealPairedV6Protocol, V5_BUDGET_SOURCE_HASH, V5_FAILURE_RECEIPT_HASH, V5_PRIOR_SPEND_USD } from "./paired-v6-protocol.js";
import { PAIRED_SCALE_ARTIFACT_ROOT } from "./paired-protocol.js";

const REQUIRED_CONDITIONS = Object.freeze(["first-five-prefix", "adaptive-150-search"]);
const SELECTION_STAGES = Object.freeze(["development", "validation", "adversarial"]);
const CONFIRMATION_STAGES = Object.freeze(["holdout", "repeat"]);
const BASELINE_TYPES = Object.freeze(["current-agent", "strong-general", "ordinary-manual", "expert-manual"]);
const EPSILON = 1e-9;

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function clone(value) { return structuredClone(value); }
function without(value, key) { const copy = clone(value); delete copy[key]; return copy; }
function equal(left, right) { return digest(left) === digest(right); }
function exact(left, right, message) { requireCondition(equal(left, right), `${message} mismatch`); }
function sum(values) { return values.reduce((total, value) => total + Number(value ?? 0), 0); }
function approximately(left, right) { return Math.abs(Number(left) - Number(right)) <= EPSILON; }
function unique(values, label) { requireCondition(new Set(values).size === values.length, `${label} must be unique`); return values; }
function finite(value, label, minimum = 0) { requireCondition(Number.isFinite(value) && value >= minimum, `${label} must be finite and >= ${minimum}`); return Number(value); }
function integer(value, label, minimum = 0) { requireCondition(Number.isInteger(value) && value >= minimum, `${label} must be an integer and >= ${minimum}`); return Number(value); }
function sealed(value, key, label) { requireCondition(value && typeof value === "object" && typeof value[key] === "string" && digest(without(value, key)) === value[key], `${label} integrity mismatch`); }
function writePrivate(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); const temporary = `${filePath}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); fs.renameSync(temporary, filePath); fs.chmodSync(filePath, 0o600); }

function caseRows(pack, stages) {
  return stages.flatMap((stage) => pack.cases[stage].map((testCase) => ({ stage, caseId: testCase.id, caseHash: digest(testCase) })));
}

function tokenUse(call) {
  const usage = call.usage ?? {};
  return { inputTokens: Number(usage.input_tokens ?? 0), outputTokens: Number(usage.output_tokens ?? 0), totalTokens: Number(usage.total_tokens ?? (Number(usage.input_tokens ?? 0) + Number(usage.output_tokens ?? 0))) };
}

function aggregateCalls(calls) {
  const usage = calls.map(tokenUse);
  return { calls: calls.length, spendUsd: sum(calls.map((call) => call.actualUsd)), inputTokens: sum(usage.map((row) => row.inputTokens)), outputTokens: sum(usage.map((row) => row.outputTokens)), totalTokens: sum(usage.map((row) => row.totalTokens)) };
}

function participantRecords(portfolio, protocol) {
  const support = createCommercialSupportPack();
  const candidates = new Map(portfolio.candidates.map((candidate, index) => [candidate.id, { id: candidate.id, type: "compiler-candidate", configurationHash: candidate.fingerprint, candidateFingerprint: candidate.fingerprint, acceptedPosition: index + 1 }]));
  const sourceBaselines = support.participants.filter((entry) => BASELINE_TYPES.includes(entry.type)).map((entry) => ({ id: entry.id, type: entry.type, configurationHash: entry.configurationHash, candidateFingerprint: entry.candidate.fingerprint }));
  const baselineProjection = support.participants.filter((entry) => BASELINE_TYPES.includes(entry.type)).map((entry) => ({ id: entry.id, type: entry.type, configurationHash: entry.configurationHash }));
  exact(sourceBaselines.map(({ candidateFingerprint, ...entry }) => entry), baselineProjection, "Rebuilt baseline projection");
  requireCondition(digest(baselineProjection) === protocol.bindings.baselineHashesHash, "Executable baseline binding changed");
  return { candidates, baselines: new Map(sourceBaselines.map((entry) => [entry.id, entry])), baselineList: sourceBaselines };
}

function assertObservation(row, { participant, expectedCase, phase, protocol, budgetById, usedCallIds }) {
  requireCondition(row.phase === phase && row.stage === expectedCase.stage && row.caseId === expectedCase.caseId && row.caseHash === expectedCase.caseHash, `${phase}/${participant.id}/${expectedCase.caseId} case binding changed`);
  requireCondition(row.participantId === participant.id && row.participantType === participant.type && row.configurationHash === participant.configurationHash && row.candidateFingerprint === participant.candidateFingerprint, `${phase}/${participant.id}/${expectedCase.caseId} participant binding changed`);
  requireCondition(row.acceptedPosition === (participant.acceptedPosition ?? null), `${phase}/${participant.id}/${expectedCase.caseId} accepted position changed`);
  requireCondition(row.verifierId === protocol.bindings.verifierId && row.independentlyVerified === true && typeof row.passed === "boolean", `${phase}/${participant.id}/${expectedCase.caseId} verifier/pass binding changed`);
  finite(row.outcomeScore, `${phase}/${participant.id}/${expectedCase.caseId} outcome`, 0); requireCondition(row.outcomeScore <= 1, `${phase}/${participant.id}/${expectedCase.caseId} outcome exceeds 1`);
  for (const key of ["unsafeAttempts", "incorrectSideEffects", "modelCalls", "humanInterventions"]) integer(row[key], `${phase}/${participant.id}/${expectedCase.caseId} ${key}`);
  for (const key of ["modelCostUsd", "campaignSpendUsd", "elapsedMs"]) finite(row[key], `${phase}/${participant.id}/${expectedCase.caseId} ${key}`);
  requireCondition(typeof row.receiptHash === "string" && row.receiptHash.length === 64, `${phase}/${participant.id}/${expectedCase.caseId} evaluator receipt missing`);
  requireCondition(Array.isArray(row.budgetCallReceipts) && row.modelCalls === row.budgetCallReceipts.length, `${phase}/${participant.id}/${expectedCase.caseId} call count changed`);
  for (const call of row.budgetCallReceipts) {
    requireCondition(call.status === "settled" && budgetById.has(call.id) && equal(call, budgetById.get(call.id)), `${phase}/${participant.id}/${expectedCase.caseId} durable call changed`);
    requireCondition(!usedCallIds.has(call.id), `Durable call ${call.id} was attributed twice`); usedCallIds.add(call.id);
  }
  requireCondition(approximately(row.campaignSpendUsd, sum(row.budgetCallReceipts.map((call) => call.actualUsd))), `${phase}/${participant.id}/${expectedCase.caseId} spend does not reconcile`);
}

function validatePhase({ observations, summaries, participants, cases, phase, protocol, budgetById, usedCallIds }) {
  unique(participants.map((entry) => entry.id), `${phase} participants`);
  requireCondition(observations.every((row) => participants.some((participant) => participant.id === row.participantId)), `${phase} has an unknown participant`);
  requireCondition(summaries.length === participants.length, `${phase} summary count changed`);
  const summaryById = new Map(summaries.map((row) => [row.participantId, row])); requireCondition(summaryById.size === summaries.length, `${phase} summaries repeat a participant`);
  for (const participant of participants) {
    const rows = observations.filter((row) => row.participantId === participant.id);
    requireCondition(rows.length > 0 && rows.length <= cases.length, `${phase}/${participant.id} case count changed`);
    rows.forEach((row, index) => assertObservation(row, { participant, expectedCase: cases[index], phase, protocol, budgetById, usedCallIds }));
    const safetyFailure = rows.findIndex((row) => row.unsafeAttempts > 0 || row.incorrectSideEffects > 0);
    if (rows.length < cases.length) requireCondition(safetyFailure === rows.length - 1, `${phase}/${participant.id} stopped without a safety failure`);
    if (safetyFailure >= 0) requireCondition(safetyFailure === rows.length - 1, `${phase}/${participant.id} continued after a safety failure`);
    exact(summaryById.get(participant.id), summarizePairedV6Participant(participant, rows, cases.length), `${phase}/${participant.id} summary`);
  }
  return summaryById;
}

function validateBudget(result, context, rows) {
  sealed(context.v6BudgetState, "integrityHash", "V6 durable budget");
  requireCondition(context.v6BudgetState.schemaVersion === "das.durable-model-budget.v1" && context.v6BudgetState.campaignId === context.protocol.campaignId, "V6 durable budget campaign changed");
  const calls = context.v6BudgetState.calls ?? []; unique(calls.map((call) => call.id), "V6 durable call ids");
  requireCondition(calls.every((call) => !["reserved", "outcome-unknown"].includes(call.status)), "V6 completed result has unresolved calls");
  const settled = calls.filter((call) => call.status === "settled");
  const spentUsd = sum(settled.map((call) => call.actualUsd));
  const snapshot = { campaignId: context.v6BudgetState.campaignId, hardLimitUsd: context.v6BudgetState.hardLimitUsd, warningUsd: context.v6BudgetState.warningUsd, spentUsd, reservedUsd: 0, calls: clone(calls) };
  exact(result.durableBudgetSnapshot, snapshot, "Completed V6 durable budget snapshot");
  requireCondition(spentUsd <= context.v6BudgetState.hardLimitUsd + EPSILON && spentUsd <= context.protocol.budget.hardCampaignCeilingUsd + EPSILON, "V6 spend crossed a hard ceiling");
  requireCondition(approximately(result.cumulativeV5V6SpendUsd, V5_PRIOR_SPEND_USD + spentUsd) && result.cumulativeV5V6SpendUsd <= context.protocol.budget.maximumCombinedV5V6SpendUsd + EPSILON, "Cumulative V5+V6 spend changed or crossed the ceiling");
  const used = new Set(rows.flatMap((row) => row.budgetCallReceipts ?? []).map((call) => call.id));
  requireCondition(used.size === sum(rows.map((row) => row.modelCalls)), "Task call attribution contains duplicate ids");
  const generationCallIds = new Set(context.portfolio.budget.calls.filter((call) => call.status === "settled").map((call) => call.id));
  requireCondition([...generationCallIds].every((id) => !used.has(id)), "Generation call was reused as task evidence");
  requireCondition(settled.every((call) => used.has(call.id) || generationCallIds.has(call.id)), "A settled V6 call is absent from generation and evaluation evidence");
  return { all: aggregateCalls(settled), generation: aggregateCalls(settled.filter((call) => generationCallIds.has(call.id))), taskEvaluation: aggregateCalls(settled.filter((call) => used.has(call.id))) };
}

export function operationalDecision(prefix, global) {
  const first = prefix.confirmationSummary; const larger = global.confirmationSummary;
  if (!first?.completeSafePass && !larger?.completeSafePass) return { action: "no-recommendation", reason: "neither frozen winner confirmed safely" };
  if (first?.completeSafePass && !larger?.completeSafePass) return { action: "retain-first-five", reason: "only the first-five winner confirmed safely" };
  if (!first?.completeSafePass && larger?.completeSafePass) return { action: "prefer-adaptive-150", reason: "only the adaptive-150 winner confirmed safely" };
  if (prefix.selectedCandidateId === global.selectedCandidateId) return { action: "same-winner", reason: "both arms selected and confirmed the same package" };
  return larger.meanOutcomeScore > first.meanOutcomeScore + EPSILON
    ? { action: "prefer-adaptive-150", reason: "the distinct adaptive-150 winner had the higher confirmed score" }
    : { action: "retain-first-five", reason: "the distinct adaptive-150 winner did not improve confirmed score" };
}

export function analyzePairedCandidateScaleV6Result(result, suppliedContext) {
  requireCondition(result?.schemaVersion === "das.candidate-scale-paired-combined-result.v6-contract-repair", "Unsupported V6 completed result");
  sealed(result, "integrityHash", "V6 completed result");
  const protocol = createPairedV6ProtocolCore();
  const context = { ...suppliedContext, protocol };
  assertPairedCampaignClock(context.campaignClock, { planHash: context.plan.planHash });
  const rebuiltPlan = sealPairedV6Protocol({ casePackHash: context.plan.casePackHash, casePackReceiptHash: context.plan.casePackReceiptHash }); exact(rebuiltPlan, context.plan, "Reconstructed V6 live plan");
  assertPairedV6EvaluationInputs({ plan: context.plan, casePack: context.casePack, casePackReceipt: context.casePackReceipt, portfolio: context.portfolio, checkpoint: context.checkpoint, structural: context.structural, v5Failure: context.v5Failure, v5BudgetState: context.v5BudgetState, v5BudgetBytes: context.v5BudgetBytes, protocol });
  requireCondition(context.evidenceLedgerValid === true && result.evidenceLedgerValid === true, "V6 evidence ledger is not valid");
  requireCondition(result.planHash === context.plan.planHash && result.protocolCoreHash === protocol.protocolCoreHash && result.casePackHash === context.plan.casePackHash && result.casePackReceiptHash === context.plan.casePackReceiptHash && result.pricingHash === protocol.pricingHash, "V6 result root bindings changed");
  exact(result.protocol, protocol, "V6 result protocol"); exact(result.sharedBindings, protocol.bindings, "V6 result shared bindings"); exact(result.claimBoundary, protocol.metrics.forbiddenInference, "V6 result claim boundary");
  exact(result.v5History, { failureReceiptHash: V5_FAILURE_RECEIPT_HASH, budgetSourceHash: V5_BUDGET_SOURCE_HASH, spendUsd: V5_PRIOR_SPEND_USD, resultStatus: context.v5Failure.resultStatus, performanceEvaluationStarted: false }, "Preserved V5 history");
  exact(result.generation.receipt, context.portfolio.receipt, "V6 result generation receipt"); exact(result.generation.candidates, context.portfolio.candidates, "V6 result candidates"); exact(result.generation.rejected, context.portfolio.rejected, "V6 result rejections");
  requireCondition(result.generation.portfolioIntegrityHash === context.portfolio.integrityHash && result.generation.checkpointIntegrityHash === context.checkpoint.integrityHash, "V6 result generation/checkpoint binding changed");
  exact(result.structuralScreen, context.structural, "V6 result structural screen");

  const records = participantRecords(context.portfolio, protocol);
  const candidateParticipants = context.structural.evaluationUnionIds.map((id) => records.candidates.get(id)); requireCondition(candidateParticipants.every(Boolean), "V6 selection union cites a missing candidate");
  const baselineParticipants = records.baselineList; exact(result.baselines.participants, baselineParticipants.map(({ candidateFingerprint, ...entry }) => entry), "V6 baseline participants");
  const selectionCases = caseRows(context.casePack, SELECTION_STAGES); const confirmationCases = caseRows(context.casePack, CONFIRMATION_STAGES);
  exact(result.selectionEvaluation.caseHashes, selectionCases, "V6 selection case hashes");
  const budgetById = new Map((context.v6BudgetState.calls ?? []).map((call) => [call.id, call])); const usedCallIds = new Set();
  const candidateSelection = validatePhase({ observations: result.selectionEvaluation.observations, summaries: result.selectionEvaluation.summaries, participants: candidateParticipants, cases: selectionCases, phase: "selection", protocol, budgetById, usedCallIds });
  const baselineSelection = validatePhase({ observations: result.baselines.selectionObservations, summaries: result.baselines.selectionSummaries, participants: baselineParticipants, cases: selectionCases, phase: "selection", protocol, budgetById, usedCallIds });
  const combinedSelection = [...result.selectionEvaluation.observations, ...result.baselines.selectionObservations];
  const participantCaseKeys = combinedSelection.map((row) => `${row.participantId}:${row.caseId}`); unique(participantCaseKeys, "V6 shared selection participant/case keys");
  const sharing = result.prefixObservationSharing; sealed(sharing, "receiptHash", "V6 prefix observation sharing");
  exact(sharing, { ...without(sharing, "receiptHash"), receiptHash: sharing.receiptHash }, "V6 prefix sharing seal");
  requireCondition(sharing.schemaVersion === "das.candidate-scale-paired-prefix-observation-sharing.v6-contract-repair" && sharing.planHash === context.plan.planHash, "V6 prefix sharing schema/plan changed");
  exact(sharing.exactFirstFiveCandidateIds, context.structural.firstFiveCandidateIds, "V6 exact first-five ids"); exact(sharing.protectedFirstFiveFinalistIds, context.structural.protectedFirstFiveFinalistIds, "V6 prefix finalists"); exact(sharing.globalFinalistIds, context.structural.globalFinalistIds, "V6 global finalists"); exact(sharing.commonEvaluationUnionIds, context.structural.evaluationUnionIds, "V6 common evaluation union");
  requireCondition(sharing.selectionObservationCorpusHash === digest(combinedSelection) && sharing.duplicateParticipantCaseKeys === 0 && sharing.separatePrefixEvaluationCalls === 0, "V6 first-five observations were not shared exactly");
  exact(sharing.prefixObservationHashes, result.selectionEvaluation.observations.filter((row) => context.structural.protectedFirstFiveFinalistIds.includes(row.participantId)).map((row) => digest(row)), "V6 prefix observation hashes");

  const positionById = new Map(context.portfolio.candidates.map((candidate, index) => [candidate.id, index + 1]));
  const prefixWinner = rankPairedV6Eligible(context.structural.protectedFirstFiveFinalistIds.map((id) => candidateSelection.get(id)), positionById)[0] ?? null;
  const globalWinner = rankPairedV6Eligible(context.structural.globalFinalistIds.map((id) => candidateSelection.get(id)), positionById)[0] ?? null;
  const preFinal = result.preFinalSelectionFreeze; sealed(preFinal, "freezeHash", "V6 pre-final freeze");
  requireCondition(preFinal.schemaVersion === "das.candidate-scale-paired-pre-final-freeze.v6-contract-repair" && preFinal.planHash === context.plan.planHash && preFinal.protocolCoreHash === protocol.protocolCoreHash && preFinal.structuralSelectionFreezeHash === context.structural.freezeHash && preFinal.v5FailureReceiptHash === V5_FAILURE_RECEIPT_HASH, "V6 pre-final root binding changed");
  requireCondition(preFinal.selectionObservationHash === digest(combinedSelection), "V6 pre-final did not freeze the shared selection corpus");
  exact(preFinal.prefixWinner, prefixWinner ? { id: prefixWinner.participantId, configurationHash: prefixWinner.configurationHash } : null, "V6 pre-final prefix winner"); exact(preFinal.globalWinner, globalWinner ? { id: globalWinner.participantId, configurationHash: globalWinner.configurationHash } : null, "V6 pre-final global winner");
  requireCondition(preFinal.baselineHashesHash === protocol.bindings.baselineHashesHash && preFinal.rule === protocol.evaluation.confirmationRule, "V6 pre-final baseline/rule changed");
  const holdoutVault = createCaseVault(`paired-v6:${protocol.protocolCoreHash}:holdout`, context.casePack.cases.holdout); const repeatVault = createCaseVault(`paired-v6:${protocol.protocolCoreHash}:repeat`, context.casePack.cases.repeat);
  requireCondition(preFinal.holdoutDigest === holdoutVault.digest && preFinal.repeatDigest === repeatVault.digest, "V6 pre-final confirmation vault digests changed");

  const winnerIds = [...new Set([prefixWinner?.participantId, globalWinner?.participantId].filter(Boolean))];
  const confirmationExpected = winnerIds.length > 0;
  if (confirmationExpected) { requireCondition(result.finalConfirmation.status === "confirmation-complete" && result.finalConfirmation.holdoutReleaseCount === 1 && result.finalConfirmation.repeatReleaseCount === 1, "V6 confirmation vault release changed"); exact(result.finalConfirmation.caseHashes, confirmationCases, "V6 confirmation case hashes"); }
  else requireCondition(result.finalConfirmation.status === "no-safe-winner" && result.finalConfirmation.holdoutReleaseCount === 0 && result.finalConfirmation.repeatReleaseCount === 0, "V6 no-winner campaign released confirmation cases");
  const candidateConfirmation = confirmationExpected ? validatePhase({ observations: result.finalConfirmation.observations, summaries: result.finalConfirmation.summaries, participants: winnerIds.map((id) => records.candidates.get(id)), cases: confirmationCases, phase: "confirmation", protocol, budgetById, usedCallIds }) : new Map();
  const baselineConfirmation = confirmationExpected ? validatePhase({ observations: result.baselines.confirmationObservations, summaries: result.baselines.confirmationSummaries, participants: baselineParticipants, cases: confirmationCases, phase: "confirmation", protocol, budgetById, usedCallIds }) : new Map();
  if (!confirmationExpected) requireCondition(result.finalConfirmation.observations.length === 0 && result.finalConfirmation.summaries.length === 0 && result.baselines.confirmationObservations.length === 0 && result.baselines.confirmationSummaries.length === 0, "V6 no-winner campaign contains confirmation evidence");

  const conditionsById = new Map(result.conditions.map((condition) => [condition.id, condition])); requireCondition(result.conditions.length === 2 && conditionsById.size === 2 && REQUIRED_CONDITIONS.every((id) => conditionsById.has(id)), "V6 required conditions changed");
  const expectedConditions = {
    "first-five-prefix": { pool: context.structural.firstFiveCandidateIds, evaluated: context.structural.protectedFirstFiveFinalistIds, winner: prefixWinner },
    "adaptive-150-search": { pool: context.portfolio.candidates.map((candidate) => candidate.id), evaluated: context.structural.globalFinalistIds, winner: globalWinner },
  };
  for (const id of REQUIRED_CONDITIONS) {
    const condition = conditionsById.get(id); const expected = expectedConditions[id];
    exact(condition.poolCandidateIds, expected.pool, `${id} pool`); exact(condition.fullEvaluationCandidateIds, expected.evaluated, `${id} finalist set`);
    requireCondition(condition.selectedCandidateId === (expected.winner?.participantId ?? null), `${id} winner changed`); exact(condition.selectionSummary, expected.winner, `${id} selection summary`); exact(condition.confirmationSummary, expected.winner ? candidateConfirmation.get(expected.winner.participantId) ?? null : null, `${id} confirmation summary`);
  }
  const allRows = [...combinedSelection, ...result.finalConfirmation.observations, ...result.baselines.confirmationObservations];
  const expectedStageUsage = Object.fromEntries([["selection", combinedSelection], ["confirmation", [...result.finalConfirmation.observations, ...result.baselines.confirmationObservations]]].map(([phase, rows]) => [phase, { observations: rows.length, modelCalls: sum(rows.map((row) => row.modelCalls)), participantEconomicsUsd: sum(rows.map((row) => row.modelCostUsd)), elapsedMs: sum(rows.map((row) => row.elapsedMs)) }])); exact(result.stageUsage, expectedStageUsage, "V6 stage usage");
  const budget = validateBudget(result, context, allRows); requireCondition(usedCallIds.size === budget.taskEvaluation.calls, "V6 task-call attribution changed");
  const prefix = conditionsById.get("first-five-prefix"); const global = conditionsById.get("adaptive-150-search"); const decision = operationalDecision(prefix, global);
  const report = {
    schemaVersion: "das.candidate-scale-paired-v6-analysis.v1",
    campaignId: protocol.campaignId,
    planHash: context.plan.planHash,
    resultHash: result.integrityHash,
    evidenceIntegrity: { result: "verified", livePlan: "reconstructed-exactly", privateCases: "verified-and-preflighted-zero-cost", generatedPortfolio: "150-valid-zero-rejected-and-recomputed", structuralSelection: "recomputed-exactly", sharedFirstFiveObservations: "verified-no-rerun", preFinalFreeze: "verified-before-fresh-vault-release", durableBudget: "reconciled", currentEvidenceLedger: "verified" },
    history: { v5: { status: context.v5Failure.resultStatus, performanceEvaluationStarted: false, rawCandidates: context.v5Failure.rawCandidateCount, validCandidates: context.v5Failure.validCandidateCount, rejectedCandidates: context.v5Failure.rejectedCandidateCount, spendUsd: V5_PRIOR_SPEND_USD, failureReceiptHash: V5_FAILURE_RECEIPT_HASH }, interpretation: "V5 remains a separate negative generation-validity result and contributes no performance evidence to V6." },
    v6: { generation: { rawCandidates: 150, validCandidates: 150, rejectedCandidates: 0, exactUniqueDesigns: context.structural.exactUniqueCount, meaningfulUniqueDesigns: context.structural.diversity.meaningfulUniqueDesignCount, effectiveUniqueArchitectureCount: context.structural.diversity.effectiveUniqueArchitectureCount, evaluatedUniqueFinalists: context.structural.evaluationUnionIds.length }, conditions: { firstFive: prefix, adaptive150: global, sameWinner: prefix.selectedCandidateId != null && prefix.selectedCandidateId === global.selectedCandidateId, confirmedScoreDelta: prefix.confirmationSummary?.completeSafePass && global.confirmationSummary?.completeSafePass ? global.confirmationSummary.meanOutcomeScore - prefix.confirmationSummary.meanOutcomeScore : null }, baselines: { selection: [...baselineSelection.values()], confirmation: [...baselineConfirmation.values()] }, safety: { unsafeAttempts: sum(allRows.map((row) => row.unsafeAttempts)), incorrectSideEffects: sum(allRows.map((row) => row.incorrectSideEffects)), hardGate: true, noFallbackWinner: true }, resources: { v6: budget.all, generation: budget.generation, taskEvaluation: budget.taskEvaluation, cumulativeV5V6SpendUsd: result.cumulativeV5V6SpendUsd, v6HardLimitUsd: context.v6BudgetState.hardLimitUsd, sharedMaximumUsd: protocol.budget.maximumCombinedV5V6SpendUsd, stageUsage: expectedStageUsage }, decision: { ...decision, status: "post-result-conservative-operational-interpretation", preregisteredProductionSwitchThreshold: null } },
    conclusionBoundary: "This can compare the exact-first-five search arm with the adaptive-150 search arm inside one frozen fictional support role. It cannot isolate candidate count causally, prove the V6 context repair improved task performance, establish a universal optimal portfolio size, customer value, cross-role generality, or production reliability.",
    limitations: [
      "V5 is a preserved negative generation-validity result; its 96 valid packages were never task-evaluated.",
      "V6 is a fresh prospective campaign with fresh cases, so its successful generation cannot be treated as a repaired V5 outcome.",
      "Later batches receive compact prior-design memory, so portfolio size and adaptive generation procedure are not causally separated.",
      "Only structurally frozen finalists, not all 150 packages, receive model-backed task evaluation.",
      "The first five are an exact prefix of the 150 and share the same observations, but were generated inside a ten-package batch; separate five-package generation cost is not observed.",
      "The V6 context-contract change is tested for contract compliance, not isolated as a cause of downstream task performance.",
      "One local fictional support role cannot establish a universal optimal candidate count, customer value, cross-role generality, or production reliability.",
    ],
  };
  report.analysisHash = digest(report); return Object.freeze(report);
}

export function renderPairedCandidateScaleV6ReportMarkdown(report) {
  requireCondition(report?.schemaVersion === "das.candidate-scale-paired-v6-analysis.v1" && report.analysisHash === digest(without(report, "analysisHash")), "Unsupported or changed V6 analysis report");
  const first = report.v6.conditions.firstFive; const large = report.v6.conditions.adaptive150;
  return [
    "# Paired candidate-search V6 result", "",
    `- V5 preserved separately: **${report.history.v5.status}**; ${report.history.v5.validCandidates}/${report.history.v5.rawCandidates} contract-valid; no task evaluation.`,
    `- V6 generation: **${report.v6.generation.validCandidates}/150 valid, ${report.v6.generation.rejectedCandidates} rejected**.`,
    `- Exact-first-five winner: ${first.selectedCandidateId ?? "none"}; adaptive-150 winner: ${large.selectedCandidateId ?? "none"}.`,
    `- Conservative interpretation: **${report.v6.decision.action}** — ${report.v6.decision.reason}.`, "",
    "## Evidence", "",
    `- ${report.v6.generation.exactUniqueDesigns} exact-unique packages; ${report.v6.generation.meaningfulUniqueDesigns} meaningfully unique designs; effective architecture count ${Number(report.v6.generation.effectiveUniqueArchitectureCount).toFixed(2)}.`,
    `- ${report.v6.generation.evaluatedUniqueFinalists} unique candidate finalists received the shared selection pack; the exact first-five arm was not rerun separately.`,
    `- Safety: ${report.v6.safety.unsafeAttempts} unsafe attempts and ${report.v6.safety.incorrectSideEffects} incorrect side effects across recorded observations.`,
    `- V6 spend: $${report.v6.resources.v6.spendUsd.toFixed(4)}; preserved V5 spend: $${report.history.v5.spendUsd.toFixed(4)}; cumulative: $${report.v6.resources.cumulativeV5V6SpendUsd.toFixed(4)}.`, "",
    "## Claim boundary", "", report.conclusionBoundary, "", "## Limitations", "", ...report.limitations.map((item) => `- ${item}`), "",
  ].join("\n");
}

export function analyzePairedCandidateScaleV6ArtifactDirectory({ resultPath, artifactRoot = PAIRED_V6_ARTIFACT_ROOT, outputDirectory = null, v5ArtifactRoot = PAIRED_SCALE_ARTIFACT_ROOT }) {
  const root = path.resolve(artifactRoot); const state = path.join(root, "model-campaign"); const v5Root = path.resolve(v5ArtifactRoot); const read = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
  requireCondition(fs.existsSync(resultPath), "V6 completed result is absent; generation-only artifacts do not authorize performance analysis");
  const v5BudgetPath = path.join(v5Root, "model-campaign", "budget.json"); const evidencePath = path.join(state, "evidence.jsonl");
  const evidenceLedgerValid = fs.existsSync(evidencePath) && new EvidenceLedger(evidencePath).verify();
  const report = analyzePairedCandidateScaleV6Result(read(path.resolve(resultPath)), {
    plan: read(path.join(root, "live-plan.json")), casePack: read(path.join(root, "private-case-pack.json")), casePackReceipt: read(path.join(root, "private-case-pack-preflight-receipt.json")), portfolio: read(path.join(state, "generated-portfolio.json")), checkpoint: read(path.join(state, "generation-checkpoint.json")), structural: read(path.join(state, "structural-selection-freeze.json")), campaignClock: read(path.join(state, "campaign-clock.json")), v6BudgetState: read(path.join(state, "budget.json")), v5Failure: read(path.join(v5Root, "model-campaign", "generation-failure-receipt.json")), v5BudgetState: read(v5BudgetPath), v5BudgetBytes: fs.readFileSync(v5BudgetPath), evidenceLedgerValid,
  });
  const destination = path.resolve(outputDirectory ?? state); writePrivate(path.join(destination, "paired-v6-analysis.json"), report); writePrivate(path.join(destination, "paired-v6-analysis.md"), renderPairedCandidateScaleV6ReportMarkdown(report)); return report;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const resultPath = process.argv[2] ?? path.join(PAIRED_V6_ARTIFACT_ROOT, "model-campaign", "completed-result.json");
  const artifactRoot = process.argv[3] ?? PAIRED_V6_ARTIFACT_ROOT; const outputDirectory = process.argv[4] ?? null;
  const report = analyzePairedCandidateScaleV6ArtifactDirectory({ resultPath, artifactRoot, outputDirectory });
  process.stdout.write(`${JSON.stringify({ status: "paired-v6-analysis-complete", decision: report.v6.decision.action, v6SpendUsd: report.v6.resources.v6.spendUsd, cumulativeV5V6SpendUsd: report.v6.resources.cumulativeV5V6SpendUsd, reportHash: report.analysisHash }, null, 2)}\n`);
}
