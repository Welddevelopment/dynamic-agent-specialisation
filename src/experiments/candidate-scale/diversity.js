import { digest } from "../../core/canonical.js";
import { differenceDimensions } from "../../compiler/candidate.js";

const DIMENSION_WEIGHTS = Object.freeze({
  model: 0.08,
  instructions: 0.20,
  context: 0.15,
  tools: 0.15,
  memory: 0.10,
  authority: 0.12,
  escalation: 0.07,
  strategy: 0.08,
  limits: 0.05,
});

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function setDistance(left = [], right = []) {
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]);
  if (!union.size) return 0;
  const intersection = [...a].filter((item) => b.has(item)).length;
  return 1 - intersection / union.size;
}

function categoricalDistance(left, right) {
  return digest(left) === digest(right) ? 0 : 1;
}

function relativeDistance(left, right, ceiling = 1) {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  return clamp(Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), ceiling));
}

export function candidateDesign(candidate) {
  const value = structuredClone(candidate);
  delete value.id;
  delete value.version;
  delete value.provenance;
  delete value.fingerprint;
  return value;
}

export function candidateDesignFingerprint(candidate) {
  return digest(candidateDesign(candidate));
}

export function candidateArchitectureSignature(candidate) {
  const thresholds = [0.10, 0.18, 0.26, 0.34, 0.50];
  const bucket = (value) => thresholds.findIndex((threshold) => Number(value) <= threshold);
  const limitBucket = (value, maximum) => Math.min(4, Math.floor(clamp(Number(value) / Math.max(Number(maximum), 1e-9)) * 5));
  const strategy = candidate.strategy ?? {};
  const signature = {
    model: candidate.model,
    instructionStyle: candidate.instructions?.style,
    emphasis: [...(candidate.instructions?.emphasis ?? [])].sort(),
    contextSelection: candidate.context?.selection,
    contextCoverage: candidate.context?.sources?.length ?? 0,
    tools: [...(candidate.tools ?? [])].sort(),
    memory: candidate.memory,
    authority: [...(candidate.authority?.allowedActions ?? [])].sort(),
    escalation: { mode: candidate.escalation?.mode, thresholdBucket: bucket(candidate.escalation?.threshold) },
    strategyOrder: ["qualityWeight", "costWeight", "speedWeight", "riskTolerance"].sort((a, b) => Number(strategy[b]) - Number(strategy[a])),
    requireCompleteContext: strategy.requireCompleteContext,
    limitBuckets: {
      cost: limitBucket(candidate.limits?.maxCostPerTaskUsd, 1),
      latency: limitBucket(candidate.limits?.maxLatencyMs, 600_000),
    },
  };
  return digest(signature);
}

export function candidateStructuralDistance(left, right) {
  const distances = {
    model: categoricalDistance(left.model, right.model),
    instructions: 0.45 * categoricalDistance(left.instructions?.style, right.instructions?.style)
      + 0.55 * setDistance(left.instructions?.emphasis, right.instructions?.emphasis),
    context: 0.40 * categoricalDistance(left.context?.selection, right.context?.selection)
      + 0.60 * setDistance(left.context?.sources, right.context?.sources),
    tools: setDistance(left.tools, right.tools),
    memory: categoricalDistance(left.memory, right.memory),
    authority: setDistance(left.authority?.allowedActions, right.authority?.allowedActions),
    escalation: 0.55 * categoricalDistance(left.escalation?.mode, right.escalation?.mode)
      + 0.45 * relativeDistance(left.escalation?.threshold, right.escalation?.threshold, 0.1),
    strategy: ["qualityWeight", "costWeight", "speedWeight", "riskTolerance"]
      .reduce((sum, key) => sum + relativeDistance(left.strategy?.[key], right.strategy?.[key], 0.1), 0) / 4,
    limits: 0.5 * relativeDistance(left.limits?.maxCostPerTaskUsd, right.limits?.maxCostPerTaskUsd, 0.01)
      + 0.5 * relativeDistance(left.limits?.maxLatencyMs, right.limits?.maxLatencyMs, 1_000),
  };
  const weighted = Object.entries(DIMENSION_WEIGHTS).reduce((sum, [key, weight]) => sum + distances[key] * weight, 0);
  return {
    distance: clamp(weighted),
    dimensionDifferences: differenceDimensions(left, right),
    components: distances,
  };
}

export function analyzeCandidateDiversity(candidates, { meaningfulDistance = 0.12 } = {}) {
  const exactGroups = new Map();
  const signatureGroups = new Map();
  for (const candidate of candidates) {
    const design = candidateDesignFingerprint(candidate);
    const signature = candidateArchitectureSignature(candidate);
    if (!exactGroups.has(design)) exactGroups.set(design, []);
    if (!signatureGroups.has(signature)) signatureGroups.set(signature, []);
    exactGroups.get(design).push(candidate.id);
    signatureGroups.get(signature).push(candidate.id);
  }

  const ordered = [...candidates].sort((a, b) => candidateDesignFingerprint(a).localeCompare(candidateDesignFingerprint(b)) || a.id.localeCompare(b.id));
  const representatives = [];
  const meaningfulAssignments = [];
  for (const candidate of ordered) {
    const nearest = representatives
      .map((representative) => ({ representative, ...candidateStructuralDistance(candidate, representative) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (!nearest || nearest.distance >= meaningfulDistance) representatives.push(candidate);
    meaningfulAssignments.push({ candidateId: candidate.id, representativeId: nearest && nearest.distance < meaningfulDistance ? nearest.representative.id : candidate.id, nearestDistance: nearest?.distance ?? null });
  }

  const pairwise = [];
  for (let left = 0; left < candidates.length; left += 1) for (let right = left + 1; right < candidates.length; right += 1) pairwise.push(candidateStructuralDistance(candidates[left], candidates[right]).distance);
  const architectureShares = [...signatureGroups.values()].map((group) => group.length / Math.max(candidates.length, 1));
  const simpsonConcentration = architectureShares.reduce((sum, share) => sum + share ** 2, 0);
  const sortedPairwise = [...pairwise].sort((a, b) => a - b);
  const percentile = (fraction) => sortedPairwise.length ? sortedPairwise[Math.min(sortedPairwise.length - 1, Math.floor(sortedPairwise.length * fraction))] : 0;
  return {
    candidateCount: candidates.length,
    exactUniqueDesigns: exactGroups.size,
    exactDuplicatePackages: [...exactGroups.values()].filter((group) => group.length > 1).reduce((sum, group) => sum + group.length - 1, 0),
    exactDuplicateGroups: [...exactGroups.entries()].filter(([, group]) => group.length > 1).map(([designFingerprint, candidateIds]) => ({ designFingerprint, candidateIds })),
    architectureSignatureCount: signatureGroups.size,
    effectiveUniqueArchitectureCount: simpsonConcentration ? 1 / simpsonConcentration : 0,
    meaningfulDistanceThreshold: meaningfulDistance,
    meaningfulUniqueDesignCount: representatives.length,
    meaningfulRepresentatives: representatives.map((candidate) => candidate.id),
    meaningfulAssignments,
    pairwiseDistance: {
      comparisons: pairwise.length,
      mean: pairwise.length ? pairwise.reduce((sum, value) => sum + value, 0) / pairwise.length : 0,
      p10: percentile(0.10),
      p50: percentile(0.50),
      p90: percentile(0.90),
    },
  };
}

export function selectDiverseCandidates(candidates, scoreFor, maximum, { minimumDistance = 0.12 } = {}) {
  const ranked = [...candidates].sort((a, b) => scoreFor(b) - scoreFor(a) || a.id.localeCompare(b.id));
  const selected = [];
  const deferred = [];
  for (const candidate of ranked) {
    if (selected.length >= maximum) break;
    const nearest = selected.length ? Math.min(...selected.map((other) => candidateStructuralDistance(candidate, other).distance)) : 1;
    if (nearest >= minimumDistance) selected.push(candidate);
    else deferred.push(candidate);
  }
  for (const candidate of deferred) if (selected.length < maximum) selected.push(candidate);
  return selected;
}
