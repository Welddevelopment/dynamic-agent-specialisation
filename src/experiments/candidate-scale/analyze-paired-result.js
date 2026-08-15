import { digest } from "../../core/canonical.js";

const CONDITION_KEYS = Object.freeze(["first-five", "full-search"]);
const PHASE_KEYS = Object.freeze(["screening", "fullEvaluation", "finalConfirmation"]);
const FINAL_STATUS = new Set(["complete", "eliminated-safety"]);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function clone(value) { return structuredClone(value); }
function without(value, key) { const copy = clone(value); delete copy[key]; return copy; }
function sealed(value, key, label) {
  requireCondition(value && typeof value === "object" && value[key] && digest(without(value, key)) === value[key], `${label} integrity mismatch`);
}
function finite(value, label, minimum = 0) {
  requireCondition(Number.isFinite(value) && value >= minimum, `${label} must be a finite number no smaller than ${minimum}`);
  return Number(value);
}
function integer(value, label, minimum = 0) {
  requireCondition(Number.isInteger(value) && value >= minimum, `${label} must be an integer no smaller than ${minimum}`);
  return Number(value);
}
function unique(values, label) {
  requireCondition(new Set(values).size === values.length, `${label} must be unique`);
  return values;
}
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function sum(values) { return values.reduce((total, value) => total + value, 0); }
function usageZero() { return { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 }; }
function addUsage(left, right) {
  return {
    calls: left.calls + right.calls,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    costUsd: left.costUsd + right.costUsd,
    elapsedMs: left.elapsedMs + right.elapsedMs,
  };
}

function normalizedUsage(value, label) {
  requireCondition(value && typeof value === "object", `${label} usage is missing`);
  return {
    calls: integer(value.calls, `${label} calls`),
    inputTokens: integer(value.inputTokens, `${label} input tokens`),
    outputTokens: integer(value.outputTokens, `${label} output tokens`),
    costUsd: finite(value.costUsd, `${label} cost`),
    elapsedMs: finite(value.elapsedMs, `${label} elapsed time`),
  };
}

function caseIndex(protocol) {
  const output = new Map();
  for (const phase of PHASE_KEYS) {
    const records = protocol.caseSets?.[phase];
    requireCondition(Array.isArray(records) && records.length > 0, `Protocol needs a non-empty ${phase} case set`);
    unique(records.map((record) => record.id), `${phase} case ids`);
    output.set(phase, new Map(records.map((record) => {
      requireCondition(typeof record.id === "string" && record.id && /^[a-f0-9]{64}$/.test(record.caseHash), `${phase} case record is not pinned`);
      return [record.id, record.caseHash];
    })));
  }
  return output;
}

function validateProtocol(protocol) {
  requireCondition(protocol?.schemaVersion === "das.candidate-scale-paired-protocol.v1", "Unsupported paired-result protocol");
  sealed(protocol, "protocolHash", "Paired-result protocol");
  for (const key of ["roleHash", "candidateContractHash", "architectModelHash", "executionModelHash", "baselineSetHash"]) {
    requireCondition(/^[a-f0-9]{64}$/.test(protocol[key]), `Protocol ${key} is missing or invalid`);
  }
  requireCondition(protocol.verifier?.id && /^[a-f0-9]{64}$/.test(protocol.verifier.hash), "Protocol verifier binding is missing");
  requireCondition(protocol.conditionCounts?.["first-five"] === 5 && protocol.conditionCounts?.["full-search"] === 150, "Paired protocol must freeze 5 and 150 requested candidates");
  const rules = protocol.decisionRules;
  requireCondition(rules && typeof rules === "object", "Paired protocol needs frozen decision rules");
  finite(rules.minimumFinalScoreDelta, "Minimum final score delta");
  finite(rules.minimumMarginalGainPerUsd, "Minimum marginal gain per dollar");
  finite(rules.minimumMarginalGainPerMinute, "Minimum marginal gain per minute");
  requireCondition(rules.retainWhenThresholdNotMet === true, "Paired protocol must fail closed to retaining the smaller search");
  for (const conditionKey of CONDITION_KEYS) {
    const budget = protocol.budgets?.[conditionKey];
    requireCondition(budget, `Protocol is missing the ${conditionKey} budget`);
    finite(budget.maximumCostUsd, `${conditionKey} maximum cost`);
    integer(budget.maximumCalls, `${conditionKey} maximum calls`);
    integer(budget.maximumTokens, `${conditionKey} maximum tokens`);
    finite(budget.maximumWallClockMs, `${conditionKey} maximum wall clock`, 1);
  }
  const baselineBudget = protocol.budgets?.baselines;
  requireCondition(baselineBudget, "Protocol is missing the baseline budget");
  finite(baselineBudget.maximumCostUsd, "Baseline maximum cost");
  integer(baselineBudget.maximumCalls, "Baseline maximum calls");
  integer(baselineBudget.maximumTokens, "Baseline maximum tokens");
  finite(baselineBudget.maximumWallClockMs, "Baseline maximum wall clock", 1);
  return { protocol, cases: caseIndex(protocol) };
}

function validateCandidate(candidate, protocol, label) {
  requireCondition(candidate?.schemaVersion === "das.candidate-scale-frozen-candidate.v1", `${label} has an unsupported candidate schema`);
  sealed(candidate, "candidateHash", `${label} candidate`);
  requireCondition(candidate.id && Number.isInteger(candidate.ordinal) && candidate.ordinal >= 1, `${label} candidate needs an id and positive ordinal`);
  requireCondition(candidate.valid === true, `${label} candidate is not contract-valid`);
  requireCondition(candidate.candidateContractHash === protocol.candidateContractHash, `${label} candidate contract hash mismatch`);
  requireCondition(candidate.executionModelHash === protocol.executionModelHash, `${label} execution model mismatch`);
  requireCondition(candidate.designFingerprint && candidate.architectureSignature, `${label} candidate lacks diversity fingerprints`);
  requireCondition(candidate.configuration && candidate.configurationHash === digest(candidate.configuration), `${label} candidate configuration changed after freeze`);
  return candidate;
}

function validateGeneration(condition, protocol, conditionKey) {
  const generation = condition.generation;
  requireCondition(generation?.schemaVersion === "das.candidate-scale-paired-generation.v1", `${conditionKey} generation receipt is missing`);
  sealed(generation, "generationReceiptHash", `${conditionKey} generation`);
  requireCondition(generation.protocolHash === protocol.protocolHash && generation.architectModelHash === protocol.architectModelHash, `${conditionKey} generation does not match the frozen protocol/models`);
  requireCondition(generation.requestedCount === protocol.conditionCounts[conditionKey], `${conditionKey} requested count changed`);
  integer(generation.generatedCount, `${conditionKey} generated count`);
  requireCondition(Array.isArray(generation.candidates) && Array.isArray(generation.rejected) && Array.isArray(generation.dedup), `${conditionKey} generation lists are incomplete`);
  const candidates = generation.candidates.map((candidate) => validateCandidate(candidate, protocol, conditionKey)).sort((a, b) => a.ordinal - b.ordinal);
  unique(candidates.map((candidate) => candidate.id), `${conditionKey} candidate ids`);
  unique(candidates.map((candidate) => candidate.ordinal), `${conditionKey} candidate ordinals`);
  requireCondition(generation.generatedCount === candidates.length + generation.rejected.length, `${conditionKey} generated count does not reconcile`);
  for (const rejection of generation.rejected) {
    requireCondition(Array.isArray(rejection.reasonCodes) && rejection.reasonCodes.length > 0 && rejection.reasonCodes.every((reason) => typeof reason === "string" && reason), `${conditionKey} rejection needs explicit reason codes`);
    requireCondition(rejection.receiptHash === digest(without(rejection, "receiptHash")), `${conditionKey} rejection receipt integrity mismatch`);
  }
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const duplicateIds = new Set();
  const dedupReasons = {};
  for (const record of generation.dedup) {
    requireCondition(record.receiptHash === digest(without(record, "receiptHash")), `${conditionKey} dedup receipt integrity mismatch`);
    requireCondition(byId.has(record.candidateId) && byId.has(record.duplicateOf) && record.candidateId !== record.duplicateOf, `${conditionKey} dedup record cites an unknown candidate`);
    requireCondition(["exact-design", "same-architecture-signature", "structural-near-duplicate"].includes(record.reason), `${conditionKey} dedup record needs a canonical reason`);
    requireCondition(!duplicateIds.has(record.candidateId), `${conditionKey} candidate has multiple dedup dispositions`);
    duplicateIds.add(record.candidateId);
    dedupReasons[record.reason] = (dedupReasons[record.reason] ?? 0) + 1;
  }
  const distinctCandidates = candidates.filter((candidate) => !duplicateIds.has(candidate.id));
  const usage = normalizedUsage(generation.usage, `${conditionKey} generation`);
  return { generation, candidates, byId, duplicateIds, distinctCandidates, dedupReasons, usage };
}

function validateObservation(observation, { protocol, cases, participantId, participantHash, phase, selectionFreezeHash = null, label }) {
  requireCondition(observation?.schemaVersion === "das.candidate-scale-paired-observation.v1", `${label} observation receipt is missing`);
  sealed(observation, "receiptHash", `${label} observation`);
  requireCondition(observation.participantId === participantId && observation.participantHash === participantHash, `${label} observation participant changed`);
  requireCondition(observation.phase === phase, `${label} observation phase changed`);
  requireCondition(observation.executionModelHash === protocol.executionModelHash, `${label} observation model mismatch`);
  requireCondition(observation.verifierId === protocol.verifier.id && observation.verifierHash === protocol.verifier.hash && observation.independentlyVerified === true, `${label} observation lacks the bound independent verifier`);
  const expectedCaseHash = cases.get(phase).get(observation.caseId);
  requireCondition(expectedCaseHash && observation.caseHash === expectedCaseHash, `${label} observation case mismatch`);
  if (phase === "finalConfirmation" && selectionFreezeHash) requireCondition(observation.selectionFreezeHash === selectionFreezeHash, `${label} final confirmation is not bound to the pre-confirmation selection freeze`);
  finite(observation.score, `${label} score`);
  requireCondition(observation.score <= 1, `${label} score must be at most 1`);
  for (const key of ["unsafeAttempts", "authorityFailures", "incorrectSideEffects"]) integer(observation[key], `${label} ${key}`);
  requireCondition(typeof observation.passed === "boolean", `${label} observation needs a pass result`);
  return { ...observation, usage: normalizedUsage(observation.usage, `${label} observation`) };
}

function validateTermination(termination, phase, participantIds, label) {
  sealed(termination, "receiptHash", `${label} termination`);
  requireCondition(participantIds.has(termination.participantId) && termination.phase === phase && termination.reason === "safety-gate", `${label} termination is invalid`);
  requireCondition(termination.unsafeAttempts > 0 || termination.authorityFailures > 0 || termination.incorrectSideEffects > 0, `${label} safety termination has no safety failure`);
  return termination;
}

function validatePhase(phaseValue, { protocol, cases, phase, participantRecords, selectionFreeze = null, label }) {
  requireCondition(phaseValue?.schemaVersion === "das.candidate-scale-paired-phase.v1" && phaseValue.phase === phase, `${label} ${phase} phase is missing`);
  sealed(phaseValue, "phaseHash", `${label} ${phase} phase`);
  requireCondition(phaseValue.protocolHash === protocol.protocolHash && phaseValue.caseSetHash === digest(protocol.caseSets[phase]), `${label} ${phase} phase does not match the protocol/cases`);
  const participantIds = unique([...phaseValue.participantIds], `${label} ${phase} participants`);
  const allowed = new Map(participantRecords.map((record) => [record.id, record]));
  for (const id of participantIds) requireCondition(allowed.has(id), `${label} ${phase} includes an unknown participant: ${id}`);
  const terminations = (phaseValue.terminations ?? []).map((record) => validateTermination(record, phase, new Set(participantIds), `${label} ${phase}`));
  unique(terminations.map((record) => record.participantId), `${label} ${phase} terminations`);
  const terminationById = new Map(terminations.map((record) => [record.participantId, record]));
  const observations = phaseValue.observations.map((observation) => {
    const participant = allowed.get(observation.participantId);
    return validateObservation(observation, {
      protocol,
      cases,
      participantId: participant.id,
      participantHash: participant.candidateHash ?? participant.baselineHash,
      phase,
      selectionFreezeHash: selectionFreeze?.freezeHash ?? null,
      label: `${label}/${phase}/${participant.id}/${observation.caseId}`,
    });
  });
  const rowsByParticipant = new Map(participantIds.map((id) => [id, observations.filter((row) => row.participantId === id)]));
  const expectedCaseIds = [...cases.get(phase).keys()].sort();
  for (const id of participantIds) {
    const rows = rowsByParticipant.get(id);
    unique(rows.map((row) => row.caseId), `${label} ${phase}/${id} case receipts`);
    if (!terminationById.has(id)) requireCondition(JSON.stringify(rows.map((row) => row.caseId).sort()) === JSON.stringify(expectedCaseIds), `${label} ${phase}/${id} is missing case receipts`);
    else requireCondition(rows.length > 0 && rows.length < expectedCaseIds.length, `${label} ${phase}/${id} safety termination does not explain a bounded early stop`);
  }
  const usage = observations.reduce((total, row) => addUsage(total, row.usage), usageZero());
  return { phase: phaseValue, participantIds, observations, rowsByParticipant, terminations, usage };
}

function safeRows(rows) {
  return rows.length > 0 && rows.every((row) => row.unsafeAttempts === 0 && row.authorityFailures === 0 && row.incorrectSideEffects === 0);
}

function participantSummary(id, rows) {
  return {
    participantId: id,
    cases: rows.length,
    passed: rows.filter((row) => row.passed).length,
    meanScore: mean(rows.map((row) => row.score)),
    safe: safeRows(rows),
    unsafeAttempts: sum(rows.map((row) => row.unsafeAttempts)),
    authorityFailures: sum(rows.map((row) => row.authorityFailures)),
    incorrectSideEffects: sum(rows.map((row) => row.incorrectSideEffects)),
    usage: rows.reduce((total, row) => addUsage(total, row.usage), usageZero()),
  };
}

function validateSelectionFreeze(value, conditionKey, generation, protocol) {
  requireCondition(value?.schemaVersion === "das.candidate-scale-selection-freeze.v1", `${conditionKey} selection freeze is missing`);
  sealed(value, "freezeHash", `${conditionKey} selection freeze`);
  const candidate = generation.byId.get(value.selectedCandidateId);
  requireCondition(candidate && !generation.duplicateIds.has(candidate.id), `${conditionKey} selected an unknown or deduplicated candidate`);
  requireCondition(value.selectedCandidateHash === candidate.candidateHash && value.generationReceiptHash === generation.generation.generationReceiptHash && value.protocolHash === protocol.protocolHash, `${conditionKey} selection freeze does not bind the exact candidate/generation/protocol`);
  requireCondition(value.selectedBeforeFinalConfirmation === true, `${conditionKey} selected candidate was not frozen before final confirmation`);
  return { freeze: value, candidate };
}

function validateCondition(condition, context, conditionKey) {
  requireCondition(condition?.schemaVersion === "das.candidate-scale-paired-condition.v1" && condition.key === conditionKey, `${conditionKey} result is missing`);
  sealed(condition, "conditionHash", `${conditionKey} result`);
  requireCondition(condition.protocolHash === context.protocol.protocolHash, `${conditionKey} result protocol mismatch`);
  const generation = validateGeneration(condition, context.protocol, conditionKey);
  const selection = validateSelectionFreeze(condition.selectionFreeze, conditionKey, generation, context.protocol);
  const phases = {};
  phases.screening = validatePhase(condition.phases.screening, { ...context, phase: "screening", participantRecords: generation.distinctCandidates, label: conditionKey });
  phases.fullEvaluation = validatePhase(condition.phases.fullEvaluation, { ...context, phase: "fullEvaluation", participantRecords: generation.distinctCandidates, label: conditionKey });
  phases.finalConfirmation = validatePhase(condition.phases.finalConfirmation, { ...context, phase: "finalConfirmation", participantRecords: [selection.candidate], selectionFreeze: selection.freeze, label: conditionKey });
  requireCondition(phases.screening.participantIds.length === generation.distinctCandidates.length, `${conditionKey} did not screen every distinct valid candidate`);
  requireCondition(phases.finalConfirmation.participantIds.length === 1 && phases.finalConfirmation.participantIds[0] === selection.candidate.id, `${conditionKey} final confirmation includes an unfrozen participant`);
  const finalRows = phases.finalConfirmation.rowsByParticipant.get(selection.candidate.id);
  requireCondition(safeRows(finalRows), `${conditionKey} selected candidate failed final safety/authority confirmation`);
  const phaseUsage = Object.fromEntries(PHASE_KEYS.map((phase) => [phase, phases[phase].usage]));
  const evaluationUsage = Object.values(phaseUsage).reduce(addUsage, usageZero());
  const totalUsage = addUsage(generation.usage, evaluationUsage);
  const budget = context.protocol.budgets[conditionKey];
  requireCondition(totalUsage.costUsd <= budget.maximumCostUsd + 1e-12, `${conditionKey} exceeded its frozen cost budget`);
  requireCondition(totalUsage.calls <= budget.maximumCalls, `${conditionKey} exceeded its frozen call budget`);
  requireCondition(totalUsage.inputTokens + totalUsage.outputTokens <= budget.maximumTokens, `${conditionKey} exceeded its frozen token budget`);
  finite(condition.wallClockMs, `${conditionKey} wall clock`);
  requireCondition(condition.wallClockMs <= budget.maximumWallClockMs, `${conditionKey} exceeded its frozen wall-clock budget`);
  return { condition, generation, selection, phases, phaseUsage, totalUsage, finalSummary: participantSummary(selection.candidate.id, finalRows) };
}

function validateBaseline(baseline, protocol) {
  requireCondition(baseline?.schemaVersion === "das.candidate-scale-executed-baseline.v1", "Executed baseline is missing");
  sealed(baseline, "baselineHash", `Baseline ${baseline.id ?? "unknown"}`);
  requireCondition(baseline.id && baseline.configuration && baseline.configurationHash === digest(baseline.configuration), `Baseline ${baseline.id ?? "unknown"} configuration changed`);
  requireCondition(baseline.executionModelHash === protocol.executionModelHash, `Baseline ${baseline.id} model mismatch`);
  return baseline;
}

function validateBaselines(value, context) {
  requireCondition(value?.schemaVersion === "das.candidate-scale-executed-baselines.v1", "Executed baseline result is missing");
  sealed(value, "baselineResultHash", "Executed baseline result");
  requireCondition(value.protocolHash === context.protocol.protocolHash, "Executed baselines do not match the protocol");
  const participants = value.participants.map((baseline) => validateBaseline(baseline, context.protocol));
  unique(participants.map((baseline) => baseline.id), "Baseline ids");
  requireCondition(digest(participants.map((baseline) => ({ id: baseline.id, baselineHash: baseline.baselineHash }))) === context.protocol.baselineSetHash, "Executed baseline set hash mismatch");
  const phases = Object.fromEntries(PHASE_KEYS.map((phase) => [phase, validatePhase(value.phases[phase], { ...context, phase, participantRecords: participants, label: "baselines" })]));
  const totalUsage = Object.values(phases).reduce((total, phase) => addUsage(total, phase.usage), usageZero());
  const budget = context.protocol.budgets.baselines;
  requireCondition(totalUsage.costUsd <= budget.maximumCostUsd + 1e-12 && totalUsage.calls <= budget.maximumCalls && totalUsage.inputTokens + totalUsage.outputTokens <= budget.maximumTokens, "Executed baselines exceeded their frozen budget");
  finite(value.wallClockMs, "Baseline wall clock");
  requireCondition(value.wallClockMs <= budget.maximumWallClockMs, "Executed baselines exceeded their frozen wall-clock budget");
  return { value, participants, phases, totalUsage };
}

function assertPairedPrefix(first, full) {
  const prefix = full.generation.candidates.slice(0, 5);
  requireCondition(first.generation.candidates.length === 5, "First-five condition must contain exactly five valid frozen candidates");
  requireCondition(JSON.stringify(first.generation.candidates.map((candidate) => [candidate.id, candidate.candidateHash])) === JSON.stringify(prefix.map((candidate) => [candidate.id, candidate.candidateHash])), "First-five candidates are not the exact frozen prefix of the full search");
  for (const phase of ["screening", "fullEvaluation"]) {
    const fullReceipts = new Map(full.phases[phase].observations.map((row) => [`${row.participantId}:${row.caseId}`, row.receiptHash]));
    for (const row of first.phases[phase].observations) {
      const paired = fullReceipts.get(`${row.participantId}:${row.caseId}`);
      if (paired) requireCondition(paired === row.receiptHash, `Shared ${phase} observation was rerun or mutated for ${row.participantId}/${row.caseId}`);
    }
  }
}

function diversity(generation) {
  const distinct = generation.distinctCandidates;
  const architectureCounts = new Map();
  for (const candidate of distinct) architectureCounts.set(candidate.architectureSignature, (architectureCounts.get(candidate.architectureSignature) ?? 0) + 1);
  const concentration = [...architectureCounts.values()].reduce((total, count) => total + (count / Math.max(distinct.length, 1)) ** 2, 0);
  return {
    exactDistinctDesigns: new Set(distinct.map((candidate) => candidate.designFingerprint)).size,
    architectureSignatureCount: architectureCounts.size,
    effectiveUniqueArchitectureCount: concentration ? 1 / concentration : 0,
  };
}

function conditionInventory(result) {
  const rejectedReasons = {};
  for (const rejection of result.generation.generation.rejected) for (const reason of rejection.reasonCodes) rejectedReasons[reason] = (rejectedReasons[reason] ?? 0) + 1;
  return {
    requested: result.generation.generation.requestedCount,
    generated: result.generation.generation.generatedCount,
    valid: result.generation.candidates.length,
    distinct: result.generation.distinctCandidates.length,
    rejected: result.generation.generation.rejected.length,
    deduplicated: result.generation.duplicateIds.size,
    rejectedReasons,
    dedupReasons: result.generation.dedupReasons,
    screened: result.phases.screening.participantIds.length,
    fullEvaluated: result.phases.fullEvaluation.participantIds.length,
    diversity: diversity(result.generation),
  };
}

function taskOutcomes(result) {
  return result.phases.finalConfirmation.observations.map((row) => ({
    caseId: row.caseId,
    participantId: row.participantId,
    passed: row.passed,
    score: row.score,
    unsafeAttempts: row.unsafeAttempts,
    authorityFailures: row.authorityFailures,
    incorrectSideEffects: row.incorrectSideEffects,
    receiptHash: row.receiptHash,
  }));
}

function baselineComparisons(condition, baselines) {
  const candidateRows = condition.phases.screening.rowsByParticipant;
  const candidateScores = [...candidateRows.entries()].map(([id, rows]) => participantSummary(id, rows)).filter((summary) => summary.safe);
  return baselines.participants.map((baseline) => {
    const baselineSummary = participantSummary(baseline.id, baselines.phases.screening.rowsByParticipant.get(baseline.id));
    return {
      baselineId: baseline.id,
      baselineScore: baselineSummary.meanScore,
      baselineSafe: baselineSummary.safe,
      safeCandidatesBeatingBaseline: baselineSummary.safe ? candidateScores.filter((candidate) => candidate.meanScore > baselineSummary.meanScore).length : null,
      comparisonBasis: "common-screening-case-set",
    };
  });
}

function usageReport(result) {
  return {
    generation: clone(result.generation.usage),
    screening: clone(result.phaseUsage.screening),
    fullEvaluation: clone(result.phaseUsage.fullEvaluation),
    finalConfirmation: clone(result.phaseUsage.finalConfirmation),
    total: clone(result.totalUsage),
    wallClockMs: result.condition.wallClockMs,
    generationElapsedMs: result.generation.usage.elapsedMs,
    evaluationElapsedMs: result.phaseUsage.screening.elapsedMs + result.phaseUsage.fullEvaluation.elapsedMs + result.phaseUsage.finalConfirmation.elapsedMs,
  };
}

function safetyReport(result) {
  const byPhase = Object.fromEntries(PHASE_KEYS.map((phase) => {
    const rows = result.phases[phase].observations;
    return [phase, {
      unsafeAttempts: sum(rows.map((row) => row.unsafeAttempts)),
      authorityFailures: sum(rows.map((row) => row.authorityFailures)),
      incorrectSideEffects: sum(rows.map((row) => row.incorrectSideEffects)),
      safetyTerminations: result.phases[phase].terminations.length,
    }];
  }));
  return {
    byPhase,
    total: Object.values(byPhase).reduce((total, row) => ({
      unsafeAttempts: total.unsafeAttempts + row.unsafeAttempts,
      authorityFailures: total.authorityFailures + row.authorityFailures,
      incorrectSideEffects: total.incorrectSideEffects + row.incorrectSideEffects,
      safetyTerminations: total.safetyTerminations + row.safetyTerminations,
    }), { unsafeAttempts: 0, authorityFailures: 0, incorrectSideEffects: 0, safetyTerminations: 0 }),
  };
}

export function analyzePairedCandidateScaleResult(combined) {
  requireCondition(combined?.schemaVersion === "das.candidate-scale-paired-combined-result.v1", "Unsupported paired candidate-scale result");
  sealed(combined, "combinedResultHash", "Paired candidate-scale combined result");
  const context = validateProtocol(combined.protocol);
  requireCondition(combined.protocolHash === context.protocol.protocolHash, "Combined result protocol hash mismatch");
  const first = validateCondition(combined.conditions?.["first-five"], context, "first-five");
  const full = validateCondition(combined.conditions?.["full-search"], context, "full-search");
  assertPairedPrefix(first, full);
  const baselines = validateBaselines(combined.baselines, context);
  const firstScore = first.finalSummary.meanScore;
  const fullScore = full.finalSummary.meanScore;
  const delta = fullScore - firstScore;
  const incrementalCostUsd = full.totalUsage.costUsd - first.totalUsage.costUsd;
  const incrementalMinutes = (full.condition.wallClockMs - first.condition.wallClockMs) / 60_000;
  requireCondition(incrementalCostUsd >= -1e-12 && incrementalMinutes >= -1e-12, "Full search used less frozen resource than the paired first-five prefix; marginal analysis is invalid");
  const marginalGainPerExtraDollar = incrementalCostUsd > 0 ? delta / incrementalCostUsd : delta > 0 ? Number.POSITIVE_INFINITY : 0;
  const marginalGainPerExtraMinute = incrementalMinutes > 0 ? delta / incrementalMinutes : delta > 0 ? Number.POSITIVE_INFINITY : 0;
  const rules = context.protocol.decisionRules;
  const sameConfiguration = first.selection.candidate.configurationHash === full.selection.candidate.configurationHash;
  const thresholdMet = delta >= rules.minimumFinalScoreDelta
    && marginalGainPerExtraDollar >= rules.minimumMarginalGainPerUsd
    && marginalGainPerExtraMinute >= rules.minimumMarginalGainPerMinute;
  const decision = sameConfiguration
    ? { action: "retain", reason: "full search selected the same frozen configuration" }
    : thresholdMet
      ? { action: "switch", reason: "full search cleared every preregistered improvement and marginal-return threshold" }
      : { action: "retain", reason: "full search did not clear every preregistered improvement and marginal-return threshold" };
  const globalWinnerInFirstFive = first.generation.byId.has(full.selection.candidate.id);
  const report = {
    schemaVersion: "das.candidate-scale-paired-analysis.v1",
    experimentId: context.protocol.experimentId,
    protocolHash: context.protocol.protocolHash,
    combinedResultHash: combined.combinedResultHash,
    inventory: {
      firstFive: conditionInventory(first),
      fullSearch: conditionInventory(full),
    },
    finalConfirmation: {
      firstFive: { selectedCandidateId: first.selection.candidate.id, selectedConfiguration: clone(first.selection.candidate.configuration), score: firstScore, taskOutcomes: taskOutcomes(first) },
      fullSearch: { selectedCandidateId: full.selection.candidate.id, selectedConfiguration: clone(full.selection.candidate.configuration), score: fullScore, taskOutcomes: taskOutcomes(full) },
      scoreDelta: delta,
      globalWinnerInFirstFive,
    },
    baselineComparisons: {
      firstFive: baselineComparisons(first, baselines),
      fullSearch: baselineComparisons(full, baselines),
    },
    safetyAndAuthority: { firstFive: safetyReport(first), fullSearch: safetyReport(full) },
    resourceUse: {
      firstFive: usageReport(first),
      fullSearch: usageReport(full),
      baselines: { total: clone(baselines.totalUsage), wallClockMs: baselines.value.wallClockMs },
      incremental: { costUsd: incrementalCostUsd, wallClockMinutes: incrementalMinutes, marginalGainPerExtraDollar, marginalGainPerExtraMinute },
    },
    decision,
    productionSearchRecommendation: {
      candidateCount: decision.action === "switch" ? context.protocol.conditionCounts["full-search"] : context.protocol.conditionCounts["first-five"],
      rule: decision.action === "switch" ? "use expanded search because every preregistered return threshold passed" : "retain the smaller default search because expanded search did not earn its additional cost/time",
      notUniversal: true,
    },
    limitations: [
      "This is one frozen role, generator, model, verifier and case pack; it does not establish a universal candidate count.",
      "Candidate count and the preregistered search-and-prune procedure change together, so this does not isolate candidate count from evaluation policy.",
      "Baseline-beating counts use the common screening set; only the frozen selected configurations receive final confirmation.",
      "A private or customer outcome is not established by a local paired experiment.",
    ],
  };
  report.analysisHash = digest(report);
  return Object.freeze(report);
}

export function renderPairedCandidateScaleReportMarkdown(report) {
  requireCondition(report?.schemaVersion === "das.candidate-scale-paired-analysis.v1" && report.analysisHash === digest(without(report, "analysisHash")), "Paired candidate-scale analysis integrity mismatch");
  const first = report.finalConfirmation.firstFive;
  const full = report.finalConfirmation.fullSearch;
  const inventory = report.inventory;
  return [
    "# Paired candidate-search result",
    "",
    `- Decision: **${report.decision.action.toUpperCase()}** — ${report.decision.reason}.`,
    `- First-five final score: ${first.score.toFixed(4)} (${first.selectedCandidateId})`,
    `- Full-search final score: ${full.score.toFixed(4)} (${full.selectedCandidateId})`,
    `- Delta: ${report.finalConfirmation.scoreDelta.toFixed(4)}`,
    `- Full-search winner appeared in the first five: ${report.finalConfirmation.globalWinnerInFirstFive ? "yes" : "no"}`,
    "",
    "## Candidate accounting",
    "",
    `- First five: ${inventory.firstFive.requested} requested / ${inventory.firstFive.generated} generated / ${inventory.firstFive.valid} valid / ${inventory.firstFive.distinct} distinct / ${inventory.firstFive.rejected} rejected.`,
    `- Full search: ${inventory.fullSearch.requested} requested / ${inventory.fullSearch.generated} generated / ${inventory.fullSearch.valid} valid / ${inventory.fullSearch.distinct} distinct / ${inventory.fullSearch.rejected} rejected.`,
    "",
    "## Resource delta",
    "",
    `- Extra cost: $${report.resourceUse.incremental.costUsd.toFixed(4)}`,
    `- Extra wall time: ${report.resourceUse.incremental.wallClockMinutes.toFixed(2)} minutes`,
    `- Score gain per extra dollar: ${Number.isFinite(report.resourceUse.incremental.marginalGainPerExtraDollar) ? report.resourceUse.incremental.marginalGainPerExtraDollar.toFixed(4) : "∞"}`,
    `- Score gain per extra minute: ${Number.isFinite(report.resourceUse.incremental.marginalGainPerExtraMinute) ? report.resourceUse.incremental.marginalGainPerExtraMinute.toFixed(4) : "∞"}`,
    "",
    "## Production recommendation",
    "",
    `Use a ${report.productionSearchRecommendation.candidateCount}-candidate search under this exact frozen protocol. ${report.productionSearchRecommendation.rule}.`,
    "",
    "## Limitations",
    "",
    ...report.limitations.map((item) => `- ${item}`),
    "",
  ].join("\n");
}
