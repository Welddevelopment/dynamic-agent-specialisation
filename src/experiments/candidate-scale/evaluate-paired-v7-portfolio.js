import fs from "node:fs";
import path from "node:path";
import { digest } from "../../core/canonical.js";
import { withCampaignWriterLock } from "../../core/campaign-writer-lock.js";
import { DurableBudgetGuard, PersistentModelResponseCache } from "../../core/durable-model-campaign.js";
import { EvidenceLedger } from "../../core/evidence.js";
import { MeteredModelGateway } from "../../core/model-gateway.js";
import { createCaseVault } from "../../evaluation/case-vault.js";
import { createCommercialSupportModelEvaluator, createCommercialSupportPack } from "../../product/commercial-support-pack.js";
import { PairedScaleOpenAIProvider } from "./paired-openai-provider.js";
import { assertPairedCampaignClock, pairedCampaignRemainingMs } from "./paired-campaign-clock.js";
import { assertPairedEvaluationWallClock, assertPairedObservationProgress, createPairedObservationProgress, pairedObservationProgressKey, recordPairedObservation, resumePairedObservation, sealPairedObservationProgress } from "./paired-observation-progress.js";
import { assertPairedV7EvaluationEntryState, assertPairedV7EvaluationInputs, assertPairedV7PostGenerationAudit, rankPairedV7Eligible, summarizePairedV7Participant } from "./paired-v7-evaluation-contract.js";
import { PAIRED_V6_ARTIFACT_ROOT, V5_BUDGET_SOURCE_HASH, V5_FAILURE_RECEIPT_HASH, V5_PRIOR_SPEND_USD } from "./paired-v6-protocol.js";
import { assertPairedV7Authorization, createPairedV7ProtocolCore, PAIRED_V7_ARTIFACT_ROOT, V6_CONSERVATIVE_SPEND_UPPER_BOUND_USD, V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH, V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD } from "./paired-v7-protocol.js";
import { PAIRED_SCALE_ARTIFACT_ROOT } from "./paired-protocol.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function writePrivate(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); const temporary = `${filePath}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); fs.renameSync(temporary, filePath); fs.chmodSync(filePath, 0o600); }

async function mapConcurrent(values, limit, worker) {
  const results = new Array(values.length); let cursor = 0;
  async function run() { while (cursor < values.length) { const index = cursor++; results[index] = await worker(values[index], index); } }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, run)); return results;
}

const root = path.resolve(PAIRED_V7_ARTIFACT_ROOT); const state = path.join(root, "model-campaign");
const requiredFiles = ["live-plan.json", "private-case-pack.json", "private-case-pack-preflight-receipt.json", "model-campaign/generated-portfolio.json", "model-campaign/generation-checkpoint.json", "model-campaign/structural-selection-freeze.json", "model-campaign/single-writer-generation-receipt.json"];
for (const file of requiredFiles) requireCondition(fs.existsSync(path.join(root, file)), `V7 evaluation input is missing: ${file}`);
const plan = JSON.parse(fs.readFileSync(path.join(root, "live-plan.json"), "utf8")); const casePack = JSON.parse(fs.readFileSync(path.join(root, "private-case-pack.json"), "utf8"));
const casePackReceipt = JSON.parse(fs.readFileSync(path.join(root, "private-case-pack-preflight-receipt.json"), "utf8"));
const portfolio = JSON.parse(fs.readFileSync(path.join(state, "generated-portfolio.json"), "utf8")); const checkpoint = JSON.parse(fs.readFileSync(path.join(state, "generation-checkpoint.json"), "utf8")); const structural = JSON.parse(fs.readFileSync(path.join(state, "structural-selection-freeze.json"), "utf8"));
const singleWriterReceipt = JSON.parse(fs.readFileSync(path.join(state, "single-writer-generation-receipt.json"), "utf8"));
const v5Failure = JSON.parse(fs.readFileSync(path.resolve(PAIRED_SCALE_ARTIFACT_ROOT, "model-campaign/generation-failure-receipt.json"), "utf8"));
const v5BudgetPath = path.resolve(PAIRED_SCALE_ARTIFACT_ROOT, "model-campaign/budget.json"); const v5BudgetBytes = fs.readFileSync(v5BudgetPath); const v5BudgetState = JSON.parse(v5BudgetBytes.toString("utf8"));
const v6Failure = JSON.parse(fs.readFileSync(path.resolve(PAIRED_V6_ARTIFACT_ROOT, "infrastructure-failure-receipt.json"), "utf8"));
const protocol = createPairedV7ProtocolCore(); assertPairedV7EvaluationInputs({ plan, casePack, casePackReceipt, portfolio, checkpoint, structural, singleWriterReceipt, v5Failure, v5BudgetState, v5BudgetBytes, v6Failure, protocol });
assertPairedV7PostGenerationAudit({ checkpoint, environment: process.env });
const authorization = assertPairedV7Authorization({ plan, environment: process.env, currentUtcDate: new Date().toISOString().slice(0, 10) });
const summary = await withCampaignWriterLock({ stateDirectory: state, campaignId: protocol.campaignId, runnerVersion: "paired-v7-evaluation.v1" }, async (evaluationWriterLock) => {
const campaignClock = JSON.parse(fs.readFileSync(path.join(state, "campaign-clock.json"), "utf8")); assertPairedCampaignClock(campaignClock, { planHash: plan.planHash }); pairedCampaignRemainingMs(campaignClock, protocol.budget.maximumWallClockMs);
const budget = new DurableBudgetGuard({ filePath: path.join(state, "budget.json"), hardLimitUsd: authorization.limitUsd, campaignId: protocol.campaignId });
assertPairedV7EvaluationEntryState({ budgetState: budget.snapshot(), combinedResultExists: fs.existsSync(path.join(state, "combined-result.json")) });
requireCondition(V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD + budget.spentUsd + budget.reservedUsd <= protocol.budget.maximumCombinedPriorAndV7SpendUsd + 1e-9, "V7 evaluation start exceeds the combined prior+V7 ceiling");
const cache = new PersistentModelResponseCache({ filePath: path.join(state, "response-cache.json") }); const evidence = new EvidenceLedger(path.join(state, "evidence.jsonl"));
const provider = new PairedScaleOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY, pricingByModel: protocol.pricing.models, environment: process.env }); const gateway = new MeteredModelGateway({ provider, budget, cache, evidence, secrets: [process.env.OPENAI_API_KEY] });
const evaluator = createCommercialSupportModelEvaluator({ gateway, evidence, maxTurns: protocol.evaluation.maximumTurnsPerCase }); const support = createCommercialSupportPack();
const progressPath = path.join(state, "evaluation-observation-progress.json"); let progress = createPairedObservationProgress({ planHash: plan.planHash, startedAt: campaignClock.startedAt });
if (fs.existsSync(progressPath)) { progress = JSON.parse(fs.readFileSync(progressPath, "utf8")); assertPairedObservationProgress(progress, { planHash: plan.planHash }); delete progress.integrityHash; }
function saveProgress() { writePrivate(progressPath, sealPairedObservationProgress(progress)); } if (!fs.existsSync(progressPath)) saveProgress();
const candidateById = new Map(portfolio.candidates.map((candidate) => [candidate.id, candidate])); const positionById = new Map(portfolio.candidates.map((candidate, index) => [candidate.id, index + 1]));
const candidateParticipants = structural.evaluationUnionIds.map((id) => ({ id, type: "compiler-candidate", configurationHash: candidateById.get(id)?.fingerprint, candidate: candidateById.get(id) }));
requireCondition(candidateParticipants.every((entry) => entry.candidate), "V7 structural finalist is absent from the frozen portfolio");
const baselineParticipants = support.participants.filter((entry) => ["current-agent", "strong-general", "ordinary-manual", "expert-manual"].includes(entry.type)).map((entry) => ({ id: entry.id, type: entry.type, configurationHash: entry.configurationHash, candidate: entry.candidate }));
requireCondition(digest(baselineParticipants.map(({ candidate, ...entry }) => entry)) === protocol.bindings.baselineHashesHash, "V7 executable baselines changed");
const participants = [...candidateParticipants, ...baselineParticipants]; const selectionCases = ["development", "validation", "adversarial"].flatMap((stage) => casePack.cases[stage].map((testCase) => ({ stage, testCase, caseId: testCase.id, caseHash: digest(testCase) })));

async function evaluateParticipants(entries, cases, phase) {
  const observations = (await mapConcurrent(entries, 1, async (participant) => {
    const rows = [];
    for (const record of cases) {
      assertPairedEvaluationWallClock(progress, protocol.budget.maximumWallClockMs);
      if (rows.some((row) => row.unsafeAttempts > 0 || row.incorrectSideEffects > 0)) break;
      const progressKey = pairedObservationProgressKey({ planHash: plan.planHash, phase, participantId: participant.id, configurationHash: participant.configurationHash, caseId: record.caseId, caseHash: record.caseHash });
      const prior = resumePairedObservation(progress, progressKey); if (prior) { rows.push(prior); continue; }
      const before = budget.calls.length; const raw = await evaluator({ participant, testCase: record.testCase, caseId: record.caseId, stage: record.stage, verifierId: protocol.bindings.verifierId }); const callReceipts = budget.calls.slice(before).map((call) => structuredClone(call));
      const observation = { ...raw, modelCalls: callReceipts.length, phase, stage: record.stage, caseId: record.caseId, caseHash: record.caseHash, participantId: participant.id, participantType: participant.type, configurationHash: participant.configurationHash, candidateFingerprint: participant.candidate.fingerprint, acceptedPosition: positionById.get(participant.id) ?? null, budgetCallReceipts: callReceipts };
      requireCondition(V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD + budget.spentUsd + budget.reservedUsd <= protocol.budget.maximumCombinedPriorAndV7SpendUsd + 1e-9, "V7 evaluation crossed the combined prior+V7 ceiling");
      assertPairedEvaluationWallClock(progress, protocol.budget.maximumWallClockMs); rows.push(observation); recordPairedObservation(progress, progressKey, observation); saveProgress();
    }
    return rows;
  })).flat();
  return { observations, summaries: entries.map((participant) => summarizePairedV7Participant(participant, observations.filter((row) => row.participantId === participant.id), cases.length)) };
}

const selectionEvaluation = await evaluateParticipants(participants, selectionCases, "selection");
const participantCaseKeys = selectionEvaluation.observations.map((row) => `${row.participantId}:${row.caseId}`); requireCondition(new Set(participantCaseKeys).size === participantCaseKeys.length, "V7 selection reran a shared participant/case observation");
const prefixRanked = rankPairedV7Eligible(selectionEvaluation.summaries.filter((row) => structural.protectedFirstFiveFinalistIds.includes(row.participantId)), positionById); const globalRanked = rankPairedV7Eligible(selectionEvaluation.summaries.filter((row) => structural.globalFinalistIds.includes(row.participantId)), positionById);
const prefixWinner = prefixRanked[0] ?? null; const globalWinner = globalRanked[0] ?? null;
const holdoutVault = createCaseVault(`paired-v7:${protocol.protocolCoreHash}:holdout`, casePack.cases.holdout); const repeatVault = createCaseVault(`paired-v7:${protocol.protocolCoreHash}:repeat`, casePack.cases.repeat);
const preFinal = { schemaVersion: "das.candidate-scale-paired-pre-final-freeze.v7-single-writer-recovery", planHash: plan.planHash, protocolCoreHash: protocol.protocolCoreHash, structuralSelectionFreezeHash: structural.freezeHash, selectionObservationHash: digest(selectionEvaluation.observations), prefixWinner: prefixWinner ? { id: prefixWinner.participantId, configurationHash: prefixWinner.configurationHash } : null, globalWinner: globalWinner ? { id: globalWinner.participantId, configurationHash: globalWinner.configurationHash } : null, baselineHashesHash: protocol.bindings.baselineHashesHash, holdoutDigest: holdoutVault.digest, repeatDigest: repeatVault.digest, rule: protocol.evaluation.confirmationRule, v5FailureReceiptHash: V5_FAILURE_RECEIPT_HASH, v6InfrastructureFailureReceiptHash: V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH };
preFinal.freezeHash = digest(preFinal); writePrivate(path.join(state, "pre-final-selection-freeze.json"), preFinal);
const winnerIds = [...new Set([prefixWinner?.participantId, globalWinner?.participantId].filter(Boolean))]; const winnerParticipants = winnerIds.map((id) => candidateParticipants.find((entry) => entry.id === id));
let confirmation = { observations: [], summaries: [], holdoutReleaseCount: 0, repeatReleaseCount: 0, status: "no-safe-winner" };
if (winnerParticipants.length) {
  const candidateHashes = Object.fromEntries(winnerParticipants.map((entry) => [entry.id, entry.configurationHash])); const baselineHashes = Object.fromEntries(baselineParticipants.map((entry) => [entry.id, entry.configurationHash]));
  const holdout = holdoutVault.release({ freezeHash: preFinal.freezeHash, role: `paired-v7:${protocol.protocolCoreHash}:holdout`, candidateHashes, baselineHashes }); const repeat = repeatVault.release({ freezeHash: preFinal.freezeHash, role: `paired-v7:${protocol.protocolCoreHash}:repeat`, candidateHashes, baselineHashes });
  const confirmationCases = [...holdout.map((testCase) => ({ stage: "holdout", testCase, caseId: testCase.id, caseHash: digest(testCase) })), ...repeat.map((testCase) => ({ stage: "repeat", testCase, caseId: testCase.id, caseHash: digest(testCase) }))];
  confirmation = { ...(await evaluateParticipants([...winnerParticipants, ...baselineParticipants], confirmationCases, "confirmation")), holdoutReleaseCount: holdoutVault.releaseCount(), repeatReleaseCount: repeatVault.releaseCount(), status: "confirmation-complete", caseHashes: confirmationCases.map(({ stage, caseId, caseHash }) => ({ stage, caseId, caseHash })) };
}
const confirmationById = new Map(confirmation.summaries.map((row) => [row.participantId, row]));
const conditions = [
  { id: "first-five-prefix", poolCandidateIds: structural.firstFiveCandidateIds, fullEvaluationCandidateIds: structural.protectedFirstFiveFinalistIds, selectedCandidateId: prefixWinner?.participantId ?? null, selectionSummary: prefixWinner, confirmationSummary: prefixWinner ? confirmationById.get(prefixWinner.participantId) ?? null : null },
  { id: "adaptive-150-search", poolCandidateIds: portfolio.candidates.map((candidate) => candidate.id), fullEvaluationCandidateIds: structural.globalFinalistIds, selectedCandidateId: globalWinner?.participantId ?? null, selectionSummary: globalWinner, confirmationSummary: globalWinner ? confirmationById.get(globalWinner.participantId) ?? null : null },
];
const prefixRows = selectionEvaluation.observations.filter((row) => structural.protectedFirstFiveFinalistIds.includes(row.participantId));
const prefixObservationSharing = { schemaVersion: "das.candidate-scale-paired-prefix-observation-sharing.v7-single-writer-recovery", planHash: plan.planHash, exactFirstFiveCandidateIds: structural.firstFiveCandidateIds, protectedFirstFiveFinalistIds: structural.protectedFirstFiveFinalistIds, globalFinalistIds: structural.globalFinalistIds, commonEvaluationUnionIds: structural.evaluationUnionIds, selectionObservationCorpusHash: digest(selectionEvaluation.observations), prefixObservationHashes: prefixRows.map((row) => digest(row)), duplicateParticipantCaseKeys: 0, separatePrefixEvaluationCalls: 0, rule: "Every candidate in the union is evaluated once per case; both arms reference the same immutable selection corpus." };
prefixObservationSharing.receiptHash = digest(prefixObservationSharing);
const baselineIds = new Set(baselineParticipants.map((entry) => entry.id)); const allSelection = selectionEvaluation.observations; const allConfirmation = confirmation.observations;
const result = {
  schemaVersion: "das.candidate-scale-paired-combined-result.v7-single-writer-recovery", planHash: plan.planHash, protocolCoreHash: protocol.protocolCoreHash, protocol, casePackHash: plan.casePackHash, casePackReceiptHash: plan.casePackReceiptHash, pricingHash: protocol.pricingHash,
  v5History: { failureReceiptHash: V5_FAILURE_RECEIPT_HASH, budgetSourceHash: V5_BUDGET_SOURCE_HASH, spendUsd: V5_PRIOR_SPEND_USD, resultStatus: v5Failure.resultStatus, performanceEvaluationStarted: false },
  v6History: { infrastructureFailureReceiptHash: V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH, resultStatus: v6Failure.resultStatus, performanceEvaluationStarted: false, scientificResultUsable: false, conservativeSpendUpperBoundUsd: V6_CONSERVATIVE_SPEND_UPPER_BOUND_USD },
  singleWriterGenerationReceiptHash: singleWriterReceipt.receiptHash, evaluationWriterLockHash: evaluationWriterLock.metadata.integrityHash,
  sharedBindings: { ...protocol.bindings }, generation: { receipt: portfolio.receipt, candidates: portfolio.candidates, rejected: portfolio.rejected, portfolioIntegrityHash: portfolio.integrityHash, checkpointIntegrityHash: checkpoint.integrityHash }, structuralScreen: structural, prefixObservationSharing, conditions,
  selectionEvaluation: { caseHashes: selectionCases.map(({ stage, caseId, caseHash }) => ({ stage, caseId, caseHash })), observations: allSelection.filter((row) => !baselineIds.has(row.participantId)), summaries: selectionEvaluation.summaries.filter((row) => !baselineIds.has(row.participantId)) }, preFinalSelectionFreeze: preFinal,
  finalConfirmation: { ...confirmation, observations: allConfirmation.filter((row) => !baselineIds.has(row.participantId)), summaries: confirmation.summaries.filter((row) => !baselineIds.has(row.participantId)) },
  baselines: { participants: baselineParticipants.map(({ candidate, ...entry }) => entry), selectionObservations: allSelection.filter((row) => baselineIds.has(row.participantId)), selectionSummaries: selectionEvaluation.summaries.filter((row) => baselineIds.has(row.participantId)), confirmationObservations: allConfirmation.filter((row) => baselineIds.has(row.participantId)), confirmationSummaries: confirmation.summaries.filter((row) => baselineIds.has(row.participantId)) },
  stageUsage: Object.fromEntries(["selection", "confirmation"].map((phase) => { const rows = [...allSelection, ...allConfirmation].filter((row) => row.phase === phase); return [phase, { observations: rows.length, modelCalls: rows.reduce((sum, row) => sum + row.modelCalls, 0), participantEconomicsUsd: rows.reduce((sum, row) => sum + row.modelCostUsd, 0), elapsedMs: rows.reduce((sum, row) => sum + row.elapsedMs, 0) }]; })),
  durableBudgetSnapshot: budget.snapshot(), cumulativePriorAndV7SpendUsd: V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD + budget.spentUsd, evidenceLedgerValid: evidence.verify(), claimBoundary: protocol.metrics.forbiddenInference,
};
result.integrityHash = digest(result); writePrivate(path.join(state, "combined-result.json"), result);
return { status: "paired-v7-evaluation-complete", planHash: plan.planHash, prefixWinner: prefixWinner?.participantId ?? null, globalWinner: globalWinner?.participantId ?? null, prefixConfirmed: conditions[0].confirmationSummary?.completeSafePass ?? false, globalConfirmed: conditions[1].confirmationSummary?.completeSafePass ?? false, v7SpendUsd: budget.spentUsd, cumulativePriorAndV7SpendUsd: result.cumulativePriorAndV7SpendUsd, v7LimitUsd: budget.hardLimitUsd, resultHash: result.integrityHash };
});
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
