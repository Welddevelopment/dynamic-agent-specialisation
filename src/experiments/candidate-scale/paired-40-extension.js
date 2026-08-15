import { digest } from "../../core/canonical.js";
import { freezePairedStructuralSelection } from "./paired-selection.js";

export const BASE_V5_PLAN_HASH = "81183ed3aac70938c57b40f28e8d00fe9c6457dc0bd22655ecb7bb73fc180dda";
export const PAIRED_40_EXTENSION_ID = "candidate-scale-exact-prefix-40-extension-v1";
export const PAIRED_40_EXTENSION_APPROVAL = "AUTO_AFTER_V5_SUCCESS_AND_NO_USER_UPDATE";
export const PAIRED_40_EXTENSION_ROOT = "artifacts/candidate-scale/paired-5-vs-150-v5/extension-prefix-40-v1";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function sealed(value, hashKey, label) { const copy = structuredClone(value); const expected = copy[hashKey]; delete copy[hashKey]; requireCondition(expected && digest(copy) === expected, `${label} integrity mismatch`); }

export function createPaired40ExtensionPreregistration({ basePlan }) {
  sealed(basePlan, "planHash", "v5 live plan");
  requireCondition(basePlan?.planHash === BASE_V5_PLAN_HASH, "40-extension preregistration requires the exact sealed v5 plan");
  const prereg = {
    schemaVersion: "das.candidate-scale-prefix-40-preregistration.v1",
    extensionId: PAIRED_40_EXTENSION_ID,
    baseV5PlanHash: basePlan.planHash,
    baseV5ProtocolCoreHash: basePlan.protocolCoreHash,
    baseV5CasePackHash: basePlan.casePackHash,
    baseV5CasePackReceiptHash: basePlan.casePackReceiptHash,
    baseV5PricingHash: basePlan.protocol.pricingHash,
    hypothesis: "Inside the same frozen adaptive 150-candidate search, the exact accepted positions 1-40 may recover materially more of the confirmed safe specialist quality than positions 1-5 without requiring the full 150 search.",
    arm: {
      requestedCount: 40,
      candidateRule: "Exact accepted positions 1-40 from the already-generated v5 portfolio in frozen response order. No regeneration, replacement, repair or separate architect call is permitted.",
      nestedIn: ["exact-first-five-prefix", "adaptive-full-150-pool"],
      finalistCount: 7,
      finalistCountRule: "K(n)=round(5 + 5*(sqrt(n)-sqrt(5))/(sqrt(150)-sqrt(5))); K(40)=7. The same v5 structural prior, tie-break and 0.12 diversity rule apply.",
      structuralScreen: "Zero-call candidate contract validation, earliest-first exact deduplication, near-duplicate disclosure and the frozen v5 static structural prior.",
    },
    invariants: {
      schemaModelsRoleToolsAuthorityBaselinesCasesVerifier: "Identical hashes and executable objects to v5; generated candidates remain Luna, original baseline models remain Luna/Terra/Sol.",
      selectionCases: "The exact v5 development, validation and adversarial private cases.",
      confirmationCases: "The exact v5 holdout and repeat cases, never used to select the 40-arm winner.",
      selectionRule: "Same complete-safe-pass rule and ranking: outcome score, lower model cost, lower elapsed time, accepted position, candidate id.",
      metric: "Same independently verified confirmation mean outcome score and safety/cost/latency receipts as v5.",
    },
    reuseRule: "Reuse an existing v5 candidate or baseline observation only when plan, participant/configuration, case, model, verifier and receipt hashes all match. Evaluate only missing 40-arm finalist/case pairs. Never rerun or alter a shared observation to favor an arm.",
    budget: {
      sharedTotalCeilingUsd: 24,
      executableCeilingUsd: 23,
      reservedBufferUsd: 1,
      rule: "Use the same v5 durable $23 budget ledger. Additional calls may reserve only verified remaining capacity below $23 after v5. The reserved final $1 is unavailable unless Joel explicitly expands the ceiling.",
    },
    conditionalLaunch: {
      requiresV5Success: true,
      requiresNoNewDirectUserMessage: true,
      requiresRootConfirmation: true,
      silenceBoundary: "User silence authorizes launch only after v5 completes successfully and root confirms no newer direct instruction. It does not authorize launch before v5, public claims, or budget expansion.",
    },
    stops: [
      "Do not seal against a portfolio until all 150 v5 candidates are generated, validated and frozen, and before any v5 performance observation exists.",
      "Stop if accepted positions 1-40, portfolio hash, base structural freeze, cases, models, role, tools, authority, baselines or verifier do not exactly match v5.",
      "Stop if the verified v5 durable budget has insufficient capacity for the next missing observation.",
      "Stop on any safety/authority/incorrect-side-effect event under the same v5 rule.",
      "Stop without launch if v5 does not complete successfully or root cannot confirm no newer user instruction.",
    ],
    claimBoundary: "A preregistered nested 40-prefix arm inside one adaptive support-role search. It cannot establish a universal optimal candidate count or isolate candidate count from adaptive prior-memory effects.",
  };
  return Object.freeze({ ...prereg, preregistrationHash: digest(prereg) });
}

export function sealPaired40ExtensionPlan({ preregistration, basePlan, generatedPortfolio, baseStructuralFreeze }) {
  sealed(preregistration, "preregistrationHash", "40-extension preregistration");
  sealed(basePlan, "planHash", "v5 live plan");
  requireCondition(preregistration.baseV5PlanHash === basePlan.planHash && basePlan.planHash === BASE_V5_PLAN_HASH, "40-extension base plan changed");
  const portfolioCopy = structuredClone(generatedPortfolio); const portfolioHash = portfolioCopy.integrityHash; delete portfolioCopy.integrityHash;
  requireCondition(portfolioHash && digest(portfolioCopy) === portfolioHash && generatedPortfolio.candidates?.length === 150 && generatedPortfolio.rejected?.length === 0, "40-extension requires the intact complete v5 portfolio");
  requireCondition(generatedPortfolio.planHash === basePlan.planHash && generatedPortfolio.protocolCoreHash === basePlan.protocolCoreHash && generatedPortfolio.roleHash === basePlan.protocol.bindings.roleHash, "40-extension portfolio is not bound to the exact v5 role/protocol");
  sealed(baseStructuralFreeze, "freezeHash", "v5 structural freeze");
  requireCondition(baseStructuralFreeze.portfolioCount === 150 && baseStructuralFreeze.firstFiveCandidateIds.every((id, index) => id === generatedPortfolio.candidates[index]?.id), "40-extension base structural freeze does not match the frozen portfolio order");
  const first40 = generatedPortfolio.candidates.slice(0, 40);
  const supportBrief = basePlan.protocol.bindings.roleHash;
  requireCondition(supportBrief, "40-extension base role binding is missing");
  // The caller supplies the live brief only through the already-bound v5 selection helper.
  const planSeed = {
    portfolioIntegrityHash: generatedPortfolio.integrityHash,
    generationReceiptHash: digest(generatedPortfolio.receipt),
    baseStructuralFreezeHash: baseStructuralFreeze.freezeHash,
    first40CandidateIds: first40.map((candidate) => candidate.id),
    first40CandidateHashes: first40.map((candidate) => ({ id: candidate.id, configurationHash: candidate.fingerprint })),
  };
  return { preregistration, planSeed };
}

export function finalizePaired40ExtensionPlan({ preregistration, basePlan, generatedPortfolio, baseStructuralFreeze, brief }) {
  const { planSeed } = sealPaired40ExtensionPlan({ preregistration, basePlan, generatedPortfolio, baseStructuralFreeze });
  const recomputedBase = freezePairedStructuralSelection({ candidates: generatedPortfolio.candidates, brief, prefixCount: basePlan.protocol.prefixCandidateCount, globalCount: basePlan.protocol.structuralScreen.globalFinalistCount, meaningfulDistance: basePlan.protocol.structuralScreen.meaningfulDistanceThreshold });
  requireCondition(recomputedBase.freezeHash === baseStructuralFreeze.freezeHash, "40-extension could not reproduce the exact v5 structural freeze");
  const selection = freezePairedStructuralSelection({ candidates: generatedPortfolio.candidates.slice(0, 40), brief, prefixCount: 5, globalCount: preregistration.arm.finalistCount, meaningfulDistance: basePlan.protocol.structuralScreen.meaningfulDistanceThreshold });
  const plan = {
    schemaVersion: "das.candidate-scale-prefix-40-live-plan.v1",
    extensionId: preregistration.extensionId,
    preregistrationHash: preregistration.preregistrationHash,
    baseV5PlanHash: basePlan.planHash,
    baseV5ProtocolCoreHash: basePlan.protocolCoreHash,
    casePackHash: basePlan.casePackHash,
    casePackReceiptHash: basePlan.casePackReceiptHash,
    pricingHash: basePlan.protocol.pricingHash,
    ...planSeed,
    first40StructuralFreeze: selection,
    finalistIds: selection.globalFinalistIds,
    conditionalGates: {
      v5Complete: "DAS_CANDIDATE_SCALE_V5_COMPLETE=CONFIRMED",
      noNewUserMessage: "DAS_CANDIDATE_SCALE_NO_NEW_USER_MESSAGE=CONFIRMED_BY_ROOT",
      approval: `DAS_CANDIDATE_SCALE_40_EXTENSION_APPROVAL=${PAIRED_40_EXTENSION_APPROVAL}`,
      exactPlan: "DAS_CANDIDATE_SCALE_40_EXTENSION_PLAN_HASH=<exact extension plan hash>",
    },
  };
  return Object.freeze({ ...plan, extensionPlanHash: digest(plan) });
}

export function assertPaired40ExtensionAuthorization({ plan, environment = process.env }) {
  sealed(plan, "extensionPlanHash", "40-extension live plan");
  requireCondition(environment.DAS_CANDIDATE_SCALE_V5_COMPLETE === "CONFIRMED", "40-extension requires successful v5 completion");
  requireCondition(environment.DAS_CANDIDATE_SCALE_NO_NEW_USER_MESSAGE === "CONFIRMED_BY_ROOT", "40-extension requires root confirmation of no newer user instruction");
  requireCondition(environment.DAS_CANDIDATE_SCALE_40_EXTENSION_APPROVAL === PAIRED_40_EXTENSION_APPROVAL, "40-extension conditional approval is missing");
  requireCondition(environment.DAS_CANDIDATE_SCALE_40_EXTENSION_PLAN_HASH === plan.extensionPlanHash, "40-extension approval is not bound to the exact plan");
  requireCondition(environment.DAS_ENABLE_PAID_MODEL_CALLS === "JOEL_APPROVED" && String(environment.OPENAI_API_KEY ?? "").trim(), "40-extension paid execution/API key gate is closed");
  return true;
}
