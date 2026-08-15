import { digest } from "../../core/canonical.js";
import { createCommercialSupportPack } from "../../product/commercial-support-pack.js";
import { createPairedScaleProtocolCore } from "./paired-protocol.js";
import { pairedV6ContractHash, PAIRED_V6_ARCHITECT_INSTRUCTION, PAIRED_V6_CONTEXT_MODE_SCHEDULE } from "./paired-v6-contract.js";

export const PAIRED_V6_CAMPAIGN_ID = "candidate-scale-paired-5-vs-150-v6-contract-repair";
export const PAIRED_V6_APPROVAL = "JOEL_APPROVED_PAIRED_5_VS_150_V6_CONTRACT_REPAIR";
export const PAIRED_V6_ARTIFACT_ROOT = "artifacts/candidate-scale/paired-5-vs-150-v6-contract-repair";
export const V5_FAILURE_RECEIPT_HASH = "d1dd3ded907f6c39b3d80a0646c99dc07bda15e5f397cf06dcb9930f030ae098";
export const V5_BUDGET_SOURCE_HASH = "4ed8464ef5ca2516070191629d344585d1d213d0465656a8aeaae21936c9d82b";
export const V5_PRIOR_SPEND_USD = 1.1633299999999998;
export const V6_HARD_CEILING_USD = 21.83;

function requireCondition(condition, message) { if (!condition) throw new Error(message); }

export function createPairedV6ProtocolCore() {
  const previous = structuredClone(createPairedScaleProtocolCore());
  delete previous.protocolCoreHash;
  const brief = createCommercialSupportPack().roleDraft.compiled.brief;
  const core = {
    ...previous,
    schemaVersion: "das.candidate-scale-paired-protocol-core.v6-contract-repair",
    campaignId: PAIRED_V6_CAMPAIGN_ID,
    hypothesis: "Within the same frozen support-role experiment, a prospective 150-candidate generation using an explicit complete-versus-selective context contract can produce 150 structurally valid packages and permit the preregistered paired search evaluation to proceed without post-hoc repair.",
    interpretation: "This is a wholly new prospective rerun after v5 stopped at its frozen generation-validity gate. V5 remains a negative result. V6 changes only the candidate context contract and receives fresh private cases; it does not mutate, repair, replace or evaluate v5 packages.",
    generation: {
      ...previous.generation,
      architectInstructionHash: digest(PAIRED_V6_ARCHITECT_INSTRUCTION),
      candidateSchemaHash: pairedV6ContractHash(brief),
      contextContract: {
        schedule: PAIRED_V6_CONTEXT_MODE_SCHEDULE,
        scheduleHash: digest(PAIRED_V6_CONTEXT_MODE_SCHEDULE),
        complete: "The model emits sourceMode=complete; the runtime binds every frozen context source and sets requireCompleteContext=true.",
        selective: "The model emits sourceMode=selective plus a strict non-empty subset; the runtime sets requireCompleteContext=false.",
        noRepair: "A package that violates its batch contract is rejected and ends the campaign. No post-hoc correction or replacement is permitted.",
      },
      orderRule: "Candidate order is exact accepted response order across new v6 batches 1-15. No v5 package is imported, repaired or substituted.",
      analysisSeed: "candidate-scale-paired-5-vs-150-v6-contract-repair-analysis-seed",
    },
    stops: [
      ...previous.stops,
      "Stop if any complete-mode package does not bind every frozen role context source or any selective-mode package is not a strict subset with requireCompleteContext=false.",
      "Stop if the bound v5 failure receipt, prior-spend amount or source budget hash changes.",
      "V5 candidates may not be imported, repaired, regenerated individually or used as v6 performance evidence.",
    ],
    budget: {
      ...previous.budget,
      priorSharedSpendUsd: V5_PRIOR_SPEND_USD,
      priorFailureReceiptHash: V5_FAILURE_RECEIPT_HASH,
      priorBudgetSourceHash: V5_BUDGET_SOURCE_HASH,
      hardCampaignCeilingUsd: V6_HARD_CEILING_USD,
      sharedUserCeilingUsd: 24,
      minimumReservedBufferUsd: 1,
      maximumCombinedV5V6SpendUsd: V5_PRIOR_SPEND_USD + V6_HARD_CEILING_USD,
      projectedMaximumUsd: V6_HARD_CEILING_USD,
    },
    pricingVerifiedUtcDate: "2026-08-12",
    pricingVerifiedLocalDate: "2026-08-12",
    pricingVerificationTimezone: "Asia/Seoul",
    pricingVerificationSource: "https://developers.openai.com/api/docs/pricing",
    metrics: { ...previous.metrics, forbiddenInference: [...previous.metrics.forbiddenInference, "v5 packages were successfully repaired", "the v6 context contract improves task performance"] },
    evidenceBoundary: "Prospective v6 protocol after a preserved v5 generation failure. No v6 candidate has been generated or evaluated and no spend/result is implied.",
  };
  requireCondition(core.budget.maximumCombinedV5V6SpendUsd <= core.budget.sharedUserCeilingUsd - core.budget.minimumReservedBufferUsd, "v6 budget does not preserve the shared $1 buffer");
  return Object.freeze({ ...core, protocolCoreHash: digest(core) });
}

export function sealPairedV6Protocol({ casePackHash, casePackReceiptHash }) {
  requireCondition(typeof casePackHash === "string" && casePackHash.length >= 32, "v6 protocol needs a fresh case-pack hash");
  requireCondition(typeof casePackReceiptHash === "string" && casePackReceiptHash.length >= 32, "v6 protocol needs a fresh case-pack receipt hash");
  const protocol = createPairedV6ProtocolCore();
  const plan = {
    schemaVersion: "das.candidate-scale-paired-live-plan.v6-contract-repair",
    protocolCoreHash: protocol.protocolCoreHash,
    casePackHash,
    casePackReceiptHash,
    v5FailureReceiptHash: V5_FAILURE_RECEIPT_HASH,
    v5BudgetSourceHash: V5_BUDGET_SOURCE_HASH,
    v5PriorSpendUsd: V5_PRIOR_SPEND_USD,
    protocol,
    gates: {
      requiredGlobalApproval: "DAS_ENABLE_PAID_MODEL_CALLS=JOEL_APPROVED",
      requiredCampaignApproval: `DAS_CANDIDATE_SCALE_V6_APPROVAL=${PAIRED_V6_APPROVAL}`,
      requiredPlanHash: "DAS_CANDIDATE_SCALE_V6_PLAN_HASH=<exact v6 plan hash>",
      requiredExplicitLimit: `DAS_CANDIDATE_SCALE_V6_LIMIT_USD=<positive value no greater than ${V6_HARD_CEILING_USD}>`,
      requiredCreditsConfirmation: "DAS_CANDIDATE_SCALE_CREDITS_AVAILABLE=CONFIRMED",
      requiredPricingDate: `DAS_CANDIDATE_SCALE_PRICING_VERIFIED_ON=${protocol.pricingVerifiedUtcDate}`,
      requiredPricingHash: `DAS_CANDIDATE_SCALE_PRICING_TABLE_HASH=${protocol.pricingHash}`,
      requiredV5FailureReceipt: `DAS_CANDIDATE_SCALE_V5_FAILURE_RECEIPT_HASH=${V5_FAILURE_RECEIPT_HASH}`,
      requiredApiKey: "OPENAI_API_KEY=<present only at launch>",
    },
  };
  return Object.freeze({ ...plan, planHash: digest(plan) });
}

export function assertPairedV6Authorization({ plan, environment = process.env, currentUtcDate }) {
  requireCondition(plan?.schemaVersion === "das.candidate-scale-paired-live-plan.v6-contract-repair", "Unsupported v6 live plan");
  const copy = structuredClone(plan); const expected = copy.planHash; delete copy.planHash;
  requireCondition(expected && digest(copy) === expected, "v6 live-plan integrity mismatch");
  requireCondition(plan.protocol.protocolCoreHash === plan.protocolCoreHash, "v6 protocol binding mismatch");
  requireCondition(environment.DAS_ENABLE_PAID_MODEL_CALLS === "JOEL_APPROVED", "Global paid model calls are not approved");
  requireCondition(environment.DAS_CANDIDATE_SCALE_V6_APPROVAL === PAIRED_V6_APPROVAL, "This exact v6 campaign is not explicitly approved");
  requireCondition(environment.DAS_CANDIDATE_SCALE_V6_PLAN_HASH === plan.planHash, "v6 approval is not bound to the exact plan");
  requireCondition(environment.DAS_CANDIDATE_SCALE_CREDITS_AVAILABLE === "CONFIRMED", "v6 credits are not explicitly confirmed");
  requireCondition(environment.DAS_CANDIDATE_SCALE_V5_FAILURE_RECEIPT_HASH === V5_FAILURE_RECEIPT_HASH, "v6 is not bound to the preserved v5 failure receipt");
  const limitUsd = Number(environment.DAS_CANDIDATE_SCALE_V6_LIMIT_USD);
  requireCondition(Number.isFinite(limitUsd) && limitUsd > 0 && limitUsd <= V6_HARD_CEILING_USD, `v6 live run needs a positive limit no greater than $${V6_HARD_CEILING_USD.toFixed(2)}`);
  requireCondition(V5_PRIOR_SPEND_USD + limitUsd <= 23, "v6 limit would consume the shared reserved dollar after v5 spend");
  requireCondition(currentUtcDate === plan.protocol.pricingVerifiedUtcDate && environment.DAS_CANDIDATE_SCALE_PRICING_VERIFIED_ON === currentUtcDate, "v6 pricing must be re-verified on the exact UTC launch date");
  requireCondition(environment.DAS_CANDIDATE_SCALE_PRICING_TABLE_HASH === plan.protocol.pricingHash, "v6 pricing hash is not approved");
  requireCondition(String(environment.OPENAI_API_KEY ?? "").trim(), "OPENAI_API_KEY is missing");
  return Object.freeze({ limitUsd, planHash: plan.planHash, cumulativeMaximumUsd: V5_PRIOR_SPEND_USD + limitUsd });
}
