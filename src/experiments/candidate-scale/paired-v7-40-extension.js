import { digest } from "../../core/canonical.js";
import { createCommercialSupportPack } from "../../product/commercial-support-pack.js";
import { freezePairedStructuralSelection } from "./paired-selection.js";
import { createPairedV7ProtocolCore, PAIRED_V7_CAMPAIGN_ID } from "./paired-v7-protocol.js";

export const PAIRED_V7_40_EXTENSION_ID = "candidate-scale-v7-exact-prefix-40-extension-v1";
export const PAIRED_V7_40_EXTENSION_ROOT = "artifacts/candidate-scale/paired-5-vs-150-v7-single-writer-recovery/extension-prefix-40-v1";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function sealed(value, key, label) { const copy = structuredClone(value); const expected = copy[key]; delete copy[key]; requireCondition(expected && digest(copy) === expected, `${label} integrity mismatch`); }
function sealedPreregistration(value) {
  const copy = structuredClone(value); const expected = copy.preregistrationHash; delete copy.preregistrationHash;
  if (expected && digest(copy) === expected) return;
  // The already-sealed prospective artifact was hashed before JSON serialization
  // with this one undefined field. Reconstruct that exact byte-independent value
  // instead of rewriting its hash or scientific meaning.
  copy.frozenRules = { ...copy.frozenRules, selectionRule: undefined };
  requireCondition(expected && digest(copy) === expected, "V7 40-arm preregistration integrity mismatch");
}

export function createPairedV740Preregistration({ basePlan }) {
  sealed(basePlan, "planHash", "V7 live plan");
  const protocol = createPairedV7ProtocolCore();
  requireCondition(basePlan.protocolCoreHash === protocol.protocolCoreHash && basePlan.protocol.campaignId === PAIRED_V7_CAMPAIGN_ID, "V7 40-arm requires the exact current V7 protocol");
  const preregistration = {
    schemaVersion: "das.candidate-scale-v7-prefix-40-preregistration.v1",
    extensionId: PAIRED_V7_40_EXTENSION_ID,
    baseV7PlanHash: basePlan.planHash,
    baseV7ProtocolCoreHash: basePlan.protocolCoreHash,
    baseV7CasePackHash: basePlan.casePackHash,
    baseV7CasePackReceiptHash: basePlan.casePackReceiptHash,
    baseV7PricingHash: basePlan.protocol.pricingHash,
    hypothesis: "Within the same frozen V7 support-role comparison, does the exact accepted 1-40 prefix recover more confirmed safe specialist quality than positions 1-5 without requiring the full 150-candidate search?",
    arm: {
      requestedCount: 40,
      candidateRule: "Exact accepted positions 1 through 40 from the fresh sealed V7 portfolio in original response order. No regeneration, replacement, repair, V5/V6 import or separate architect call is permitted.",
      nestedIn: ["exact-first-five-prefix", "adaptive-150-search"],
      finalistCount: 7,
      finalistRule: "Use the same static structural prior, tie-breaks and meaningful-distance threshold as V7. K(40)=7 is fixed prospectively.",
    },
    frozenRules: {
      candidateContract: protocol.generation.candidateSchemaHash,
      roleHash: protocol.bindings.roleHash,
      verifierId: protocol.bindings.verifierId,
      baselineHashesHash: protocol.bindings.baselineHashesHash,
      selectionCaseCounts: protocol.evaluation.selectionCaseCounts,
      confirmationCaseCounts: protocol.evaluation.confirmationCaseCounts,
      selectionRule: protocol.selectionRule,
      confirmationRule: protocol.evaluation.confirmationRule,
      meaningfulDistanceThreshold: protocol.structuralScreen.meaningfulDistanceThreshold,
    },
    observationRule: "Reuse a V7 observation only when plan, participant/configuration, case, phase, model, verifier and receipt bindings match exactly. Evaluate only missing 40-arm finalist/case pairs. Shared observations may not be rerun or altered.",
    confirmationRule: "Select the 40-arm winner only from frozen development/validation/adversarial observations. Release the existing V7 holdout/repeat cases only after the winner and observation corpus are sealed.",
    budget: {
      durableCampaignId: protocol.campaignId,
      v7HardCampaignCeilingUsd: protocol.budget.hardCampaignCeilingUsd,
      maximumCombinedPriorAndV7SpendUsd: protocol.budget.maximumCombinedPriorAndV7SpendUsd,
      sharedUserCeilingUsd: protocol.budget.sharedUserCeilingUsd,
      reservedBufferUsd: protocol.budget.minimumReservedBufferUsd,
      rule: "Use the same V7 durable budget and evidence ledger. The 40 arm has no independent allowance and may not exceed any V7 or shared ceiling.",
    },
    finalizationGate: "After the complete V7 portfolio/checkpoint/single-writer receipt are sealed, bind exact positions 1-40 and their hashes before any V7 performance observation, pre-final freeze or combined result exists.",
    launchGate: "No launch is authorized by this preregistration. A later exact extension plan, explicit approval, valid single-writer lock and remaining durable budget are all required.",
    stops: [
      "Stop if V7 generation is incomplete, rejected any candidate or lacks a clean exclusive-writer receipt.",
      "Stop if any V7 performance observation or combined result exists before the exact 1-40 plan is sealed.",
      "Stop if candidate order, portfolio, cases, models, role, authority, baselines, verifier, ranking or safety rule differs from V7.",
      "Stop on unresolved provider outcome, insufficient verified budget, evidence-ledger failure or writer-lock failure.",
    ],
    claimBoundary: "One preregistered nested 40-prefix arm inside one adaptive fictional support-role search. It cannot isolate candidate count from adaptive prior-memory effects or establish a universal optimal portfolio size, customer value, cross-role generality or production reliability.",
  };
  return Object.freeze({ ...preregistration, preregistrationHash: digest(preregistration) });
}

export function finalizePairedV740Plan({ preregistration, basePlan, portfolio, checkpoint, baseStructural, singleWriterReceipt }) {
  sealedPreregistration(preregistration); sealed(basePlan, "planHash", "V7 live plan"); sealed(portfolio, "integrityHash", "V7 portfolio"); sealed(checkpoint, "integrityHash", "V7 generation checkpoint"); sealed(baseStructural, "freezeHash", "V7 structural freeze"); sealed(singleWriterReceipt, "receiptHash", "V7 writer receipt");
  requireCondition(preregistration.baseV7PlanHash === basePlan.planHash && portfolio.planHash === basePlan.planHash && checkpoint.planHash === basePlan.planHash, "V7 40-arm base-plan binding changed");
  requireCondition(portfolio.candidates?.length === 150 && portfolio.rejected?.length === 0 && checkpoint.validCount === 150 && checkpoint.rejectedCount === 0, "V7 40-arm requires the clean complete 150-candidate portfolio");
  requireCondition(checkpoint.portfolioIntegrityHash === portfolio.integrityHash && checkpoint.structuralSelectionFreezeHash === baseStructural.freezeHash && singleWriterReceipt.checkpointIntegrityHash === checkpoint.integrityHash, "V7 40-arm generation receipts do not join exactly");
  requireCondition(portfolio.writerLockHash === checkpoint.writerLockHash && checkpoint.writerLockHash === singleWriterReceipt.writerLockHash, "V7 40-arm generation was not sealed by one bound writer");
  const protocol = createPairedV7ProtocolCore(); const brief = createCommercialSupportPack().roleDraft.compiled.brief;
  const first40 = portfolio.candidates.slice(0, 40); const selection = freezePairedStructuralSelection({ candidates: first40, brief, prefixCount: 5, globalCount: 7, meaningfulDistance: protocol.structuralScreen.meaningfulDistanceThreshold });
  const plan = {
    schemaVersion: "das.candidate-scale-v7-prefix-40-live-plan.v1", extensionId: preregistration.extensionId, preregistrationHash: preregistration.preregistrationHash,
    baseV7PlanHash: basePlan.planHash, baseV7ProtocolCoreHash: basePlan.protocolCoreHash, casePackHash: basePlan.casePackHash, casePackReceiptHash: basePlan.casePackReceiptHash, pricingHash: basePlan.protocol.pricingHash,
    portfolioIntegrityHash: portfolio.integrityHash, generationCheckpointHash: checkpoint.integrityHash, singleWriterGenerationReceiptHash: singleWriterReceipt.receiptHash, baseStructuralFreezeHash: baseStructural.freezeHash,
    first40CandidateIds: first40.map((candidate) => candidate.id), first40CandidateHashes: first40.map((candidate) => ({ id: candidate.id, configurationHash: candidate.fingerprint })),
    first40StructuralFreeze: selection, finalistIds: selection.globalFinalistIds,
    observationContract: { sourcePlanHash: basePlan.planHash, phases: ["selection", "confirmation"], exactReuseRule: preregistration.observationRule, selectionRule: protocol.evaluation.selectionRule, confirmationRule: protocol.evaluation.confirmationRule },
    budget: preregistration.budget,
    launchStatus: "not-authorized",
    requiredLaterGates: ["exact extension-plan hash approval", "valid exclusive writer lock", "no unresolved provider outcomes", "verified remaining V7 durable budget", "no conflicting completed extension result"],
    claimBoundary: preregistration.claimBoundary,
  };
  return Object.freeze({ ...plan, extensionPlanHash: digest(plan) });
}
