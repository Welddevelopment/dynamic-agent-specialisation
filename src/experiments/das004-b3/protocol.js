import { digest } from "../../core/canonical.js";
import { createCaseVault } from "../../evaluation/case-vault.js";
import { createAdaptiveEngineeringProtocol } from "../../evaluation/adaptive-engineering-protocol.js";
import { declareArmEntryPoints } from "../../evaluation/execution-attestation.js";
import { accessOffboardingBrief, importedAccessOffboardingAgent } from "../../roles/access-offboarding.js";
import { accessOffboardingB3ConfirmationPayloads, accessOffboardingB3DevelopmentCases } from "../../worlds/access-offboarding-b3-cases.js";

export const DAS004_B3_CAMPAIGN_ID = "das004-b3-access-offboarding-real-compiler-v1";
export const DAS004_B3_ARTIFACT_ROOT = "artifacts/adaptive-baseline/das004-b3-access-offboarding-real-compiler-v1";
export const DAS004_B3_APPROVAL = "JOEL_APPROVED_DAS004_B3_REAL_COMPILER_3USD_2026_08_22";

/**
 * PRICING FRESHNESS — read before running.
 *
 * This table is B2's, carried forward UNCHANGED. It has NOT been independently re-verified
 * against the provider on this date; the models and rates are simply the same ones B2 froze
 * on 2026-08-13. `assertDas004B3Authorization` still requires the run to happen on
 * DAS004_B3_PRICING_DATE, so if the run slips to another day this constant must be bumped
 * and the table actually re-checked. Saying "verified" without checking is the erratum-0111a
 * failure in a different costume.
 */
export const DAS004_B3_PRICING_DATE = "2026-08-22";
export const DAS004_B3_PRICING_INDEPENDENTLY_REVERIFIED = false;
export const DAS004_B3_PRICING_SOURCE = "https://developers.openai.com/api/docs/pricing";
export const DAS004_B3_PRICING_USD = Object.freeze({
  "gpt-5.6-luna": Object.freeze({ inputPerMillionUsd: 0.2, cachedInputPerMillionUsd: 0.02, cacheWritePerMillionUsd: 0.25, outputPerMillionUsd: 1.2 }),
  "gpt-5.6-terra": Object.freeze({ inputPerMillionUsd: 2, cachedInputPerMillionUsd: 0.2, cacheWritePerMillionUsd: 2.5, outputPerMillionUsd: 12 }),
});
export const DAS004_B3_PRICING_HASH = digest(DAS004_B3_PRICING_USD);

/**
 * CEILING — $3, set by Joel in session on 2026-08-22.
 *
 * APR-0003 states $1 for PROP-0004. Joel was shown that contradiction explicitly and chose
 * the $3 frozen ceiling. Recorded here so a later reader of APR-0003 does not find an
 * unexplained mismatch. $3 is a CEILING, not an estimate; planned maximum is well below it.
 */
export const DAS004_B3_HARD_LIMIT_USD = 3;
export const DAS004_B3_PLANNED_MAXIMUM_USD = 1.6;
export const DAS004_B3_CEILING_NOTE = "Ceiling $3 set by Joel 2026-08-22, overriding APR-0003's stated $1 after the code/approval contradiction was surfaced.";

export const DAS004_B3_ENGINEERING_MODEL = "gpt-5.6-terra";
export const DAS004_B3_EXECUTION_MODEL = "gpt-5.6-luna";

/**
 * THE POINT OF B3 — the arms are different CODE, and it is machine-checked.
 *
 * B2 declared two arms that were one class separated by a persona string (erratum 0111a).
 * Here the das arm is the real model-backed compiler entry point and the adaptive-engineer
 * arm is the unconstrained designer. `distinctArmEntryPoints` must be TRUE, and the
 * attestor resolves both against their real modules before anything is quotable.
 *
 * NOT compileSpecialist(): that path is deterministic (four hard-coded variants, planWorkItem,
 * zero model calls) and needs a role interface this brief does not have. Using it would put a
 * $0 arm against a paid arm and break equal resources.
 */
export const DAS004_B3_ARM_ENTRY_POINTS = declareArmEntryPoints([
  { armId: "das", module: "src/compiler/model-architect.js", exportName: "ModelCandidateArchitect", methodName: "propose" },
  { armId: "adaptive-engineer", module: "src/experiments/das004-b2/model-adaptive-designer.js", exportName: "ModelAdaptiveDesigner", methodName: "propose" },
]);

export function armEntryPointsAreDistinct(sealed = DAS004_B3_ARM_ENTRY_POINTS) {
  const signatures = sealed.arms.map((row) => `${row.module}#${row.exportName}.${row.methodName ?? ""}`);
  return new Set(signatures).size === signatures.length;
}

function developmentCases() {
  return accessOffboardingB3DevelopmentCases.map(({ id, ...payload }) => Object.freeze({ id, payload: Object.freeze(structuredClone(payload)) }));
}

export function createDas004B3ProtocolBundle() {
  const cases = Object.freeze(developmentCases());
  const confirmationVault = createCaseVault(`adaptive-pair:${accessOffboardingBrief.id}:b3`, accessOffboardingB3ConfirmationPayloads);
  const protocol = createAdaptiveEngineeringProtocol({
    id: DAS004_B3_CAMPAIGN_ID,
    brief: accessOffboardingBrief,
    importedAgent: importedAccessOffboardingAgent,
    developmentCases: cases,
    confirmationVault,
    allowedModelFamilies: Object.keys(DAS004_B3_PRICING_USD),
    limits: {
      maximumRounds: 2,
      beamWidth: 2,
      maximumChildrenPerParent: 1,
      maximumCandidatesEvaluated: 3,
      maximumEngineeringCalls: 2,
      maximumOperatingCalls: 176,
      maximumEngineeringSpendUsd: 0.25,
      maximumOperatingSpendUsd: 0.55,
      maximumWallClockMs: 45 * 60 * 1_000,
    },
    scoring: { outcome: 1, passRate: 1, operatingCost: 0, latency: 0, humanIntervention: 0 },
  });
  return Object.freeze({ brief: accessOffboardingBrief, importedAgent: importedAccessOffboardingAgent, developmentCases: cases, confirmationVault, protocol });
}

export function createDas004B3Preregistration() {
  const { brief, importedAgent, developmentCases: cases, protocol } = createDas004B3ProtocolBundle();
  const core = {
    schemaVersion: "das.das004-b3-preregistration.v1",
    campaignId: DAS004_B3_CAMPAIGN_ID,
    supersedesForArchitectureClaims: "das004-b2-access-offboarding-v2-utc-correction",
    hypothesis: "Under one frozen fictional access-offboarding role and equal resources, the real model-backed DAS candidate compiler may produce a materially better independently verified safe specialist than a strong adaptive automated engineer; a tie or a loss is equally valid and will be reported unchanged.",
    primaryQuestion: "Does the actual DAS compiler produce a materially better safe specialist than a strong adaptive engineer under equal resources, on fresh confirmation cases, after both winners are frozen?",
    expectationStatedInAdvance: "This is the first VALID run of this comparison, not a rerun of a passing test. A coin flip is the honest prior. A loss is a real result and is worth more than an untested claim.",
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
      das: "The real model-backed DAS compiler: ModelCandidateArchitect.propose generates a complete candidate portfolio, ModelCandidateRefiner.refine repairs against verifier-grounded development failures.",
      "adaptive-engineer": "Strong adaptive automated agent engineer that may inspect its own development feedback and retain, revise, fork or switch within the same contract.",
    },
    armEntryPoints: DAS004_B3_ARM_ENTRY_POINTS,
    distinctArmEntryPoints: armEntryPointsAreDistinct(),
    executionAttestation: "Both arms declare the module, export and method that constitutes them. The attestor resolves each declaration against the real module and identity-checks the function that runs. assertAllReached() executes before any result is quotable.",
    declaredHarnessSteps: [
      "MODEL NORMALIZATION: the architect's response schema leaves model.family free, so generated candidates are normalized onto the frozen execution family gpt-5.6-luna. This is the same normalization the paid Level 1 campaign used. It selects a permitted engine; it does not alter any scored design dimension.",
      "LINEAGE STAMPING: the architect returns a portfolio, not parent-linked actions, so the adapter records provenance.parents as the exact frozen parent fingerprint. Instructions, context, tools, memory, authority, escalation, limits and strategy are never edited.",
      "Both steps are harness bookkeeping and are disclosed here so that no reader has to infer them from source.",
    ],
    whatB3DoesNotInherit: [
      "B2's freeze. PROP-0003 changed the verifier source hash from b40976dc9318... to 6a9f79b630c5..., so no B2 freeze can be reused or pooled with this result.",
      "B2's cases. Every development and confirmation case here is new; no B2 identifier appears.",
      "B2's architecture claim. B2 compared two personas over one class and cannot speak about the compiler.",
    ],
    sharedAccess: {
      sameImportedAgent: true,
      sameRoleToolsContextPoliciesAuthorityVerifier: true,
      sameDevelopmentCases: true,
      sameConfirmationVault: true,
      sameModelAllowlist: Object.keys(DAS004_B3_PRICING_USD),
      sameEngineeringModel: DAS004_B3_ENGINEERING_MODEL,
      sameExecutionModel: DAS004_B3_EXECUTION_MODEL,
      sameProvider: "OpenAI Responses API",
      samePerArmLimitsHash: digest(protocol.perArmLimits),
      noCrossArmFeedback: true,
      equalResourcesNote: "Both arms engineer with gpt-5.6-terra and execute candidates on gpt-5.6-luna, under identical per-arm reservation and spend limits. Neither arm gets a free path.",
    },
    caseFreeze: {
      developmentCount: cases.length,
      developmentCaseDigest: protocol.development.caseDigest,
      confirmationCount: protocol.confirmation.count,
      confirmationVaultDigest: protocol.confirmation.digest,
      confirmationVisibleDuringEngineering: false,
      reusesConsumedCases: false,
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
      retainExisting: "If neither arm's winner beats the imported agent under the frozen ranking, retain-existing is the correct outcome and will be reported as such, not as a failure.",
    },
    metrics: ["confirmation pass rate", "mean independent outcome score", "unsafe attempts", "incorrect side effects", "operating model cost", "wall-clock latency", "engineering calls and cost", "candidate diversity", "search path", "confirmation survival", "execution attestation receipt"],
    resources: {
      perArm: protocol.perArmLimits,
      plannedCombinedMaximumUsd: DAS004_B3_PLANNED_MAXIMUM_USD,
      hardCampaignCeilingUsd: DAS004_B3_HARD_LIMIT_USD,
      safetyBufferUsd: DAS004_B3_HARD_LIMIT_USD - DAS004_B3_PLANNED_MAXIMUM_USD,
      ceilingNote: DAS004_B3_CEILING_NOTE,
      onePaidCampaignAtATime: true,
    },
    pricing: {
      verifiedUtcDate: DAS004_B3_PRICING_DATE,
      independentlyReverifiedOnThisDate: DAS004_B3_PRICING_INDEPENDENTLY_REVERIFIED,
      carriedForwardFrom: "das004-b2 pricing frozen 2026-08-13, unchanged",
      source: DAS004_B3_PRICING_SOURCE,
      table: DAS004_B3_PRICING_USD,
      pricingHash: DAS004_B3_PRICING_HASH,
      serviceTier: "default",
    },
    stopConditions: ["global projected spend above $3", "per-arm resource breach", "unresolved or outcome-unknown provider reservation", "pricing/date/plan/approval mismatch", "case, verifier, role or candidate mutation", "unsafe or incorrect external effect", "missing safe development winner", "confirmation-vault mismatch", "evidence-ledger integrity failure", "execution attestation unresolved or unreached"],
    protectedBoundary: ["fictional local evidence only", "no customer data", "no activation", "no CF integration", "no public claim", "no human-engineer-effort claim", "no setup-time claim", "no claim beyond this exact role and freeze", "no pooling with B2 or with the deterministic 115/115 fleet result"],
    protocol,
  };
  return Object.freeze({ ...core, planHash: digest(core) });
}

export function assertDas004B3Preregistration(plan) {
  if (plan?.schemaVersion !== "das.das004-b3-preregistration.v1") throw new Error("Unsupported DAS-004/B3 preregistration");
  const copy = structuredClone(plan);
  const expected = copy.planHash;
  delete copy.planHash;
  if (!expected || digest(copy) !== expected) throw new Error("DAS-004/B3 preregistration integrity mismatch");
  if (plan.pricing.pricingHash !== DAS004_B3_PRICING_HASH || plan.pricing.verifiedUtcDate !== DAS004_B3_PRICING_DATE) throw new Error("DAS-004/B3 pricing freeze mismatch");
  if (plan.resources.hardCampaignCeilingUsd !== DAS004_B3_HARD_LIMIT_USD || plan.resources.plannedCombinedMaximumUsd > DAS004_B3_HARD_LIMIT_USD) throw new Error("DAS-004/B3 budget freeze mismatch");
  if (!plan.armEntryPoints) throw new Error("DAS-004/B3 preregistration declares no per-arm entry point");
  if (plan.armEntryPoints.entryPointsHash !== DAS004_B3_ARM_ENTRY_POINTS.entryPointsHash) throw new Error("DAS-004/B3 arm entry-point declaration differs from the campaign definition");
  if (plan.distinctArmEntryPoints !== armEntryPointsAreDistinct(plan.armEntryPoints)) throw new Error("DAS-004/B3 preregistration misreports whether its arms are distinct code paths");
  // The entire reason B3 exists. If the arms are not different code, this is B2 again.
  if (plan.distinctArmEntryPoints !== true) throw new Error("DAS-004/B3 requires two genuinely distinct arm entry points; identical arms reproduce erratum 0111a");
  if (plan.caseFreeze.reusesConsumedCases !== false) throw new Error("DAS-004/B3 must not reuse consumed cases");
  return plan;
}
