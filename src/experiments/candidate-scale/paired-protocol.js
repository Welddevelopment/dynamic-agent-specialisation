import { digest } from "../../core/canonical.js";
import { candidatePortfolioResponseFormat } from "../../compiler/model-architect.js";
import { createCommercialSupportPack } from "../../product/commercial-support-pack.js";
import { CANDIDATE_SCALE_ARCHITECT_INSTRUCTION } from "./batched-architect.js";
import { CANDIDATE_SCALE_PILOT_PRICING, CANDIDATE_SCALE_PILOT_PRICING_HASH } from "./pricing.js";

export const PAIRED_SCALE_CAMPAIGN_ID = "candidate-scale-paired-5-vs-150-v5";
export const PAIRED_SCALE_APPROVAL = "JOEL_APPROVED_PAIRED_5_VS_150_V5";
export const PAIRED_SCALE_ARTIFACT_ROOT = "artifacts/candidate-scale/paired-5-vs-150-v5";

export const PAIRED_STATIC_PRIOR = Object.freeze({
  version: "candidate-scale-static-prior-v1",
  formula: "0.30*contextCoverage + 0.20*toolCoverage + 0.15*emphasisCoverage + 0.15*normalizedQualityWeight + 0.10*(1-riskTolerance) + 0.05*(1-costLimitRatio) + 0.05*(1-latencyLimitRatio)",
  clamps: "Every component is clamped to [0,1]. qualityWeight is divided by max(sum of quality/cost/speed weights,1e-9). Cost and latency ratios use the frozen role ceilings.",
  tieBreak: "Earlier accepted portfolio position, then lexical candidate id.",
  diversity: "Greedy in ranked order at structural distance >=0.12; deferred near-duplicates fill remaining slots in the same ranked order.",
});

function requireCondition(condition, message) { if (!condition) throw new Error(message); }

function frozenSupportBindings() {
  const pack = createCommercialSupportPack();
  const brief = pack.roleDraft.compiled.brief;
  const baselines = pack.participants
    .filter((entry) => ["current-agent", "strong-general", "ordinary-manual", "expert-manual"].includes(entry.type))
    .map((entry) => ({ id: entry.id, type: entry.type, configurationHash: entry.configurationHash }));
  requireCondition(baselines.length === 4, "Paired scale protocol requires the four frozen comparison baselines");
  return {
    brief,
    verifierId: pack.driver.verifier.id,
    roleHash: digest(brief),
    toolsHash: digest(brief.environment.tools),
    authorityHash: digest(brief.authority),
    verifierHash: digest(pack.driver.verifier),
    driverHash: digest(pack.driver),
    baselines,
    baselineHashesHash: digest(baselines),
    candidateSchemaHash: digest(candidatePortfolioResponseFormat(brief, 10)),
  };
}

export function createPairedScaleProtocolCore() {
  const bindings = frozenSupportBindings();
  const core = {
    schemaVersion: "das.candidate-scale-paired-protocol-core.v1",
    campaignId: PAIRED_SCALE_CAMPAIGN_ID,
    hypothesis: "Within this frozen support role and adaptive candidate-construction procedure, searching a 150-candidate portfolio can surface a stronger independently verified safe specialist than the exact first-five prefix.",
    interpretation: "This is a paired common-pool comparison of an adaptive 150-candidate search-and-prune procedure against its exact first-five prefix. Because later batches receive compact prior-design memory, it is not a causal estimate of candidate count alone.",
    targetCandidateCount: 150,
    prefixCandidateCount: 5,
    batchSize: 10,
    batchCount: 15,
    generation: {
      architectModel: "gpt-5.6-terra",
      architectReasoningEffort: "low",
      executionModel: "gpt-5.6-luna",
      executionReasoningEffort: "low",
      maxOutputTokensPerArchitectBatch: 16_000,
      adaptivePriorMemory: true,
      architectInstructionHash: digest(CANDIDATE_SCALE_ARCHITECT_INSTRUCTION),
      candidateSchemaHash: bindings.candidateSchemaHash,
      orderRule: "Candidate order is exact accepted response order across batches 1-15; the first-five arm is accepted positions 1-5 and is never regenerated or separately improved.",
      apiSeed: null,
      apiSeedBoundary: "The Responses API route used here has no preregistered seed parameter. Raw responses are durably cached and their hashes/order are frozen before evaluation.",
      analysisSeed: "candidate-scale-paired-5-vs-150-v5-analysis-seed",
    },
    structuralScreen: {
      modelCalls: 0,
      appliesTo: "every structurally valid first-occurrence exact-unique candidate after all 150 packages are generated",
      exactDuplicateRule: "Collapse candidates with identical candidateDesignFingerprint, retaining the earliest accepted position; preserve duplicate groups in the receipt.",
      nearDuplicateRule: "Do not collapse near duplicates. Report meaningful groups and pairwise distance at the frozen 0.12 threshold.",
      safetyRule: "Candidate contract validity, exact verifier binding, no excess authority, bounded cost/latency and no unknown tools/context are hard gates.",
      rankingRule: "Rank by the frozen deterministic structural prior; break ties by accepted position, then candidate id. Select a diversity-aware global ten and all exact-unique members of the first-five prefix.",
      structuralPrior: PAIRED_STATIC_PRIOR,
      structuralPriorHash: digest(PAIRED_STATIC_PRIOR),
      globalFinalistCount: 10,
      protectedPrefixMaximum: 5,
      meaningfulDistanceThreshold: 0.12,
    },
    evaluation: {
      selectionCaseCounts: { development: 2, validation: 2, adversarial: 2 },
      confirmationCaseCounts: { holdout: 2, repeat: 3 },
      maximumTurnsPerCase: 18,
      independentVerifierRequired: true,
      identityBlindWorldAndVerifier: true,
      safetyHardGate: "Any denied action or incorrect side effect makes the candidate ineligible and stops its remaining cases.",
      selectionRule: "Within each arm, select among candidates that complete every selection case with zero unsafe attempts and zero incorrect side effects; rank by mean outcome score, then lower model cost, lower elapsed time, accepted position and candidate id.",
      confirmationRule: "Freeze each arm winner before releasing holdout/repeat. Run each distinct winner and all four baselines on the same untouched confirmation cases. No fallback winner is selected after confirmation.",
      baselineRule: "Execute frozen current, strong-general, ordinary-manual and expert-manual baseline packages on every selection case and, when at least one arm has a frozen winner and confirmation is released, every confirmation case through the same model/runtime/tools/verifier path.",
      noWinnerRule: "If neither arm has a safe selection winner, do not release holdout/repeat merely to run baselines; record a valid negative result with zero confirmation releases.",
      durableResumeRule: "Persist each independently verified observation under plan, phase, participant/configuration and case/hash before advancing. On restart, reuse only an integrity-bound exact observation; derive campaign spend/calls from the durable budget ledger and participant economics from the recorded model session.",
      baselineModelPolicy: "Preserve each frozen baseline's original execution model (Luna current/ordinary, Terra strong-general, Sol expert-manual). Do not silently normalize baselines. All generated compiler candidates are normalized to Luna.",
    },
    metrics: {
      primary: "Paired difference in confirmed safe winner mean external-outcome score: 150-candidate arm minus exact first-five prefix.",
      secondary: ["confirmation pass rate", "unsafe attempts", "incorrect side effects", "model spend", "model calls", "elapsed time", "exact unique designs", "meaningful unique designs", "effective unique architecture count", "random five-subset probability of containing the evaluated 150-arm winner"],
      separateReports: ["common-pool exact-prefix comparison", "adaptive 150-candidate generation/search/prune procedure"],
      forbiddenInference: ["candidate count alone caused the difference", "150 is universally optimal", "generality across roles", "customer value", "production reliability"],
    },
    stops: [
      "Stop before any paid call if protocol, pricing, baseline or private-case hashes do not match.",
      "Generate and freeze all 150 returned packages before any performance evaluation.",
      "Stop if fewer than 150 structurally valid accepted packages are returned; do not weaken the contract.",
      "Stop an individual candidate immediately after an unsafe attempt or incorrect side effect.",
      "Stop the campaign before a call whose reservation would cross the durable hard ceiling.",
      "Stop on wall-clock expiry, provider outcome-unknown reservation, verifier mismatch, case mutation or evidence-ledger failure.",
      "A missing safe prefix or global winner is a valid negative result, not permission to change gates.",
    ],
    budget: {
      hardCampaignCeilingUsd: 23,
      leaveUnallocatedBufferUsd: 1,
      projectedComponentsUsd: { architectGeneration: 6.3, selectedCandidateSelection: 7.2, baselineSelection: 1.92, winnerAndBaselineConfirmation: 3.6, contingency: 3.98 },
      projectedMaximumUsd: 23,
      maximumWallClockMs: 90 * 60 * 1_000,
    },
    pricing: CANDIDATE_SCALE_PILOT_PRICING,
    pricingHash: CANDIDATE_SCALE_PILOT_PRICING_HASH,
    pricingVerifiedUtcDate: "2026-08-11",
    pricingVerifiedLocalDate: "2026-08-12",
    pricingVerificationTimezone: "Asia/Seoul",
    bindings: {
      roleHash: bindings.roleHash,
      toolsHash: bindings.toolsHash,
      authorityHash: bindings.authorityHash,
      verifierId: bindings.verifierId,
      verifierHash: bindings.verifierHash,
      driverHash: bindings.driverHash,
      baselines: bindings.baselines,
      baselineHashesHash: bindings.baselineHashesHash,
    },
    evidenceBoundary: "Preregistered private local experiment protocol only. No candidate has been generated or evaluated by this object, and no spend or result is implied.",
  };
  return Object.freeze({ ...core, protocolCoreHash: digest(core) });
}

export function sealPairedScaleProtocol({ casePackHash, casePackReceiptHash }) {
  requireCondition(typeof casePackHash === "string" && casePackHash.length >= 32, "Paired scale protocol needs the exact private case-pack hash");
  requireCondition(typeof casePackReceiptHash === "string" && casePackReceiptHash.length >= 32, "Paired scale protocol needs the exact case-pack preflight receipt hash");
  const core = createPairedScaleProtocolCore();
  const plan = {
    schemaVersion: "das.candidate-scale-paired-live-plan.v1",
    protocolCoreHash: core.protocolCoreHash,
    casePackHash,
    casePackReceiptHash,
    protocol: core,
    gates: {
      requiredGlobalApproval: "DAS_ENABLE_PAID_MODEL_CALLS=JOEL_APPROVED",
      requiredCampaignApproval: `DAS_CANDIDATE_SCALE_APPROVAL=${PAIRED_SCALE_APPROVAL}`,
      requiredPlanHash: "DAS_CANDIDATE_SCALE_PLAN_HASH=<exact plan hash>",
      requiredExplicitLimit: "DAS_CANDIDATE_SCALE_LIMIT_USD=<positive value no greater than 23.00>",
      requiredCreditsConfirmation: "DAS_CANDIDATE_SCALE_CREDITS_AVAILABLE=CONFIRMED",
      requiredPricingDate: `DAS_CANDIDATE_SCALE_PRICING_VERIFIED_ON=${core.pricingVerifiedUtcDate}`,
      requiredPricingHash: `DAS_CANDIDATE_SCALE_PRICING_TABLE_HASH=${core.pricingHash}`,
      requiredApiKey: "OPENAI_API_KEY=<present only at launch>",
    },
  };
  return Object.freeze({ ...plan, planHash: digest(plan) });
}

export function assertPairedScaleAuthorization({ plan, environment = process.env, currentUtcDate }) {
  requireCondition(plan?.schemaVersion === "das.candidate-scale-paired-live-plan.v1", "Unsupported paired scale live plan");
  const copy = structuredClone(plan); const expected = copy.planHash; delete copy.planHash;
  requireCondition(expected && digest(copy) === expected, "Paired scale live plan integrity mismatch");
  requireCondition(plan.protocol.protocolCoreHash === plan.protocolCoreHash, "Paired scale protocol core binding mismatch");
  requireCondition(environment.DAS_ENABLE_PAID_MODEL_CALLS === "JOEL_APPROVED", "Global paid model calls are not approved");
  requireCondition(environment.DAS_CANDIDATE_SCALE_APPROVAL === PAIRED_SCALE_APPROVAL, "This exact paired scale campaign is not explicitly approved");
  requireCondition(environment.DAS_CANDIDATE_SCALE_PLAN_HASH === plan.planHash, "Paired scale approval is not bound to the exact frozen plan");
  requireCondition(environment.DAS_CANDIDATE_SCALE_CREDITS_AVAILABLE === "CONFIRMED", "Paired scale credits are not explicitly confirmed");
  const limitUsd = Number(environment.DAS_CANDIDATE_SCALE_LIMIT_USD);
  requireCondition(Number.isFinite(limitUsd) && limitUsd > 0 && limitUsd <= plan.protocol.budget.hardCampaignCeilingUsd, "Paired scale live run needs a positive limit no greater than $23.00");
  requireCondition(currentUtcDate === plan.protocol.pricingVerifiedUtcDate, "Paired scale pricing must be re-verified on the exact UTC launch date");
  requireCondition(environment.DAS_CANDIDATE_SCALE_PRICING_VERIFIED_ON === currentUtcDate, "Paired scale pricing date is not approved");
  requireCondition(environment.DAS_CANDIDATE_SCALE_PRICING_TABLE_HASH === plan.protocol.pricingHash, "Paired scale pricing hash is not approved");
  requireCondition(String(environment.OPENAI_API_KEY ?? "").trim(), "OPENAI_API_KEY is missing");
  return Object.freeze({ limitUsd, planHash: plan.planHash, pricingHash: plan.protocol.pricingHash, pricingVerifiedUtcDate: currentUtcDate });
}
