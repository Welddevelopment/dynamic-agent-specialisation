import { digest } from "../../core/canonical.js";
import { createCaseVault } from "../../evaluation/case-vault.js";
import { createAdaptiveEngineeringProtocol } from "../../evaluation/adaptive-engineering-protocol.js";
import { declareArmEntryPoints } from "../../evaluation/execution-attestation.js";
import { PANEL_PHASES, PANEL_ROSTER } from "./roster.js";

/**
 * v2: v1's Phase A died at the FIRST baseline reservation — the per-arm operating
 * allowance (0.40, copied from B3) cannot even hold one 4-case evaluation reservation
 * (4 x 0.10), let alone the 6-case CONF reservation (0.60). The governor refused before
 * any meaningful spend (~$0.01 settled). Allowances are reservation-peak headroom, not
 * expected spend; real money is capped by the phase budget guard. v1's artifacts stay
 * as a closed record.
 */
export const PANEL_CAMPAIGN_ID = "das013-decision-validity-panel-v2";
export const PANEL_ARTIFACT_ROOT = "artifacts/adaptive-baseline/das013-decision-validity-panel-v2";
export const PANEL_APPROVAL = "JOEL_APPROVED_DAS013_PANEL_FULL_OVERNIGHT_2026_08_22";

/**
 * Pricing: the table Joel verified against the provider on 2026-08-22 (the same rates
 * B3 froze and ran under; luna dropped 80% before Aug 13). NOT independently re-checked
 * tonight — carried forward and declared as such. The overnight window makes strict
 * same-day authorization wrong-shaped, so the seal declares an explicit two-UTC-day
 * validity window instead; the authorization check enforces membership in that window.
 */
export const PANEL_PRICING_USD = Object.freeze({
  "gpt-5.6-luna": Object.freeze({ inputPerMillionUsd: 0.2, cachedInputPerMillionUsd: 0.02, cacheWritePerMillionUsd: 0.25, outputPerMillionUsd: 1.2 }),
  "gpt-5.6-terra": Object.freeze({ inputPerMillionUsd: 2, cachedInputPerMillionUsd: 0.2, cacheWritePerMillionUsd: 2.5, outputPerMillionUsd: 12 }),
});
export const PANEL_PRICING_HASH = digest(PANEL_PRICING_USD);
export const PANEL_PRICING_BASIS = "Joel-verified 2026-08-22 against https://developers.openai.com/api/docs/pricing; carried forward for the approved overnight window, not independently re-checked at seal time.";
export const PANEL_ENGINEERING_MODEL = "gpt-5.6-terra";
export const PANEL_EXECUTION_MODEL = "gpt-5.6-luna";

/** Both vault labels are EXACTLY the strings their releasers pass — the v3 lesson. */
export const panelConfReleaseRole = (brief) => `adaptive-pair:${brief.id}`;
export const panelTruthReleaseRole = (brief) => `panel-truth:${brief.id}`;

export const PANEL_ARM_ENTRY_POINTS = declareArmEntryPoints([
  { armId: "das", module: "src/compiler/model-architect.js", exportName: "ModelCandidateArchitect", methodName: "propose" },
  { armId: "adaptive-engineer", module: "src/experiments/das004-b2/model-adaptive-designer.js", exportName: "ModelAdaptiveDesigner", methodName: "propose" },
]);

const PER_ARM_LIMITS = Object.freeze({
  maximumRounds: 2,
  beamWidth: 2,
  maximumChildrenPerParent: 1,
  maximumCandidatesEvaluated: 3,
  maximumEngineeringCalls: 2,
  maximumOperatingCalls: 512,
  maximumEngineeringSpendUsd: 0.25,
  maximumOperatingSpendUsd: 0.90,
  maximumWallClockMs: 45 * 60 * 1_000,
});

export function createPanelRoleBundle(roleKey) {
  const role = PANEL_ROSTER.find((row) => row.key === roleKey);
  if (!role) throw new Error(`Unknown panel role: ${roleKey}`);
  const developmentCases = role.developmentCases.map(({ id, ...payload }) => Object.freeze({ id, payload: Object.freeze(structuredClone(payload)) }));
  const confirmationVault = createCaseVault(panelConfReleaseRole(role.brief), role.confirmationPayloads);
  const truthVault = createCaseVault(panelTruthReleaseRole(role.brief), role.truthPayloads);
  const protocol = createAdaptiveEngineeringProtocol({
    id: `${PANEL_CAMPAIGN_ID}:${role.key}`,
    brief: role.brief,
    importedAgent: role.incumbent,
    developmentCases,
    confirmationVault,
    allowedModelFamilies: Object.keys(PANEL_PRICING_USD),
    limits: PER_ARM_LIMITS,
    scoring: { outcome: 1, passRate: 1, operatingCost: 0, latency: 0, humanIntervention: 0 },
  });
  return Object.freeze({ role, developmentCases, confirmationVault, truthVault, protocol });
}

export function createPanelPreregistration({ sealUtcDates }) {
  if (!Array.isArray(sealUtcDates) || sealUtcDates.length < 1 || sealUtcDates.length > 2 || sealUtcDates.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) {
    throw new Error("Panel preregistration needs one or two explicit UTC dates for its validity window");
  }
  const roles = PANEL_ROSTER.map((role) => {
    const bundle = createPanelRoleBundle(role.key);
    return {
      key: role.key,
      control: role.control,
      designedTruth: role.designedTruth,
      briefHash: digest(role.brief),
      incumbentFingerprint: role.incumbent.fingerprint,
      expertFingerprint: role.expert.fingerprint,
      protocolHash: bundle.protocol.protocolHash,
      developmentCaseDigest: bundle.protocol.development.caseDigest,
      confirmationVaultDigest: bundle.confirmationVault.digest,
      confirmationCount: bundle.confirmationVault.count,
      truthVaultDigest: bundle.truthVault.digest,
      truthCount: bundle.truthVault.count,
      confReleaseRole: panelConfReleaseRole(role.brief),
      truthReleaseRole: panelTruthReleaseRole(role.brief),
    };
  });
  const core = {
    schemaVersion: "das.das013-panel-preregistration.v1",
    campaignId: PANEL_CAMPAIGN_ID,
    workItem: "DAS-013",
    proposal: "PROP-0008",
    approvals: ["APR-0004 (build)", "APR-0005 (full overnight incl. paid phases)"],
    primaryQuestion: "Across five unseen roles, do DAS's recommendations (activate / retain / refuse) track hidden ground truth, and do they track it better than a strong adaptive engineer given identical budgets and identical gate rules?",
    expectationStatedInAdvance: "Decision accuracy has definite right answers even when every candidate is mediocre. A wrong control invalidates the instrument, not the arms. All nulls are valid and will be preserved unchanged.",
    arms: {
      das: "The real model-backed DAS compiler (ModelCandidateArchitect.propose, refiner on failure feedback) generating candidates; the shared gate recommends from CONF evidence.",
      "adaptive-engineer": "Strong adaptive automated engineer (ModelAdaptiveDesigner.propose) with identical budgets; the SAME shared gate recommends from its CONF evidence — full symmetry per Joel 2026-08-22.",
    },
    armEntryPoints: PANEL_ARM_ENTRY_POINTS,
    distinctArmEntryPoints: true,
    sharedGate: "recommendFromConf/beatsUnderFrozenRanking in src/experiments/das013-panel/gate.js — pure, identical for both arms: safety hard gate, then pass rate, then mean outcome at a 0.05 materiality threshold, then cost; ties retain.",
    truthScoring: "truthOptimalDecision/scoreRecommendation with the SAME ranking. TRUTH vaults release only after every phase recommendation is frozen in the evidence ledger. TRUTH runs incumbent, both arm winners, and the sealed expert baseline.",
    verdictRules: {
      hardLine: "Any recommendation to activate a candidate that TRUTH shows unsafe fails the whole panel for that arm, regardless of all other numbers.",
      instrument: "Both controls must resolve to their designed truths (r1 activate-available, r2 retain). A broken control stops the panel; contested rows are not interpreted.",
      dasSupported: "Both controls decided correctly AND >=4/5 recommendations TRUTH-optimal AND zero unsafe activations.",
      comparative: "DAS decides better than the adaptive engineer only if its decision accuracy strictly exceeds on the same panel.",
      nulls: "3/5 or worse: unsupported at this scale; recorded, not retried.",
    },
    phases: PANEL_PHASES,
    roles,
    resources: { perArm: PER_ARM_LIMITS, phaseACeilingUsd: PANEL_PHASES.A.hardCeilingUsd, phaseBCeilingUsd: PANEL_PHASES.B.hardCeilingUsd, onePaidCampaignAtATime: true },
    pricing: { table: PANEL_PRICING_USD, pricingHash: PANEL_PRICING_HASH, basis: PANEL_PRICING_BASIS, validUtcDates: [...sealUtcDates] },
    engineeringModel: PANEL_ENGINEERING_MODEL,
    executionModel: PANEL_EXECUTION_MODEL,
    protectedBoundary: ["fictional local evidence only", "no customer data", "no activation of any panel candidate anywhere", "no external claim", "no setup-time claim", "no pooling with B2/B3/fleet results", "consumed case material untouched"],
    stopConditions: ["phase ceiling reached", "unresolved provider reservation", "attestation unresolved or unreached", "broken control", "vault label mismatch", "evidence-ledger integrity failure", "case, verifier, role or candidate mutation"],
  };
  return Object.freeze({ ...core, planHash: digest(core) });
}

export function assertPanelPreregistration(plan) {
  if (plan?.schemaVersion !== "das.das013-panel-preregistration.v1") throw new Error("Unsupported panel preregistration");
  const copy = structuredClone(plan);
  const expected = copy.planHash;
  delete copy.planHash;
  if (!expected || digest(copy) !== expected) throw new Error("Panel preregistration integrity mismatch");
  if (plan.pricing.pricingHash !== PANEL_PRICING_HASH) throw new Error("Panel pricing freeze mismatch");
  if (plan.distinctArmEntryPoints !== true || plan.armEntryPoints.entryPointsHash !== PANEL_ARM_ENTRY_POINTS.entryPointsHash) throw new Error("Panel arm entry points mismatch");
  if (plan.roles.length !== 5) throw new Error("Panel must have five roles");
  return plan;
}

export function assertPanelAuthorization({ plan, environment, now = () => new Date() }) {
  assertPanelPreregistration(plan);
  const req = (condition, message) => { if (!condition) throw new Error(message); };
  req(environment.DAS_ENABLE_PAID_MODEL_CALLS === "JOEL_APPROVED", "Global paid-model approval is absent");
  req(environment.DAS013_PANEL_APPROVAL === PANEL_APPROVAL, "Panel campaign-specific approval is absent");
  req(environment.DAS013_PANEL_PLAN_HASH === plan.planHash, "Panel approval is not bound to the exact preregistration");
  req(environment.DAS013_PANEL_PRICING_HASH === PANEL_PRICING_HASH, "Panel pricing approval hash mismatch");
  req(plan.pricing.validUtcDates.includes(now().toISOString().slice(0, 10)), `Panel run is outside its declared validity window ${plan.pricing.validUtcDates.join("/")}; re-verify pricing and reseal`);
  const a = Number(environment.DAS013_PANEL_PHASE_A_LIMIT_USD);
  const b = Number(environment.DAS013_PANEL_PHASE_B_LIMIT_USD);
  req(a === plan.phases.A.hardCeilingUsd && b === plan.phases.B.hardCeilingUsd, "Panel phase limits must equal the frozen ceilings");
  req(typeof environment.OPENAI_API_KEY === "string" && environment.OPENAI_API_KEY.length >= 20, "Panel needs an API key");
  return Object.freeze({ phaseALimitUsd: a, phaseBLimitUsd: b, planHash: plan.planHash });
}
