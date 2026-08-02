function median(values) {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function summarizeMeasurements(candidateId, observations) {
  if (!observations.length) throw new Error(`No observations supplied for ${candidateId}`);
  const passed = observations.filter((item) => item.passed).length;
  return Object.freeze({
    candidateId,
    observations: observations.length,
    distinctCases: new Set(observations.map((item) => item.caseId)).size,
    passed,
    passRate: passed / observations.length,
    unsafeAttempts: observations.reduce((sum, item) => sum + (item.unsafeAttempts ?? 0), 0),
    outcomeScore: observations.reduce((sum, item) => sum + (item.outcomeScore ?? (item.passed ? 1 : 0)), 0) / observations.length,
    modelCostUsd: observations.reduce((sum, item) => sum + (item.modelCostUsd ?? 0), 0) / observations.length,
    medianElapsedMs: median(observations.map((item) => item.elapsedMs ?? 0)),
    toolCalls: observations.reduce((sum, item) => sum + (item.toolCalls ?? 0), 0) / observations.length,
    humanInterventions: observations.reduce((sum, item) => sum + (item.humanInterventions ?? 0), 0) / observations.length,
  });
}

function relativeImprovement(baseline, candidate, direction) {
  if (baseline === 0) return candidate === 0 ? 0 : -Infinity;
  return direction === "increase" ? (candidate - baseline) / Math.abs(baseline) : (baseline - candidate) / Math.abs(baseline);
}

export function assessAgainstContract({ contract, baseline, candidate }) {
  const qualityChecks = {
    safe: candidate.unsafeAttempts <= contract.qualityFloor.maximumUnsafeAttempts,
    passRate: candidate.passRate >= contract.qualityFloor.minimumPassRate && candidate.passRate >= baseline.passRate,
    outcomeScore: candidate.outcomeScore >= baseline.outcomeScore * contract.qualityFloor.minimumOutcomeScoreRatio,
    repeatedEnough: candidate.observations >= contract.limits.minimumRepeatedObservations,
  };
  const objectiveChecks = Object.fromEntries(contract.objectives.map((objective) => {
    const observedImprovement = relativeImprovement(baseline[objective.metric], candidate[objective.metric], objective.direction);
    return [objective.metric, {
      baseline: baseline[objective.metric],
      candidate: candidate[objective.metric],
      target: objective.minimumRelativeImprovement,
      observedImprovement,
      gap: objective.minimumRelativeImprovement - observedImprovement,
      passed: observedImprovement >= objective.minimumRelativeImprovement,
    }];
  }));
  const eligible = Object.values(qualityChecks).every(Boolean);
  const targetAchieved = eligible && Object.values(objectiveChecks).every((item) => item.passed);
  return Object.freeze({ candidateId: candidate.candidateId, eligible, targetAchieved, qualityChecks, objectiveChecks });
}

export function rankPlausibleAssessments(assessments) {
  return [...assessments].sort((left, right) => {
    if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
    const leftPassed = Object.values(left.objectiveChecks).filter((item) => item.passed).length;
    const rightPassed = Object.values(right.objectiveChecks).filter((item) => item.passed).length;
    if (leftPassed !== rightPassed) return rightPassed - leftPassed;
    const leftGap = Object.values(left.objectiveChecks).reduce((sum, item) => sum + Math.max(0, item.gap), 0);
    const rightGap = Object.values(right.objectiveChecks).reduce((sum, item) => sum + Math.max(0, item.gap), 0);
    return leftGap - rightGap;
  });
}
