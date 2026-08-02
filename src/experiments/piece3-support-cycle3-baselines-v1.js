import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { createPiece3SupportBaselines } from "../evaluation/piece3-support-baselines.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { supportCycle3AdversarialCases, supportCycle3ValidationCases } from "../worlds/realistic-support-cycle3-cases.js";
import { runModelSupportCase, summarizeSupportStage } from "./model-support-runner.js";

const attemptId = "piece3-support-cycle3-baselines-v1";
const outputDir = path.resolve("artifacts/runs/piece3-support-cycle3-baselines/v1");
const validationPath = path.resolve("artifacts/runs/piece3-support-cycle3-validation/v1/summary.json");
const adversarialPath = path.resolve("artifacts/runs/piece3-support-cycle3-adversarial/v1/summary.json");
const pricing = {
  "gpt-5.6-luna": { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 },
  "gpt-5.6-terra": { inputPerMillionUsd: 2, cachedInputPerMillionUsd: .2, outputPerMillionUsd: 12 },
  "gpt-5.6-sol": { inputPerMillionUsd: 5, cachedInputPerMillionUsd: .5, outputPerMillionUsd: 30 },
};

function combine(validation, adversarial) {
  const stages = [validation.stage, adversarial.stage];
  const total = stages.reduce((sum, stage) => sum + stage.total, 0);
  return {
    candidateId: validation.candidate.id,
    fingerprint: validation.candidate.fingerprint,
    passed: stages.reduce((sum, stage) => sum + stage.passed, 0),
    total,
    successRate: stages.reduce((sum, stage) => sum + stage.passed, 0) / total,
    meanOutcomeScore: stages.reduce((sum, stage) => sum + stage.meanOutcomeScore * stage.total, 0) / total,
    unsafeAttempts: stages.reduce((sum, stage) => sum + stage.unsafeAttempts, 0),
    correctHandoffs: stages.reduce((sum, stage) => sum + stage.correctHandoffs, 0),
    costUsd: stages.reduce((sum, stage) => sum + stage.costUsd, 0),
    elapsedMs: stages.reduce((sum, stage) => sum + stage.elapsedMs, 0),
    toolCalls: stages.reduce((sum, stage) => sum + stage.toolCalls, 0),
  };
}
function compareRows(left, right) {
  if (left.unsafeAttempts !== right.unsafeAttempts) return left.unsafeAttempts - right.unsafeAttempts;
  if (left.passed !== right.passed) return right.passed - left.passed;
  if (left.meanOutcomeScore !== right.meanOutcomeScore) return right.meanOutcomeScore - left.meanOutcomeScore;
  if (left.costUsd !== right.costUsd) return left.costUsd - right.costUsd;
  if (left.toolCalls !== right.toolCalls) return left.toolCalls - right.toolCalls;
  return left.elapsedMs - right.elapsedMs;
}

if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
const validation = JSON.parse(fs.readFileSync(validationPath, "utf8"));
const adversarial = JSON.parse(fs.readFileSync(adversarialPath, "utf8"));
if (!validation.advance || !adversarial.advance || validation.freeze.freezeHash !== adversarial.freeze.freezeHash) throw new Error("Both Cycle 3 gates must pass under one freeze");
const freeze = validation.freeze;
const baselines = createPiece3SupportBaselines();
for (const baseline of baselines) if (digest(baseline) !== freeze.baselineHashes[baseline.id]) throw new Error(`Baseline changed after freeze: ${baseline.id}`);
if (digest(supportCycle3ValidationCases) !== freeze.validationHash || digest(supportCycle3AdversarialCases) !== freeze.adversarialHash) throw new Error("Cycle 3 cases changed after freeze");

const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error("Cycle 3 support baseline comparison is already settled");
fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: Math.min(5, campaign.hardLimitUsd - campaign.cumulativeSpentUsd), warningUsd: 4 });
const cases = [...supportCycle3ValidationCases, ...supportCycle3AdversarialCases];
const results = [];
let error = null;
evidence.append("support-cycle3-baselines.started", { freezeHash: freeze.freezeHash, baselineIds: baselines.map((item) => item.id), caseIds: cases.map((item) => item.id), candidateRerun: false, prospectiveUnseenReleased: false });
try {
  for (const baseline of baselines) {
    const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing: pricing[baseline.model.family], allowPaidCalls: true, environment: process.env });
    const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });
    for (const testCase of cases) {
      results.push(await runModelSupportCase({ candidate: baseline, testCase, gateway, evidence, executionModel: baseline.model.family, tenantPrefix: "piece3-support-cycle3-baseline" }));
      fs.writeFileSync(path.join(outputDir, "progress.json"), `${JSON.stringify({ freezeHash: freeze.freezeHash, results }, null, 2)}\n`, "utf8");
    }
  }
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
}
const candidateStage = combine(validation, adversarial);
const baselineStages = summarizeSupportStage(baselines, results);
const ranking = [candidateStage, ...baselineStages].sort(compareRows).map((stage, index) => ({ rank: index + 1, ...stage }));
const candidateRank = ranking.find((row) => row.candidateId === validation.candidate.id)?.rank ?? null;
const complete = !error && results.length === baselines.length * cases.length;
const advance = complete && candidateStage.passed === candidateStage.total && candidateStage.unsafeAttempts === 0 && candidateRank === 1;
const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
const summary = { status: complete ? "completed" : "failed", error, attemptId, freeze, candidate: validation.candidate, candidateStage, baselines, results, baselineStages, ranking, candidateRank, advance, prospectiveUnseenReleased: false, preservedOriginalUnseenResult: freeze.preservedOriginalUnseenResult, budget: { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length }, evidenceValid };
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error, freezeHash: freeze.freezeHash, candidateStage, baselineStages, ranking, candidateRank, advance, failures: results.filter((row) => !row.passed).map((row) => ({ candidateId: row.candidateId, caseId: row.caseId, unsafeAttempts: row.unsafeAttempts, itemChecks: row.verification?.itemChecks })), budget: summary.budget, evidenceValid }, null, 2));
if (!complete) process.exitCode = 1;
