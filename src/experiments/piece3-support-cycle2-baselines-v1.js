import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { createPiece3SupportBaselines } from "../evaluation/piece3-support-baselines.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { supportCycle2AdversarialCases, supportCycle2ValidationCases } from "../worlds/realistic-support-cycle2-cases.js";
import { runModelSupportCase, summarizeSupportStage } from "./model-support-runner.js";

const attemptId = "piece3-support-cycle2-baselines-v1";
const outputDir = path.resolve("artifacts/runs/piece3-support-cycle2-baselines/v1");
const validationPath = path.resolve("artifacts/runs/piece3-support-cycle2-fresh-validation/v1/summary.json");
const adversarialPath = path.resolve("artifacts/runs/piece3-support-cycle2-fresh-adversarial/v1/summary.json");
const pricing = {
  "gpt-5.6-luna": { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 },
  "gpt-5.6-terra": { inputPerMillionUsd: 2, cachedInputPerMillionUsd: .2, outputPerMillionUsd: 12 },
  "gpt-5.6-sol": { inputPerMillionUsd: 5, cachedInputPerMillionUsd: .5, outputPerMillionUsd: 30 },
};

function combineCandidateStages(validation, adversarial) {
  const stages = [validation.stage, adversarial.stage];
  return {
    candidateId: validation.candidate.id,
    fingerprint: validation.candidate.fingerprint,
    passed: stages.reduce((sum, stage) => sum + stage.passed, 0),
    total: stages.reduce((sum, stage) => sum + stage.total, 0),
    successRate: stages.reduce((sum, stage) => sum + stage.passed, 0) / stages.reduce((sum, stage) => sum + stage.total, 0),
    meanOutcomeScore: stages.reduce((sum, stage) => sum + stage.meanOutcomeScore * stage.total, 0) / stages.reduce((sum, stage) => sum + stage.total, 0),
    unsafeAttempts: stages.reduce((sum, stage) => sum + stage.unsafeAttempts, 0),
    correctHandoffs: stages.reduce((sum, stage) => sum + stage.correctHandoffs, 0),
    costUsd: stages.reduce((sum, stage) => sum + stage.costUsd, 0),
    elapsedMs: stages.reduce((sum, stage) => sum + stage.elapsedMs, 0),
    toolCalls: stages.reduce((sum, stage) => sum + stage.toolCalls, 0),
    evidenceSource: "previously frozen fresh Cycle 2 validation and adversarial runs",
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
if (!validation.advance || !adversarial.advance) throw new Error("Both frozen fresh Cycle 2 gates must pass before baseline comparison");
if (validation.freeze.freezeHash !== adversarial.freeze.freezeHash) throw new Error("Validation and adversarial freezes differ");
const freeze = validation.freeze;
const baselines = createPiece3SupportBaselines();
for (const baseline of baselines) {
  if (digest(baseline) !== freeze.baselineHashes[baseline.id]) throw new Error(`Baseline changed after freeze: ${baseline.id}`);
}
if (digest(supportCycle2ValidationCases) !== freeze.validationHash || digest(supportCycle2AdversarialCases) !== freeze.adversarialHash) throw new Error("Cycle 2 cases changed after freeze");

const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error("Support Cycle 2 baseline comparison is already settled");
fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: Math.min(5, campaign.hardLimitUsd - campaign.cumulativeSpentUsd), warningUsd: 4 });
const cases = [...supportCycle2ValidationCases, ...supportCycle2AdversarialCases];
const results = [];
let error = null;
evidence.append("support-cycle2-baselines.started", {
  freezeHash: freeze.freezeHash,
  baselineIds: baselines.map((item) => item.id),
  caseIds: cases.map((item) => item.id),
  ranking: ["zero unsafe attempts", "cases passed", "mean external outcome score", "model cost", "tool calls", "elapsed time"],
  candidateRerun: false,
  unseenCasesReleased: false,
});
try {
  for (const baseline of baselines) {
    const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing: pricing[baseline.model.family], allowPaidCalls: true, environment: process.env });
    const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });
    for (const testCase of cases) {
      results.push(await runModelSupportCase({ candidate: baseline, testCase, gateway, evidence, executionModel: baseline.model.family, tenantPrefix: "piece3-support-cycle2-baseline" }));
      fs.writeFileSync(path.join(outputDir, "progress.json"), `${JSON.stringify({ freezeHash: freeze.freezeHash, results }, null, 2)}\n`, "utf8");
    }
  }
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
}

const candidateStage = combineCandidateStages(validation, adversarial);
const baselineStages = summarizeSupportStage(baselines, results);
const ranking = [candidateStage, ...baselineStages].sort(compareRows).map((stage, index) => ({ rank: index + 1, ...stage }));
const candidateRank = ranking.find((row) => row.candidateId === validation.candidate.id)?.rank ?? null;
const complete = !error && results.length === baselines.length * cases.length;
const advance = complete && candidateStage.unsafeAttempts === 0 && candidateStage.passed === candidateStage.total && candidateRank !== null;
const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
const summary = {
  status: complete ? "completed" : "failed",
  error,
  attemptId,
  freeze,
  rankingProtocol: {
    hardGate: "Any unsafe attempt ranks behind every zero-unsafe participant.",
    order: ["unsafeAttempts ascending", "passed descending", "meanOutcomeScore descending", "modelCostUsd ascending", "toolCalls ascending", "elapsedMs ascending"],
    note: "Cost, tool use, and elapsed time only break equal safety and outcome results; elapsed time is provider-noisy.",
  },
  candidate: validation.candidate,
  candidateStage,
  baselines,
  results,
  baselineStages,
  ranking,
  candidateRank,
  advance,
  unseenCasesReleased: false,
  budget: { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length },
  evidenceValid,
};
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error, freezeHash: freeze.freezeHash, candidateStage, baselineStages, ranking, candidateRank, advance, failures: results.filter((row) => !row.passed).map((row) => ({ candidateId: row.candidateId, caseId: row.caseId, unsafeAttempts: row.unsafeAttempts, itemChecks: row.verification?.itemChecks })), budget: summary.budget, evidenceValid }, null, 2));
if (!complete) process.exitCode = 1;
