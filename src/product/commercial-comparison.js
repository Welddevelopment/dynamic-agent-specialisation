import { digest } from "../core/canonical.js";
import { createCaseVault } from "../evaluation/case-vault.js";
import { assessCommercialReadiness, buildCommercialJobDraft, normalizeCommercialIntake } from "./commercial-intake.js";

const SAFE_ENVIRONMENTS = new Set(["disposable-sandbox", "customer-local-test", "approved-live"]);
const PARTICIPANT_TYPES = new Set(["current-agent", "strong-general", "ordinary-manual", "expert-manual", "compiler-candidate"]);
const STAGES = new Set(["development", "validation", "adversarial", "unseen"]);

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function clean(value, maximum = 240) { return String(value ?? "").trim().slice(0, maximum); }

function normalizeParticipant(participant) {
  const value = {
    id: clean(participant?.id),
    type: PARTICIPANT_TYPES.has(participant?.type) ? participant.type : "",
    label: clean(participant?.label),
    version: clean(participant?.version) || "1",
    configurationHash: clean(participant?.configurationHash, 128),
    runnerId: clean(participant?.runnerId),
  };
  requireCondition(value.id && value.type && value.label && value.configurationHash && value.runnerId, "Every comparison participant needs an id, type, label, configuration hash and verified runner id");
  return value;
}

function normalizeCases(input) {
  const seen = new Set();
  const byStage = { development: [], validation: [], adversarial: [], unseen: [] };
  for (const raw of Array.isArray(input) ? input : []) {
    const id = clean(raw?.id);
    const stage = STAGES.has(raw?.stage) ? raw.stage : "";
    requireCondition(id && stage, "Every comparison case needs a unique id and valid stage");
    requireCondition(!seen.has(id), `Duplicate comparison case id: ${id}`);
    seen.add(id);
    requireCondition(raw.payload && typeof raw.payload === "object", `Comparison case ${id} needs a bounded payload`);
    byStage[stage].push({ id, stage, payload: structuredClone(raw.payload), caseHash: digest(raw.payload) });
  }
  requireCondition(byStage.development.length >= 5, "At least five development cases are required");
  requireCondition(byStage.validation.length >= 2, "At least two validation cases are required");
  requireCondition(byStage.adversarial.length >= 3, "At least three adversarial cases are required");
  requireCondition(byStage.unseen.length >= 2, "At least two sealed unseen cases are required");
  return byStage;
}

function normalizeDriver(driver, intake) {
  requireCondition(driver && typeof driver === "object", "A comparison driver is required");
  const value = {
    id: clean(driver.id), version: clean(driver.version), templateId: clean(driver.templateId),
    environment: SAFE_ENVIRONMENTS.has(driver.environment) ? driver.environment : "",
    status: driver.status === "verified" ? "verified" : "",
    operationNames: [...new Set((driver.operationNames ?? []).map((item) => clean(item)).filter(Boolean))].sort(),
    verifier: { id: clean(driver.verifier?.id), status: driver.verifier?.status === "verified" ? "verified" : "", independent: driver.verifier?.independent === true },
    systemBindings: (driver.systemBindings ?? []).map((binding) => ({ systemId: clean(binding.systemId), adapterId: clean(binding.adapterId), adapterVersion: clean(binding.adapterVersion), status: binding.status === "verified" ? "verified" : "" })),
  };
  requireCondition(value.id && value.version && value.templateId === intake.role.templateId, "The verified driver must match the selected role template");
  requireCondition(value.environment && value.status === "verified", "The comparison driver must use a verified bounded environment");
  requireCondition(value.operationNames.length > 0, "The comparison driver must declare its bounded operations");
  requireCondition(value.verifier.id && value.verifier.status === "verified" && value.verifier.independent, "The comparison driver needs a verified independent verifier");
  const bindings = new Map(value.systemBindings.map((binding) => [binding.systemId, binding]));
  for (const system of intake.systems) {
    const binding = bindings.get(system.id);
    requireCondition(binding?.adapterId && binding?.adapterVersion && binding.status === "verified", `System ${system.name} is not bound to a verified comparison adapter`);
  }
  return value;
}

function normalizedThresholds(input) {
  const value = {
    minimumOutcomeImprovement: Number(input?.minimumOutcomeImprovement ?? 0),
    minimumCostReduction: Number(input?.minimumCostReduction ?? 0),
    minimumSpeedReduction: Number(input?.minimumSpeedReduction ?? 0),
    maximumUnsafeAttempts: Number(input?.maximumUnsafeAttempts ?? 0),
    maximumIncorrectSideEffects: Number(input?.maximumIncorrectSideEffects ?? 0),
    minimumRepeatRuns: Number(input?.minimumRepeatRuns ?? 3),
  };
  requireCondition(value.minimumOutcomeImprovement >= 0 && value.minimumOutcomeImprovement <= 1, "Outcome improvement threshold must be between 0 and 1");
  requireCondition(value.minimumCostReduction >= 0 && value.minimumCostReduction <= 1, "Cost-reduction threshold must be between 0 and 1");
  requireCondition(value.minimumSpeedReduction >= 0 && value.minimumSpeedReduction <= 1, "Speed-reduction threshold must be between 0 and 1");
  requireCondition(value.maximumUnsafeAttempts === 0 && value.maximumIncorrectSideEffects === 0, "Commercial comparison safety gates cannot be weakened");
  requireCondition(Number.isInteger(value.minimumRepeatRuns) && value.minimumRepeatRuns >= 3, "At least three fresh repeat runs are required");
  return value;
}

function normalizedBudget(input) {
  const value = { maximumModelSpendUsd: Number(input?.maximumModelSpendUsd), maximumWallClockMs: Number(input?.maximumWallClockMs), maximumCandidates: Number(input?.maximumCandidates) };
  requireCondition(Number.isFinite(value.maximumModelSpendUsd) && value.maximumModelSpendUsd >= 0, "A hard non-negative model-spend limit is required");
  requireCondition(Number.isFinite(value.maximumWallClockMs) && value.maximumWallClockMs > 0, "A hard comparison time limit is required");
  requireCondition(Number.isInteger(value.maximumCandidates) && value.maximumCandidates >= 3 && value.maximumCandidates <= 30, "Comparison candidate count must stay between 3 and 30");
  return value;
}

function seal(record) {
  const serialized = JSON.parse(JSON.stringify(record));
  requireCondition(digest(serialized) === digest(record), "Commercial comparison contains a value that cannot survive JSON persistence");
  return { ...record, freezeHash: digest(record) };
}

export function createCommercialComparisonFreeze({ intake: input, driver, cases, participants, thresholds, budget }) {
  const intake = normalizeCommercialIntake(input);
  const readiness = assessCommercialReadiness(intake);
  requireCondition(readiness.stages.comparison.ready, "The commercial role is not ready for a fair comparison");
  const roleDraft = buildCommercialJobDraft(intake);
  const normalizedDriver = normalizeDriver(driver, intake);
  const caseGroups = normalizeCases(cases);
  const normalizedParticipants = (participants ?? []).map(normalizeParticipant);
  requireCondition(new Set(normalizedParticipants.map((item) => item.id)).size === normalizedParticipants.length, "Comparison participant ids must be unique");
  const types = new Set(normalizedParticipants.map((item) => item.type));
  requireCondition(types.has("strong-general") && types.has("ordinary-manual") && types.has("expert-manual"), "Strong-general, ordinary-manual and expert-manual baselines are mandatory");
  if (intake.currentAgent.mode === "provided") requireCondition(types.has("current-agent"), "The supplied current agent must be included in the comparison");
  const normalizedLimits = normalizedBudget(budget);
  requireCondition(normalizedParticipants.filter((item) => item.type === "compiler-candidate").length <= normalizedLimits.maximumCandidates, "Frozen compiler candidates exceed the comparison candidate limit");
  const unseenVault = createCaseVault(`commercial:${intake.sessionId}`, caseGroups.unseen.map((item) => item.payload));
  const record = {
    schemaVersion: "das.commercial-comparison-freeze.v1",
    sessionId: intake.sessionId,
    intakeHash: digest(intake),
    roleDraftHash: digest(roleDraft.compiled.brief),
    templateId: intake.role.templateId,
    driver: normalizedDriver,
    cases: {
      development: caseGroups.development.map(({ id, stage, payload, caseHash }) => ({ id, stage, payload, caseHash })),
      validation: caseGroups.validation.map(({ id, stage, payload, caseHash }) => ({ id, stage, payload, caseHash })),
      adversarial: caseGroups.adversarial.map(({ id, stage, payload, caseHash }) => ({ id, stage, payload, caseHash })),
      unseen: { count: unseenVault.count, digest: unseenVault.digest, caseHashes: caseGroups.unseen.map(({ id, caseHash }) => ({ id, caseHash })) },
    },
    participants: normalizedParticipants,
    priorities: { quality: intake.priorities.quality, cost: intake.priorities.cost, speed: intake.priorities.speed },
    thresholds: normalizedThresholds(thresholds),
    budget: normalizedLimits,
    evidenceBoundary: "Frozen comparison contract only. No candidate has run and no improvement is proved.",
  };
  return { contract: Object.freeze(seal(record)), unseenVault };
}

export function assertCommercialComparisonFreeze(contract) {
  const copy = structuredClone(contract);
  const expected = copy.freezeHash;
  delete copy.freezeHash;
  requireCondition(expected && digest(copy) === expected, "Commercial comparison freeze changed after commitment");
  return true;
}

export function releaseCommercialUnseen({ contract, unseenVault, preUnseenReceipt }) {
  assertCommercialComparisonFreeze(contract);
  requireCondition(preUnseenReceipt?.contractFreezeHash === contract.freezeHash, "Pre-unseen receipt must bind to the exact comparison freeze");
  requireCondition(preUnseenReceipt?.validationPassed === true && preUnseenReceipt?.adversarialPassed === true, "Validation and adversarial gates must pass before unseen release");
  requireCondition(preUnseenReceipt?.unsafeAttempts === 0 && preUnseenReceipt?.incorrectSideEffects === 0, "Unsafe or incorrect evidence blocks unseen release");
  const candidateHashes = Object.fromEntries(contract.participants.filter((item) => item.type === "compiler-candidate").map((item) => [item.id, item.configurationHash]));
  const baselineHashes = Object.fromEntries(contract.participants.filter((item) => item.type !== "compiler-candidate").map((item) => [item.id, item.configurationHash]));
  requireCondition(Object.keys(candidateHashes).length > 0, "At least one compiler candidate must be frozen before unseen release");
  return unseenVault.release({ freezeHash: contract.freezeHash, role: `commercial:${contract.sessionId}`, candidateHashes, baselineHashes });
}
