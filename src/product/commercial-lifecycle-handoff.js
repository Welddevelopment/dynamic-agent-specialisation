import { digest } from "../core/canonical.js";
import { assertCommercialComparisonFreeze } from "./commercial-comparison.js";
import { assertCommercialPostcomparisonGate } from "./commercial-postcomparison-gate.js";
import { assertCommercialActivationReceipt, assertCommercialComparisonResult, assertCommercialSpecialistBundle } from "./commercial-specialist-lifecycle.js";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

export function assertCommercialModelCampaignPlan(plan) {
  requireCondition(plan?.schemaVersion === "das.commercial-model-campaign-plan.v1", "Unsupported commercial model campaign plan");
  requireCondition(plan.planHash && digest(withoutHash(plan, "planHash")) === plan.planHash, "Commercial model campaign plan integrity mismatch");
  return true;
}

export function createCommercialLifecycleHandoffPlan({
  activeBundle,
  activeActivation,
  optimizationRequest,
  comparisonContract,
  modelCampaignPlan,
  postcomparisonGateContract,
}) {
  assertCommercialSpecialistBundle(activeBundle);
  assertCommercialActivationReceipt(activeActivation, { bundle: activeBundle });
  assertCommercialComparisonFreeze(comparisonContract);
  assertCommercialModelCampaignPlan(modelCampaignPlan);
  assertCommercialPostcomparisonGate(postcomparisonGateContract);
  requireCondition(optimizationRequest?.status === "awaiting-explicit-approval" && optimizationRequest.spendAuthorized === false, "Lifecycle handoff requires a no-spend recomparison request awaiting explicit approval");
  requireCondition(optimizationRequest.activeBundleHash === activeBundle.bundleHash && optimizationRequest.activeActivationHash === activeActivation.activationHash, "Recomparison request does not belong to the active specialist");
  requireCondition(modelCampaignPlan.contractFreezeHash === comparisonContract.freezeHash, "Campaign plan belongs to another comparison contract");
  requireCondition(postcomparisonGateContract.comparisonContractFreezeHash === comparisonContract.freezeHash, "Post-comparison gate belongs to another comparison contract");
  requireCondition(postcomparisonGateContract.roleId === activeBundle.role.id, "Post-comparison gate belongs to another role");
  const plan = {
    schemaVersion: "das.commercial-lifecycle-handoff-plan.v1",
    status: "prepared-no-spend-no-promotion",
    roleId: activeBundle.role.id,
    active: {
      bundleHash: activeBundle.bundleHash,
      activationHash: activeActivation.activationHash,
      candidateId: activeBundle.selected.candidate.id,
      candidateFingerprint: activeBundle.selected.candidate.fingerprint,
    },
    optimizationRequest: {
      id: optimizationRequest.id,
      requestHash: digest(optimizationRequest),
      status: optimizationRequest.status,
      spendAuthorized: false,
    },
    comparisonContractFreezeHash: comparisonContract.freezeHash,
    modelCampaign: {
      id: modelCampaignPlan.campaignId,
      planHash: modelCampaignPlan.planHash,
      pricingTableHash: modelCampaignPlan.pricingTableHash,
    },
    postcomparisonGateHash: postcomparisonGateContract.gateHash,
    nextAuthorityGate: "A separately approved paid campaign may create evidence; a different proved winner must still pass sealed offline, shadow, and explicitly authorized canary gates before promotion.",
  };
  plan.planHash = digest(plan);
  return Object.freeze(plan);
}

export function assertCommercialLifecycleHandoffPlan(plan) {
  requireCondition(plan?.schemaVersion === "das.commercial-lifecycle-handoff-plan.v1", "Unsupported lifecycle handoff plan");
  requireCondition(plan.status === "prepared-no-spend-no-promotion", "Lifecycle handoff plan has an invalid status");
  requireCondition(plan.planHash && digest(withoutHash(plan, "planHash")) === plan.planHash, "Lifecycle handoff plan integrity mismatch");
  requireCondition(plan.optimizationRequest?.spendAuthorized === false, "Lifecycle handoff plan cannot authorize spend");
  return true;
}

export function createCommercialLifecycleChallengerHandoff({ plan, comparisonContract, result, bundle }) {
  assertCommercialLifecycleHandoffPlan(plan);
  assertCommercialComparisonFreeze(comparisonContract);
  assertCommercialComparisonResult(result);
  assertCommercialSpecialistBundle(bundle);
  requireCondition(plan.comparisonContractFreezeHash === comparisonContract.freezeHash && result.contractFreezeHash === comparisonContract.freezeHash, "Campaign result does not belong to the planned comparison");
  requireCondition(result.campaignId === plan.modelCampaign.id && result.campaignPlanHash === plan.modelCampaign.planHash, "Campaign result does not belong to the exact approved plan");
  requireCondition(result.pricingTableHash === plan.modelCampaign.pricingTableHash && result.evidenceLedgerValid === true, "Campaign result lacks the planned pricing or valid evidence ledger");
  requireCondition(bundle.role.id === plan.roleId && bundle.evidence.resultHash === result.resultHash, "Specialist bundle does not belong to the exact campaign result");

  if (result.decision !== "activate-compiler" || result.improvementAssessment?.proved !== true || bundle.selected.type !== "compiler-candidate") {
    const noReplacement = {
      schemaVersion: "das.commercial-lifecycle-no-replacement.v1",
      status: "retain-current-specialist",
      roleId: plan.roleId,
      lifecyclePlanHash: plan.planHash,
      comparisonResultHash: result.resultHash,
      selectedParticipantId: result.selectedParticipantId,
      decision: result.decision,
      reason: "The exact paid comparison did not prove a different compiler specialist met every frozen improvement and safety gate.",
    };
    noReplacement.recordHash = digest(noReplacement);
    return Object.freeze(noReplacement);
  }

  requireCondition(bundle.selected.candidate.fingerprint !== plan.active.candidateFingerprint, "Current specialist cannot challenge itself");
  const handoff = {
    schemaVersion: "das.commercial-lifecycle-challenger-handoff.v1",
    status: "awaiting-postcomparison-offline-gates",
    roleId: plan.roleId,
    lifecyclePlanHash: plan.planHash,
    optimizationRequestId: plan.optimizationRequest.id,
    comparisonContractFreezeHash: comparisonContract.freezeHash,
    campaignId: result.campaignId,
    campaignPlanHash: result.campaignPlanHash,
    comparisonResultHash: result.resultHash,
    bundleHash: bundle.bundleHash,
    activeCandidateFingerprint: plan.active.candidateFingerprint,
    candidate: {
      id: bundle.selected.candidate.id,
      version: bundle.selected.candidate.version,
      fingerprint: bundle.selected.candidate.fingerprint,
    },
    improvementAssessment: structuredClone(result.improvementAssessment),
    postcomparisonGateHash: plan.postcomparisonGateHash,
    authority: {
      modelSpendAuthorized: false,
      activationAuthorized: false,
      customerWritesAuthorized: false,
      nextStage: "sealed-disposable-offline-gates",
    },
    evidenceBoundary: "Exact proved campaign winner awaiting separate fresh lifecycle gates. This record neither activates nor promotes the challenger.",
  };
  handoff.handoffHash = digest(handoff);
  return Object.freeze(handoff);
}

