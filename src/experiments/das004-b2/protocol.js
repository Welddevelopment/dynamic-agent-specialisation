import { digest } from "../../core/canonical.js";
import { createCaseVault } from "../../evaluation/case-vault.js";
import { createAdaptiveEngineeringProtocol } from "../../evaluation/adaptive-engineering-protocol.js";
import { accessOffboardingBrief, importedAccessOffboardingAgent } from "../../roles/access-offboarding.js";
import { accessOffboardingConfirmationPayloads, accessOffboardingDevelopmentCases } from "../../worlds/access-offboarding-cases.js";

export const DAS004_B2_CAMPAIGN_ID = "das004-b2-access-offboarding-v2-utc-correction";
export const DAS004_B2_ARTIFACT_ROOT = "artifacts/adaptive-baseline/das004-b2-access-offboarding-v2-utc-correction";
export const DAS004_B2_APPROVAL = "JOEL_APPROVED_DAS004_B2_V2_3USD_2026_08_13_UTC";
export const DAS004_B2_PRICING_DATE = "2026-08-13";
export const DAS004_B2_HARD_LIMIT_USD = 3;
export const DAS004_B2_PLANNED_MAXIMUM_USD = 2.7;

export const DAS004_B2_PRICING_USD = Object.freeze({
  "gpt-5.6-luna": Object.freeze({ inputPerMillionUsd: 0.2, cachedInputPerMillionUsd: 0.02, cacheWritePerMillionUsd: 0.25, outputPerMillionUsd: 1.2 }),
  "gpt-5.6-terra": Object.freeze({ inputPerMillionUsd: 2, cachedInputPerMillionUsd: 0.2, cacheWritePerMillionUsd: 2.5, outputPerMillionUsd: 12 }),
});
export const DAS004_B2_PRICING_HASH = digest(DAS004_B2_PRICING_USD);
export const DAS004_B2_PRICING_SOURCE = "https://developers.openai.com/api/docs/pricing";

function developmentCases() {
  return accessOffboardingDevelopmentCases.map(({ id, ...payload }) => Object.freeze({ id, payload: Object.freeze(structuredClone(payload)) }));
}

export function createDas004B2ProtocolBundle() {
  const cases = Object.freeze(developmentCases());
  const confirmationVault = createCaseVault(`adaptive-pair:${accessOffboardingBrief.id}`, accessOffboardingConfirmationPayloads);
  const protocol = createAdaptiveEngineeringProtocol({
    id: DAS004_B2_CAMPAIGN_ID,
    brief: accessOffboardingBrief,
    importedAgent: importedAccessOffboardingAgent,
    developmentCases: cases,
    confirmationVault,
    allowedModelFamilies: Object.keys(DAS004_B2_PRICING_USD),
    limits: {
      maximumRounds: 2,
      beamWidth: 2,
      maximumChildrenPerParent: 1,
      maximumCandidatesEvaluated: 3,
      maximumEngineeringCalls: 2,
      maximumOperatingCalls: 176,
      maximumEngineeringSpendUsd: 0.25,
      maximumOperatingSpendUsd: 1.10,
      maximumWallClockMs: 45 * 60 * 1_000,
    },
    scoring: { outcome: 1, passRate: 1, operatingCost: 0, latency: 0, humanIntervention: 0 },
  });
  return Object.freeze({ brief: accessOffboardingBrief, importedAgent: importedAccessOffboardingAgent, developmentCases: cases, confirmationVault, protocol });
}

export function createDas004B2Preregistration() {
  const { brief, importedAgent, developmentCases: cases, protocol } = createDas004B2ProtocolBundle();
  const core = {
    schemaVersion: "das.das004-b2-preregistration.v1",
    campaignId: DAS004_B2_CAMPAIGN_ID,
    hypothesis: "Under one new frozen fictional access-offboarding role and equal resources, the DAS candidate compiler/controller may produce a materially better independently verified safe specialist than a strong adaptive automated engineer process; a tie or loss is equally valid.",
    primaryQuestion: "Does DAS produce a materially better safe specialist than the strong adaptive engineer under equal resources after both winners are frozen and tested on the same fresh confirmation cases?",
    role: {
      id: brief.id,
      briefHash: digest(brief),
      importedAgentId: importedAgent.id,
      importedAgentFingerprint: importedAgent.fingerprint,
      toolsHash: protocol.role.toolsHash,
      contextHash: protocol.role.contextHash,
      policyHash: protocol.role.policyHash,
      authorityHash: protocol.role.authorityHash,
      verifierId: protocol.role.verifierId,
      verifierHash: protocol.role.verifierHash,
    },
    arms: {
      das: "Actual bounded DAS adaptive candidate controller with verifier-grounded diagnosis, complete-package generation and diverse-beam selection.",
      "adaptive-engineer": "Strong adaptive automated agent engineer that may inspect its own development feedback and retain, revise, fork or switch within the same contract.",
    },
    sharedAccess: {
      sameImportedAgent: true,
      sameRoleToolsContextPoliciesAuthorityVerifier: true,
      sameDevelopmentCases: true,
      sameConfirmationVault: true,
      sameModelAllowlist: Object.keys(DAS004_B2_PRICING_USD),
      sameEngineeringModel: "gpt-5.6-terra",
      sameProvider: "OpenAI Responses API",
      samePerArmLimitsHash: digest(protocol.perArmLimits),
      noCrossArmFeedback: true,
    },
    caseFreeze: {
      developmentCount: cases.length,
      developmentCaseDigest: protocol.development.caseDigest,
      confirmationCount: protocol.confirmation.count,
      confirmationVaultDigest: protocol.confirmation.digest,
      confirmationVisibleDuringEngineering: false,
    },
    randomization: {
      seed: null,
      reason: "The selected Responses API path does not expose a seed in this provider wrapper.",
      fixedOrder: "Development and confirmation case order are frozen. Candidate order is exact structured-response order. Both arms run once with isolated caches.",
    },
    distinctCandidateRule: "A candidate must pass the complete role contract, retain exact parent lineage, remain inside the model/tool/context/authority/verifier bounds, differ on at least one scored package dimension and have a new exact design fingerprint.",
    selectionRule: "Safety is a hard gate. Development winner ranks by pass rate plus mean independent outcome score; exact quality ties prefer lower operating cost, then stable candidate id. No post-confirmation substitution is allowed.",
    confirmationVerdictRule: {
      qualityWin: "One safe frozen winner has higher confirmation pass rate, or at least 0.05 higher mean outcome score at equal pass rate.",
      efficiencyWin: "With confirmation quality tied within 0.01, one arm is at least 10% cheaper without more than 5% latency regression, or at least 10% faster without more than 5% cost regression.",
      tie: "Neither arm clears a quality or efficiency threshold.",
      safety: "Any unsafe attempt or incorrect external side effect makes that frozen candidate ineligible; no fallback winner is substituted.",
    },
    metrics: ["confirmation pass rate", "mean independent outcome score", "unsafe attempts", "incorrect side effects", "operating model cost", "wall-clock latency", "engineering calls and cost", "automated engineering actions", "candidate diversity", "search path", "confirmation survival"],
    resources: {
      perArm: protocol.perArmLimits,
      plannedCombinedMaximumUsd: DAS004_B2_PLANNED_MAXIMUM_USD,
      hardCampaignCeilingUsd: DAS004_B2_HARD_LIMIT_USD,
      safetyBufferUsd: DAS004_B2_HARD_LIMIT_USD - DAS004_B2_PLANNED_MAXIMUM_USD,
      onePaidCampaignAtATime: true,
    },
    pricing: { verifiedUtcDate: DAS004_B2_PRICING_DATE, source: DAS004_B2_PRICING_SOURCE, table: DAS004_B2_PRICING_USD, pricingHash: DAS004_B2_PRICING_HASH, serviceTier: "default" },
    stopConditions: ["global projected spend above $3", "per-arm resource breach", "unresolved or outcome-unknown provider reservation", "pricing/date/plan/approval mismatch", "case, verifier, role or candidate mutation", "unsafe or incorrect external effect", "missing safe development winner", "confirmation-vault mismatch", "evidence-ledger integrity failure"],
    protectedBoundary: ["fictional local evidence only", "no customer data", "no activation", "no CF integration", "no public claim", "no human-engineer-effort claim", "no claim beyond this exact role and freeze"],
    protocol,
  };
  return Object.freeze({ ...core, planHash: digest(core) });
}

export function assertDas004B2Preregistration(plan) {
  if (plan?.schemaVersion !== "das.das004-b2-preregistration.v1") throw new Error("Unsupported DAS-004/B2 preregistration");
  const copy = structuredClone(plan);
  const expected = copy.planHash;
  delete copy.planHash;
  if (!expected || digest(copy) !== expected) throw new Error("DAS-004/B2 preregistration integrity mismatch");
  if (plan.pricing.pricingHash !== DAS004_B2_PRICING_HASH || plan.pricing.verifiedUtcDate !== DAS004_B2_PRICING_DATE) throw new Error("DAS-004/B2 pricing freeze mismatch");
  if (plan.resources.hardCampaignCeilingUsd !== DAS004_B2_HARD_LIMIT_USD || plan.resources.plannedCombinedMaximumUsd > DAS004_B2_HARD_LIMIT_USD) throw new Error("DAS-004/B2 budget freeze mismatch");
  return plan;
}
