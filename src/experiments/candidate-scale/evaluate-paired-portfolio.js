import fs from "node:fs";
import path from "node:path";
import { createCaseVault } from "../../evaluation/case-vault.js";
import { digest } from "../../core/canonical.js";
import { DurableBudgetGuard, PersistentModelResponseCache } from "../../core/durable-model-campaign.js";
import { EvidenceLedger } from "../../core/evidence.js";
import { MeteredModelGateway } from "../../core/model-gateway.js";
import { createCommercialSupportModelEvaluator, createCommercialSupportPack } from "../../product/commercial-support-pack.js";
import { assertPairedPrivateCasePack, pairedPrivateCasePackHash } from "./paired-private-case-pack.js";
import { PairedScaleOpenAIProvider } from "./paired-openai-provider.js";
import { assertPairedEvaluationWallClock, assertPairedObservationProgress, createPairedObservationProgress, pairedObservationProgressKey, recordPairedObservation, resumePairedObservation, sealPairedObservationProgress } from "./paired-observation-progress.js";
import { assertPairedCampaignClock, pairedCampaignRemainingMs } from "./paired-campaign-clock.js";
import { assertPairedScaleAuthorization, createPairedScaleProtocolCore, PAIRED_SCALE_ARTIFACT_ROOT } from "./paired-protocol.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function writePrivate(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); const temporary = `${filePath}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); fs.renameSync(temporary, filePath); fs.chmodSync(filePath, 0o600); }
function withoutHash(value, key = "integrityHash") { const copy = structuredClone(value); delete copy[key]; return copy; }

async function mapConcurrent(values, limit, worker) {
  const results = new Array(values.length); let cursor = 0;
  async function run() { while (cursor < values.length) { const index = cursor++; results[index] = await worker(values[index], index); } }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, run)); return results;
}

function summarize(participant, rows, expectedCases) {
  const modelCostUsd = rows.reduce((sum, row) => sum + row.modelCostUsd, 0); const elapsedMs = rows.reduce((sum, row) => sum + row.elapsedMs, 0);
  return { participantId: participant.id, participantType: participant.type, configurationHash: participant.configurationHash, casesRun: rows.length, expectedCases, passed: rows.filter((row) => row.passed).length, passRate: rows.filter((row) => row.passed).length / expectedCases, meanOutcomeScore: rows.reduce((sum, row) => sum + row.outcomeScore, 0) / expectedCases, unsafeAttempts: rows.reduce((sum, row) => sum + row.unsafeAttempts, 0), incorrectSideEffects: rows.reduce((sum, row) => sum + row.incorrectSideEffects, 0), modelCostUsd, elapsedMs, modelCalls: rows.reduce((sum, row) => sum + row.modelCalls, 0), completeSafePass: rows.length === expectedCases && rows.every((row) => row.passed) && rows.every((row) => row.unsafeAttempts === 0 && row.incorrectSideEffects === 0), observationHashes: rows.map((row) => digest(row)) };
}

function rankEligible(summaries, positionById) {
  return summaries.filter((row) => row.completeSafePass).sort((a, b) => b.meanOutcomeScore - a.meanOutcomeScore || a.modelCostUsd - b.modelCostUsd || a.elapsedMs - b.elapsedMs || (positionById.get(a.participantId) ?? Number.MAX_SAFE_INTEGER) - (positionById.get(b.participantId) ?? Number.MAX_SAFE_INTEGER) || a.participantId.localeCompare(b.participantId));
}

const root = path.resolve(PAIRED_SCALE_ARTIFACT_ROOT); const state = path.join(root, "model-campaign");
const plan = JSON.parse(fs.readFileSync(path.join(root, "live-plan.json"), "utf8")); const casePack = JSON.parse(fs.readFileSync(path.join(root, "private-case-pack.json"), "utf8"));
const portfolio = JSON.parse(fs.readFileSync(path.join(state, "generated-portfolio.json"), "utf8")); const structural = JSON.parse(fs.readFileSync(path.join(state, "structural-selection-freeze.json"), "utf8"));
const protocol = createPairedScaleProtocolCore(); assertPairedPrivateCasePack(casePack, { protocol }); requireCondition(pairedPrivateCasePackHash(casePack) === plan.casePackHash, "Evaluation plan/private pack binding mismatch");
requireCondition(portfolio.integrityHash && digest(withoutHash(portfolio)) === portfolio.integrityHash, "Generated portfolio integrity mismatch");
const structuralCopy = structuredClone(structural); const structuralHash = structuralCopy.freezeHash; delete structuralCopy.freezeHash; requireCondition(structuralHash && digest(structuralCopy) === structuralHash, "Structural selection freeze integrity mismatch");
requireCondition(portfolio.candidates.length === 150 && portfolio.rejected.length === 0, "Paired evaluation requires the complete frozen 150-candidate portfolio");
const authorization = assertPairedScaleAuthorization({ plan, environment: process.env, currentUtcDate: new Date().toISOString().slice(0, 10) });
const campaignClock = JSON.parse(fs.readFileSync(path.join(state, "campaign-clock.json"), "utf8")); assertPairedCampaignClock(campaignClock, { planHash: plan.planHash }); pairedCampaignRemainingMs(campaignClock, protocol.budget.maximumWallClockMs);
const budget = new DurableBudgetGuard({ filePath: path.join(state, "budget.json"), hardLimitUsd: authorization.limitUsd, campaignId: protocol.campaignId }); const cache = new PersistentModelResponseCache({ filePath: path.join(state, "response-cache.json") }); const evidence = new EvidenceLedger(path.join(state, "evidence.jsonl"));
const provider = new PairedScaleOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY, pricingByModel: protocol.pricing.models, environment: process.env }); const gateway = new MeteredModelGateway({ provider, budget, cache, evidence, secrets: [process.env.OPENAI_API_KEY] });
const evaluator = createCommercialSupportModelEvaluator({ gateway, evidence, maxTurns: protocol.evaluation.maximumTurnsPerCase }); const support = createCommercialSupportPack();
const progressPath = path.join(state, "evaluation-observation-progress.json");
let progress = createPairedObservationProgress({ planHash: plan.planHash, startedAt: campaignClock.startedAt });
if (fs.existsSync(progressPath)) {
  progress = JSON.parse(fs.readFileSync(progressPath, "utf8")); assertPairedObservationProgress(progress, { planHash: plan.planHash }); delete progress.integrityHash;
}
function saveProgress() { writePrivate(progressPath, sealPairedObservationProgress(progress)); }
if (!fs.existsSync(progressPath)) saveProgress();
const candidateById = new Map(portfolio.candidates.map((candidate) => [candidate.id, candidate])); const positionById = new Map(portfolio.candidates.map((candidate, index) => [candidate.id, index + 1]));
const candidateParticipants = structural.evaluationUnionIds.map((id) => ({ id, type: "compiler-candidate", configurationHash: candidateById.get(id)?.fingerprint, candidate: candidateById.get(id) }));
requireCondition(candidateParticipants.every((entry) => entry.candidate), "Structural finalist is missing from the frozen portfolio");
const baselineParticipants = support.participants.filter((entry) => ["current-agent", "strong-general", "ordinary-manual", "expert-manual"].includes(entry.type)).map((entry) => ({ id: entry.id, type: entry.type, configurationHash: entry.configurationHash, candidate: entry.candidate }));
requireCondition(digest(baselineParticipants.map(({ candidate, ...entry }) => entry)) === protocol.bindings.baselineHashesHash, "Executable baseline hashes no longer match the protocol");
const participants = [...candidateParticipants, ...baselineParticipants]; const selectionCases = ["development", "validation", "adversarial"].flatMap((stage) => casePack.cases[stage].map((testCase) => ({ stage, testCase, caseId: testCase.id, caseHash: digest(testCase) })));

async function evaluateParticipants(entries, cases, phase) {
  const observations = (await mapConcurrent(entries, 1, async (participant) => {
    const rows = [];
    for (const record of cases) {
      assertPairedEvaluationWallClock(progress, protocol.budget.maximumWallClockMs);
      if (rows.some((row) => row.unsafeAttempts > 0 || row.incorrectSideEffects > 0)) break;
      const progressKey = pairedObservationProgressKey({ planHash: plan.planHash, phase, participantId: participant.id, configurationHash: participant.configurationHash, caseId: record.caseId, caseHash: record.caseHash });
      const prior = resumePairedObservation(progress, progressKey);
      if (prior) { rows.push(prior); continue; }
      const before = budget.calls.length; const raw = await evaluator({ participant, testCase: record.testCase, caseId: record.caseId, stage: record.stage, verifierId: protocol.bindings.verifierId }); const callReceipts = budget.calls.slice(before).map((call) => structuredClone(call));
      const observation = { ...raw, modelCalls: callReceipts.length, phase, stage: record.stage, caseId: record.caseId, caseHash: record.caseHash, participantId: participant.id, participantType: participant.type, configurationHash: participant.configurationHash, candidateFingerprint: participant.candidate.fingerprint, acceptedPosition: positionById.get(participant.id) ?? null, budgetCallReceipts: callReceipts };
      assertPairedEvaluationWallClock(progress, protocol.budget.maximumWallClockMs);
      rows.push(observation); recordPairedObservation(progress, progressKey, observation); saveProgress();
    }
    return rows;
  })).flat();
  const summaries = entries.map((participant) => summarize(participant, observations.filter((row) => row.participantId === participant.id), cases.length));
  return { observations, summaries };
}

const selectionEvaluation = await evaluateParticipants(participants, selectionCases, "selection");
const prefixRanked = rankEligible(selectionEvaluation.summaries.filter((row) => structural.protectedFirstFiveFinalistIds.includes(row.participantId)), positionById); const globalRanked = rankEligible(selectionEvaluation.summaries.filter((row) => structural.globalFinalistIds.includes(row.participantId)), positionById);
const prefixWinner = prefixRanked[0] ?? null; const globalWinner = globalRanked[0] ?? null;
const holdoutRole = `paired:${protocol.protocolCoreHash}:holdout`; const repeatRole = `paired:${protocol.protocolCoreHash}:repeat`;
const holdoutVault = createCaseVault(holdoutRole, casePack.cases.holdout); const repeatVault = createCaseVault(repeatRole, casePack.cases.repeat);
const preFinal = { schemaVersion: "das.candidate-scale-paired-pre-final-freeze.v1", planHash: plan.planHash, protocolCoreHash: protocol.protocolCoreHash, structuralSelectionFreezeHash: structural.freezeHash, selectionObservationHash: digest(selectionEvaluation.observations), prefixWinner: prefixWinner ? { id: prefixWinner.participantId, configurationHash: prefixWinner.configurationHash } : null, globalWinner: globalWinner ? { id: globalWinner.participantId, configurationHash: globalWinner.configurationHash } : null, baselineHashesHash: protocol.bindings.baselineHashesHash, holdoutDigest: holdoutVault.digest, repeatDigest: repeatVault.digest, rule: protocol.evaluation.confirmationRule };
preFinal.freezeHash = digest(preFinal); writePrivate(path.join(state, "pre-final-selection-freeze.json"), preFinal);
const winnerIds = [...new Set([prefixWinner?.participantId, globalWinner?.participantId].filter(Boolean))]; const winnerParticipants = winnerIds.map((id) => candidateParticipants.find((entry) => entry.id === id));
let confirmation = { observations: [], summaries: [], holdoutReleaseCount: 0, repeatReleaseCount: 0, status: "no-safe-winner" };
if (winnerParticipants.length) {
  const candidateHashes = Object.fromEntries(winnerParticipants.map((entry) => [entry.id, entry.configurationHash])); const baselineHashes = Object.fromEntries(baselineParticipants.map((entry) => [entry.id, entry.configurationHash]));
  const holdout = holdoutVault.release({ freezeHash: preFinal.freezeHash, role: holdoutRole, candidateHashes, baselineHashes }); const repeat = repeatVault.release({ freezeHash: preFinal.freezeHash, role: repeatRole, candidateHashes, baselineHashes });
  const confirmationCases = [...holdout.map((testCase) => ({ stage: "holdout", testCase, caseId: testCase.id, caseHash: digest(testCase) })), ...repeat.map((testCase) => ({ stage: "repeat", testCase, caseId: testCase.id, caseHash: digest(testCase) }))];
  confirmation = { ...(await evaluateParticipants([...winnerParticipants, ...baselineParticipants], confirmationCases, "confirmation")), holdoutReleaseCount: holdoutVault.releaseCount(), repeatReleaseCount: repeatVault.releaseCount(), status: "confirmation-complete", caseHashes: confirmationCases.map(({ stage, caseId, caseHash }) => ({ stage, caseId, caseHash })) };
}
const confirmationById = new Map(confirmation.summaries.map((row) => [row.participantId, row])); const conditions = [
  { id: "first-five-prefix", poolCandidateIds: structural.firstFiveCandidateIds, fullEvaluationCandidateIds: structural.protectedFirstFiveFinalistIds, selectedCandidateId: prefixWinner?.participantId ?? null, selectionSummary: prefixWinner, confirmationSummary: prefixWinner ? confirmationById.get(prefixWinner.participantId) ?? null : null },
  { id: "adaptive-150-search", poolCandidateIds: portfolio.candidates.map((candidate) => candidate.id), fullEvaluationCandidateIds: structural.globalFinalistIds, selectedCandidateId: globalWinner?.participantId ?? null, selectionSummary: globalWinner, confirmationSummary: globalWinner ? confirmationById.get(globalWinner.participantId) ?? null : null },
];
const baselineIds = new Set(baselineParticipants.map((entry) => entry.id)); const result = {
  schemaVersion: "das.candidate-scale-paired-combined-result.v1", planHash: plan.planHash, protocolCoreHash: protocol.protocolCoreHash, protocol, casePackHash: plan.casePackHash, casePackReceiptHash: plan.casePackReceiptHash, pricingHash: protocol.pricingHash,
  sharedBindings: { ...protocol.bindings }, generation: { receipt: portfolio.receipt, candidates: portfolio.candidates, rejected: portfolio.rejected, portfolioIntegrityHash: portfolio.integrityHash },
  structuralScreen: structural, conditions,
  selectionEvaluation: { caseHashes: selectionCases.map(({ stage, caseId, caseHash }) => ({ stage, caseId, caseHash })), observations: selectionEvaluation.observations.filter((row) => !baselineIds.has(row.participantId)), summaries: selectionEvaluation.summaries.filter((row) => !baselineIds.has(row.participantId)) },
  preFinalSelectionFreeze: preFinal,
  finalConfirmation: { ...confirmation, observations: confirmation.observations.filter((row) => !baselineIds.has(row.participantId)), summaries: confirmation.summaries.filter((row) => !baselineIds.has(row.participantId)) },
  baselines: { participants: baselineParticipants.map(({ candidate, ...entry }) => entry), selectionObservations: selectionEvaluation.observations.filter((row) => baselineIds.has(row.participantId)), selectionSummaries: selectionEvaluation.summaries.filter((row) => baselineIds.has(row.participantId)), confirmationObservations: confirmation.observations.filter((row) => baselineIds.has(row.participantId)), confirmationSummaries: confirmation.summaries.filter((row) => baselineIds.has(row.participantId)) },
  stageUsage: Object.fromEntries(["selection", "confirmation"].map((phase) => { const rows = [...selectionEvaluation.observations, ...confirmation.observations].filter((row) => row.phase === phase); return [phase, { observations: rows.length, modelCalls: rows.reduce((sum, row) => sum + row.modelCalls, 0), participantEconomicsUsd: rows.reduce((sum, row) => sum + row.modelCostUsd, 0), elapsedMs: rows.reduce((sum, row) => sum + row.elapsedMs, 0) }]; })),
  durableBudgetSnapshot: budget.snapshot(), evidenceLedgerValid: evidence.verify(), claimBoundary: protocol.metrics.forbiddenInference,
};
result.integrityHash = digest(result); writePrivate(path.join(state, "completed-result.json"), result);
process.stdout.write(`${JSON.stringify({ status: "paired-5-vs-150-evaluation-complete", planHash: plan.planHash, prefixWinner: prefixWinner?.participantId ?? null, globalWinner: globalWinner?.participantId ?? null, prefixConfirmed: conditions[0].confirmationSummary?.completeSafePass ?? false, globalConfirmed: conditions[1].confirmationSummary?.completeSafePass ?? false, spendUsd: budget.spentUsd, budgetLimitUsd: budget.hardLimitUsd, resultHash: result.integrityHash }, null, 2)}\n`);
