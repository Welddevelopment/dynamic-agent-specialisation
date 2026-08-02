import { digest } from "../core/canonical.js";
import { assessAgainstContract, rankPlausibleAssessments, summarizeMeasurements } from "./measurement.js";

export class TargetDrivenImprovementController {
  constructor({ contract, evaluate, refine, spentUsd = () => 0, estimatePotential = null, now = () => Date.now(), evidence = null }) {
    this.contract = contract;
    this.evaluate = evaluate;
    this.refine = refine;
    this.spentUsd = spentUsd;
    this.estimatePotential = estimatePotential;
    this.now = now;
    this.evidence = evidence;
  }

  async run({ baseline, initialCandidates }) {
    const startedSpendUsd = this.spentUsd();
    const startedAtMs = this.now();
    const baselineObservations = await this.evaluate(baseline, { kind: "baseline", round: 0 });
    const baselineSummary = summarizeMeasurements(baseline.id, baselineObservations);
    const rounds = [];
    let candidates = [...initialCandidates];
    const evaluatedFingerprints = new Set();
    let winner = null;
    let best = null;
    let previousFrontierScore = -Infinity;
    let stagnantRounds = 0;
    let stopReason = "no-candidates-remained";

    for (let round = 1; round <= this.contract.limits.maximumRounds && candidates.length; round += 1) {
      const results = [];
      for (const candidate of candidates) {
        const fingerprint = candidate.fingerprint ?? digest(candidate);
        if (evaluatedFingerprints.has(fingerprint)) continue;
        evaluatedFingerprints.add(fingerprint);
        const observations = await this.evaluate(candidate, { kind: "candidate", round });
        const summary = summarizeMeasurements(candidate.id, observations);
        const assessment = assessAgainstContract({ contract: this.contract, baseline: baselineSummary, candidate: summary });
        results.push({ candidate, fingerprint, summary, assessment });
        this.evidence?.append("improvement.candidate-evaluated", { round, candidateId: candidate.id, fingerprint, summary, assessment });
      }
      const ranked = rankPlausibleAssessments(results.map((item) => item.assessment));
      const ordered = ranked.map((assessment) => results.find((item) => item.candidate.id === assessment.candidateId));
      const frontierScore = ordered.length ? objectiveFrontierScore(ordered[0].assessment) : -Infinity;
      if (frontierScore - previousFrontierScore < this.contract.stopPolicy.minimumMaterialProgress) stagnantRounds += 1;
      else stagnantRounds = 0;
      previousFrontierScore = Math.max(previousFrontierScore, frontierScore);
      if (!best || frontierScore > objectiveFrontierScore(best.assessment)) best = ordered[0] ?? best;
      rounds.push({ round, results: ordered.map(({ candidate, fingerprint, summary, assessment }) => ({ candidateId: candidate.id, fingerprint, summary, assessment })) });
      winner = ordered.find((item) => item.assessment.targetAchieved) ?? null;
      if (winner) { stopReason = "target-achieved"; break; }
      const campaignSpend = this.spentUsd() - startedSpendUsd;
      if (campaignSpend >= this.contract.limits.maximumModelSpendUsd) { stopReason = "hard-model-budget-reached"; break; }
      if (this.now() - startedAtMs >= this.contract.limits.maximumWallClockMs) { stopReason = "hard-time-budget-reached"; break; }
      if (round === this.contract.limits.maximumRounds) { stopReason = "maximum-rounds-reached"; break; }
      if (stagnantRounds >= this.contract.stopPolicy.maximumConsecutiveRoundsWithoutMaterialProgress) { stopReason = "marginal-progress-too-low"; break; }
      const plausible = [];
      for (const item of ordered) {
        if (!isRefinementPlausible(item, baselineSummary, this.contract)) continue;
        const probability = this.estimatePotential ? await this.estimatePotential({ candidate: item.candidate, summary: item.summary, assessment: item.assessment, round }) : null;
        if (probability !== null && probability < this.contract.stopPolicy.minimumEstimatedSuccessProbability) continue;
        plausible.push({ ...item, estimatedSuccessProbability: probability });
        if (plausible.length >= this.contract.limits.maximumRefinementsPerRound) break;
      }
      if (!plausible.length) { stopReason = "no-plausible-improvement-path"; break; }
      candidates = [];
      for (const parent of plausible) {
        const diagnosis = {
          qualityChecks: parent.assessment.qualityChecks,
          missedObjectives: Object.entries(parent.assessment.objectiveChecks).filter(([, value]) => !value.passed).map(([metric, value]) => ({ metric, ...value })),
          rule: "Improve only diagnosed misses; preserve all passing safety and quality behaviour; do not use validation or unseen cases.",
        };
        const child = await this.refine({ parent: parent.candidate, diagnosis, round, estimatedSuccessProbability: parent.estimatedSuccessProbability });
        if (child) candidates.push(child);
      }
    }
    const spent = this.spentUsd() - startedSpendUsd;
    const status = winner ? "target-achieved-on-development" : "target-not-achieved-within-limits";
    const result = {
      schemaVersion: 1,
      contract: this.contract,
      baseline: baselineSummary,
      rounds,
      status,
      provisionalWinner: winner ? { candidate: winner.candidate, summary: winner.summary, assessment: winner.assessment } : null,
      bestCandidateFound: best ? { candidate: best.candidate, summary: best.summary, assessment: best.assessment } : null,
      spentUsd: spent,
      stopReason,
      unseenCasesReleased: false,
      resultHash: null,
    };
    result.resultHash = digest({ ...result, resultHash: null });
    this.evidence?.append("improvement.completed", { status, resultHash: result.resultHash, spentUsd: spent, winnerId: winner?.candidate.id ?? null });
    return result;
  }
}

function objectiveFrontierScore(assessment) {
  if (!assessment) return -Infinity;
  const objectiveScore = Object.values(assessment.objectiveChecks).reduce((sum, item) => sum + Math.min(item.observedImprovement, item.target), 0);
  return objectiveScore - (assessment.eligible ? 0 : 10);
}

function isRefinementPlausible(item, baseline, contract) {
  const passRatio = baseline.passRate === 0 ? 0 : item.summary.passRate / baseline.passRate;
  if (passRatio < contract.stopPolicy.minimumRefinementPassRateRatio) return false;
  if (item.summary.unsafeAttempts > contract.stopPolicy.maximumRefinementUnsafeAttempts) return false;
  const combinedGap = Object.values(item.assessment.objectiveChecks).reduce((sum, check) => sum + Math.max(0, check.gap), 0);
  return combinedGap <= contract.stopPolicy.maximumCombinedObjectiveGapForRefinement;
}
