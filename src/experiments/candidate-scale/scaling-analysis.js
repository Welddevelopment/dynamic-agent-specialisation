import { digest } from "../../core/canonical.js";
import { candidateArchitectureSignature, candidateDesignFingerprint } from "./diversity.js";

export const CANDIDATE_SCALE_PORTFOLIO_SIZES = Object.freeze([5, 10, 20, 40, 75, 150]);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function seededRandom(seed) {
  let state = Number.parseInt(digest(seed).slice(0, 8), 16) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function effectiveCount(values, keyFor) {
  const counts = new Map();
  for (const value of values) counts.set(keyFor(value), (counts.get(keyFor(value)) ?? 0) + 1);
  const concentration = [...counts.values()].reduce((sum, count) => sum + (count / Math.max(values.length, 1)) ** 2, 0);
  return concentration ? 1 / concentration : 0;
}

function portfolioMetrics(sample, topIds) {
  const safe = sample.filter((item) => item.summary.unsafeAttempts === 0 && item.summary.incorrectSideEffects === 0);
  const best = [...safe].sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id))[0] ?? null;
  return {
    candidateCount: sample.length,
    safeCandidateCount: safe.length,
    bestCandidateId: best?.candidate.id ?? null,
    bestResultScore: best?.score ?? null,
    foundTopPerformer: sample.some((item) => topIds.has(item.candidate.id)),
    exactUniqueDesignCount: new Set(sample.map((item) => candidateDesignFingerprint(item.candidate))).size,
    architectureSignatureCount: new Set(sample.map((item) => candidateArchitectureSignature(item.candidate))).size,
    effectiveUniqueArchitectureCount: effectiveCount(sample, (item) => candidateArchitectureSignature(item.candidate)),
    spendUsd: sample.reduce((sum, item) => sum + item.summary.campaignSpendUsd, 0),
    modelCalls: sample.reduce((sum, item) => sum + item.summary.modelCalls, 0),
    sequentialCandidateElapsedMs: sample.reduce((sum, item) => sum + item.summary.meanElapsedMs * item.summary.cases, 0),
  };
}

export function analyzeCandidateScalingCurve({
  candidates,
  comparableSummaries,
  sizes = CANDIDATE_SCALE_PORTFOLIO_SIZES,
  randomTrials = 500,
  seed = "candidate-scale-v1",
  scoreFor = (summary) => summary.meanOutcomeScore,
}) {
  requireCondition(Array.isArray(candidates) && candidates.length > 0, "Scaling analysis needs evaluated candidates");
  requireCondition(Array.isArray(comparableSummaries) && comparableSummaries.length === candidates.length, "Scaling analysis needs one comparable-stage summary per candidate");
  requireCondition(Number.isInteger(randomTrials) && randomTrials >= 50 && randomTrials <= 10_000, "Scaling analysis random trials must be between 50 and 10000");
  const summaries = new Map(comparableSummaries.map((summary) => [summary.candidateId, summary]));
  const pool = candidates.map((candidate) => {
    const summary = summaries.get(candidate.id);
    requireCondition(summary && summary.candidateFingerprint === candidate.fingerprint, `Comparable summary missing or mutated for ${candidate.id}`);
    return { candidate, summary, score: Number(scoreFor(summary)) };
  });
  requireCondition(pool.every((item) => Number.isFinite(item.score)), "Scaling analysis score must be finite for every candidate");
  const safePool = pool.filter((item) => item.summary.unsafeAttempts === 0 && item.summary.incorrectSideEffects === 0);
  requireCondition(safePool.length > 0, "Scaling analysis has no safe performer");
  const globalBest = Math.max(...safePool.map((item) => item.score));
  const topIds = new Set(safePool.filter((item) => Math.abs(item.score - globalBest) <= 1e-12).map((item) => item.candidate.id));
  const usableSizes = sizes.filter((size) => Number.isInteger(size) && size > 0 && size <= pool.length);
  requireCondition(usableSizes.length > 0, "None of the requested portfolio sizes fit the evaluated pool");

  const nestedOrder = shuffled(pool, seededRandom(`${seed}:nested`));
  const nested = usableSizes.map((size) => ({ size, ...portfolioMetrics(nestedOrder.slice(0, size), topIds) }));
  let priorBest = null;
  for (const row of nested) {
    row.marginalBestResultGain = priorBest == null || row.bestResultScore == null ? null : row.bestResultScore - priorBest;
    if (row.bestResultScore != null) priorBest = row.bestResultScore;
  }

  const random = usableSizes.map((size) => {
    const trials = [];
    const randomForSize = seededRandom(`${seed}:random:${size}`);
    for (let trial = 0; trial < randomTrials; trial += 1) trials.push(portfolioMetrics(shuffled(pool, randomForSize).slice(0, size), topIds));
    const bestScores = trials.map((item) => item.bestResultScore).filter((value) => value != null).sort((a, b) => a - b);
    return {
      size,
      trials: trials.length,
      probabilityOfFindingEvaluatedPoolTopPerformer: trials.filter((item) => item.foundTopPerformer).length / trials.length,
      meanBestResultScore: mean(bestScores),
      p10BestResultScore: bestScores[Math.min(bestScores.length - 1, Math.floor(bestScores.length * 0.10))] ?? null,
      p50BestResultScore: bestScores[Math.min(bestScores.length - 1, Math.floor(bestScores.length * 0.50))] ?? null,
      p90BestResultScore: bestScores[Math.min(bestScores.length - 1, Math.floor(bestScores.length * 0.90))] ?? null,
      meanExactUniqueDesignCount: mean(trials.map((item) => item.exactUniqueDesignCount)),
      meanArchitectureSignatureCount: mean(trials.map((item) => item.architectureSignatureCount)),
      meanEffectiveUniqueArchitectureCount: mean(trials.map((item) => item.effectiveUniqueArchitectureCount)),
      meanSpendUsd: mean(trials.map((item) => item.spendUsd)),
      meanModelCalls: mean(trials.map((item) => item.modelCalls)),
      meanSequentialCandidateElapsedMs: mean(trials.map((item) => item.sequentialCandidateElapsedMs)),
    };
  });
  for (let index = 0; index < random.length; index += 1) random[index].marginalMeanBestResultGain = index === 0 ? null : random[index].meanBestResultScore - random[index - 1].meanBestResultScore;

  const report = {
    schemaVersion: "das.candidate-scale-curve.v1",
    metricScope: "comparable cheap viability screen",
    evaluatedPoolSize: pool.length,
    safePoolSize: safePool.length,
    requestedSizes: [...sizes],
    evaluatedSizes: usableSizes,
    evaluatedPoolTopScore: globalBest,
    evaluatedPoolTopCandidateIds: [...topIds],
    nested,
    random,
    interpretation: {
      topPerformer: "The best safe candidate in this evaluated pool on the supplied comparable-stage score; not a global optimum.",
      effectiveUniqueArchitectureCount: "Inverse Simpson concentration over coarse structural signatures. Repeated architecture families contribute less than genuinely varied families.",
      marginalGain: "Observed or simulated gain inside this frozen evaluated pool only.",
    },
    evidenceBoundary: "Portfolio resampling over one evaluated pool. It cannot establish a universal optimal candidate count or extrapolate beyond the role, candidate generator, evaluator, models and cases used.",
  };
  report.analysisHash = digest(report);
  return report;
}
