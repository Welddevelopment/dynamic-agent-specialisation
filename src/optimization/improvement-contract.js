const supportedMetrics = new Set(["modelCostUsd", "medianElapsedMs", "toolCalls", "outcomeScore", "humanInterventions"]);

function finiteNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a finite non-negative number`);
  return value;
}

export function createImprovementContract(input) {
  if (!input?.id) throw new Error("Improvement contract requires an id");
  if (!Array.isArray(input.objectives) || input.objectives.length === 0) throw new Error("At least one improvement objective is required");
  const seen = new Set();
  const objectives = input.objectives.map((objective) => {
    if (!supportedMetrics.has(objective.metric)) throw new Error(`Unsupported improvement metric: ${objective.metric}`);
    if (seen.has(objective.metric)) throw new Error(`Duplicate improvement metric: ${objective.metric}`);
    seen.add(objective.metric);
    const direction = objective.direction ?? (objective.metric === "outcomeScore" ? "increase" : "decrease");
    if (!["increase", "decrease"].includes(direction)) throw new Error(`${objective.metric} direction must be increase or decrease`);
    const minimumRelativeImprovement = finiteNonNegative(objective.minimumRelativeImprovement, `${objective.metric} target`);
    if (minimumRelativeImprovement >= 1) throw new Error(`${objective.metric} target must be below 100%`);
    return Object.freeze({ metric: objective.metric, direction, minimumRelativeImprovement });
  });
  const qualityFloor = Object.freeze({
    minimumPassRate: input.qualityFloor?.minimumPassRate ?? 1,
    minimumOutcomeScoreRatio: input.qualityFloor?.minimumOutcomeScoreRatio ?? 1,
    maximumUnsafeAttempts: input.qualityFloor?.maximumUnsafeAttempts ?? 0,
  });
  if (qualityFloor.minimumPassRate < 0 || qualityFloor.minimumPassRate > 1) throw new Error("Pass-rate floor must be between 0 and 1");
  if (qualityFloor.minimumOutcomeScoreRatio < 0) throw new Error("Outcome-score ratio cannot be negative");
  const limits = Object.freeze({
    maximumRounds: Math.max(1, Math.floor(input.limits?.maximumRounds ?? 4)),
    maximumRefinementsPerRound: Math.max(1, Math.floor(input.limits?.maximumRefinementsPerRound ?? 2)),
    maximumModelSpendUsd: finiteNonNegative(input.limits?.maximumModelSpendUsd ?? 5, "Model-spend limit"),
    maximumWallClockMs: finiteNonNegative(input.limits?.maximumWallClockMs ?? 3_600_000, "Wall-clock limit"),
    minimumRepeatedObservations: Math.max(1, Math.floor(input.limits?.minimumRepeatedObservations ?? 3)),
  });
  const stopPolicy = Object.freeze({
    maximumConsecutiveRoundsWithoutMaterialProgress: Math.max(1, Math.floor(input.stopPolicy?.maximumConsecutiveRoundsWithoutMaterialProgress ?? 2)),
    minimumMaterialProgress: finiteNonNegative(input.stopPolicy?.minimumMaterialProgress ?? 0.01, "Minimum material progress"),
    minimumEstimatedSuccessProbability: input.stopPolicy?.minimumEstimatedSuccessProbability ?? 0.15,
    minimumRefinementPassRateRatio: input.stopPolicy?.minimumRefinementPassRateRatio ?? 0.8,
    maximumRefinementUnsafeAttempts: Math.max(0, Math.floor(input.stopPolicy?.maximumRefinementUnsafeAttempts ?? 1)),
    maximumCombinedObjectiveGapForRefinement: input.stopPolicy?.maximumCombinedObjectiveGapForRefinement ?? 0.35,
  });
  return Object.freeze({
    schemaVersion: 1,
    id: input.id,
    baselineId: input.baselineId,
    objectives: Object.freeze(objectives),
    qualityFloor,
    limits,
    stopPolicy,
    selectionOrder: Object.freeze(["safety", "pass-rate", "outcome-score", ...objectives.map((item) => item.metric)]),
    noTargetWeakening: true,
    unseenCasesAvailableDuringImprovement: false,
  });
}

export function tenPercentCostAndSpeedContract({ id, baselineId, maximumRounds = 4, maximumModelSpendUsd = 5 } = {}) {
  return createImprovementContract({
    id,
    baselineId,
    objectives: [
      { metric: "modelCostUsd", minimumRelativeImprovement: 0.10 },
      { metric: "medianElapsedMs", minimumRelativeImprovement: 0.10 },
    ],
    qualityFloor: { minimumPassRate: 1, minimumOutcomeScoreRatio: 1, maximumUnsafeAttempts: 0 },
    limits: { maximumRounds, maximumRefinementsPerRound: 2, maximumModelSpendUsd, minimumRepeatedObservations: 3 },
  });
}
