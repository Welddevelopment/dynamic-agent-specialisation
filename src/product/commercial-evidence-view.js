import { digest } from "../core/canonical.js";
import { assertCommercialComparisonFreeze } from "./commercial-comparison.js";
import { assertCommercialComparisonResult, assertCommercialSpecialistBundle } from "./commercial-specialist-lifecycle.js";

function stageSummary(result, participantId) {
  return result.stageHistory.map((stage) => ({ stage: stage.stage, resultHash: stage.resultHash, summary: stage.summaries.find((item) => item.participantId === participantId) ?? null }));
}

function lossReason(selected, other) {
  if (other.unsafeAttempts > selected.unsafeAttempts) return "More unsafe attempts.";
  if (other.incorrectSideEffects > selected.incorrectSideEffects) return "More incorrect external side effects.";
  if (other.passRate < selected.passRate) return "Lower independently verified completion rate.";
  if (other.meanOutcomeScore < selected.meanOutcomeScore) return "Lower independently verified outcome score.";
  if (other.modelCostUsd > selected.modelCostUsd && other.meanElapsedMs > selected.meanElapsedMs) return "Equivalent verified outcome at higher cost and slower completion.";
  if (other.modelCostUsd > selected.modelCostUsd) return "Equivalent verified outcome at higher model cost.";
  if (other.meanElapsedMs > selected.meanElapsedMs) return "Equivalent verified outcome with slower completion.";
  return "Lower utility under the company's frozen quality, cost and speed priorities.";
}

export function buildCommercialEvidenceViews({ contract, result, bundle }) {
  assertCommercialComparisonFreeze(contract);
  assertCommercialComparisonResult(result);
  assertCommercialSpecialistBundle(bundle);
  const selected = result.rankedUnseen.find((item) => item.participantId === result.selectedParticipantId);
  const current = result.rankedUnseen.find((item) => item.type === "current-agent") ?? null;
  const executive = {
    recommendation: result.decision,
    selectedLabel: bundle.selected.label,
    role: bundle.role.title,
    improvementProved: result.improvementAssessment?.proved ?? result.decision === "retain-existing",
    safety: selected ? { unsafeAttempts: selected.unsafeAttempts, incorrectSideEffects: selected.incorrectSideEffects } : null,
    repeatRuns: result.repeatability.runs,
    boundary: "Recommendation from a frozen bounded comparison; customer and production value require controlled use.",
  };
  const technical = {
    selected: structuredClone(selected),
    current: structuredClone(current),
    improvementAssessment: structuredClone(result.improvementAssessment),
    candidate: {
      model: structuredClone(bundle.selected.candidate.model),
      instructions: structuredClone(bundle.selected.candidate.instructions),
      context: structuredClone(bundle.selected.candidate.context),
      tools: structuredClone(bundle.selected.candidate.tools),
      memory: structuredClone(bundle.selected.candidate.memory),
      authority: structuredClone(bundle.selected.candidate.authority),
      escalation: structuredClone(bundle.selected.candidate.escalation),
      verifier: structuredClone(bundle.selected.candidate.verifier),
      limits: structuredClone(bundle.selected.candidate.limits),
    },
    alternatives: result.rankedUnseen.filter((item) => item.participantId !== result.selectedParticipantId).map((item) => ({ ...structuredClone(item), whyNotSelected: selected ? lossReason(selected, item) : "Not selected by the frozen comparison." })),
    stageEvidence: stageSummary(result, result.selectedParticipantId),
  };
  const forensic = {
    contract: structuredClone(contract),
    result: structuredClone(result),
    bundle: structuredClone(bundle),
    integrity: { contractFreezeHash: contract.freezeHash, resultHash: result.resultHash, bundleHash: bundle.bundleHash },
  };
  const receipt = { schemaVersion: "das.commercial-evidence-views.v1", executive, technical, forensic };
  receipt.evidenceViewHash = digest(receipt);
  return Object.freeze(receipt);
}
