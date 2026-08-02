import fs from "node:fs";
import path from "node:path";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { ModelOptimizationRefiner } from "../compiler/model-optimization-refiner.js";
import { createPiece3SupportBaselines } from "../evaluation/piece3-support-baselines.js";
import { TargetDrivenImprovementController } from "../optimization/improvement-controller.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { realisticSupportBrief } from "../roles/realistic-support.js";
import { realisticSupportCases } from "../worlds/realistic-support-cases.js";
import { runModelSupportCase } from "./model-support-runner.js";

const attemptId = "piece3-support-development-target-v2-resume";
const PRICING = { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 };
const v1Path = path.resolve("artifacts/runs/piece3-support-development-target/v1/summary.json");
const viabilityPath = path.resolve("artifacts/runs/piece3-support-viability/v4/summary.json");
const outputDir = path.resolve("artifacts/runs/piece3-support-development-target/v2");

if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
if (!fs.existsSync(v1Path) || !fs.existsSync(viabilityPath)) throw new Error("V1 development and V4 viability evidence are required");

const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error("Piece 3 support development resume is already settled");
fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: Math.min(4.5, campaign.hardLimitUsd - campaign.cumulativeSpentUsd), warningUsd: 4 });
const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing: PRICING, allowPaidCalls: true, environment: process.env, modelMap: { "candidate-optimization-policy": "gpt-5.6-luna" } });
const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });

const prior = JSON.parse(fs.readFileSync(v1Path, "utf8"));
if (prior.status !== "completed" || prior.result?.stopReason !== "no-plausible-improvement-path") throw new Error("Unexpected V1 source state");
const viability = JSON.parse(fs.readFileSync(viabilityPath, "utf8"));
const survivors = viability.survivorIds.map((id) => viability.candidates.find((candidate) => candidate.id === id));
if (survivors.some((candidate) => !candidate)) throw new Error("A viability survivor is missing");
const baseline = createPiece3SupportBaselines().find((candidate) => candidate.id === prior.result.baseline.candidateId);
if (!baseline) throw new Error("The V1 baseline no longer matches the frozen baseline set");

const cached = new Map();
cached.set(baseline.id, prior.evaluationReceipts.filter((row) => row.candidateId === baseline.id).map((row) => ({ ...row, toolSequence: [] })));
for (const result of prior.result.rounds[0].results) cached.set(result.candidateId, result.caseMeasurements.map((row) => ({ ...row })));

const refinementReceipts = [];
const evaluationReceipts = [];
const refiner = new ModelOptimizationRefiner({ gateway, maxOutputTokens: 8_000 });
const controller = new TargetDrivenImprovementController({
  contract: prior.contract,
  spentUsd: () => budget.spentUsd,
  evidence,
  evaluate: async (candidate, stage) => {
    if (cached.has(candidate.id)) {
      const rows = structuredClone(cached.get(candidate.id));
      evidence.append("support-development.cached-measurement-reused", { candidateId: candidate.id, sourceAttemptId: prior.attemptId, caseIds: rows.map((row) => row.caseId) });
      return rows;
    }
    evidence.append("support-development.refined-participant-started", { candidateId: candidate.id, stage, currentSpendUsd: budget.spentUsd });
    const rows = [];
    for (const testCase of realisticSupportCases.development) {
      const row = await runModelSupportCase({ candidate, testCase, gateway, evidence, executionModel: candidate.model.family, tenantPrefix: `piece3-development-resume:${stage.kind}:${stage.round}` });
      rows.push(row);
      const receipt = { candidateId: candidate.id, stage, caseId: row.caseId, passed: row.passed, outcomeScore: row.outcomeScore, unsafeAttempts: row.unsafeAttempts, modelCostUsd: row.modelCostUsd, elapsedMs: row.elapsedMs, toolCalls: row.toolCalls, toolSequence: row.toolSequence };
      evaluationReceipts.push(receipt);
      evidence.append("support-development.refined-case-finished", receipt);
    }
    return rows;
  },
  estimatePotential: async ({ summary, assessment }) => {
    if (!assessment.qualityChecks.safe) return 0;
    const passGap = Math.max(0, prior.contract.qualityFloor.minimumPassRate - summary.passRate);
    const outcomeGap = Math.max(0, prior.result.baseline.outcomeScore * prior.contract.qualityFloor.minimumOutcomeScoreRatio - summary.outcomeScore);
    const objectiveGap = Object.values(assessment.objectiveChecks).reduce((sum, check) => sum + Math.max(0, check.gap), 0);
    return Math.max(.03, Math.min(.85, .65 - passGap - outcomeGap - objectiveGap));
  },
  refine: async ({ parent, diagnosis, round }) => {
    try {
      const refined = await refiner.refine({ brief: realisticSupportBrief, parent, diagnosis, contract: prior.contract, round });
      const receipt = { parentId: parent.id, childId: refined.candidate.id, round, differences: refined.differences, modelReceipt: refined.modelReceipt };
      refinementReceipts.push(receipt);
      evidence.append("support-development.candidate-refined", receipt);
      return refined.candidate;
    } catch (error) {
      const receipt = { parentId: parent.id, round, error: error instanceof Error ? error.message : String(error) };
      refinementReceipts.push(receipt);
      evidence.append("support-development.refinement-rejected", receipt);
      return null;
    }
  },
});

let summary;
try {
  const result = await controller.run({ baseline, initialCandidates: survivors });
  summary = { status: "completed", attemptId, sourceAttemptId: prior.attemptId, contract: prior.contract, result, evaluationReceipts, refinementReceipts, validationCasesReleased: false, adversarialCasesReleased: false, unseenCasesReleased: false };
} catch (error) {
  summary = { status: "failed", attemptId, sourceAttemptId: prior.attemptId, error: error instanceof Error ? error.message : String(error), contract: prior.contract, evaluationReceipts, refinementReceipts, validationCasesReleased: false, adversarialCasesReleased: false, unseenCasesReleased: false };
}

const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
summary.budget = { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length };
summary.evidenceValid = evidenceValid;
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error: summary.error ?? null, result: summary.result ? { status: summary.result.status, stopReason: summary.result.stopReason, provisionalWinnerId: summary.result.provisionalWinner?.candidate.id ?? null, bestCandidateId: summary.result.bestCandidateFound?.candidate.id ?? null, rounds: summary.result.rounds.map((round) => ({ round: round.round, results: round.results.map((item) => ({ candidateId: item.candidateId, summary: item.summary, assessment: item.assessment })) })) } : null, refinementReceipts, budget: summary.budget, evidenceValid }, null, 2));
if (summary.status !== "completed") process.exitCode = 1;
