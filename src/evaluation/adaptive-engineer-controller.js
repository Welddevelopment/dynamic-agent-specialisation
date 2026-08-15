import { digest } from "../core/canonical.js";
import { differenceDimensions, validateCandidate } from "../compiler/candidate.js";
import { assertAdaptiveEngineeringProtocol, assertDevelopmentCasesMatch } from "./adaptive-engineering-protocol.js";
import { analyzeCandidateDiversity, candidateDesignFingerprint, selectDiverseCandidates } from "../experiments/candidate-scale/diversity.js";

const ACTIONS = new Set(["retain", "revise", "switch-model", "fork"]);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function finiteNonNegative(value, label) {
  requireCondition(Number.isFinite(value) && value >= 0, `${label} must be a finite non-negative number`);
  return Number(value);
}

function candidatePayload(candidate) {
  const value = structuredClone(candidate);
  delete value.fingerprint;
  return value;
}

function validateBoundedCandidate(candidate, brief) {
  const validation = validateCandidate(candidatePayload(candidate), brief);
  requireCondition(validation.valid, `Adaptive engineer candidate failed the bounded contract: ${validation.reasons.join(",")}`);
  requireCondition(!candidate.fingerprint || candidate.fingerprint === validation.candidate.fingerprint, "Adaptive engineer candidate fingerprint mismatch");
  return validation.candidate;
}

function candidateInvariantSummary(candidate) {
  return {
    roleId: candidate.roleId,
    verifier: candidate.verifier,
    authority: candidate.authority,
    tools: candidate.tools,
    context: candidate.context,
    modelFamily: candidate.model?.family,
  };
}

export function assertAdaptiveEngineerAction({ protocol, brief, parent, action }) {
  assertAdaptiveEngineeringProtocol(protocol);
  requireCondition(ACTIONS.has(action?.kind), `Unsupported adaptive engineer action: ${action?.kind}`);
  requireCondition(parent?.fingerprint, "Adaptive engineer action requires a frozen parent");
  requireCondition(action.parentFingerprint === parent.fingerprint, "Adaptive engineer action is not bound to its parent");
  requireCondition(String(action.rationale ?? "").trim(), "Adaptive engineer action requires a rationale");
  if (action.kind === "retain") {
    requireCondition(!action.candidate || action.candidate.fingerprint === parent.fingerprint, "Retain action cannot substitute another candidate");
    return Object.freeze({ kind: "retain", parentFingerprint: parent.fingerprint, candidate: parent, differences: Object.freeze([]), rationale: String(action.rationale) });
  }

  const candidate = validateBoundedCandidate(action.candidate, brief);
  requireCondition(candidate.fingerprint !== parent.fingerprint, `${action.kind} action produced no material change`);
  requireCondition(protocol.allowedModelFamilies.includes(candidate.model?.family), `Model family ${candidate.model?.family} is outside the frozen allowlist`);
  requireCondition(candidate.verifier?.kind === "independent-external-state" && candidate.verifier?.binding === protocol.role.verifierId, "Adaptive action changed the independent verifier");
  requireCondition(candidate.roleId === protocol.role.id, "Adaptive action changed the role");
  requireCondition((candidate.tools ?? []).every((tool) => (brief.environment?.tools ?? []).includes(tool)), "Adaptive action introduced an unknown tool");
  requireCondition((candidate.context?.sources ?? []).every((source) => (brief.environment?.contextSources ?? []).includes(source)), "Adaptive action introduced an unknown context source");
  requireCondition((candidate.authority?.allowedActions ?? []).every((entry) => (brief.authority?.allowedActions ?? []).includes(entry)), "Adaptive action widened the authority ceiling");
  requireCondition(candidate.provenance?.parents?.includes(parent.fingerprint), "Adaptive action lacks exact parent lineage");
  const differences = differenceDimensions(parent, candidate);
  requireCondition(differences.length > 0, `${action.kind} action produced no scored configuration difference`);
  if (action.kind === "revise") requireCondition(candidate.model?.family === parent.model?.family, "Revise action cannot silently switch model family");
  if (action.kind === "switch-model") {
    requireCondition(candidate.model?.family !== parent.model?.family, "Switch-model action did not switch model family");
    requireCondition(differences.every((dimension) => dimension === "model"), "Switch-model action may change only the model configuration");
  }
  return Object.freeze({ kind: action.kind, parentFingerprint: parent.fingerprint, candidate, differences: Object.freeze(differences), rationale: String(action.rationale) });
}

function normalizeObservation(raw, { candidate, expectedCaseIds, verifierId, index }) {
  const row = {
    candidateId: String(raw?.candidateId ?? ""),
    candidateFingerprint: String(raw?.candidateFingerprint ?? ""),
    caseId: String(raw?.caseId ?? ""),
    verifierId: String(raw?.verifierId ?? ""),
    verifierKind: String(raw?.verifierKind ?? ""),
    independentlyVerified: raw?.independentlyVerified === true,
    passed: raw?.passed === true,
    outcomeScore: Number(raw?.outcomeScore),
    unsafeAttempts: Number(raw?.unsafeAttempts ?? 0),
    incorrectSideEffects: Number(raw?.incorrectSideEffects ?? 0),
    modelCostUsd: Number(raw?.modelCostUsd ?? 0),
    elapsedMs: Number(raw?.elapsedMs ?? 0),
    toolCalls: Number(raw?.toolCalls ?? 0),
    humanInterventions: Number(raw?.humanInterventions ?? 0),
    verificationReceiptHash: String(raw?.verificationReceiptHash ?? raw?.receiptHash ?? ""),
    verification: structuredClone(raw?.verification ?? null),
  };
  requireCondition(row.candidateId === candidate.id && row.candidateFingerprint === candidate.fingerprint, "Development observation belongs to another candidate");
  requireCondition(row.caseId === expectedCaseIds[index], "Development observations changed order or crossed the frozen case boundary");
  requireCondition(row.verifierId === verifierId && row.verifierKind === "independent-external-state" && row.independentlyVerified, "Development observation lacks the frozen independent verifier");
  requireCondition(row.verificationReceiptHash, "Development observation requires an independent receipt hash");
  for (const field of ["outcomeScore", "unsafeAttempts", "incorrectSideEffects", "modelCostUsd", "elapsedMs", "toolCalls", "humanInterventions"]) finiteNonNegative(row[field], field);
  requireCondition(row.outcomeScore <= 1, "Outcome score cannot exceed one");
  return Object.freeze(row);
}

export function normalizeAdaptiveObservations(rawRows, { candidate, expectedCaseIds, verifierId }) {
  requireCondition(Array.isArray(rawRows) && rawRows.length > 0, "Development evaluation returned no observations");
  requireCondition(rawRows.length <= expectedCaseIds.length, "Development evaluation returned cases outside the freeze");
  const rows = rawRows.map((row, index) => normalizeObservation(row, { candidate, expectedCaseIds, verifierId, index }));
  const hardFailureIndex = rows.findIndex((row) => row.unsafeAttempts > 0 || row.incorrectSideEffects > 0);
  if (hardFailureIndex >= 0) requireCondition(hardFailureIndex === rows.length - 1, "Candidate continued after a hard safety failure");
  else requireCondition(rows.length === expectedCaseIds.length, "Safe candidate did not complete every frozen development case");
  return Object.freeze(rows);
}

export function summarizeAdaptiveCandidate(candidate, rows, weights) {
  const count = rows.length;
  const passCount = rows.filter((row) => row.passed).length;
  const summary = {
    candidateId: candidate.id,
    candidateFingerprint: candidate.fingerprint,
    observations: count,
    passRate: passCount / count,
    meanOutcomeScore: rows.reduce((sum, row) => sum + row.outcomeScore, 0) / count,
    unsafeAttempts: rows.reduce((sum, row) => sum + row.unsafeAttempts, 0),
    incorrectSideEffects: rows.reduce((sum, row) => sum + row.incorrectSideEffects, 0),
    operatingCostUsd: rows.reduce((sum, row) => sum + row.modelCostUsd, 0),
    meanElapsedMs: rows.reduce((sum, row) => sum + row.elapsedMs, 0) / count,
    humanInterventions: rows.reduce((sum, row) => sum + row.humanInterventions, 0),
  };
  summary.safe = summary.unsafeAttempts === 0 && summary.incorrectSideEffects === 0;
  summary.score = summary.safe
    ? summary.meanOutcomeScore * weights.outcome + summary.passRate * weights.passRate - summary.operatingCostUsd * weights.operatingCost - (summary.meanElapsedMs / 1_000) * weights.latency - summary.humanInterventions * weights.humanIntervention
    : -Infinity;
  return Object.freeze(summary);
}

function publicFeedback(record) {
  return Object.freeze({
    candidateId: record.candidate.id,
    candidateFingerprint: record.candidate.fingerprint,
    summary: record.summary,
    cases: record.rows.map((row) => ({
      caseId: row.caseId,
      passed: row.passed,
      outcomeScore: row.outcomeScore,
      unsafeAttempts: row.unsafeAttempts,
      incorrectSideEffects: row.incorrectSideEffects,
      modelCostUsd: row.modelCostUsd,
      elapsedMs: row.elapsedMs,
      toolCalls: row.toolCalls,
      humanInterventions: row.humanInterventions,
      verificationReceiptHash: row.verificationReceiptHash,
      verification: row.verification,
    })),
  });
}

function rank(records) {
  return [...records].sort((left, right) => right.summary.score - left.summary.score || right.summary.meanOutcomeScore - left.summary.meanOutcomeScore || left.summary.operatingCostUsd - right.summary.operatingCostUsd || left.candidate.id.localeCompare(right.candidate.id));
}

function selectDiverseBeam(records, maximum) {
  const byFingerprint = new Map(records.map((record) => [record.candidate.fingerprint, record]));
  return selectDiverseCandidates(records.map((record) => record.candidate), (candidate) => byFingerprint.get(candidate.fingerprint).summary.score, maximum)
    .map((candidate) => byFingerprint.get(candidate.fingerprint));
}

export class AdaptiveEngineerController {
  constructor({ protocol, brief, armId, designer, evaluator, governor, now = () => Date.now(), evidence = null }) {
    this.protocol = assertAdaptiveEngineeringProtocol(protocol);
    requireCondition(this.protocol.arms.includes(armId), `Unknown paired arm: ${armId}`);
    requireCondition(digest(brief) === this.protocol.role.briefHash, "Adaptive controller brief changed after freeze");
    for (const method of ["estimate", "propose"]) requireCondition(typeof designer?.[method] === "function", `Adaptive designer is missing ${method}`);
    for (const method of ["estimate", "evaluate"]) requireCondition(typeof evaluator?.[method] === "function", `Adaptive evaluator is missing ${method}`);
    requireCondition(governor, "Adaptive controller requires the paired resource governor");
    this.brief = brief;
    this.armId = armId;
    this.designer = designer;
    this.evaluator = evaluator;
    this.governor = governor;
    this.now = now;
    this.evidence = evidence;
  }

  async #evaluate(candidate, developmentCases, round) {
    const estimate = await this.evaluator.estimate({ armId: this.armId, candidate: structuredClone(candidate), cases: structuredClone(developmentCases), round });
    const reservation = this.governor.reserve({ armId: this.armId, kind: "operating", projectedUsd: finiteNonNegative(estimate.maximumUsd, "Evaluation estimate"), projectedCalls: estimate.maximumCalls, purpose: `development-round-${round}:${candidate.id}` });
    let response;
    try {
      response = await this.evaluator.evaluate({ armId: this.armId, candidate: structuredClone(candidate), cases: structuredClone(developmentCases), round, confirmationMaterial: null });
      this.governor.settle({ reservation, actualUsd: finiteNonNegative(response.accounting?.actualUsd ?? 0, "Evaluation actual spend"), actualCalls: response.accounting?.actualCalls ?? 0 });
    } catch (error) {
      this.governor.cancel(reservation);
      throw error;
    }
    const rows = normalizeAdaptiveObservations(response.observations, { candidate, expectedCaseIds: developmentCases.map((item) => item.id), verifierId: this.protocol.role.verifierId });
    const summary = summarizeAdaptiveCandidate(candidate, rows, this.protocol.scoring);
    const record = Object.freeze({ candidate, rows, summary, round, recordHash: digest({ candidateFingerprint: candidate.fingerprint, rows, summary, round }) });
    this.evidence?.append("adaptive-engineer.candidate-evaluated", { armId: this.armId, candidateId: candidate.id, round, recordHash: record.recordHash, safe: summary.safe });
    return record;
  }

  async run({ importedAgent, developmentCases }) {
    assertDevelopmentCasesMatch(this.protocol, developmentCases);
    const imported = validateBoundedCandidate(importedAgent, this.brief);
    requireCondition(imported.fingerprint === this.protocol.importedAgent.fingerprint, "Adaptive arm did not start from the frozen imported agent");
    requireCondition(this.protocol.allowedModelFamilies.includes(imported.model?.family), "Imported agent model is outside the frozen allowlist");

    const startedAtMs = this.now();
    const evaluated = new Map();
    const evaluatedDesigns = new Map();
    const actionReceipts = [];
    const rejections = [];
    let candidatesEvaluated = 0;
    let beam = [];
    let stopReason = "maximum-rounds-reached";

    const evaluateOnce = async (candidate, round) => {
      if (evaluated.has(candidate.fingerprint)) return evaluated.get(candidate.fingerprint);
      requireCondition(candidatesEvaluated < this.protocol.perArmLimits.maximumCandidatesEvaluated, `${this.armId} crossed its candidate-evaluation allowance`);
      const record = await this.#evaluate(candidate, developmentCases, round);
      evaluated.set(candidate.fingerprint, record);
      evaluatedDesigns.set(candidateDesignFingerprint(candidate), candidate.fingerprint);
      candidatesEvaluated += 1;
      return record;
    };

    beam = [await evaluateOnce(imported, 0)].filter((record) => record.summary.safe);
    for (let round = 1; round <= this.protocol.perArmLimits.maximumRounds; round += 1) {
      if (!beam.length) { stopReason = "no-safe-candidate"; break; }
      requireCondition(this.now() - startedAtMs <= this.protocol.perArmLimits.maximumWallClockMs, `${this.armId} crossed its wall-clock allowance`);
      const feedback = rank(beam).map(publicFeedback);
      const estimate = await this.designer.estimate({ armId: this.armId, round, beam: beam.map((record) => candidateInvariantSummary(record.candidate)), maximumActions: this.protocol.perArmLimits.beamWidth * this.protocol.perArmLimits.maximumChildrenPerParent });
      const reservation = this.governor.reserve({ armId: this.armId, kind: "engineering", projectedUsd: finiteNonNegative(estimate.maximumUsd, "Design estimate"), projectedCalls: estimate.maximumCalls, purpose: `adaptive-design-round-${round}` });
      let response;
      try {
        response = await this.designer.propose({
          armId: this.armId,
          round,
          parents: beam.map((record) => structuredClone(record.candidate)),
          developmentFeedback: feedback,
          allowedModelFamilies: [...this.protocol.allowedModelFamilies],
          maximumChildrenPerParent: this.protocol.perArmLimits.maximumChildrenPerParent,
          hiddenCases: null,
        });
        this.governor.settle({ reservation, actualUsd: finiteNonNegative(response.accounting?.actualUsd ?? 0, "Design actual spend"), actualCalls: response.accounting?.actualCalls ?? 0 });
      } catch (error) {
        this.governor.cancel(reservation);
        throw error;
      }
      requireCondition(Array.isArray(response.actions), "Adaptive designer must return actions");
      requireCondition(response.actions.length <= this.protocol.perArmLimits.beamWidth * this.protocol.perArmLimits.maximumChildrenPerParent, "Adaptive designer returned too many actions");

      const parentByFingerprint = new Map(beam.map((record) => [record.candidate.fingerprint, record.candidate]));
      const next = [...beam];
      let acceptedNew = 0;
      for (const rawAction of response.actions) {
        const parent = parentByFingerprint.get(rawAction.parentFingerprint);
        if (!parent) {
          rejections.push({ round, reason: "unknown-parent", actionHash: digest(rawAction) });
          continue;
        }
        let action;
        try {
          action = assertAdaptiveEngineerAction({ protocol: this.protocol, brief: this.brief, parent, action: rawAction });
        } catch (error) {
          rejections.push({ round, reason: error instanceof Error ? error.message : String(error), actionHash: digest(rawAction) });
          continue;
        }
        if (action.kind === "retain") {
          actionReceipts.push({ round, kind: "retain", parentFingerprint: parent.fingerprint, candidateFingerprint: parent.fingerprint, differences: [], rationale: action.rationale });
          continue;
        }
        const designFingerprint = candidateDesignFingerprint(action.candidate);
        if (evaluated.has(action.candidate.fingerprint) || evaluatedDesigns.has(designFingerprint)) {
          rejections.push({ round, reason: "exact-duplicate-candidate", actionHash: digest(rawAction), candidateFingerprint: action.candidate.fingerprint, designFingerprint, inheritedFromFingerprint: evaluatedDesigns.get(designFingerprint) ?? action.candidate.fingerprint });
          continue;
        }
        if (candidatesEvaluated >= this.protocol.perArmLimits.maximumCandidatesEvaluated) {
          rejections.push({ round, reason: "candidate-evaluation-allowance-exhausted", actionHash: digest(rawAction), candidateFingerprint: action.candidate.fingerprint });
          continue;
        }
        const record = await evaluateOnce(action.candidate, round);
        actionReceipts.push({ round, kind: action.kind, parentFingerprint: parent.fingerprint, candidateFingerprint: action.candidate.fingerprint, differences: action.differences, rationale: action.rationale, evaluationRecordHash: record.recordHash });
        acceptedNew += 1;
        if (record.summary.safe) next.push(record);
        else rejections.push({ round, reason: record.summary.unsafeAttempts > 0 ? "unsafe-attempt" : "incorrect-side-effect", candidateFingerprint: action.candidate.fingerprint, evaluationRecordHash: record.recordHash });
      }
      beam = selectDiverseBeam([...new Map(next.map((record) => [record.candidate.fingerprint, record])).values()], this.protocol.perArmLimits.beamWidth);
      if (acceptedNew === 0) { stopReason = "no-new-valid-candidate"; break; }
      if (round === this.protocol.perArmLimits.maximumRounds) stopReason = "maximum-rounds-reached";
    }

    const ranked = rank([...evaluated.values()].filter((record) => record.summary.safe));
    const selected = ranked[0] ?? null;
    const resources = this.governor.assertSettled(this.armId);
    const result = {
      schemaVersion: "das.adaptive-engineer-result.v1",
      protocolHash: this.protocol.protocolHash,
      armId: this.armId,
      importedAgentFingerprint: imported.fingerprint,
      selected: selected ? { candidate: selected.candidate, summary: selected.summary, developmentRecordHash: selected.recordHash } : null,
      evaluated: [...evaluated.values()].map((record) => ({ candidate: record.candidate, summary: record.summary, rows: record.rows, round: record.round, recordHash: record.recordHash })),
      actions: actionReceipts,
      rejections,
      resources,
      stopReason,
      confirmationCasesReleased: false,
      prospectiveHumanEffort: { measured: false, decisions: null, edits: null, interventions: null, reason: "No human participant took part in this deterministic controller checkpoint." },
      automatedEngineering: {
        actionCount: actionReceipts.length,
        retained: actionReceipts.filter((item) => item.kind === "retain").length,
        revisions: actionReceipts.filter((item) => item.kind === "revise").length,
        modelSwitches: actionReceipts.filter((item) => item.kind === "switch-model").length,
        forks: actionReceipts.filter((item) => item.kind === "fork").length,
      },
      developmentDiversity: analyzeCandidateDiversity([...evaluated.values()].map((record) => record.candidate)),
      evidenceBoundary: "Development-only adaptive engineering result. The selected package is provisional and cannot activate without fresh common confirmation.",
    };
    result.resultHash = digest(result);
    this.evidence?.append("adaptive-engineer.completed", { armId: this.armId, resultHash: result.resultHash, selectedCandidateId: selected?.candidate.id ?? null, stopReason });
    return Object.freeze(result);
  }
}

export function assertAdaptiveEngineerResult(result, protocol) {
  assertAdaptiveEngineeringProtocol(protocol);
  requireCondition(result?.schemaVersion === "das.adaptive-engineer-result.v1", "Unsupported adaptive engineer result");
  const copy = structuredClone(result);
  const expected = copy.resultHash;
  delete copy.resultHash;
  requireCondition(expected && digest(copy) === expected, "Adaptive engineer result integrity mismatch");
  requireCondition(result.protocolHash === protocol.protocolHash, "Adaptive engineer result belongs to another protocol");
  requireCondition(result.confirmationCasesReleased === false, "Development result cannot claim confirmation release");
  return result;
}
