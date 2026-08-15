import { digest } from "../core/canonical.js";
import { validateCandidate } from "../compiler/candidate.js";

const ARM_IDS = Object.freeze(["das", "adaptive-engineer"]);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function finiteNonNegative(value, label) {
  requireCondition(Number.isFinite(value) && value >= 0, `${label} must be a finite non-negative number`);
  return Number(value);
}

function positiveInteger(value, label) {
  requireCondition(Number.isInteger(value) && value > 0, `${label} must be a positive integer`);
  return value;
}

function normalizeCases(cases) {
  requireCondition(Array.isArray(cases) && cases.length > 0, "Adaptive engineering needs frozen development cases");
  const ids = new Set();
  return cases.map((entry) => {
    const id = String(entry?.id ?? "").trim();
    requireCondition(id && !ids.has(id), "Development cases need unique non-empty ids");
    requireCondition(entry.payload && typeof entry.payload === "object", `Development case ${id} needs a bounded payload`);
    ids.add(id);
    return Object.freeze({ id, caseHash: digest(entry.payload) });
  });
}

function normalizeModels(models) {
  requireCondition(Array.isArray(models) && models.length > 0, "Adaptive engineering needs at least one allowed model family");
  const values = [...new Set(models.map((item) => String(item).trim()).filter(Boolean))].sort();
  requireCondition(values.length === models.length, "Allowed model families must be unique and non-empty");
  return Object.freeze(values);
}

/**
 * Freezes the rules for a future paired comparison. Raw holdout material is
 * deliberately excluded: only its sealed digest and count enter this object.
 */
export function createAdaptiveEngineeringProtocol({
  id,
  brief,
  importedAgent,
  developmentCases,
  confirmationVault,
  allowedModelFamilies,
  limits = {},
  scoring = {},
}) {
  requireCondition(String(id ?? "").trim(), "Adaptive engineering protocol requires an id");
  requireCondition(brief?.id, "Adaptive engineering protocol requires a bounded role brief");
  requireCondition(brief.successCriteria?.verifierId, "Adaptive engineering protocol requires an independent verifier binding");
  requireCondition(String(confirmationVault?.digest ?? "").length >= 32, "Adaptive engineering protocol requires a sealed confirmation-vault digest");
  positiveInteger(confirmationVault?.count, "Confirmation-vault count");
  const importedPayload = structuredClone(importedAgent ?? {});
  delete importedPayload.fingerprint;
  const importedValidation = validateCandidate(importedPayload, brief);
  requireCondition(importedValidation.valid, `Imported agent failed the bounded candidate contract: ${importedValidation.reasons.join(",")}`);
  requireCondition(!importedAgent?.fingerprint || importedAgent.fingerprint === importedValidation.candidate.fingerprint, "Imported agent fingerprint mismatch");

  const frozenDevelopmentCases = normalizeCases(developmentCases);
  const models = normalizeModels(allowedModelFamilies);
  const perArm = Object.freeze({
    maximumRounds: positiveInteger(limits.maximumRounds ?? 3, "Maximum rounds"),
    beamWidth: positiveInteger(limits.beamWidth ?? 3, "Beam width"),
    maximumChildrenPerParent: positiveInteger(limits.maximumChildrenPerParent ?? 2, "Maximum children per parent"),
    maximumCandidatesEvaluated: positiveInteger(limits.maximumCandidatesEvaluated ?? 18, "Maximum candidates evaluated"),
    maximumEngineeringCalls: positiveInteger(limits.maximumEngineeringCalls ?? 8, "Maximum engineering calls"),
    maximumOperatingCalls: positiveInteger(limits.maximumOperatingCalls ?? 120, "Maximum operating calls"),
    maximumEngineeringSpendUsd: finiteNonNegative(limits.maximumEngineeringSpendUsd ?? 1, "Maximum engineering spend"),
    maximumOperatingSpendUsd: finiteNonNegative(limits.maximumOperatingSpendUsd ?? 2, "Maximum operating spend"),
    maximumWallClockMs: finiteNonNegative(limits.maximumWallClockMs ?? 30 * 60 * 1_000, "Maximum wall clock"),
  });
  requireCondition(perArm.maximumWallClockMs > 0, "Maximum wall clock must be positive");

  const scoreWeights = Object.freeze({
    outcome: finiteNonNegative(scoring.outcome ?? 1, "Outcome weight"),
    passRate: finiteNonNegative(scoring.passRate ?? 1, "Pass-rate weight"),
    operatingCost: finiteNonNegative(scoring.operatingCost ?? 0.2, "Operating-cost weight"),
    latency: finiteNonNegative(scoring.latency ?? 0.1, "Latency weight"),
    humanIntervention: finiteNonNegative(scoring.humanIntervention ?? 0.25, "Human-intervention weight"),
  });

  const core = {
    schemaVersion: "das.adaptive-engineering-protocol.v1",
    id: String(id).trim(),
    arms: ARM_IDS,
    role: {
      id: brief.id,
      briefHash: digest(brief),
      toolsHash: digest(brief.environment?.tools ?? []),
      contextHash: digest(brief.environment?.contextSources ?? []),
      authorityHash: digest(brief.authority ?? {}),
      policyHash: digest(brief.policies ?? {}),
      verifierId: brief.successCriteria.verifierId,
      verifierHash: digest(brief.successCriteria),
    },
    importedAgent: {
      id: importedValidation.candidate.id,
      fingerprint: importedValidation.candidate.fingerprint,
    },
    development: {
      cases: frozenDevelopmentCases,
      caseDigest: digest(frozenDevelopmentCases),
      visibleToBothArms: true,
      feedback: "Independent external-outcome measurements from development cases only.",
    },
    confirmation: {
      count: confirmationVault.count,
      digest: confirmationVault.digest,
      visibleDuringEngineering: false,
      releaseRule: "Release once, only after both arm winners and the imported starting agent are frozen.",
    },
    allowedModelFamilies: models,
    perArmLimits: perArm,
    scoring: scoreWeights,
    invariants: {
      sameImportedStartingAgent: true,
      sameDevelopmentCases: true,
      sameConfirmationCases: true,
      sameToolsContextAuthorityAndVerifier: true,
      modelSwitchAllowedOnlyWithinAllowlist: true,
      safetyHardGate: "Any unsafe attempt or independently verified incorrect side effect makes that candidate ineligible.",
      noCrossArmFeedback: true,
      noConfirmationLeakage: true,
      noAutomaticActivation: true,
    },
    evidenceBoundary: "Frozen zero-spend comparison protocol. It does not contain a comparison result, customer evidence, or permission for paid execution.",
  };
  return Object.freeze({ ...core, protocolHash: digest(core) });
}

export function assertAdaptiveEngineeringProtocol(protocol) {
  requireCondition(protocol?.schemaVersion === "das.adaptive-engineering-protocol.v1", "Unsupported adaptive engineering protocol");
  const copy = structuredClone(protocol);
  const expected = copy.protocolHash;
  delete copy.protocolHash;
  requireCondition(expected && digest(copy) === expected, "Adaptive engineering protocol integrity mismatch");
  requireCondition(digest(protocol.development.cases) === protocol.development.caseDigest, "Development case freeze changed");
  requireCondition(protocol.invariants?.sameImportedStartingAgent === true, "Paired comparison must share one imported starting agent");
  requireCondition(protocol.invariants?.noConfirmationLeakage === true, "Confirmation cases must remain hidden during engineering");
  return protocol;
}

export function assertDevelopmentCasesMatch(protocol, developmentCases) {
  assertAdaptiveEngineeringProtocol(protocol);
  const frozen = normalizeCases(developmentCases);
  requireCondition(digest(frozen) === protocol.development.caseDigest, "Development cases changed after protocol freeze");
  return developmentCases;
}
