import { digest } from "../../core/canonical.js";
import { candidateDesignFingerprint, candidateStructuralDistance, analyzeCandidateDiversity } from "./diversity.js";
import { PAIRED_STATIC_PRIOR } from "./paired-protocol.js";

const clamp = (value) => Math.max(0, Math.min(1, Number(value)));

export function pairedStaticPriorScore(candidate, brief) {
  const roleContext = Math.max(brief.environment.contextSources.length, 1); const roleTools = Math.max(brief.environment.tools.length, 1);
  const weights = candidate.strategy; const weightTotal = Math.max(weights.qualityWeight + weights.costWeight + weights.speedWeight, 1e-9);
  const components = {
    contextCoverage: clamp(candidate.context.sources.length / roleContext),
    toolCoverage: clamp(candidate.tools.length / roleTools),
    emphasisCoverage: clamp(candidate.instructions.emphasis.length / 8),
    normalizedQualityWeight: clamp(weights.qualityWeight / weightTotal),
    inverseRiskTolerance: clamp(1 - weights.riskTolerance),
    inverseCostLimit: clamp(1 - candidate.limits.maxCostPerTaskUsd / brief.priorities.maxCostPerTaskUsd),
    inverseLatencyLimit: clamp(1 - candidate.limits.maxLatencyMs / brief.priorities.maxLatencyMs),
  };
  const score = 0.30 * components.contextCoverage + 0.20 * components.toolCoverage + 0.15 * components.emphasisCoverage + 0.15 * components.normalizedQualityWeight + 0.10 * components.inverseRiskTolerance + 0.05 * components.inverseCostLimit + 0.05 * components.inverseLatencyLimit;
  return { score, components, priorHash: digest(PAIRED_STATIC_PRIOR) };
}

function ranked(records, brief) {
  return records.map((record) => ({ ...record, prior: pairedStaticPriorScore(record.candidate, brief) }))
    .sort((a, b) => b.prior.score - a.prior.score || a.acceptedPosition - b.acceptedPosition || a.candidate.id.localeCompare(b.candidate.id));
}

function selectDiverse(records, brief, maximum, minimumDistance) {
  const ordered = ranked(records, brief); const selected = []; const deferred = [];
  for (const record of ordered) {
    const nearest = selected.length ? Math.min(...selected.map((entry) => candidateStructuralDistance(record.candidate, entry.candidate).distance)) : 1;
    if (nearest >= minimumDistance) selected.push({ ...record, nearestSelectedDistance: nearest }); else deferred.push({ ...record, nearestSelectedDistance: nearest });
    if (selected.length >= maximum) break;
  }
  for (const record of deferred) if (selected.length < maximum) selected.push(record);
  return selected;
}

export function freezePairedStructuralSelection({ candidates, brief, prefixCount = 5, globalCount = 10, meaningfulDistance = 0.12 }) {
  const seen = new Map(); const exactDuplicates = []; const unique = [];
  candidates.forEach((candidate, index) => {
    const acceptedPosition = index + 1; const designFingerprint = candidateDesignFingerprint(candidate);
    if (seen.has(designFingerprint)) exactDuplicates.push({ candidateId: candidate.id, acceptedPosition, designFingerprint, inheritedFromCandidateId: seen.get(designFingerprint).candidate.id, inheritedFromPosition: seen.get(designFingerprint).acceptedPosition });
    else { const record = { candidate, acceptedPosition, designFingerprint }; seen.set(designFingerprint, record); unique.push(record); }
  });
  const firstFiveCandidateIds = candidates.slice(0, prefixCount).map((candidate) => candidate.id);
  const prefixUnique = unique.filter((record) => record.acceptedPosition <= prefixCount);
  const global = selectDiverse(unique, brief, Math.min(globalCount, unique.length), meaningfulDistance);
  const prefix = ranked(prefixUnique, brief);
  const union = new Map([...global, ...prefix].map((record) => [record.candidate.id, record]));
  const freeze = {
    schemaVersion: "das.candidate-scale-paired-structural-selection.v1",
    portfolioCount: candidates.length,
    firstFiveCandidateIds,
    exactUniqueCount: unique.length,
    exactDuplicates,
    diversity: analyzeCandidateDiversity(candidates, { meaningfulDistance }),
    structuralRows: unique.map((record) => ({ candidateId: record.candidate.id, acceptedPosition: record.acceptedPosition, candidateFingerprint: record.candidate.fingerprint, designFingerprint: record.designFingerprint, ...pairedStaticPriorScore(record.candidate, brief) })),
    globalFinalistIds: global.map((record) => record.candidate.id),
    protectedFirstFiveFinalistIds: prefix.map((record) => record.candidate.id),
    evaluationUnionIds: [...union.values()].sort((a, b) => a.acceptedPosition - b.acceptedPosition).map((record) => record.candidate.id),
    selectionRulesHash: digest({ prior: PAIRED_STATIC_PRIOR, prefixCount, globalCount, meaningfulDistance }),
    evidenceBoundary: "Zero-call structural validation, exact deduplication, diversity analysis and preregistered prior selection only. It contains no task-performance evidence.",
  };
  return Object.freeze({ ...freeze, freezeHash: digest(freeze) });
}

