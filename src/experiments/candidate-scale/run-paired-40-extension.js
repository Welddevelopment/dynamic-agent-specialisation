import fs from "node:fs";
import path from "node:path";
import { digest } from "../../core/canonical.js";
import { DurableBudgetGuard, PersistentModelResponseCache } from "../../core/durable-model-campaign.js";
import { EvidenceLedger } from "../../core/evidence.js";
import { MeteredModelGateway } from "../../core/model-gateway.js";
import { createCommercialSupportModelEvaluator, createCommercialSupportPack } from "../../product/commercial-support-pack.js";
import { assertPaired40ExtensionAuthorization, PAIRED_40_EXTENSION_ROOT } from "./paired-40-extension.js";
import { assertPairedCampaignClock, pairedCampaignRemainingMs } from "./paired-campaign-clock.js";
import { assertPairedPrivateCasePack, pairedPrivateCasePackHash } from "./paired-private-case-pack.js";
import { PairedScaleOpenAIProvider } from "./paired-openai-provider.js";
import { assertPairedEvaluationWallClock, assertPairedObservationProgress, createPairedObservationProgress, pairedObservationProgressKey, recordPairedObservation, resumePairedObservation, sealPairedObservationProgress } from "./paired-observation-progress.js";
import { assertPairedScaleAuthorization, createPairedScaleProtocolCore, PAIRED_SCALE_ARTIFACT_ROOT } from "./paired-protocol.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function read(filePath) { requireCondition(fs.existsSync(filePath), `Missing required artifact: ${filePath}`); return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function writePrivate(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); const temporary = `${filePath}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); fs.renameSync(temporary, filePath); fs.chmodSync(filePath, 0o600); }
function verifySealed(value, hashKey, label) { const copy = structuredClone(value); const expected = copy[hashKey]; delete copy[hashKey]; requireCondition(expected && digest(copy) === expected, `${label} integrity mismatch`); }

function summarize(participant, rows, expectedCases) {
  const modelCostUsd = rows.reduce((sum, row) => sum + Number(row.modelCostUsd ?? 0), 0);
  const elapsedMs = rows.reduce((sum, row) => sum + Number(row.elapsedMs ?? 0), 0);
  return { participantId: participant.id, participantType: participant.type, configurationHash: participant.configurationHash, casesRun: rows.length, expectedCases, passed: rows.filter((row) => row.passed).length, passRate: rows.filter((row) => row.passed).length / expectedCases, meanOutcomeScore: rows.reduce((sum, row) => sum + Number(row.outcomeScore ?? 0), 0) / expectedCases, unsafeAttempts: rows.reduce((sum, row) => sum + Number(row.unsafeAttempts ?? 0), 0), incorrectSideEffects: rows.reduce((sum, row) => sum + Number(row.incorrectSideEffects ?? 0), 0), modelCostUsd, elapsedMs, modelCalls: rows.reduce((sum, row) => sum + Number(row.modelCalls ?? 0), 0), completeSafePass: rows.length === expectedCases && rows.every((row) => row.passed) && rows.every((row) => row.unsafeAttempts === 0 && row.incorrectSideEffects === 0), observationHashes: rows.map((row) => digest(row)) };
}

function rankEligible(summaries, positionById) {
  return summaries.filter((row) => row.completeSafePass).sort((a, b) => b.meanOutcomeScore - a.meanOutcomeScore || a.modelCostUsd - b.modelCostUsd || a.elapsedMs - b.elapsedMs || (positionById.get(a.participantId) ?? Number.MAX_SAFE_INTEGER) - (positionById.get(b.participantId) ?? Number.MAX_SAFE_INTEGER) || a.participantId.localeCompare(b.participantId));
}

function exactReusableObservation(rows, { participant, record, phase, verifierId }) {
  const matches = rows.filter((row) => row.phase === phase && row.participantId === participant.id && row.configurationHash === participant.configurationHash && row.caseId === record.caseId && row.caseHash === record.caseHash && row.verifierId === verifierId && row.independentlyVerified === true && typeof row.receiptHash === "string");
  requireCondition(matches.length <= 1, `Multiple v5 observations matched ${participant.id}/${record.caseId}`);
  return matches[0] ? structuredClone(matches[0]) : null;
}

const baseRoot = path.resolve(PAIRED_SCALE_ARTIFACT_ROOT);
const baseState = path.join(baseRoot, "model-campaign");
const extensionRoot = path.resolve(PAIRED_40_EXTENSION_ROOT);
const extensionState = path.join(extensionRoot, "model-campaign");
const basePlan = read(path.join(baseRoot, "live-plan.json"));
const plan = read(path.join(extensionRoot, "live-plan.json"));
const casePack = read(path.join(baseRoot, "private-case-pack.json"));
const portfolio = read(path.join(baseState, "generated-portfolio.json"));
const v5Result = read(path.join(baseState, "completed-result.json"));
verifySealed(plan, "extensionPlanHash", "40-prefix live plan");
verifySealed(portfolio, "integrityHash", "v5 generated portfolio");
verifySealed(v5Result, "integrityHash", "v5 completed result");
requireCondition(v5Result.planHash === basePlan.planHash && basePlan.planHash === plan.baseV5PlanHash, "40-prefix extension is not bound to this completed v5 campaign");
requireCondition(v5Result.generation.portfolioIntegrityHash === portfolio.integrityHash && plan.portfolioIntegrityHash === portfolio.integrityHash, "40-prefix portfolio binding changed");
requireCondition(v5Result.evidenceLedgerValid === true, "v5 evidence ledger was not valid");
const protocol = createPairedScaleProtocolCore();
assertPairedPrivateCasePack(casePack, { protocol });
requireCondition(pairedPrivateCasePackHash(casePack) === plan.casePackHash && plan.casePackHash === basePlan.casePackHash, "40-prefix private case binding changed");
assertPairedScaleAuthorization({ plan: basePlan, environment: process.env, currentUtcDate: new Date().toISOString().slice(0, 10) });
assertPaired40ExtensionAuthorization({ plan, environment: process.env });

const campaignClock = read(path.join(baseState, "campaign-clock.json"));
assertPairedCampaignClock(campaignClock, { planHash: basePlan.planHash });
pairedCampaignRemainingMs(campaignClock, protocol.budget.maximumWallClockMs);
const budget = new DurableBudgetGuard({ filePath: path.join(baseState, "budget.json"), hardLimitUsd: protocol.budget.hardCampaignCeilingUsd, campaignId: protocol.campaignId });
requireCondition(budget.spentUsd < protocol.budget.hardCampaignCeilingUsd, "No verified v5 durable budget remains for the 40-prefix extension");
const cache = new PersistentModelResponseCache({ filePath: path.join(baseState, "response-cache.json") });
const evidence = new EvidenceLedger(path.join(baseState, "evidence.jsonl"));
const provider = new PairedScaleOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY, pricingByModel: protocol.pricing.models, environment: process.env });
const gateway = new MeteredModelGateway({ provider, budget, cache, evidence, secrets: [process.env.OPENAI_API_KEY] });
const evaluator = createCommercialSupportModelEvaluator({ gateway, evidence, maxTurns: protocol.evaluation.maximumTurnsPerCase });
const support = createCommercialSupportPack();
const candidateById = new Map(portfolio.candidates.map((candidate) => [candidate.id, candidate]));
const positionById = new Map(portfolio.candidates.map((candidate, index) => [candidate.id, index + 1]));
requireCondition(plan.first40CandidateIds.every((id, index) => portfolio.candidates[index]?.id === id), "40-prefix accepted order changed");
const candidateParticipants = plan.finalistIds.map((id) => ({ id, type: "compiler-candidate", configurationHash: candidateById.get(id)?.fingerprint, candidate: candidateById.get(id) }));
requireCondition(candidateParticipants.length === 7 && candidateParticipants.every((entry) => entry.candidate), "40-prefix finalists are incomplete");
const baselineParticipants = support.participants.filter((entry) => ["current-agent", "strong-general", "ordinary-manual", "expert-manual"].includes(entry.type)).map((entry) => ({ id: entry.id, type: entry.type, configurationHash: entry.configurationHash, candidate: entry.candidate }));
requireCondition(digest(baselineParticipants.map(({ candidate, ...entry }) => entry)) === protocol.bindings.baselineHashesHash, "Executable baseline hashes changed");
const selectionCases = ["development", "validation", "adversarial"].flatMap((stage) => casePack.cases[stage].map((testCase) => ({ stage, testCase, caseId: testCase.id, caseHash: digest(testCase) })));
const confirmationCases = ["holdout", "repeat"].flatMap((stage) => casePack.cases[stage].map((testCase) => ({ stage, testCase, caseId: testCase.id, caseHash: digest(testCase) })));
const reusableRows = [
  ...v5Result.selectionEvaluation.observations,
  ...v5Result.baselines.selectionObservations,
  ...v5Result.finalConfirmation.observations,
  ...v5Result.baselines.confirmationObservations,
];

const progressPath = path.join(extensionState, "extension-observation-progress.json");
let progress = fs.existsSync(progressPath) ? read(progressPath) : createPairedObservationProgress({ planHash: plan.extensionPlanHash, startedAt: campaignClock.startedAt });
assertPairedObservationProgress(progress, { planHash: plan.extensionPlanHash });
delete progress.integrityHash;
function saveProgress() { writePrivate(progressPath, sealPairedObservationProgress(progress)); }
if (!fs.existsSync(progressPath)) saveProgress();

async function evaluate(entries, cases, phase) {
  const rows = [];
  for (const participant of entries) {
    for (const record of cases) {
      assertPairedEvaluationWallClock(progress, protocol.budget.maximumWallClockMs);
      const participantRows = rows.filter((row) => row.participantId === participant.id);
      if (participantRows.some((row) => row.unsafeAttempts > 0 || row.incorrectSideEffects > 0)) break;
      const progressKey = pairedObservationProgressKey({ planHash: plan.extensionPlanHash, phase, participantId: participant.id, configurationHash: participant.configurationHash, caseId: record.caseId, caseHash: record.caseHash });
      const resumed = resumePairedObservation(progress, progressKey);
      if (resumed) { rows.push(resumed); continue; }
      const reused = exactReusableObservation(reusableRows, { participant, record, phase, verifierId: protocol.bindings.verifierId });
      if (reused) { rows.push(reused); recordPairedObservation(progress, progressKey, { ...reused, extensionReuse: { sourcePlanHash: basePlan.planHash, sourceObservationHash: digest(reused) } }); saveProgress(); continue; }
      const before = budget.calls.length;
      const raw = await evaluator({ participant, testCase: record.testCase, caseId: record.caseId, stage: record.stage, verifierId: protocol.bindings.verifierId });
      const callReceipts = budget.calls.slice(before).map((call) => structuredClone(call));
      const observation = { ...raw, modelCalls: callReceipts.length, phase, stage: record.stage, caseId: record.caseId, caseHash: record.caseHash, participantId: participant.id, participantType: participant.type, configurationHash: participant.configurationHash, candidateFingerprint: participant.candidate.fingerprint, acceptedPosition: positionById.get(participant.id) ?? null, budgetCallReceipts: callReceipts };
      rows.push(observation); recordPairedObservation(progress, progressKey, observation); saveProgress();
    }
  }
  return { observations: rows, summaries: entries.map((participant) => summarize(participant, rows.filter((row) => row.participantId === participant.id), cases.length)) };
}

const selection = await evaluate([...candidateParticipants, ...baselineParticipants], selectionCases, "selection");
const winner = rankEligible(selection.summaries.filter((row) => row.participantType === "compiler-candidate"), positionById)[0] ?? null;
const preFinal = { schemaVersion: "das.candidate-scale-prefix-40-pre-final-freeze.v1", extensionPlanHash: plan.extensionPlanHash, selectionObservationHash: digest(selection.observations), winner: winner ? { id: winner.participantId, configurationHash: winner.configurationHash } : null, confirmationCaseHashes: confirmationCases.map(({ stage, caseId, caseHash }) => ({ stage, caseId, caseHash })), rule: protocol.evaluation.confirmationRule };
preFinal.freezeHash = digest(preFinal);
writePrivate(path.join(extensionState, "pre-final-selection-freeze.json"), preFinal);
let confirmation = { observations: [], summaries: [], status: "no-safe-winner" };
if (winner) {
  const winnerParticipant = candidateParticipants.find((entry) => entry.id === winner.participantId);
  confirmation = { ...(await evaluate([winnerParticipant, ...baselineParticipants], confirmationCases, "confirmation")), status: "confirmation-complete" };
}
const result = {
  schemaVersion: "das.candidate-scale-prefix-40-result.v1",
  extensionPlanHash: plan.extensionPlanHash,
  preregistrationHash: plan.preregistrationHash,
  baseV5PlanHash: basePlan.planHash,
  baseV5ResultHash: v5Result.integrityHash,
  portfolioIntegrityHash: portfolio.integrityHash,
  first40CandidateIds: plan.first40CandidateIds,
  finalistIds: plan.finalistIds,
  selectionEvaluation: selection,
  preFinalSelectionFreeze: preFinal,
  selectedCandidateId: winner?.participantId ?? null,
  finalConfirmation: confirmation,
  durableBudgetSnapshot: budget.snapshot(),
  evidenceLedgerValid: evidence.verify(),
  claimBoundary: "One preregistered nested 40-prefix arm inside one adaptive support-role search. This does not establish a universal optimal candidate count or isolate count from adaptive prior-memory effects.",
};
result.integrityHash = digest(result);
writePrivate(path.join(extensionState, "completed-result.json"), result);
process.stdout.write(`${JSON.stringify({ status: "paired-prefix-40-extension-complete", extensionPlanHash: plan.extensionPlanHash, selectedCandidateId: result.selectedCandidateId, confirmedSafePass: confirmation.summaries.find((row) => row.participantId === result.selectedCandidateId)?.completeSafePass ?? false, spendUsd: budget.spentUsd, remainingBelow23Usd: Math.max(0, protocol.budget.hardCampaignCeilingUsd - budget.spentUsd), resultHash: result.integrityHash }, null, 2)}\n`);
