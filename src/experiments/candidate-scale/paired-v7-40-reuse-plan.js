import { digest } from "../../core/canonical.js";
import { createCommercialSupportPack } from "../../product/commercial-support-pack.js";
import { rankPairedV7Eligible, summarizePairedV7Participant } from "./paired-v7-evaluation-contract.js";

const BASELINE_TYPES = Object.freeze(["current-agent", "strong-general", "ordinary-manual", "expert-manual"]);

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function without(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }
function sealed(value, key, label) { requireCondition(value && digest(without(value, key)) === value[key], `${label} integrity mismatch`); }

function casesFor(casePack, stages) {
  return stages.flatMap((stage) => casePack.cases[stage].map((testCase) => ({ stage, caseId: testCase.id, caseHash: digest(testCase) })));
}

function observationMatch(row, { participant, record, phase, verifierId }) {
  return row.phase === phase
    && row.stage === record.stage
    && row.participantId === participant.id
    && row.participantType === participant.type
    && row.configurationHash === participant.configurationHash
    && row.candidateFingerprint === participant.candidateFingerprint
    && row.acceptedPosition === (participant.acceptedPosition ?? null)
    && row.caseId === record.caseId
    && row.caseHash === record.caseHash
    && row.verifierId === verifierId
    && row.independentlyVerified === true
    && typeof row.receiptHash === "string";
}

function planPhase({ participants, cases, phase, rows, verifierId }) {
  const reusable = [];
  const missing = [];
  const safetyStopped = [];
  const rowsByParticipant = new Map();
  for (const participant of participants) {
    const participantRows = [];
    for (const record of cases) {
      if (participantRows.some((row) => row.unsafeAttempts > 0 || row.incorrectSideEffects > 0)) {
        safetyStopped.push({ participantId: participant.id, caseId: record.caseId, reason: "prior-observation-hit-hard-safety-gate" });
        continue;
      }
      const matches = rows.filter((row) => observationMatch(row, { participant, record, phase, verifierId }));
      requireCondition(matches.length <= 1, `Multiple reusable observations match ${phase}/${participant.id}/${record.caseId}`);
      if (matches.length === 1) {
        const row = matches[0];
        participantRows.push(row);
        reusable.push({ participantId: participant.id, participantType: participant.type, configurationHash: participant.configurationHash, caseId: record.caseId, caseHash: record.caseHash, sourceObservationHash: digest(row) });
      } else {
        missing.push({ participantId: participant.id, participantType: participant.type, configurationHash: participant.configurationHash, caseId: record.caseId, caseHash: record.caseHash, stage: record.stage });
      }
    }
    rowsByParticipant.set(participant.id, participantRows);
  }
  return { reusable, missing, safetyStopped, rowsByParticipant };
}

/**
 * Produces a zero-call extension execution map after the sealed V7 result has
 * passed the independent analyzer. It never authorizes or performs missing
 * model-backed observations.
 */
export function createPairedV740ReusePlan({ extensionPlan, basePlan, baseResult, baseAnalysis, portfolio, casePack, protocol }) {
  sealed(extensionPlan, "extensionPlanHash", "V7 40-arm plan");
  sealed(basePlan, "planHash", "V7 base plan");
  sealed(baseResult, "integrityHash", "V7 combined result");
  sealed(baseAnalysis, "analysisHash", "V7 independent analysis");
  sealed(portfolio, "integrityHash", "V7 portfolio");
  requireCondition(extensionPlan.schemaVersion === "das.candidate-scale-v7-prefix-40-live-plan.v1" && extensionPlan.launchStatus === "not-authorized", "V7 40-arm plan status changed");
  requireCondition(baseAnalysis.schemaVersion === "das.candidate-scale-paired-v7-analysis.v1" && baseAnalysis.resultHash === baseResult.integrityHash, "V7 40-arm requires the analysis of this exact combined result");
  requireCondition(extensionPlan.baseV7PlanHash === basePlan.planHash && baseResult.planHash === basePlan.planHash, "V7 40-arm base-result binding changed");
  requireCondition(extensionPlan.portfolioIntegrityHash === portfolio.integrityHash && baseResult.generation.portfolioIntegrityHash === portfolio.integrityHash, "V7 40-arm portfolio binding changed");
  requireCondition(extensionPlan.first40CandidateIds.every((id, index) => portfolio.candidates[index]?.id === id), "V7 40-arm accepted order changed");
  requireCondition(baseResult.evidenceLedgerValid === true && baseAnalysis.evidenceIntegrity?.durableBudget === "reconciled-no-unresolved-reservations", "V7 result is not clean enough for observation reuse");

  const positionById = new Map(portfolio.candidates.map((candidate, index) => [candidate.id, index + 1]));
  const candidateById = new Map(portfolio.candidates.map((candidate) => [candidate.id, candidate]));
  const candidateParticipants = extensionPlan.finalistIds.map((id) => {
    const candidate = candidateById.get(id);
    requireCondition(candidate, `V7 40-arm finalist is missing: ${id}`);
    return { id, type: "compiler-candidate", configurationHash: candidate.fingerprint, candidateFingerprint: candidate.fingerprint, acceptedPosition: positionById.get(id) };
  });
  requireCondition(candidateParticipants.length === 7, "V7 40-arm must retain exactly seven frozen finalists");
  const support = createCommercialSupportPack();
  const baselineParticipants = support.participants.filter((entry) => BASELINE_TYPES.includes(entry.type)).map((entry) => ({ id: entry.id, type: entry.type, configurationHash: entry.configurationHash, candidateFingerprint: entry.candidate.fingerprint, acceptedPosition: null }));
  requireCondition(digest(baselineParticipants.map(({ candidateFingerprint, acceptedPosition, ...entry }) => entry)) === protocol.bindings.baselineHashesHash, "V7 40-arm baseline binding changed");

  const selectionCases = casesFor(casePack, ["development", "validation", "adversarial"]);
  const confirmationCases = casesFor(casePack, ["holdout", "repeat"]);
  const selectionRows = [...baseResult.selectionEvaluation.observations, ...baseResult.baselines.selectionObservations];
  const selection = planPhase({ participants: [...candidateParticipants, ...baselineParticipants], cases: selectionCases, phase: "selection", rows: selectionRows, verifierId: protocol.bindings.verifierId });
  const candidateMissing = selection.missing.filter((row) => row.participantType === "compiler-candidate");
  const baselineMissing = selection.missing.filter((row) => row.participantType !== "compiler-candidate");

  let selectedCandidateId = null;
  let confirmation = { status: "deferred-until-selection-complete", reusable: [], missing: [], safetyStopped: [] };
  if (candidateMissing.length === 0 && baselineMissing.length === 0) {
    const summaries = candidateParticipants.map((participant) => summarizePairedV7Participant(participant, selection.rowsByParticipant.get(participant.id), selectionCases.length));
    selectedCandidateId = rankPairedV7Eligible(summaries, positionById)[0]?.participantId ?? null;
    if (selectedCandidateId) {
      const confirmationRows = [...baseResult.finalConfirmation.observations, ...baseResult.baselines.confirmationObservations];
      const confirmationParticipants = [candidateParticipants.find((entry) => entry.id === selectedCandidateId), ...baselineParticipants];
      const planned = planPhase({ participants: confirmationParticipants, cases: confirmationCases, phase: "confirmation", rows: confirmationRows, verifierId: protocol.bindings.verifierId });
      confirmation = { status: planned.missing.length === 0 ? "fully-reusable" : "missing-observations-require-separate-approval", reusable: planned.reusable, missing: planned.missing, safetyStopped: planned.safetyStopped };
    } else confirmation = { status: "no-safe-winner", reusable: [], missing: [], safetyStopped: [] };
  }

  const upperBoundDeferredConfirmationObservations = selectedCandidateId === null && candidateMissing.length > 0 ? (1 + baselineParticipants.length) * confirmationCases.length : 0;
  const receipt = {
    schemaVersion: "das.candidate-scale-v7-prefix-40-reuse-plan.v1",
    extensionPlanHash: extensionPlan.extensionPlanHash,
    baseResultHash: baseResult.integrityHash,
    baseAnalysisHash: baseAnalysis.analysisHash,
    selection: {
      casesPerParticipant: selectionCases.length,
      frozenCandidateFinalists: candidateParticipants.length,
      baselines: baselineParticipants.length,
      reusableObservations: selection.reusable,
      missingCandidateObservations: candidateMissing,
      missingBaselineObservations: baselineMissing,
      safetyStopped: selection.safetyStopped,
      selectedCandidateId,
    },
    confirmation,
    maximumAdditionalObservationsBeforeEarlySafetyStops: candidateMissing.length + baselineMissing.length + confirmation.missing.length + upperBoundDeferredConfirmationObservations,
    paidExecutionAuthorized: false,
    nextGate: candidateMissing.length || baselineMissing.length ? "explicit approval bound to this reuse-plan hash before any missing selection observation" : selectedCandidateId ? "explicit approval bound to this reuse-plan hash before any missing confirmation observation" : "no paid extension work required",
    claimBoundary: extensionPlan.claimBoundary,
  };
  return Object.freeze({ ...receipt, reusePlanHash: digest(receipt) });
}
