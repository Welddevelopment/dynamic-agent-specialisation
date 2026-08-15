import { digest } from "../../core/canonical.js";
import { createPairedV6ProtocolCore, V5_BUDGET_SOURCE_HASH, V5_FAILURE_RECEIPT_HASH, V5_PRIOR_SPEND_USD } from "./paired-v6-protocol.js";

export const PAIRED_V7_CAMPAIGN_ID = "candidate-scale-paired-5-vs-150-v7-single-writer-recovery";
export const PAIRED_V7_APPROVAL = "JOEL_APPROVED_PAIRED_5_VS_150_V7_SINGLE_WRITER_RECOVERY";
export const PAIRED_V7_ARTIFACT_ROOT = "artifacts/candidate-scale/paired-5-vs-150-v7-single-writer-recovery";
export const V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH = "f2c5b717445f71049fb855df0b1fe9f771fc9c74c20c93a2d5057be64d708311";
export const V6_CONSERVATIVE_SPEND_UPPER_BOUND_USD = 1.4213165;
export const V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD = V5_PRIOR_SPEND_USD + V6_CONSERVATIVE_SPEND_UPPER_BOUND_USD;
export const V7_HARD_CEILING_USD = 20.41;
export const V7_MINIMUM_RESERVED_BUFFER_USD = 1;

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function scientificComparisonKernel(protocol) {
  const generation = structuredClone(protocol.generation);
  delete generation.orderRule;
  delete generation.analysisSeed;
  const metrics = structuredClone(protocol.metrics);
  delete metrics.forbiddenInference;
  return {
    hypothesisQuestion: "Does the adaptive search over 150 prospectively generated packages find a better confirmed specialist than the exact first-five prefix under one shared frozen comparison?",
    targetCandidateCount: protocol.targetCandidateCount,
    prefixCandidateCount: protocol.prefixCandidateCount,
    batchSize: protocol.batchSize,
    generation,
    structuralScreen: protocol.structuralScreen,
    evaluation: protocol.evaluation,
    baselines: protocol.baselines,
    selectionRule: protocol.selectionRule,
    metrics,
    bindings: protocol.bindings,
  };
}

export function createPairedV7ProtocolCore() {
  const v6 = structuredClone(createPairedV6ProtocolCore());
  delete v6.protocolCoreHash;
  const inheritedBudget = structuredClone(v6.budget);
  for (const key of ["priorSharedSpendUsd", "priorFailureReceiptHash", "priorBudgetSourceHash", "maximumCombinedV5V6SpendUsd", "projectedComponentsUsd", "projectedMaximumUsd", "hardCampaignCeilingUsd"]) delete inheritedBudget[key];
  const v6ScientificKernel = scientificComparisonKernel(v6);
  const coreWithoutComparisonReceipt = {
    ...v6,
    schemaVersion: "das.candidate-scale-paired-protocol-core.v7-single-writer-recovery",
    campaignId: PAIRED_V7_CAMPAIGN_ID,
    hypothesis: "Within the same frozen support-role experiment, does an adaptive search over 150 prospectively generated contract-valid packages find a better independently confirmed specialist than the exact first-five prefix?",
    interpretation: "V7 is a fresh prospective infrastructure recovery after V6 was invalidated before portfolio sealing by two concurrent writers. The scientific 5-versus-150 candidate contract, schedule, structural screen, cases-per-stage, baselines, ranking and confirmation rules are unchanged. V5 and V6 remain separate negative/infrastructure evidence and contribute no candidates or performance observations.",
    generation: {
      ...v6.generation,
      orderRule: "Candidate order is exact accepted response order across fresh V7 batches 1-15. No V5 or V6 package is imported, repaired, resumed or substituted.",
      analysisSeed: "candidate-scale-paired-5-vs-150-v7-single-writer-recovery-analysis-seed",
    },
    stops: [
      ...v6.stops,
      "Stop before any state mutation or provider call if the exclusive campaign writer lock cannot be acquired.",
      "Stop if the bound V6 infrastructure-failure receipt or conservative prior-spend upper bound changes.",
      "V6 candidate fragments, cache entries, budget state and observations may not be imported into V7.",
    ],
    budget: {
      ...inheritedBudget,
      priorSharedSpendUsd: V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD,
      priorKnownV5SpendUsd: V5_PRIOR_SPEND_USD,
      priorV6ConservativeSpendUpperBoundUsd: V6_CONSERVATIVE_SPEND_UPPER_BOUND_USD,
      priorV6InfrastructureFailureReceiptHash: V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH,
      hardCampaignCeilingUsd: V7_HARD_CEILING_USD,
      sharedUserCeilingUsd: 24,
      minimumReservedBufferUsd: V7_MINIMUM_RESERVED_BUFFER_USD,
      maximumCombinedPriorAndV7SpendUsd: V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD + V7_HARD_CEILING_USD,
      projectedComponentsUsd: {
        architectGeneration: 3,
        selectedCandidateSelection: 7.2,
        baselineSelection: 1.92,
        winnerAndBaselineConfirmation: 3.6,
        contingency: 4.69,
      },
      projectedMaximumUsd: V7_HARD_CEILING_USD,
    },
    pricingVerifiedUtcDate: "2026-08-12",
    pricingVerifiedLocalDate: "2026-08-12",
    pricingVerificationTimezone: "Asia/Seoul",
    metrics: {
      ...v6.metrics,
      forbiddenInference: [
        ...v6.metrics.forbiddenInference,
        "V6 produced a usable candidate portfolio",
        "V7 repaired or reused V6 generations",
        "the single-writer lock changes candidate quality",
      ],
    },
    evidenceBoundary: "Prospective V7 campaign after a preserved V6 concurrent-writer infrastructure failure. No V7 candidate has been generated or evaluated and no spend/result is implied.",
  };
  const v7ScientificKernel = scientificComparisonKernel(coreWithoutComparisonReceipt);
  const core = {
    ...coreWithoutComparisonReceipt,
    scientificComparison: {
      unchangedFromV6: true,
      v6ScientificKernelHash: digest(v6ScientificKernel),
      v7ScientificKernelHash: digest(v7ScientificKernel),
      allowedInfrastructureDifferences: ["fresh campaign namespace", "fresh private case pack", "exclusive single-writer lock", "conservative prior-spend binding", "fresh artifact hashes", "campaign-specific analysis seed and order provenance wording"],
    },
  };
  requireCondition(core.scientificComparison.v6ScientificKernelHash === core.scientificComparison.v7ScientificKernelHash, "V7 scientific comparison semantics changed from V6");
  requireCondition(Math.abs(Object.values(core.budget.projectedComponentsUsd).reduce((sum, value) => sum + value, 0) - core.budget.projectedMaximumUsd) < 1e-9, "V7 projected budget components do not equal the hard campaign maximum");
  requireCondition(core.budget.maximumCombinedPriorAndV7SpendUsd <= core.budget.sharedUserCeilingUsd - core.budget.minimumReservedBufferUsd, "V7 budget does not preserve the shared $1 buffer");
  return Object.freeze({ ...core, protocolCoreHash: digest(core) });
}

export function sealPairedV7Protocol({ casePackHash, casePackReceiptHash }) {
  requireCondition(typeof casePackHash === "string" && casePackHash.length >= 32, "V7 protocol needs a fresh case-pack hash");
  requireCondition(typeof casePackReceiptHash === "string" && casePackReceiptHash.length >= 32, "V7 protocol needs a fresh case-pack receipt hash");
  const protocol = createPairedV7ProtocolCore();
  const plan = {
    schemaVersion: "das.candidate-scale-paired-live-plan.v7-single-writer-recovery",
    protocolCoreHash: protocol.protocolCoreHash,
    casePackHash,
    casePackReceiptHash,
    v5FailureReceiptHash: V5_FAILURE_RECEIPT_HASH,
    v5BudgetSourceHash: V5_BUDGET_SOURCE_HASH,
    v5PriorSpendUsd: V5_PRIOR_SPEND_USD,
    v6InfrastructureFailureReceiptHash: V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH,
    v6ConservativeSpendUpperBoundUsd: V6_CONSERVATIVE_SPEND_UPPER_BOUND_USD,
    priorSharedSpendUpperBoundUsd: V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD,
    protocol,
    gates: {
      requiredGlobalApproval: "DAS_ENABLE_PAID_MODEL_CALLS=JOEL_APPROVED",
      requiredCampaignApproval: `DAS_CANDIDATE_SCALE_V7_APPROVAL=${PAIRED_V7_APPROVAL}`,
      requiredPlanHash: "DAS_CANDIDATE_SCALE_V7_PLAN_HASH=<exact V7 plan hash>",
      requiredExplicitLimit: `DAS_CANDIDATE_SCALE_V7_LIMIT_USD=<positive value no greater than ${V7_HARD_CEILING_USD}>`,
      requiredCreditsConfirmation: "DAS_CANDIDATE_SCALE_CREDITS_AVAILABLE=CONFIRMED",
      requiredPricingDate: `DAS_CANDIDATE_SCALE_PRICING_VERIFIED_ON=${protocol.pricingVerifiedUtcDate}`,
      requiredPricingHash: `DAS_CANDIDATE_SCALE_PRICING_TABLE_HASH=${protocol.pricingHash}`,
      requiredV5FailureReceipt: `DAS_CANDIDATE_SCALE_V5_FAILURE_RECEIPT_HASH=${V5_FAILURE_RECEIPT_HASH}`,
      requiredV6InfrastructureFailureReceipt: `DAS_CANDIDATE_SCALE_V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH=${V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH}`,
      requiredApiKey: "OPENAI_API_KEY=<present only at launch>",
    },
  };
  return Object.freeze({ ...plan, planHash: digest(plan) });
}

export function assertPairedV7Authorization({ plan, environment = process.env, currentUtcDate }) {
  requireCondition(plan?.schemaVersion === "das.candidate-scale-paired-live-plan.v7-single-writer-recovery", "Unsupported V7 live plan");
  const copy = structuredClone(plan); const expected = copy.planHash; delete copy.planHash;
  requireCondition(expected && digest(copy) === expected, "V7 live-plan integrity mismatch");
  requireCondition(plan.protocol.protocolCoreHash === plan.protocolCoreHash, "V7 protocol binding mismatch");
  requireCondition(environment.DAS_ENABLE_PAID_MODEL_CALLS === "JOEL_APPROVED", "Global paid model calls are not approved");
  requireCondition(environment.DAS_CANDIDATE_SCALE_V7_APPROVAL === PAIRED_V7_APPROVAL, "This exact V7 campaign is not explicitly approved");
  requireCondition(environment.DAS_CANDIDATE_SCALE_V7_PLAN_HASH === plan.planHash, "V7 approval is not bound to the exact plan");
  requireCondition(environment.DAS_CANDIDATE_SCALE_CREDITS_AVAILABLE === "CONFIRMED", "V7 credits are not explicitly confirmed");
  requireCondition(environment.DAS_CANDIDATE_SCALE_V5_FAILURE_RECEIPT_HASH === V5_FAILURE_RECEIPT_HASH, "V7 is not bound to the preserved V5 failure receipt");
  requireCondition(environment.DAS_CANDIDATE_SCALE_V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH === V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH, "V7 is not bound to the preserved V6 infrastructure failure receipt");
  const limitUsd = Number(environment.DAS_CANDIDATE_SCALE_V7_LIMIT_USD);
  requireCondition(Number.isFinite(limitUsd) && limitUsd > 0 && limitUsd <= V7_HARD_CEILING_USD, `V7 live run needs a positive limit no greater than $${V7_HARD_CEILING_USD.toFixed(2)}`);
  requireCondition(V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD + limitUsd <= 24 - V7_MINIMUM_RESERVED_BUFFER_USD, "V7 limit would consume the shared reserved dollar after V5 and the conservative V6 upper bound");
  requireCondition(currentUtcDate === plan.protocol.pricingVerifiedUtcDate && environment.DAS_CANDIDATE_SCALE_PRICING_VERIFIED_ON === currentUtcDate, "V7 pricing must be re-verified on the exact UTC launch date");
  requireCondition(environment.DAS_CANDIDATE_SCALE_PRICING_TABLE_HASH === plan.protocol.pricingHash, "V7 pricing hash is not approved");
  requireCondition(String(environment.OPENAI_API_KEY ?? "").trim(), "OPENAI_API_KEY is missing");
  return Object.freeze({ limitUsd, planHash: plan.planHash, cumulativeMaximumUsd: V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD + limitUsd });
}
