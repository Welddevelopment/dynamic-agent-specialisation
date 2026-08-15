import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCandidate } from "../../compiler/candidate.js";
import { digest } from "../../core/canonical.js";
import { createCaseVault } from "../../evaluation/case-vault.js";
import { createCommercialSupportPack } from "../../product/commercial-support-pack.js";
import { analyzeCandidateDiversity } from "./diversity.js";
import { assertPairedCampaignClock } from "./paired-campaign-clock.js";
import { assertPairedPrivateCasePack, pairedPrivateCasePackHash } from "./paired-private-case-pack.js";
import { createPairedScaleProtocolCore, PAIRED_SCALE_ARTIFACT_ROOT, sealPairedScaleProtocol } from "./paired-protocol.js";
import { freezePairedStructuralSelection } from "./paired-selection.js";

const REQUIRED_CONDITIONS = Object.freeze(["first-five-prefix", "adaptive-150-search"]);
const SELECTION_STAGES = Object.freeze(["development", "validation", "adversarial"]);
const CONFIRMATION_STAGES = Object.freeze(["holdout", "repeat"]);
const EPSILON = 1e-9;

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function clone(value) { return structuredClone(value); }
function without(value, key) { const copy = clone(value); delete copy[key]; return copy; }
function equal(left, right) { return digest(left) === digest(right); }
function sum(values) { return values.reduce((total, value) => total + value, 0); }
function approximately(left, right, epsilon = EPSILON) { return Math.abs(Number(left) - Number(right)) <= epsilon; }
function finite(value, label, minimum = 0) {
  requireCondition(Number.isFinite(value) && value >= minimum, `${label} must be a finite number no smaller than ${minimum}`);
  return Number(value);
}
function integer(value, label, minimum = 0) {
  requireCondition(Number.isInteger(value) && value >= minimum, `${label} must be an integer no smaller than ${minimum}`);
  return Number(value);
}
function unique(values, label) {
  requireCondition(new Set(values).size === values.length, `${label} must be unique`);
  return values;
}
function assertHash(value, label) { requireCondition(typeof value === "string" && /^[a-f0-9]{64}$/.test(value), `${label} must be a SHA-256 digest`); }
function assertSealed(value, key, label) {
  requireCondition(value && typeof value === "object", `${label} is missing`);
  assertHash(value[key], `${label} ${key}`);
  requireCondition(digest(without(value, key)) === value[key], `${label} integrity mismatch`);
}
function assertExact(left, right, label) { requireCondition(equal(left, right), `${label} mismatch`); }

function writePrivate(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
  fs.chmodSync(filePath, 0o600);
}

function assertCaseReceipt(receipt, { protocol, casePack, livePlan }) {
  assertSealed(receipt, "receiptHash", "Private case-pack preflight receipt");
  requireCondition(receipt.schemaVersion === "das.candidate-scale-paired-case-preflight-receipt.v1", "Unsupported private case-pack preflight receipt");
  requireCondition(receipt.protocolCoreHash === protocol.protocolCoreHash, "Private case receipt protocol binding changed");
  requireCondition(receipt.casePackHash === pairedPrivateCasePackHash(casePack), "Private case receipt pack binding changed");
  requireCondition(receipt.receiptHash === livePlan.casePackReceiptHash, "Live plan does not bind the supplied private case receipt");
  for (const key of ["caseCounts", "caseHashes", "independentReferenceReceipt", "shortcutControlReceipt"]) assertExact(receipt[key], casePack[key], `Private case receipt ${key}`);
  requireCondition(receipt.roleHash === casePack.roleHash && receipt.verifierHash === casePack.verifierHash && receipt.baselineHashesHash === casePack.baselineHashesHash, "Private case receipt role/verifier/baseline binding changed");
  requireCondition(receipt.modelCalls === 0 && receipt.spendUsd === 0, "Private case preflight was not zero-cost");
}

function validateContext({ livePlan, casePack, casePackReceipt, generatedPortfolio, structuralFreeze, campaignClock, budgetState }) {
  const protocol = createPairedScaleProtocolCore();
  requireCondition(livePlan?.schemaVersion === "das.candidate-scale-paired-live-plan.v1", "Unsupported paired live plan");
  assertSealed(livePlan, "planHash", "Paired live plan");
  assertExact(livePlan.protocol, protocol, "Live protocol core");
  requireCondition(livePlan.protocolCoreHash === protocol.protocolCoreHash, "Live plan protocol-core hash changed");
  assertPairedPrivateCasePack(casePack, { protocol });
  requireCondition(pairedPrivateCasePackHash(casePack) === livePlan.casePackHash, "Live plan does not bind the supplied private case pack");
  for (const stage of [...SELECTION_STAGES, ...CONFIRMATION_STAGES]) {
    assertExact(casePack.caseHashes[stage], casePack.cases[stage].map((testCase) => ({ id: testCase.id, hash: digest(testCase) })), `Private case-pack ${stage} hashes`);
  }
  assertCaseReceipt(casePackReceipt, { protocol, casePack, livePlan });
  const rebuiltPlan = sealPairedScaleProtocol({ casePackHash: livePlan.casePackHash, casePackReceiptHash: livePlan.casePackReceiptHash });
  assertExact(rebuiltPlan, livePlan, "Reconstructed live plan");
  assertPairedCampaignClock(campaignClock, { planHash: livePlan.planHash });
  assertSealed(generatedPortfolio, "integrityHash", "Generated portfolio");
  requireCondition(generatedPortfolio.schemaVersion === "das.candidate-scale-paired-generated-portfolio.v1", "Unsupported generated portfolio");
  requireCondition(generatedPortfolio.planHash === livePlan.planHash && generatedPortfolio.protocolCoreHash === protocol.protocolCoreHash, "Generated portfolio plan/protocol binding changed");
  requireCondition(generatedPortfolio.roleHash === protocol.bindings.roleHash, "Generated portfolio role binding changed");
  requireCondition(generatedPortfolio.model === protocol.generation.architectModel, "Generated portfolio architect model changed");
  requireCondition(generatedPortfolio.evidenceLedgerValid === true, "Generation evidence ledger was not valid");
  assertSealed(structuralFreeze, "freezeHash", "Structural selection freeze");
  assertSealed(budgetState, "integrityHash", "Durable budget state");
  requireCondition(budgetState.schemaVersion === "das.durable-model-budget.v1" && budgetState.campaignId === protocol.campaignId, "Durable budget campaign changed");
  return { protocol };
}

function validateGeneration(result, context, brief) {
  const { protocol } = context;
  const value = result.generation;
  requireCondition(value && Array.isArray(value.candidates) && Array.isArray(value.rejected), "Completed result generation is incomplete");
  requireCondition(value.portfolioIntegrityHash === context.generatedPortfolio.integrityHash, "Completed result cites the wrong generated portfolio");
  for (const key of ["receipt", "candidates", "rejected"]) assertExact(value[key], context.generatedPortfolio[key], `Completed generation ${key}`);
  const receipt = value.receipt;
  requireCondition(receipt?.schemaVersion === "das.candidate-scale-batched-portfolio.v1", "Unsupported batched generation receipt");
  requireCondition(receipt.roleId === brief.id, "Generation role changed");
  requireCondition(receipt.targetCount === protocol.targetCandidateCount && receipt.returnedCount === protocol.targetCandidateCount, "Generation did not return the frozen target count");
  requireCondition(receipt.acceptedCount === protocol.targetCandidateCount && receipt.rejectedCount === 0 && value.rejected.length === 0, "Paired v5 requires 150 accepted packages and zero rejected packages");
  requireCondition(receipt.batchSize === protocol.batchSize && receipt.batchCount === protocol.batchCount && receipt.batches.length === protocol.batchCount, "Generation batch topology changed");
  assertExact(receipt.executionModel, { family: protocol.generation.executionModel, tier: "paired-normalized-execution" }, "Generated execution model");
  const receiptWithoutPortfolioHash = without(receipt, "portfolioHash");
  requireCondition(receipt.portfolioHash === digest({ candidates: value.candidates, rejected: value.rejected, receipt: receiptWithoutPortfolioHash }), "Generation portfolio hash mismatch");
  const candidateIds = unique(value.candidates.map((candidate) => candidate.id), "Generated candidate ids");
  requireCondition(candidateIds.length === protocol.targetCandidateCount, "Generated candidate count changed");
  for (const [index, candidate] of value.candidates.entries()) {
    const raw = without(candidate, "fingerprint");
    const validation = validateCandidate(raw, brief);
    requireCondition(validation.valid, `Generated candidate ${candidate.id} violates the frozen candidate contract: ${validation.reasons.join(",")}`);
    assertExact(validation.candidate, candidate, `Generated candidate ${candidate.id}`);
    assertExact(candidate.model, receipt.executionModel, `Generated candidate ${candidate.id} normalized execution model`);
    requireCondition(candidate.provenance?.normalizedExecutionModel === protocol.generation.executionModel, `Generated candidate ${candidate.id} lacks execution-model provenance`);
    requireCondition(typeof candidate.id === "string" && candidate.id, `Generated candidate at accepted position ${index + 1} has no id`);
  }
  let acceptedCursor = 0;
  for (const [index, batch] of receipt.batches.entries()) {
    requireCondition(batch.batchIndex === index + 1, `Generation batch ${index + 1} index changed`);
    requireCondition(batch.batchHash === digest(without(batch, "batchHash")), `Generation batch ${index + 1} integrity mismatch`);
    requireCondition(batch.requestedCount === protocol.batchSize && batch.acceptedCount === protocol.batchSize && batch.rejectedCount === 0 && batch.rejected.length === 0, `Generation batch ${index + 1} did not preserve its exact accepted count`);
    assertExact(batch.acceptedCandidateIds, candidateIds.slice(acceptedCursor, acceptedCursor + batch.acceptedCount), `Generation batch ${index + 1} accepted order`);
    acceptedCursor += batch.acceptedCount;
    assertHash(batch.priorDesignMemoryHash, `Generation batch ${index + 1} prior memory hash`);
    assertHash(batch.requestHash, `Generation batch ${index + 1} request hash`);
    requireCondition(batch.modelReceipt?.model === "candidate-architect-policy" && batch.modelReceipt?.resolvedModel === protocol.generation.architectModel, `Generation batch ${index + 1} architect model changed`);
    finite(batch.modelReceipt.actualUsd, `Generation batch ${index + 1} spend`);
    finite(batch.modelReceipt.elapsedMs, `Generation batch ${index + 1} elapsed time`);
  }
  requireCondition(acceptedCursor === protocol.targetCandidateCount, "Generation batch accounting did not reconcile");
  requireCondition(approximately(receipt.architectSpendUsd, sum(receipt.batches.map((batch) => batch.modelReceipt.actualUsd))), "Generation architect spend does not reconcile with batches");
  const generationBudget = context.generatedPortfolio.budget;
  requireCondition(generationBudget?.campaignId === protocol.campaignId && generationBudget.hardLimitUsd <= protocol.budget.hardCampaignCeilingUsd, "Generated portfolio budget binding changed");
  requireCondition(generationBudget.reservedUsd === 0 && generationBudget.calls.every((call) => call.status === "settled"), "Generated portfolio was frozen with unresolved model-call reservations");
  requireCondition(approximately(generationBudget.spentUsd, receipt.architectSpendUsd), "Generated portfolio spend does not match the architect receipt");
  assertExact(generationBudget.calls, context.budgetState.calls.slice(0, generationBudget.calls.length), "Generated portfolio durable-budget prefix");
  finite(receipt.elapsedMs, "Generation elapsed time");
  return { receipt, candidates: value.candidates, candidateById: new Map(value.candidates.map((candidate) => [candidate.id, candidate])), positionById: new Map(value.candidates.map((candidate, index) => [candidate.id, index + 1])) };
}

function validateStructural(result, context, generation, brief) {
  const { protocol } = context;
  assertExact(result.structuralScreen, context.structuralFreeze, "Completed structural screen artifact");
  const rebuilt = freezePairedStructuralSelection({
    candidates: generation.candidates,
    brief,
    prefixCount: protocol.prefixCandidateCount,
    globalCount: protocol.structuralScreen.globalFinalistCount,
    meaningfulDistance: protocol.structuralScreen.meaningfulDistanceThreshold,
  });
  assertExact(rebuilt, result.structuralScreen, "Recomputed structural selection");
  requireCondition(protocol.structuralScreen.modelCalls === 0, "Frozen protocol no longer defines structural screening as zero-call");
  requireCondition(result.structuralScreen.portfolioCount === protocol.targetCandidateCount, "Structural screen did not cover all 150 candidates");
  requireCondition(result.structuralScreen.structuralRows.length === result.structuralScreen.exactUniqueCount, "Structural row count does not match exact-unique count");
  return result.structuralScreen;
}

function caseRows(casePack, stages) {
  return stages.flatMap((stage) => casePack.cases[stage].map((testCase) => ({ stage, caseId: testCase.id, caseHash: digest(testCase) })));
}

function callTokenUsage(call) {
  const usage = call.usage ?? {};
  return {
    inputTokens: Number(usage.input_tokens ?? 0),
    outputTokens: Number(usage.output_tokens ?? 0),
    totalTokens: Number(usage.total_tokens ?? Number(usage.input_tokens ?? 0) + Number(usage.output_tokens ?? 0)),
    cachedInputTokens: Number(usage.input_tokens_details?.cached_tokens ?? 0),
    cacheWriteTokens: Number(usage.input_tokens_details?.cache_write_tokens ?? 0),
    reasoningTokens: Number(usage.output_tokens_details?.reasoning_tokens ?? 0),
  };
}

function aggregateCalls(calls) {
  const tokens = calls.map(callTokenUsage);
  return {
    calls: calls.length,
    spendUsd: sum(calls.map((call) => Number(call.actualUsd ?? 0))),
    inputTokens: sum(tokens.map((value) => value.inputTokens)),
    outputTokens: sum(tokens.map((value) => value.outputTokens)),
    totalTokens: sum(tokens.map((value) => value.totalTokens)),
    cachedInputTokens: sum(tokens.map((value) => value.cachedInputTokens)),
    cacheWriteTokens: sum(tokens.map((value) => value.cacheWriteTokens)),
    reasoningTokens: sum(tokens.map((value) => value.reasoningTokens)),
  };
}

function expectedSummary(participant, rows, expectedCases) {
  const modelCostUsd = sum(rows.map((row) => row.modelCostUsd));
  const elapsedMs = sum(rows.map((row) => row.elapsedMs));
  return {
    participantId: participant.id,
    participantType: participant.type,
    configurationHash: participant.configurationHash,
    casesRun: rows.length,
    expectedCases,
    passed: rows.filter((row) => row.passed).length,
    passRate: rows.filter((row) => row.passed).length / expectedCases,
    meanOutcomeScore: sum(rows.map((row) => row.outcomeScore)) / expectedCases,
    unsafeAttempts: sum(rows.map((row) => row.unsafeAttempts)),
    incorrectSideEffects: sum(rows.map((row) => row.incorrectSideEffects)),
    modelCostUsd,
    elapsedMs,
    modelCalls: sum(rows.map((row) => row.modelCalls)),
    completeSafePass: rows.length === expectedCases && rows.every((row) => row.passed) && rows.every((row) => row.unsafeAttempts === 0 && row.incorrectSideEffects === 0),
    observationHashes: rows.map((row) => digest(row)),
  };
}

function assertObservation(row, { participant, expectedCase, phase, protocol, positionById, budgetCallsById, usedBudgetCallIds }) {
  requireCondition(row && typeof row === "object", `${phase}/${participant.id}/${expectedCase.caseId} observation is missing`);
  requireCondition(row.phase === phase && row.stage === expectedCase.stage && row.caseId === expectedCase.caseId && row.caseHash === expectedCase.caseHash, `${phase}/${participant.id}/${expectedCase.caseId} case binding changed`);
  requireCondition(row.participantId === participant.id && row.participantType === participant.type && row.configurationHash === participant.configurationHash, `${phase}/${participant.id}/${expectedCase.caseId} participant binding changed`);
  requireCondition(row.candidateFingerprint === participant.candidateFingerprint, `${phase}/${participant.id}/${expectedCase.caseId} candidate fingerprint changed`);
  requireCondition(row.acceptedPosition === (positionById.get(participant.id) ?? null), `${phase}/${participant.id}/${expectedCase.caseId} accepted position changed`);
  requireCondition(row.verifierId === protocol.bindings.verifierId && row.independentlyVerified === true, `${phase}/${participant.id}/${expectedCase.caseId} lacks the frozen independent verifier`);
  requireCondition(typeof row.passed === "boolean", `${phase}/${participant.id}/${expectedCase.caseId} pass flag is missing`);
  finite(row.outcomeScore, `${phase}/${participant.id}/${expectedCase.caseId} outcome score`);
  requireCondition(row.outcomeScore <= 1, `${phase}/${participant.id}/${expectedCase.caseId} outcome score exceeds 1`);
  for (const key of ["unsafeAttempts", "incorrectSideEffects", "modelCalls", "humanInterventions"]) integer(row[key], `${phase}/${participant.id}/${expectedCase.caseId} ${key}`);
  for (const key of ["modelCostUsd", "campaignSpendUsd", "elapsedMs"]) finite(row[key], `${phase}/${participant.id}/${expectedCase.caseId} ${key}`);
  assertHash(row.receiptHash, `${phase}/${participant.id}/${expectedCase.caseId} evaluator receipt`);
  requireCondition(Array.isArray(row.budgetCallReceipts) && row.modelCalls === row.budgetCallReceipts.length, `${phase}/${participant.id}/${expectedCase.caseId} call receipt count changed`);
  for (const call of row.budgetCallReceipts) {
    requireCondition(call.status === "settled", `${phase}/${participant.id}/${expectedCase.caseId} contains a non-settled model call`);
    const durable = budgetCallsById.get(call.id);
    requireCondition(durable && equal(durable, call), `${phase}/${participant.id}/${expectedCase.caseId} cites a call absent or changed in the durable budget`);
    requireCondition(!usedBudgetCallIds.has(call.id), `Durable model call ${call.id} was attributed to more than one observation`);
    usedBudgetCallIds.add(call.id);
  }
  requireCondition(approximately(row.campaignSpendUsd, sum(row.budgetCallReceipts.map((call) => call.actualUsd))), `${phase}/${participant.id}/${expectedCase.caseId} campaign spend does not match call receipts`);
}

function validateParticipantPhase({ observations, summaries, participants, expectedCases, phase, protocol, positionById, budgetCallsById, usedBudgetCallIds }) {
  requireCondition(Array.isArray(observations) && Array.isArray(summaries), `${phase} observations/summaries are missing`);
  const participantIds = unique(participants.map((participant) => participant.id), `${phase} participant ids`);
  requireCondition(observations.every((row) => participantIds.includes(row.participantId)), `${phase} includes an unbound participant observation`);
  requireCondition(summaries.length === participants.length, `${phase} summary count changed`);
  const summariesById = new Map(summaries.map((summary) => [summary.participantId, summary]));
  requireCondition(summariesById.size === summaries.length, `${phase} summaries contain duplicate participants`);
  for (const participant of participants) {
    const rows = observations.filter((row) => row.participantId === participant.id);
    requireCondition(rows.length > 0 && rows.length <= expectedCases.length, `${phase}/${participant.id} has an invalid case count`);
    for (const [index, row] of rows.entries()) assertObservation(row, { participant, expectedCase: expectedCases[index], phase, protocol, positionById, budgetCallsById, usedBudgetCallIds });
    const firstSafetyFailure = rows.findIndex((row) => row.unsafeAttempts > 0 || row.incorrectSideEffects > 0);
    if (firstSafetyFailure >= 0) requireCondition(firstSafetyFailure === rows.length - 1, `${phase}/${participant.id} continued after a safety failure`);
    if (rows.length < expectedCases.length) requireCondition(firstSafetyFailure === rows.length - 1, `${phase}/${participant.id} stopped early without a safety-gate receipt`);
    const expected = expectedSummary(participant, rows, expectedCases.length);
    assertExact(summariesById.get(participant.id), expected, `${phase}/${participant.id} summary`);
  }
  return summariesById;
}

function rankEligible(summaries, positionById) {
  return summaries.filter((row) => row.completeSafePass).sort((a, b) => b.meanOutcomeScore - a.meanOutcomeScore || a.modelCostUsd - b.modelCostUsd || a.elapsedMs - b.elapsedMs || (positionById.get(a.participantId) ?? Number.MAX_SAFE_INTEGER) - (positionById.get(b.participantId) ?? Number.MAX_SAFE_INTEGER) || a.participantId.localeCompare(b.participantId));
}

function participantRecords(generation, protocol, baselineEntries) {
  const candidateRecords = generation.candidates.map((candidate) => ({ id: candidate.id, type: "compiler-candidate", configurationHash: candidate.fingerprint, candidateFingerprint: candidate.fingerprint }));
  const baselineRecords = baselineEntries.map((entry) => ({ id: entry.id, type: entry.type, configurationHash: entry.configurationHash, candidateFingerprint: entry.candidate.fingerprint }));
  requireCondition(digest(baselineEntries.map(({ candidate, ...entry }) => entry)) === protocol.bindings.baselineHashesHash, "Executable baseline hashes do not match the frozen protocol");
  return { candidateById: new Map(candidateRecords.map((record) => [record.id, record])), baselineById: new Map(baselineRecords.map((record) => [record.id, record])), baselineRecords };
}

function validateConditions(result, { generation, structural, selectionSummariesById, confirmationSummariesById }) {
  requireCondition(Array.isArray(result.conditions), "Paired v5 conditions are missing");
  const byId = new Map(result.conditions.map((condition) => [condition.id, condition]));
  requireCondition(byId.size === result.conditions.length, "Paired v5 condition ids must be unique");
  for (const id of REQUIRED_CONDITIONS) requireCondition(byId.has(id), `Paired v5 is missing ${id}`);
  const expected = {
    "first-five-prefix": { pool: structural.firstFiveCandidateIds, evaluated: structural.protectedFirstFiveFinalistIds, ranked: rankEligible(structural.protectedFirstFiveFinalistIds.map((id) => selectionSummariesById.get(id)), generation.positionById) },
    "adaptive-150-search": { pool: generation.candidates.map((candidate) => candidate.id), evaluated: structural.globalFinalistIds, ranked: rankEligible(structural.globalFinalistIds.map((id) => selectionSummariesById.get(id)), generation.positionById) },
  };
  const validated = {};
  for (const id of REQUIRED_CONDITIONS) {
    const condition = byId.get(id); const reference = expected[id]; const winner = reference.ranked[0] ?? null;
    assertExact(condition.poolCandidateIds, reference.pool, `${id} pool`);
    assertExact(condition.fullEvaluationCandidateIds, reference.evaluated, `${id} evaluated finalist set`);
    requireCondition(condition.selectedCandidateId === (winner?.participantId ?? null), `${id} selected the wrong frozen winner`);
    assertExact(condition.selectionSummary, winner, `${id} selection summary`);
    assertExact(condition.confirmationSummary, winner ? confirmationSummariesById.get(winner.participantId) ?? null : null, `${id} confirmation summary`);
    validated[id] = { ...condition, winner };
  }
  const optional = [];
  for (const condition of result.conditions.filter((item) => !REQUIRED_CONDITIONS.includes(item.id))) {
    const match = /^adaptive-(\d+)-search$/.exec(condition.id);
    requireCondition(match, `Unsupported extra paired condition ${condition.id}`);
    const count = Number(match[1]);
    requireCondition(count > 5 && count < 150, `Optional paired arm ${condition.id} has an invalid size`);
    assertExact(condition.poolCandidateIds, generation.candidates.slice(0, count).map((candidate) => candidate.id), `${condition.id} pool`);
    requireCondition(condition.fullEvaluationCandidateIds.every((id) => condition.poolCandidateIds.includes(id) && selectionSummariesById.has(id)), `${condition.id} cites an unevaluated finalist`);
    const ranked = rankEligible(condition.fullEvaluationCandidateIds.map((id) => selectionSummariesById.get(id)), generation.positionById);
    requireCondition(condition.selectedCandidateId === (ranked[0]?.participantId ?? null), `${condition.id} selected the wrong winner`);
    optional.push({ id: condition.id, candidateCount: count, status: "validated-secondary-arm", selectedCandidateId: condition.selectedCandidateId });
  }
  return { byId: validated, optional };
}

function validateBudget(result, context, allObservationRows, generation) {
  const state = context.budgetState;
  const calls = state.calls ?? [];
  unique(calls.map((call) => call.id), "Durable budget call ids");
  requireCondition(state.hardLimitUsd <= context.protocol.budget.hardCampaignCeilingUsd, "Durable budget exceeds the frozen $23 campaign ceiling");
  const unresolved = calls.filter((call) => ["reserved", "outcome-unknown"].includes(call.status));
  requireCondition(unresolved.length === 0, "Completed result contains unresolved model-call reservations");
  const settled = calls.filter((call) => call.status === "settled");
  const spentUsd = sum(settled.map((call) => call.actualUsd));
  const reservedUsd = 0;
  const expectedSnapshot = { campaignId: state.campaignId, hardLimitUsd: state.hardLimitUsd, warningUsd: state.warningUsd, spentUsd, reservedUsd, calls: clone(calls) };
  assertExact(result.durableBudgetSnapshot, expectedSnapshot, "Completed durable budget snapshot");
  requireCondition(spentUsd <= state.hardLimitUsd + EPSILON, "Completed campaign crossed its durable hard budget");
  const byId = new Map(calls.map((call) => [call.id, call]));
  const used = new Set();
  for (const row of allObservationRows) for (const call of row.budgetCallReceipts ?? []) {
    requireCondition(byId.has(call.id), `Observation cites unknown durable model call ${call.id}`);
    requireCondition(!used.has(call.id), `Durable model call ${call.id} was attributed twice`);
    used.add(call.id);
  }
  const architectCalls = settled.filter((call) => call.purpose === "candidate-scale-construct-complete-specialist-batch");
  const nonCachedBatches = generation.receipt.batches.filter((batch) => batch.modelReceipt.cached !== true);
  requireCondition(architectCalls.length === nonCachedBatches.length, "Architect call count does not match non-cached generation batches");
  for (const [index, batch] of nonCachedBatches.entries()) requireCondition(approximately(architectCalls[index].actualUsd, batch.modelReceipt.actualUsd), `Architect batch ${batch.batchIndex} spend does not match the durable budget`);
  const settledIds = new Set(settled.map((call) => call.id));
  for (const call of architectCalls) requireCondition(!used.has(call.id), `Architect call ${call.id} was also attributed to task evaluation`);
  const accounted = new Set([...used, ...architectCalls.map((call) => call.id)]);
  requireCondition([...settledIds].every((id) => accounted.has(id)), "Durable budget contains a settled call absent from generation and task observations");
  return { settledCalls: settled, cancelledCalls: calls.filter((call) => call.status === "cancelled"), actual: aggregateCalls(settled), architect: aggregateCalls(architectCalls), taskEvaluation: aggregateCalls(settled.filter((call) => used.has(call.id))) };
}

function conditionResourceUse(condition, selectionRows, confirmationRows, generation) {
  const selected = new Set(condition.fullEvaluationCandidateIds);
  const selection = selectionRows.filter((row) => selected.has(row.participantId));
  const confirmation = condition.selectedCandidateId ? confirmationRows.filter((row) => row.participantId === condition.selectedCandidateId) : [];
  const calls = [...selection, ...confirmation].flatMap((row) => row.budgetCallReceipts);
  return {
    evaluatedCandidateCount: condition.fullEvaluationCandidateIds.length,
    selectionObservations: selection.length,
    confirmationObservations: confirmation.length,
    modelEconomicsUsd: sum([...selection, ...confirmation].map((row) => row.modelCostUsd)),
    modelElapsedMs: sum([...selection, ...confirmation].map((row) => row.elapsedMs)),
    actualCalls: aggregateCalls(calls),
    generationCostStatus: condition.id === "first-five-prefix" ? "not-separately-observed-first-five-were-the-first-half-of-a-ten-package-batch" : "shared-full-150-generation-cost-reported-at-campaign-level",
    generatedPoolCount: condition.poolCandidateIds.length,
    exactFirstFivePrefix: condition.id === "first-five-prefix" ? equal(condition.poolCandidateIds, generation.candidates.slice(0, 5).map((candidate) => candidate.id)) : null,
  };
}

function confirmationState(summary) { return summary?.completeSafePass === true ? "confirmed-safe-pass" : summary ? "confirmation-failed" : "no-safe-selection-winner"; }

function operationalDecision(prefixCondition, globalCondition) {
  const prefix = prefixCondition.confirmationSummary;
  const global = globalCondition.confirmationSummary;
  const prefixSafe = prefix?.completeSafePass === true;
  const globalSafe = global?.completeSafePass === true;
  if (!prefixSafe && !globalSafe) return { action: "no-recommendation", reason: "neither arm produced a confirmation-safe winner" };
  if (prefixSafe && !globalSafe) return { action: "retain", reason: "the first-five winner confirmed safely and the adaptive-150 winner did not" };
  if (!prefixSafe && globalSafe) return { action: "switch", reason: "only the adaptive-150 winner confirmed safely" };
  if (prefixCondition.selectedCandidateId === globalCondition.selectedCandidateId) return { action: "retain", reason: "both arms froze and confirmed the same candidate" };
  if (global.meanOutcomeScore > prefix.meanOutcomeScore + EPSILON) return { action: "switch", reason: "the distinct adaptive-150 winner had the higher confirmed external-outcome score" };
  return { action: "retain", reason: "the distinct adaptive-150 winner did not improve confirmed external-outcome score" };
}

function baselineComparison(condition, candidateSummaries, baselineSummaries) {
  const candidates = condition.fullEvaluationCandidateIds.map((id) => candidateSummaries.get(id)).filter(Boolean);
  return [...baselineSummaries.values()].map((baseline) => ({
    baselineId: baseline.participantId,
    baselineType: baseline.participantType,
    baselineCompleteSafePass: baseline.completeSafePass,
    baselineMeanOutcomeScore: baseline.meanOutcomeScore,
    evaluatedFinalists: candidates.length,
    safeFinalistsBeatingBaseline: baseline.completeSafePass ? candidates.filter((candidate) => candidate.completeSafePass && candidate.meanOutcomeScore > baseline.meanOutcomeScore).length : null,
    comparisonBasis: "same-six-case-selection-pack-evaluated-finalists-only",
  }));
}

function validateStageUsage(result, selectionRows, confirmationRows) {
  const expected = Object.fromEntries([["selection", selectionRows], ["confirmation", confirmationRows]].map(([phase, rows]) => [phase, {
    observations: rows.length,
    modelCalls: sum(rows.map((row) => row.modelCalls)),
    participantEconomicsUsd: sum(rows.map((row) => row.modelCostUsd)),
    elapsedMs: sum(rows.map((row) => row.elapsedMs)),
  }]));
  assertExact(result.stageUsage, expected, "Completed stage usage");
  return expected;
}

export function analyzePairedCandidateScaleV5Result(result, suppliedContext) {
  requireCondition(result?.schemaVersion === "das.candidate-scale-paired-combined-result.v1", "Unsupported paired v5 completed result");
  assertSealed(result, "integrityHash", "Paired v5 completed result");
  const context = { ...suppliedContext };
  const validated = validateContext(context);
  Object.assign(context, validated);
  requireCondition(result.planHash === context.livePlan.planHash && result.protocolCoreHash === context.protocol.protocolCoreHash, "Completed result plan/protocol binding changed");
  assertExact(result.protocol, context.protocol, "Completed result protocol");
  requireCondition(result.casePackHash === context.livePlan.casePackHash && result.casePackReceiptHash === context.livePlan.casePackReceiptHash, "Completed result private-case binding changed");
  requireCondition(result.pricingHash === context.protocol.pricingHash, "Completed result pricing binding changed");
  assertExact(result.sharedBindings, context.protocol.bindings, "Completed result shared bindings");
  requireCondition(result.evidenceLedgerValid === true, "Completed evidence ledger was not valid");
  assertExact(result.claimBoundary, context.protocol.metrics.forbiddenInference, "Completed result claim boundary");

  const support = createCommercialSupportPack();
  const brief = support.roleDraft.compiled.brief;
  const generation = validateGeneration(result, context, brief);
  const structural = validateStructural(result, context, generation, brief);
  const baselineEntries = support.participants.filter((entry) => ["current-agent", "strong-general", "ordinary-manual", "expert-manual"].includes(entry.type)).map((entry) => ({ id: entry.id, type: entry.type, configurationHash: entry.configurationHash, candidate: entry.candidate }));
  assertExact(result.baselines.participants, baselineEntries.map(({ candidate, ...entry }) => entry), "Completed baseline participants");
  const records = participantRecords(generation, context.protocol, baselineEntries);
  const selectionCases = caseRows(context.casePack, SELECTION_STAGES);
  const confirmationCases = caseRows(context.casePack, CONFIRMATION_STAGES);
  assertExact(result.selectionEvaluation.caseHashes, selectionCases, "Selection case hashes");

  const budgetCallsById = new Map((context.budgetState.calls ?? []).map((call) => [call.id, call]));
  const usedBudgetCallIds = new Set();
  const candidateSelectionParticipants = structural.evaluationUnionIds.map((id) => records.candidateById.get(id));
  requireCondition(candidateSelectionParticipants.every(Boolean), "Structural selection cites a missing generated candidate");
  const candidateSelectionSummaries = validateParticipantPhase({ observations: result.selectionEvaluation.observations, summaries: result.selectionEvaluation.summaries, participants: candidateSelectionParticipants, expectedCases: selectionCases, phase: "selection", protocol: context.protocol, positionById: generation.positionById, budgetCallsById, usedBudgetCallIds });
  const baselineSelectionSummaries = validateParticipantPhase({ observations: result.baselines.selectionObservations, summaries: result.baselines.selectionSummaries, participants: records.baselineRecords, expectedCases: selectionCases, phase: "selection", protocol: context.protocol, positionById: generation.positionById, budgetCallsById, usedBudgetCallIds });

  const prefixRanked = rankEligible(structural.protectedFirstFiveFinalistIds.map((id) => candidateSelectionSummaries.get(id)), generation.positionById);
  const globalRanked = rankEligible(structural.globalFinalistIds.map((id) => candidateSelectionSummaries.get(id)), generation.positionById);
  const prefixWinner = prefixRanked[0] ?? null; const globalWinner = globalRanked[0] ?? null;
  const preFinal = result.preFinalSelectionFreeze;
  assertSealed(preFinal, "freezeHash", "Pre-final selection freeze");
  requireCondition(preFinal.schemaVersion === "das.candidate-scale-paired-pre-final-freeze.v1", "Unsupported pre-final selection freeze");
  requireCondition(preFinal.planHash === context.livePlan.planHash && preFinal.protocolCoreHash === context.protocol.protocolCoreHash && preFinal.structuralSelectionFreezeHash === structural.freezeHash, "Pre-final selection binding changed");
  const combinedSelectionRows = [...result.selectionEvaluation.observations, ...result.baselines.selectionObservations];
  requireCondition(preFinal.selectionObservationHash === digest(combinedSelectionRows), "Pre-final freeze does not bind the exact selection observations");
  assertExact(preFinal.prefixWinner, prefixWinner ? { id: prefixWinner.participantId, configurationHash: prefixWinner.configurationHash } : null, "Pre-final prefix winner");
  assertExact(preFinal.globalWinner, globalWinner ? { id: globalWinner.participantId, configurationHash: globalWinner.configurationHash } : null, "Pre-final global winner");
  requireCondition(preFinal.baselineHashesHash === context.protocol.bindings.baselineHashesHash && preFinal.rule === context.protocol.evaluation.confirmationRule, "Pre-final baseline/rule binding changed");
  const holdoutVault = createCaseVault(`paired:${context.protocol.protocolCoreHash}:holdout`, context.casePack.cases.holdout);
  const repeatVault = createCaseVault(`paired:${context.protocol.protocolCoreHash}:repeat`, context.casePack.cases.repeat);
  requireCondition(preFinal.holdoutDigest === holdoutVault.digest && preFinal.repeatDigest === repeatVault.digest, "Pre-final freeze does not bind the untouched confirmation vaults");

  const distinctWinnerIds = [...new Set([prefixWinner?.participantId, globalWinner?.participantId].filter(Boolean))];
  const confirmationExpected = distinctWinnerIds.length > 0;
  if (confirmationExpected) {
    requireCondition(result.finalConfirmation.status === "confirmation-complete" && result.finalConfirmation.holdoutReleaseCount === 1 && result.finalConfirmation.repeatReleaseCount === 1, "Confirmation vault was not released exactly once after winner freeze");
    assertExact(result.finalConfirmation.caseHashes, confirmationCases, "Confirmation case hashes");
  } else {
    requireCondition(result.finalConfirmation.status === "no-safe-winner" && result.finalConfirmation.holdoutReleaseCount === 0 && result.finalConfirmation.repeatReleaseCount === 0, "No-winner campaign improperly released confirmation cases");
    requireCondition(result.finalConfirmation.observations.length === 0 && result.finalConfirmation.summaries.length === 0 && result.baselines.confirmationObservations.length === 0 && result.baselines.confirmationSummaries.length === 0, "No-winner campaign contains confirmation results");
  }
  const candidateConfirmationParticipants = distinctWinnerIds.map((id) => records.candidateById.get(id));
  const candidateConfirmationSummaries = confirmationExpected ? validateParticipantPhase({ observations: result.finalConfirmation.observations, summaries: result.finalConfirmation.summaries, participants: candidateConfirmationParticipants, expectedCases: confirmationCases, phase: "confirmation", protocol: context.protocol, positionById: generation.positionById, budgetCallsById, usedBudgetCallIds }) : new Map();
  const baselineConfirmationSummaries = confirmationExpected ? validateParticipantPhase({ observations: result.baselines.confirmationObservations, summaries: result.baselines.confirmationSummaries, participants: records.baselineRecords, expectedCases: confirmationCases, phase: "confirmation", protocol: context.protocol, positionById: generation.positionById, budgetCallsById, usedBudgetCallIds }) : new Map();
  const conditions = validateConditions(result, { generation, structural, selectionSummariesById: candidateSelectionSummaries, confirmationSummariesById: candidateConfirmationSummaries });
  requireCondition(conditions.byId["first-five-prefix"].selectedCandidateId === (preFinal.prefixWinner?.id ?? null) && conditions.byId["adaptive-150-search"].selectedCandidateId === (preFinal.globalWinner?.id ?? null), "Completed conditions changed winners after the pre-final freeze");

  const selectionRows = combinedSelectionRows;
  const confirmationRows = [...result.finalConfirmation.observations, ...result.baselines.confirmationObservations];
  const stageUsage = validateStageUsage(result, selectionRows, confirmationRows);
  const allObservationRows = [...selectionRows, ...confirmationRows];
  const budget = validateBudget(result, context, allObservationRows, generation);
  requireCondition(usedBudgetCallIds.size === budget.taskEvaluation.calls, "Task-evaluation call accounting changed during validation");

  const prefix = conditions.byId["first-five-prefix"];
  const global = conditions.byId["adaptive-150-search"];
  const decision = operationalDecision(prefix, global);
  const prefixConfirmedScore = prefix.confirmationSummary?.completeSafePass ? prefix.confirmationSummary.meanOutcomeScore : null;
  const globalConfirmedScore = global.confirmationSummary?.completeSafePass ? global.confirmationSummary.meanOutcomeScore : null;
  const confirmedDelta = prefixConfirmedScore != null && globalConfirmedScore != null ? globalConfirmedScore - prefixConfirmedScore : null;
  const globalWinnerInFirstFive = global.selectedCandidateId ? structural.firstFiveCandidateIds.includes(global.selectedCandidateId) : null;
  const firstBatch = generation.receipt.batches[0];
  const laterGenerationBatches = generation.receipt.batches.slice(1);
  const report = {
    schemaVersion: "das.candidate-scale-paired-v5-analysis.v1",
    campaignId: context.protocol.campaignId,
    resultHash: result.integrityHash,
    planHash: context.livePlan.planHash,
    protocolCoreHash: context.protocol.protocolCoreHash,
    evidenceIntegrity: {
      result: "verified",
      livePlan: "verified-and-reconstructed",
      privateCasePack: "verified",
      privateCasePreflight: "verified-zero-cost",
      generatedPortfolio: "verified",
      structuralSelection: "recomputed-exactly",
      preFinalSelection: "verified-before-vault-release",
      durableBudget: "reconciled-to-generation-and-observations",
      evidenceLedgerFlag: "valid-at-result-write",
    },
    topology: {
      generatedCandidates: generation.candidates.length,
      contractValidCandidates: generation.candidates.length,
      exactUniqueDesigns: structural.exactUniqueCount,
      exactDuplicatePackages: structural.exactDuplicates.length,
      meaningfulUniqueDesigns: structural.diversity.meaningfulUniqueDesignCount,
      effectiveUniqueArchitectureCount: structural.diversity.effectiveUniqueArchitectureCount,
      architectureSignatureCount: structural.diversity.architectureSignatureCount,
      firstFivePrefixIds: structural.firstFiveCandidateIds,
      globalStructuralFinalistIds: structural.globalFinalistIds,
      protectedFirstFiveFinalistIds: structural.protectedFirstFiveFinalistIds,
      modelEvaluatedUniqueCandidates: structural.evaluationUnionIds.length,
      structuralScreeningModelCalls: 0,
      optionalValidatedArms: conditions.optional,
    },
    conditions: {
      firstFive: {
        selectedCandidateId: prefix.selectedCandidateId,
        selection: prefix.selectionSummary,
        confirmation: prefix.confirmationSummary,
        confirmationState: confirmationState(prefix.confirmationSummary),
        resourceUse: conditionResourceUse(prefix, result.selectionEvaluation.observations, result.finalConfirmation.observations, generation),
      },
      adaptive150: {
        selectedCandidateId: global.selectedCandidateId,
        selection: global.selectionSummary,
        confirmation: global.confirmationSummary,
        confirmationState: confirmationState(global.confirmationSummary),
        resourceUse: conditionResourceUse(global, result.selectionEvaluation.observations, result.finalConfirmation.observations, generation),
      },
      confirmedScoreDeltaAdaptive150MinusFirstFive: confirmedDelta,
      sameSelectedCandidate: prefix.selectedCandidateId != null && prefix.selectedCandidateId === global.selectedCandidateId,
      globalWinnerInFirstFive,
      randomFiveSubsetProbabilityOfContainingEvaluatedGlobalWinner: global.selectedCandidateId ? 5 / generation.candidates.length : null,
    },
    baselines: {
      selection: [...baselineSelectionSummaries.values()],
      confirmation: [...baselineConfirmationSummaries.values()],
      firstFiveFinalistComparisons: baselineComparison(prefix, candidateSelectionSummaries, baselineSelectionSummaries),
      adaptive150FinalistComparisons: baselineComparison(global, candidateSelectionSummaries, baselineSelectionSummaries),
    },
    safety: {
      selectionUnsafeAttempts: sum(selectionRows.map((row) => row.unsafeAttempts)),
      selectionIncorrectSideEffects: sum(selectionRows.map((row) => row.incorrectSideEffects)),
      confirmationUnsafeAttempts: sum(confirmationRows.map((row) => row.unsafeAttempts)),
      confirmationIncorrectSideEffects: sum(confirmationRows.map((row) => row.incorrectSideEffects)),
      safetyHardGateApplied: true,
      noFallbackWinnerAfterConfirmation: true,
    },
    resources: {
      durableCampaign: budget.actual,
      generation: {
        actual: budget.architect,
        participantReportedSpendUsd: generation.receipt.architectSpendUsd,
        elapsedMs: generation.receipt.elapsedMs,
        firstTenBatchSpendUsd: firstBatch.modelReceipt.actualUsd,
        firstTenBatchElapsedMs: firstBatch.modelReceipt.elapsedMs,
        laterFourteenBatchSpendUsd: sum(laterGenerationBatches.map((batch) => batch.modelReceipt.actualUsd)),
        laterFourteenBatchElapsedMs: sum(laterGenerationBatches.map((batch) => batch.modelReceipt.elapsedMs)),
        exactFiveCandidateGenerationCost: null,
        exactFiveCandidateGenerationCostReason: "The exact first five were generated inside a ten-package first batch, so a separate observed five-package generation cost does not exist.",
      },
      taskEvaluation: budget.taskEvaluation,
      stageUsage,
      cancelledVerifiedNoChargeCalls: budget.cancelledCalls.length,
      hardLimitUsd: context.budgetState.hardLimitUsd,
      maximumWallClockMs: context.protocol.budget.maximumWallClockMs,
      campaignStartedAt: context.campaignClock.startedAt,
      sealedEndToEndWallClockMs: null,
      sealedEndToEndWallClockReason: "The completed-result schema does not seal a completion timestamp; model elapsed and generation elapsed are reported, but total end-to-end wall time cannot be reconstructed as integrity-bound evidence.",
    },
    decision: {
      ...decision,
      status: "post-result-conservative-operational-interpretation",
      preregisteredThreshold: null,
      boundary: "The v5 protocol preregistered the primary score delta but no cross-arm production switch threshold. This action is a conservative interpretation, not a preregistered causal decision rule.",
    },
    productionSearchRecommendation: decision.action === "switch"
      ? { default: "adaptive-150-search", scope: "this frozen support role only", confidence: "experimental-local" }
      : decision.action === "retain"
        ? { default: "first-five-prefix", scope: "this frozen support role only", confidence: "experimental-local" }
        : { default: null, scope: "no safe production default from this result", confidence: "none" },
    limitations: [
      "This is one frozen fictional support role, generator, model family, verifier and private case pack; it does not establish a universal candidate count.",
      "Later architecture batches received compact prior-design memory, so candidate count and adaptive search procedure are not causally separated.",
      "All 150 packages received zero-call structural screening; only frozen finalists and baselines received model-backed evaluation.",
      "Baseline-beating counts describe evaluated finalists, not all 150 generated packages.",
      "The exact five-package generation cost was not observed because generation used ten-package batches.",
      "The completed result does not seal an end timestamp, so total end-to-end wall-clock compliance is not independently reconstructable from the result bundle.",
      "This local experiment establishes neither customer value, cross-role generality nor production reliability.",
    ],
  };
  report.analysisHash = digest(report);
  return Object.freeze(report);
}

function formatScore(value) { return value == null ? "n/a" : Number(value).toFixed(4); }
function formatUsd(value) { return `$${Number(value).toFixed(4)}`; }

export function renderPairedCandidateScaleV5ReportMarkdown(report) {
  if (report?.schemaVersion === "das.candidate-scale-paired-v5-negative-analysis.v1") return renderPairedCandidateScaleV5NegativeReportMarkdown(report);
  requireCondition(report?.schemaVersion === "das.candidate-scale-paired-v5-analysis.v1", "Unsupported paired v5 analysis report");
  requireCondition(report.analysisHash === digest(without(report, "analysisHash")), "Paired v5 analysis report integrity mismatch");
  const prefix = report.conditions.firstFive; const global = report.conditions.adaptive150;
  return [
    "# Paired candidate-search v5 result",
    "",
    `- Conservative operational interpretation: **${report.decision.action.toUpperCase()}** — ${report.decision.reason}.`,
    `- Exact first-five winner: ${prefix.selectedCandidateId ?? "none"}; confirmation: ${prefix.confirmationState}; confirmed score: ${formatScore(prefix.confirmation?.meanOutcomeScore)}.`,
    `- Adaptive-150 winner: ${global.selectedCandidateId ?? "none"}; confirmation: ${global.confirmationState}; confirmed score: ${formatScore(global.confirmation?.meanOutcomeScore)}.`,
    `- Confirmed score delta (150 minus five): ${formatScore(report.conditions.confirmedScoreDeltaAdaptive150MinusFirstFive)}.`,
    `- Same selected package: ${report.conditions.sameSelectedCandidate ? "yes" : "no"}.`,
    "",
    "## Evidence topology",
    "",
    `- ${report.topology.generatedCandidates} generated and contract-valid packages; ${report.topology.exactUniqueDesigns} exact-unique designs; ${report.topology.meaningfulUniqueDesigns} meaningful structural designs; effective architecture count ${report.topology.effectiveUniqueArchitectureCount.toFixed(2)}.`,
    `- All ${report.topology.generatedCandidates} packages received deterministic zero-call structural screening.`,
    `- ${report.topology.modelEvaluatedUniqueCandidates} unique frozen candidate finalists received model-backed selection evaluation, alongside all four baselines.`,
    `- Random five-subset probability of containing the evaluated global winner: ${report.conditions.randomFiveSubsetProbabilityOfContainingEvaluatedGlobalWinner == null ? "n/a" : `${(100 * report.conditions.randomFiveSubsetProbabilityOfContainingEvaluatedGlobalWinner).toFixed(2)}%`}.`,
    "",
    "## Baseline comparison",
    "",
    ...report.baselines.adaptive150FinalistComparisons.map((item) => `- ${item.baselineType}: ${item.safeFinalistsBeatingBaseline ?? "n/a"}/${item.evaluatedFinalists} safely complete evaluated global finalists scored higher on the common six-case selection pack.`),
    "",
    "## Safety",
    "",
    `- Selection: ${report.safety.selectionUnsafeAttempts} unsafe attempts; ${report.safety.selectionIncorrectSideEffects} incorrect side effects.`,
    `- Confirmation: ${report.safety.confirmationUnsafeAttempts} unsafe attempts; ${report.safety.confirmationIncorrectSideEffects} incorrect side effects.`,
    "- Any unsafe attempt or incorrect side effect remained a hard eligibility gate; no post-confirmation fallback winner was permitted.",
    "",
    "## Resource use",
    "",
    `- Actual durable campaign spend: ${formatUsd(report.resources.durableCampaign.spendUsd)} / ${formatUsd(report.resources.hardLimitUsd)} hard ceiling.`,
    `- Durable model calls: ${report.resources.durableCampaign.calls}; total tokens: ${report.resources.durableCampaign.totalTokens}; generation spend: ${formatUsd(report.resources.generation.actual.spendUsd)}; task-evaluation spend: ${formatUsd(report.resources.taskEvaluation.spendUsd)}.`,
    `- Generation elapsed: ${(report.resources.generation.elapsedMs / 1000).toFixed(2)}s; recorded selection model elapsed: ${(report.resources.stageUsage.selection.elapsedMs / 1000).toFixed(2)}s; recorded confirmation model elapsed: ${(report.resources.stageUsage.confirmation.elapsedMs / 1000).toFixed(2)}s.`,
    `- Exact five-package generation cost: not observed. ${report.resources.generation.exactFiveCandidateGenerationCostReason}`,
    `- Total sealed wall clock: unavailable. ${report.resources.sealedEndToEndWallClockReason}`,
    "",
    "## Recommendation boundary",
    "",
    `- Provisional default under this exact frozen role: ${report.productionSearchRecommendation.default ?? "none"}.`,
    `- ${report.decision.boundary}`,
    "",
    "## Limitations",
    "",
    ...report.limitations.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

export function analyzePairedCandidateScaleV5GenerationFailure(receipt, {
  livePlan,
  responseCache,
  budgetState,
  responseCacheBytes,
  budgetBytes,
  evidenceBytes,
}) {
  assertSealed(receipt, "receiptHash", "V5 generation-failure receipt");
  requireCondition(receipt.schemaVersion === "das.candidate-scale-v5-generation-failure-receipt.v1", "Unsupported v5 generation-failure receipt");
  const protocol = createPairedScaleProtocolCore();
  assertSealed(livePlan, "planHash", "Paired live plan");
  assertExact(livePlan.protocol, protocol, "V5 failure live protocol");
  requireCondition(receipt.planHash === livePlan.planHash && receipt.protocolCoreHash === protocol.protocolCoreHash, "V5 failure receipt plan/protocol binding changed");
  assertSealed(responseCache, "integrityHash", "V5 model response cache");
  requireCondition(responseCache.schemaVersion === "das.model-response-cache.v1", "Unsupported v5 response cache");
  assertSealed(budgetState, "integrityHash", "V5 durable budget state");
  requireCondition(budgetState.schemaVersion === "das.durable-model-budget.v1" && budgetState.campaignId === protocol.campaignId, "V5 failure budget campaign changed");
  requireCondition(Buffer.isBuffer(responseCacheBytes) && Buffer.isBuffer(budgetBytes) && Buffer.isBuffer(evidenceBytes), "V5 failure analysis needs the exact source bytes");
  assertExact(receipt.sourceBindings, {
    responseCacheSha256: digest(responseCacheBytes.toString("base64")),
    budgetSha256: digest(budgetBytes.toString("base64")),
    evidenceLedgerSha256: digest(evidenceBytes.toString("base64")),
  }, "V5 failure source-file bindings");
  requireCondition(responseCache.entries.length === protocol.batchCount, "V5 failure cache no longer contains exactly 15 architect batches");
  requireCondition(budgetState.calls.length === protocol.batchCount && budgetState.calls.every((call) => call.status === "settled"), "V5 failure budget no longer contains exactly 15 settled architect calls");
  requireCondition(budgetState.calls.every((call) => call.purpose === "candidate-scale-construct-complete-specialist-batch"), "V5 failure budget contains a non-architect call, implying performance evaluation may have started");
  const brief = createCommercialSupportPack().roleDraft.compiled.brief;
  const raw = responseCache.entries.flatMap((entry, batchIndex) => {
    const payload = typeof entry.response?.output === "string" ? JSON.parse(entry.response.output) : entry.response?.output;
    requireCondition(Array.isArray(payload?.candidates) && payload.candidates.length === protocol.batchSize, `V5 cached architect batch ${batchIndex + 1} changed shape`);
    requireCondition(entry.response.model === "candidate-architect-policy" && entry.response.resolvedModel === protocol.generation.architectModel, `V5 cached architect batch ${batchIndex + 1} model changed`);
    return payload.candidates.map((candidate, offset) => ({ batchIndex: batchIndex + 1, responsePosition: offset + 1, acceptedPosition: batchIndex * protocol.batchSize + offset + 1, candidate }));
  });
  requireCondition(raw.length === protocol.targetCandidateCount, "V5 failure reconstruction no longer contains 150 raw packages");
  const validations = raw.map((entry) => ({ ...entry, validation: validateCandidate(entry.candidate, brief) }));
  const valid = validations.filter((entry) => entry.validation.valid).map((entry) => entry.validation.candidate);
  const rejected = validations.filter((entry) => !entry.validation.valid).map((entry) => ({ batchIndex: entry.batchIndex, responsePosition: entry.responsePosition, acceptedPosition: entry.acceptedPosition, candidateId: String(entry.candidate?.id ?? ""), rawHash: digest(entry.candidate), reasons: entry.validation.reasons }));
  const reasonCounts = {};
  for (const row of rejected) for (const reason of row.reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  const diversity = analyzeCandidateDiversity(valid, { meaningfulDistance: protocol.structuralScreen.meaningfulDistanceThreshold });
  const spendUsd = sum(budgetState.calls.map((call) => Number(call.actualUsd ?? 0)));
  const expected = {
    rawCandidateCount: raw.length,
    validCandidateCount: valid.length,
    rejectedCandidateCount: rejected.length,
    groupedExactReasonCounts: Object.fromEntries(Object.entries(reasonCounts).sort(([a], [b]) => a.localeCompare(b))),
    rejected,
    validPoolDiversity: { exactUniqueDesigns: diversity.exactUniqueDesigns, meaningfulUniqueDesignCount: diversity.meaningfulUniqueDesignCount, architectureSignatureCount: diversity.architectureSignatureCount, exactDuplicatePackages: diversity.exactDuplicatePackages },
    paidCalls: budgetState.calls.length,
    actualSpendUsd: spendUsd,
  };
  for (const [key, value] of Object.entries(expected)) assertExact(receipt[key], value, `V5 failure ${key}`);
  requireCondition(receipt.portfolioEmitted === false && receipt.performanceEvaluationStarted === false && receipt.resultStatus === "negative-generation-validity-gate", "V5 failure receipt overstates campaign progress");
  const report = {
    schemaVersion: "das.candidate-scale-paired-v5-negative-analysis.v1",
    campaignId: protocol.campaignId,
    planHash: livePlan.planHash,
    failureReceiptHash: receipt.receiptHash,
    status: receipt.resultStatus,
    generation: {
      rawCandidates: raw.length,
      contractValidCandidates: valid.length,
      rejectedCandidates: rejected.length,
      validityRate: valid.length / raw.length,
      exactUniqueValidDesigns: diversity.exactUniqueDesigns,
      meaningfulUniqueValidDesigns: diversity.meaningfulUniqueDesignCount,
      effectiveUniqueValidArchitectures: diversity.effectiveUniqueArchitectureCount,
      groupedExactReasonCounts: expected.groupedExactReasonCounts,
    },
    resources: { ...aggregateCalls(budgetState.calls), hardLimitUsd: budgetState.hardLimitUsd },
    gates: {
      portfolioEmitted: false,
      structuralFinalistsFrozen: false,
      modelBackedPerformanceEvaluationStarted: false,
      confirmationVaultReleased: false,
      comparisonDecisionAvailable: false,
    },
    conclusion: "The architect-generation gate failed cleanly: 54/150 raw packages violated the frozen candidate contract. No first-five-versus-150 performance comparison exists for v5.",
    nextExperimentBoundary: "Any repaired rerun must be a new prospectively sealed campaign with new private cases and preserved v5 spend/failure evidence; rejected v5 packages cannot be silently repaired and relabelled as the original result.",
    limitations: [
      "This negative result measures architect compliance with one frozen candidate contract, not specialist performance.",
      "The 96 valid packages were not performance-tested and cannot be ranked by outcome quality.",
      "The failure does not establish that the 150-candidate search hypothesis is false; it establishes that v5 did not reach the comparison gate.",
    ],
  };
  report.analysisHash = digest(report);
  return Object.freeze(report);
}

export function renderPairedCandidateScaleV5NegativeReportMarkdown(report) {
  requireCondition(report?.schemaVersion === "das.candidate-scale-paired-v5-negative-analysis.v1", "Unsupported v5 negative analysis report");
  requireCondition(report.analysisHash === digest(without(report, "analysisHash")), "V5 negative analysis report integrity mismatch");
  return [
    "# Paired candidate-search v5: preserved negative result",
    "",
    `- Status: **${report.status}**.`,
    `- Raw packages returned: ${report.generation.rawCandidates}.`,
    `- Frozen-contract valid: ${report.generation.contractValidCandidates} (${(100 * report.generation.validityRate).toFixed(1)}%).`,
    `- Rejected: ${report.generation.rejectedCandidates}.`,
    `- Actual architect spend: ${formatUsd(report.resources.spendUsd)} across ${report.resources.calls} calls.`,
    "- Portfolio emitted: no. Model-backed task evaluation: no. Holdout/repeat release: no.",
    "",
    "## Exact result",
    "",
    report.conclusion,
    "",
    "## Contract failures",
    "",
    ...Object.entries(report.generation.groupedExactReasonCounts).map(([reason, count]) => `- ${reason}: ${count}`),
    "",
    "## Next-experiment boundary",
    "",
    report.nextExperimentBoundary,
    "",
    "## Limitations",
    "",
    ...report.limitations.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

export function analyzePairedCandidateScaleV5ArtifactDirectory({ resultPath, artifactRoot, outputDirectory = null }) {
  const root = path.resolve(artifactRoot);
  const state = path.join(root, "model-campaign");
  const read = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
  const resolvedResultPath = path.resolve(resultPath);
  let report;
  if (fs.existsSync(resolvedResultPath)) {
    report = analyzePairedCandidateScaleV5Result(read(resolvedResultPath), {
      livePlan: read(path.join(root, "live-plan.json")),
      casePack: read(path.join(root, "private-case-pack.json")),
      casePackReceipt: read(path.join(root, "private-case-pack-preflight-receipt.json")),
      generatedPortfolio: read(path.join(state, "generated-portfolio.json")),
      structuralFreeze: read(path.join(state, "structural-selection-freeze.json")),
      campaignClock: read(path.join(state, "campaign-clock.json")),
      budgetState: read(path.join(state, "budget.json")),
    });
  } else {
    const cachePath = path.join(state, "response-cache.json"); const budgetPath = path.join(state, "budget.json"); const evidencePath = path.join(state, "evidence.jsonl");
    report = analyzePairedCandidateScaleV5GenerationFailure(read(path.join(state, "generation-failure-receipt.json")), {
      livePlan: read(path.join(root, "live-plan.json")),
      responseCache: read(cachePath),
      budgetState: read(budgetPath),
      responseCacheBytes: fs.readFileSync(cachePath),
      budgetBytes: fs.readFileSync(budgetPath),
      evidenceBytes: fs.readFileSync(evidencePath),
    });
  }
  const destination = path.resolve(outputDirectory ?? state);
  writePrivate(path.join(destination, "paired-v5-analysis.json"), report);
  writePrivate(path.join(destination, "paired-v5-analysis.md"), renderPairedCandidateScaleV5ReportMarkdown(report));
  return report;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const resultPath = process.argv[2] ?? path.join(PAIRED_SCALE_ARTIFACT_ROOT, "model-campaign", "completed-result.json");
  const artifactRoot = process.argv[3] ?? PAIRED_SCALE_ARTIFACT_ROOT;
  const outputDirectory = process.argv[4] ?? null;
  const report = analyzePairedCandidateScaleV5ArtifactDirectory({ resultPath, artifactRoot, outputDirectory });
  process.stdout.write(`${JSON.stringify({ status: report.status ?? "paired-v5-analysis-complete", decision: report.decision?.action ?? null, recommendation: report.productionSearchRecommendation?.default ?? null, spendUsd: report.resources.durableCampaign?.spendUsd ?? report.resources.spendUsd, reportHash: report.analysisHash }, null, 2)}\n`);
}
