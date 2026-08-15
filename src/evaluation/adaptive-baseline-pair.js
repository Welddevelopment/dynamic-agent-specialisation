import { digest } from "../core/canonical.js";
import { validateCandidate } from "../compiler/candidate.js";
import { assertAdaptiveEngineeringProtocol, assertDevelopmentCasesMatch } from "./adaptive-engineering-protocol.js";
import { AdaptiveEngineerController, assertAdaptiveEngineerResult, normalizeAdaptiveObservations, summarizeAdaptiveCandidate } from "./adaptive-engineer-controller.js";
import { PairedResourceGovernor } from "./paired-resource-governor.js";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function finiteNonNegative(value, label) {
  requireCondition(Number.isFinite(value) && value >= 0, `${label} must be a finite non-negative number`);
  return Number(value);
}

function validatedImportedAgent(importedAgent, brief, protocol) {
  const payload = structuredClone(importedAgent);
  delete payload.fingerprint;
  const validation = validateCandidate(payload, brief);
  requireCondition(validation.valid, `Imported agent failed the pair contract: ${validation.reasons.join(",")}`);
  requireCondition(validation.candidate.fingerprint === protocol.importedAgent.fingerprint, "Pair imported agent changed after freeze");
  return validation.candidate;
}

export function freezeAdaptiveBaselinePair({ protocol, importedAgent, armResults }) {
  assertAdaptiveEngineeringProtocol(protocol);
  requireCondition(armResults && protocol.arms.every((armId) => armResults[armId]), "Both paired development results are required before freezing winners");
  const results = Object.fromEntries(protocol.arms.map((armId) => {
    const result = assertAdaptiveEngineerResult(armResults[armId], protocol);
    requireCondition(result.armId === armId, `Adaptive result is filed under the wrong arm: ${armId}`);
    return [armId, result];
  }));
  const selected = Object.fromEntries(protocol.arms.map((armId) => [armId, results[armId].selected ? {
    candidateId: results[armId].selected.candidate.id,
    candidateFingerprint: results[armId].selected.candidate.fingerprint,
    developmentRecordHash: results[armId].selected.developmentRecordHash,
  } : null]));
  const core = {
    schemaVersion: "das.adaptive-baseline-pair-freeze.v1",
    protocolHash: protocol.protocolHash,
    importedAgentFingerprint: importedAgent.fingerprint,
    armResultHashes: Object.fromEntries(protocol.arms.map((armId) => [armId, results[armId].resultHash])),
    selected,
    developmentCaseDigest: protocol.development.caseDigest,
    confirmationVaultDigest: protocol.confirmation.digest,
    confirmationVaultCount: protocol.confirmation.count,
    commonResourceLimitsHash: digest(protocol.perArmLimits),
    noFallbackAfterConfirmation: true,
  };
  return Object.freeze({ ...core, freezeHash: digest(core) });
}

export function assertAdaptiveBaselinePairFreeze(freeze, protocol) {
  assertAdaptiveEngineeringProtocol(protocol);
  requireCondition(freeze?.schemaVersion === "das.adaptive-baseline-pair-freeze.v1", "Unsupported adaptive pair freeze");
  const copy = structuredClone(freeze);
  const expected = copy.freezeHash;
  delete copy.freezeHash;
  requireCondition(expected && digest(copy) === expected, "Adaptive pair freeze integrity mismatch");
  requireCondition(freeze.protocolHash === protocol.protocolHash, "Adaptive pair freeze belongs to another protocol");
  requireCondition(freeze.confirmationVaultDigest === protocol.confirmation.digest && freeze.confirmationVaultCount === protocol.confirmation.count, "Adaptive pair confirmation vault changed after freeze");
  return freeze;
}

export class AdaptiveBaselinePair {
  constructor({ protocol, brief, designers, developmentEvaluator, confirmationEvaluator, now = () => Date.now(), evidence = null }) {
    this.protocol = assertAdaptiveEngineeringProtocol(protocol);
    requireCondition(digest(brief) === this.protocol.role.briefHash, "Adaptive pair brief changed after freeze");
    requireCondition(this.protocol.arms.every((armId) => designers?.[armId]), "Adaptive pair requires a designer for both arms");
    requireCondition(developmentEvaluator && confirmationEvaluator, "Adaptive pair needs common development and confirmation evaluators");
    this.brief = brief;
    this.designers = designers;
    this.developmentEvaluator = developmentEvaluator;
    this.confirmationEvaluator = confirmationEvaluator;
    this.now = now;
    this.evidence = evidence;
  }

  async #confirm({ armId, candidate, cases, governor }) {
    const estimate = await this.confirmationEvaluator.estimate({ armId, candidate: structuredClone(candidate), cases: structuredClone(cases), stage: "common-confirmation" });
    const reservation = governor.reserve({ armId, kind: "operating", projectedUsd: finiteNonNegative(estimate.maximumUsd, "Confirmation estimate"), projectedCalls: estimate.maximumCalls, purpose: `common-confirmation:${candidate.id}` });
    let response;
    try {
      response = await this.confirmationEvaluator.evaluate({ armId, candidate: structuredClone(candidate), cases: structuredClone(cases), stage: "common-confirmation" });
      governor.settle({ reservation, actualUsd: finiteNonNegative(response.accounting?.actualUsd ?? 0, "Confirmation actual spend"), actualCalls: response.accounting?.actualCalls ?? 0 });
    } catch (error) {
      governor.cancel(reservation);
      throw error;
    }
    const rows = normalizeAdaptiveObservations(response.observations, { candidate, expectedCaseIds: cases.map((item) => item.id), verifierId: this.protocol.role.verifierId });
    const summary = summarizeAdaptiveCandidate(candidate, rows, this.protocol.scoring);
    return Object.freeze({ armId, candidateId: candidate.id, candidateFingerprint: candidate.fingerprint, rows, summary, confirmationHash: digest({ armId, candidateFingerprint: candidate.fingerprint, rows, summary }) });
  }

  async run({ importedAgent, developmentCases, confirmationVault }) {
    assertDevelopmentCasesMatch(this.protocol, developmentCases);
    requireCondition(confirmationVault?.digest === this.protocol.confirmation.digest && confirmationVault?.count === this.protocol.confirmation.count, "Pair received another confirmation vault");
    requireCondition(typeof confirmationVault.release === "function", "Confirmation vault cannot be released through the bounded interface");
    const imported = validatedImportedAgent(importedAgent, this.brief, this.protocol);
    const governor = new PairedResourceGovernor({ protocol: this.protocol, now: this.now });
    const armResults = {};
    for (const armId of this.protocol.arms) {
      const controller = new AdaptiveEngineerController({ protocol: this.protocol, brief: this.brief, armId, designer: this.designers[armId], evaluator: this.developmentEvaluator, governor, now: this.now, evidence: this.evidence });
      armResults[armId] = await controller.run({ importedAgent: imported, developmentCases });
    }
    const freeze = freezeAdaptiveBaselinePair({ protocol: this.protocol, importedAgent: imported, armResults });
    assertAdaptiveBaselinePairFreeze(freeze, this.protocol);
    const missingWinner = this.protocol.arms.find((armId) => !freeze.selected[armId]);
    if (missingWinner) {
      const result = {
        schemaVersion: "das.adaptive-baseline-pair-result.v1",
        protocolHash: this.protocol.protocolHash,
        freeze,
        armResults,
        confirmation: null,
        status: "confirmation-not-released",
        reason: `${missingWinner} produced no safe development winner`,
        confirmationReleaseCount: 0,
        automaticActivation: false,
        evidenceBoundary: "Valid negative development result; fresh confirmation remained sealed.",
      };
      result.resultHash = digest(result);
      return Object.freeze(result);
    }

    const candidatesByArm = Object.fromEntries(this.protocol.arms.map((armId) => [armId, armResults[armId].selected.candidate]));
    const candidateHashes = Object.fromEntries(this.protocol.arms.map((armId) => [`${armId}:${candidatesByArm[armId].id}`, candidatesByArm[armId].fingerprint]));
    const payloads = confirmationVault.release({ freezeHash: freeze.freezeHash, role: `adaptive-pair:${this.protocol.role.id}`, candidateHashes, baselineHashes: { imported: imported.fingerprint } });
    requireCondition(Array.isArray(payloads) && payloads.length === this.protocol.confirmation.count, "Confirmation vault released the wrong case count");
    const confirmationCases = payloads.map((payload, index) => Object.freeze({ id: `confirmation-${index + 1}`, payload: structuredClone(payload) }));
    const confirmation = {};
    for (const armId of this.protocol.arms) confirmation[armId] = await this.#confirm({ armId, candidate: candidatesByArm[armId], cases: confirmationCases, governor });
    const resources = Object.fromEntries(this.protocol.arms.map((armId) => [armId, governor.assertSettled(armId)]));
    const safe = Object.fromEntries(this.protocol.arms.map((armId) => [armId, confirmation[armId].summary.safe]));
    const scoreDelta = safe.das && safe["adaptive-engineer"] ? confirmation.das.summary.score - confirmation["adaptive-engineer"].summary.score : null;
    const status = safe.das || safe["adaptive-engineer"] ? "common-confirmation-complete" : "both-frozen-winners-failed-confirmation";
    const result = {
      schemaVersion: "das.adaptive-baseline-pair-result.v1",
      protocolHash: this.protocol.protocolHash,
      freeze,
      armResults,
      confirmation,
      resources,
      status,
      scoreDeltaDasMinusAdaptiveEngineer: scoreDelta,
      confirmationReleaseCount: 1,
      noFallbackWinner: true,
      automaticActivation: false,
      strongestSupportedQuestion: "Under one frozen fictional role and equal resources, which complete adaptive engineering procedure produced the stronger independently verified safe frozen specialist?",
      forbiddenInference: ["Generality across roles", "Customer value", "Production reliability", "Universal superiority over agent frameworks"],
      evidenceBoundary: "Prospective paired local comparison receipt. A result is meaningful only for its exact frozen role, procedures, resources, cases and verifier.",
    };
    result.resultHash = digest(result);
    this.evidence?.append("adaptive-baseline-pair.completed", { resultHash: result.resultHash, status, scoreDeltaDasMinusAdaptiveEngineer: scoreDelta });
    return Object.freeze(result);
  }
}

export function assertAdaptiveBaselinePairResult(result, protocol) {
  assertAdaptiveEngineeringProtocol(protocol);
  requireCondition(result?.schemaVersion === "das.adaptive-baseline-pair-result.v1", "Unsupported adaptive baseline pair result");
  const copy = structuredClone(result);
  const expected = copy.resultHash;
  delete copy.resultHash;
  requireCondition(expected && digest(copy) === expected, "Adaptive baseline pair result integrity mismatch");
  requireCondition(result.protocolHash === protocol.protocolHash, "Adaptive baseline pair result belongs to another protocol");
  requireCondition(result.automaticActivation === false, "Adaptive pair cannot activate a specialist");
  return result;
}

