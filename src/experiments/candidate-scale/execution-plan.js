import { digest } from "../../core/canonical.js";
import { CURRENT_MODEL_PRICING_USD } from "../../providers/model-pricing.js";
import { CANDIDATE_SCALE_PORTFOLIO_SIZES } from "./scaling-analysis.js";

export const CANDIDATE_SCALE_CAMPAIGN_ID = "candidate-scale-v1";
export const CANDIDATE_SCALE_APPROVAL = "JOEL_APPROVED_CANDIDATE_SCALE_V1";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function utcDate() {
  return new Date().toISOString().slice(0, 10);
}

export function createCandidateScaleExecutionPlan({
  targetCount = 150,
  batchSize = 10,
  stageCases = { viability: 2, development: 5, validation: 2, adversarial: 3, holdout: 2, repeat: 6 },
  stageSurvivors = { viability: 40, development: 20, validation: 8, adversarial: 4 },
  maximumTurns = { viability: 8, development: 24, validation: 32, adversarial: 40, holdout: 48, repeat: 48 },
  projectedTaskSpendUsd = { viability: 0.03, development: 0.12, validation: 0.18, adversarial: 0.25, holdout: 0.30, repeat: 0.30 },
  projectedArchitectBatchSpendUsd = 0.35,
  absoluteMaximumTaskSpendUsd = 0.50,
  maximumWallClockMs = 8 * 60 * 60 * 1_000,
  casePackHash = "pending-fresh-private-case-pack",
} = {}) {
  requireCondition(Number.isInteger(targetCount) && targetCount >= 5 && targetCount <= 150, "Candidate-scale plan target must be 5-150");
  requireCondition(Number.isInteger(batchSize) && batchSize >= 1 && batchSize <= 20, "Candidate-scale plan batch size must be 1-20");
  requireCondition(Number.isFinite(projectedArchitectBatchSpendUsd) && projectedArchitectBatchSpendUsd >= 0, "Candidate-scale architect batch projection must be non-negative");
  requireCondition(Number.isFinite(absoluteMaximumTaskSpendUsd) && absoluteMaximumTaskSpendUsd > 0, "Candidate-scale absolute task ceiling must be positive");
  requireCondition(typeof casePackHash === "string" && casePackHash.length >= 16, "Candidate-scale plan needs a private case-pack hash or an explicit pending marker");
  const architectureCalls = Math.ceil(targetCount / batchSize);
  const stageCandidateCounts = {
    viability: targetCount,
    development: Math.min(targetCount, stageSurvivors.viability),
    validation: Math.min(targetCount, stageSurvivors.development),
    adversarial: Math.min(targetCount, stageSurvivors.validation),
    holdout: Math.min(targetCount, stageSurvivors.adversarial),
    repeat: Math.min(targetCount, stageSurvivors.adversarial),
  };
  const stageTaskEvaluations = Object.fromEntries(Object.entries(stageCases).map(([stage, count]) => {
    requireCondition(Number.isInteger(count) && count >= 1, `Candidate-scale ${stage} case count must be positive`);
    requireCondition(Number.isInteger(stageCandidateCounts[stage]) && stageCandidateCounts[stage] >= 1, `Candidate-scale ${stage} candidate count must be positive`);
    return [stage, count * stageCandidateCounts[stage]];
  }));
  const maximumTaskEvaluations = Object.values(stageTaskEvaluations).reduce((sum, value) => sum + value, 0);
  const maximumEvaluationModelCalls = Object.entries(stageTaskEvaluations).reduce((sum, [stage, tasks]) => {
    requireCondition(Number.isInteger(maximumTurns[stage]) && maximumTurns[stage] >= 1, `Candidate-scale ${stage} turn ceiling must be positive`);
    return sum + tasks * maximumTurns[stage];
  }, 0);
  const projectedMaximumSpendUsd = architectureCalls * projectedArchitectBatchSpendUsd + Object.entries(stageTaskEvaluations).reduce((sum, [stage, tasks]) => {
    requireCondition(Number.isFinite(projectedTaskSpendUsd[stage]) && projectedTaskSpendUsd[stage] >= 0, `Candidate-scale ${stage} task-spend projection must be non-negative`);
    return sum + tasks * projectedTaskSpendUsd[stage];
  }, 0);
  const absoluteTheoreticalCeilingUsd = architectureCalls * projectedArchitectBatchSpendUsd + maximumTaskEvaluations * absoluteMaximumTaskSpendUsd;
  const plan = {
    schemaVersion: "das.candidate-scale-execution-plan.v1",
    campaignId: CANDIDATE_SCALE_CAMPAIGN_ID,
    casePackHash,
    targetCount,
    batchSize,
    portfolioSizes: CANDIDATE_SCALE_PORTFOLIO_SIZES.filter((size) => size <= targetCount),
    architectureCalls,
    stageCases: structuredClone(stageCases),
    stageSurvivors: structuredClone(stageSurvivors),
    stageCandidateCounts,
    stageTaskEvaluations,
    maximumTaskEvaluations,
    maximumTurns: structuredClone(maximumTurns),
    projectedArchitectBatchSpendUsd,
    projectedTaskSpendUsd: structuredClone(projectedTaskSpendUsd),
    projectedMaximumSpendUsd,
    absoluteMaximumTaskSpendUsd,
    absoluteTheoreticalCeilingUsd,
    maximumEvaluationModelCalls,
    maximumTotalModelCalls: architectureCalls + maximumEvaluationModelCalls,
    maximumWallClockMs,
    pricingTableHash: digest(CURRENT_MODEL_PRICING_USD),
    gates: {
      paidCallsDefault: "disabled",
      currentAuthorization: "zero-cost-local-only",
      requiredGlobalApproval: "DAS_ENABLE_PAID_MODEL_CALLS=JOEL_APPROVED",
      requiredCampaignApproval: `DAS_CANDIDATE_SCALE_APPROVAL=${CANDIDATE_SCALE_APPROVAL}`,
      requiredPlanHash: "DAS_CANDIDATE_SCALE_PLAN_HASH=<exact plan hash>",
      requiredExplicitLimit: "DAS_CANDIDATE_SCALE_LIMIT_USD=<positive value no greater than projected maximum>",
      requiredCreditsConfirmation: "DAS_CANDIDATE_SCALE_CREDITS_AVAILABLE=CONFIRMED",
      requiredPricingDate: "DAS_CANDIDATE_SCALE_PRICING_VERIFIED_ON=<current UTC date>",
      requiredPricingHash: `DAS_CANDIDATE_SCALE_PRICING_TABLE_HASH=${digest(CURRENT_MODEL_PRICING_USD)}`,
      requiredApiKey: "OPENAI_API_KEY=<present only at launch>",
    },
    evidenceBoundary: "Zero-cost planning projection. The projected maximum uses stage-specific observed-cost allowances and a lower explicit campaign limit may stop safely; the separate absolute theoretical ceiling assumes every task reaches the role's full per-task limit. Neither is approval, a charge, or a performance result.",
  };
  plan.planHash = digest(plan);
  return Object.freeze(plan);
}

export function assertCandidateScaleLiveAuthorization({ environment = process.env, plan, pricingVerifiedDate = utcDate() }) {
  requireCondition(plan?.planHash, "Candidate-scale live run needs a frozen plan");
  const copy = structuredClone(plan);
  const expected = copy.planHash;
  delete copy.planHash;
  requireCondition(digest(copy) === expected, "Candidate-scale plan integrity mismatch");
  requireCondition(environment.DAS_ENABLE_PAID_MODEL_CALLS === "JOEL_APPROVED", "Global paid model calls are not approved");
  requireCondition(environment.DAS_CANDIDATE_SCALE_APPROVAL === CANDIDATE_SCALE_APPROVAL, "This exact candidate-scale campaign is not explicitly approved");
  requireCondition(environment.DAS_CANDIDATE_SCALE_PLAN_HASH === plan.planHash, "Candidate-scale approval is not bound to the exact frozen plan");
  requireCondition(environment.DAS_CANDIDATE_SCALE_CREDITS_AVAILABLE === "CONFIRMED", "Candidate-scale credits have not been explicitly confirmed available");
  const limitUsd = Number(environment.DAS_CANDIDATE_SCALE_LIMIT_USD);
  requireCondition(Number.isFinite(limitUsd) && limitUsd > 0 && limitUsd <= plan.projectedMaximumSpendUsd, "Candidate-scale live run needs a positive hard limit inside the frozen maximum");
  requireCondition(environment.DAS_CANDIDATE_SCALE_PRICING_VERIFIED_ON === pricingVerifiedDate, "Candidate-scale model pricing was not freshly verified today");
  requireCondition(environment.DAS_CANDIDATE_SCALE_PRICING_TABLE_HASH === plan.pricingTableHash, "Candidate-scale pricing hash is not approved");
  requireCondition(String(environment.OPENAI_API_KEY ?? "").trim(), "OPENAI_API_KEY is missing");
  return Object.freeze({ limitUsd, pricingVerifiedDate, pricingTableHash: plan.pricingTableHash, planHash: plan.planHash });
}
