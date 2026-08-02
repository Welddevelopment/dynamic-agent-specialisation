import fs from "node:fs";
import path from "node:path";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { ModelOptimizationRefiner } from "../compiler/model-optimization-refiner.js";
import { createPiece3SupportBaselines } from "../evaluation/piece3-support-baselines.js";
import { createImprovementContract } from "../optimization/improvement-contract.js";
import { TargetDrivenImprovementController } from "../optimization/improvement-controller.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { realisticSupportBrief } from "../roles/realistic-support.js";
import { realisticSupportCases } from "../worlds/realistic-support-cases.js";
import { runModelSupportCase } from "./model-support-runner.js";

const attemptId = "piece3-support-development-target-v1";
const PRICING = { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 };
const viabilityPath = path.resolve("artifacts/runs/piece3-support-viability/v4/summary.json");
const outputDir = path.resolve("artifacts/runs/piece3-support-development-target/v1");

if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
if (!fs.existsSync(viabilityPath)) throw new Error("Piece 3 viability v4 must finish first");

const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error("Piece 3 support development target v1 is already settled");
fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: Math.min(5, campaign.hardLimitUsd - campaign.cumulativeSpentUsd), warningUsd: 4 });
const provider = new OpenAIResponsesProvider({
  apiKey: process.env.OPENAI_API_KEY,
  pricing: PRICING,
  allowPaidCalls: true,
  environment: process.env,
  modelMap: { "candidate-optimization-policy": "gpt-5.6-luna" },
});
const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });

const viability = JSON.parse(fs.readFileSync(viabilityPath, "utf8"));
const survivors = viability.survivorIds.map((id) => viability.candidates.find((candidate) => candidate.id === id));
if (survivors.some((candidate) => !candidate)) throw new Error("A recorded viability survivor is missing");
const baseline = createPiece3SupportBaselines().find((candidate) => candidate.id === "support-baseline-ordinary-manual-luna");
if (!baseline) throw new Error("Frozen ordinary-manual support baseline is missing");

const contract = createImprovementContract({
  id: "support-development-ten-percent-cost-and-speed-v1",
  baselineId: baseline.id,
  objectives: [
    { metric: "modelCostUsd", direction: "decrease", minimumRelativeImprovement: .10 },
    { metric: "medianElapsedMs", direction: "decrease", minimumRelativeImprovement: .10 },
  ],
  qualityFloor: { minimumPassRate: 1, minimumOutcomeScoreRatio: 1, maximumUnsafeAttempts: 0 },
  limits: { maximumRounds: 3, maximumRefinementsPerRound: 2, maximumModelSpendUsd: 5, maximumWallClockMs: 3_600_000, minimumRepeatedObservations: realisticSupportCases.development.length },
  stopPolicy: { maximumConsecutiveRoundsWithoutMaterialProgress: 2, minimumMaterialProgress: .01, minimumEstimatedSuccessProbability: .15, minimumRefinementPassRateRatio: .9, maximumRefinementUnsafeAttempts: 0, maximumCombinedObjectiveGapForRefinement: .35 },
});

const refiner = new ModelOptimizationRefiner({ gateway, maxOutputTokens: 8_000 });
const refinementReceipts = [];
const evaluationReceipts = [];
const controller = new TargetDrivenImprovementController({
  contract,
  spentUsd: () => budget.spentUsd,
  evidence,
  evaluate: async (candidate, stage) => {
    evidence.append("support-development.participant-started", { candidateId: candidate.id, stage, currentSpendUsd: budget.spentUsd });
    const rows = [];
    for (const testCase of realisticSupportCases.development) {
      const row = await runModelSupportCase({ candidate, testCase, gateway, evidence, executionModel: candidate.model.family, tenantPrefix: `piece3-development:${stage.kind}:${stage.round}` });
      rows.push(row);
      evaluationReceipts.push({ candidateId: candidate.id, stage, caseId: row.caseId, passed: row.passed, outcomeScore: row.outcomeScore, unsafeAttempts: row.unsafeAttempts, modelCostUsd: row.modelCostUsd, elapsedMs: row.elapsedMs, toolCalls: row.toolCalls });
      evidence.append("support-development.case-finished", evaluationReceipts.at(-1));
    }
    return rows;
  },
  estimatePotential: async ({ assessment }) => {
    if (!assessment.eligible) return 0;
    const combinedGap = Object.values(assessment.objectiveChecks).reduce((sum, check) => sum + Math.max(0, check.gap), 0);
    return Math.max(.03, Math.min(.8, .55 - combinedGap));
  },
  refine: async ({ parent, diagnosis, round }) => {
    try {
      const refined = await refiner.refine({ brief: realisticSupportBrief, parent, diagnosis, contract, round });
      refinementReceipts.push({ parentId: parent.id, childId: refined.candidate.id, round, differences: refined.differences, modelReceipt: refined.modelReceipt });
      evidence.append("support-development.candidate-refined", refinementReceipts.at(-1));
      return refined.candidate;
    } catch (error) {
      const failure = { parentId: parent.id, round, error: error instanceof Error ? error.message : String(error) };
      refinementReceipts.push(failure);
      evidence.append("support-development.refinement-rejected", failure);
      return null;
    }
  },
});

let summary;
try {
  const result = await controller.run({ baseline, initialCandidates: survivors });
  summary = {
    status: "completed",
    attemptId,
    contract,
    viabilitySource: "piece3-support-viability-v4",
    baseline,
    initialCandidateIds: survivors.map((candidate) => candidate.id),
    result,
    evaluationReceipts,
    refinementReceipts,
    validationCasesReleased: false,
    adversarialCasesReleased: false,
    unseenCasesReleased: false,
  };
} catch (error) {
  summary = { status: "failed", attemptId, error: error instanceof Error ? error.message : String(error), contract, evaluationReceipts, refinementReceipts, validationCasesReleased: false, adversarialCasesReleased: false, unseenCasesReleased: false };
}

const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
summary.budget = { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length };
summary.evidenceValid = evidenceValid;
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error: summary.error ?? null, result: summary.result ? { status: summary.result.status, stopReason: summary.result.stopReason, provisionalWinnerId: summary.result.provisionalWinner?.candidate.id ?? null, bestCandidateId: summary.result.bestCandidateFound?.candidate.id ?? null, baseline: summary.result.baseline, rounds: summary.result.rounds.map((round) => ({ round: round.round, results: round.results.map((item) => ({ candidateId: item.candidateId, summary: item.summary, assessment: item.assessment })) })) } : null, refinementReceipts, budget: summary.budget, evidenceValid }, null, 2));
if (summary.status !== "completed") process.exitCode = 1;
