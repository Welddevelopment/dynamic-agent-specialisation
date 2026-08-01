function scoreOption(option, strategy) {
  const quality = option.metrics.quality ?? 0;
  const normalizedCost = 1 - Math.min(1, option.metrics.cost ?? 0);
  const normalizedSpeed = 1 - Math.min(1, option.metrics.latency ?? 0);
  return quality * strategy.qualityWeight + normalizedCost * strategy.costWeight + normalizedSpeed * strategy.speedWeight;
}

export function planWorkItem(candidate, observation) {
  const missing = observation.requiredContext.filter((key) => !candidate.context.sources.includes(key));
  if (missing.length && candidate.strategy.requireCompleteContext) return { kind: "escalate", reason: `missing-context:${missing.join(",")}` };
  const available = new Set(candidate.context.sources);
  const eligible = observation.options.filter((option) => {
    if ((option.requiresContext ?? []).some((key) => !available.has(key))) return false;
    if (option.policyViolations.length) return false;
    if (option.risk > candidate.strategy.riskTolerance) return false;
    return candidate.authority.allowedActions.includes(option.action);
  });
  if (!eligible.length) return { kind: "escalate", reason: "no-safe-authorized-option" };
  const ranked = eligible.map((option) => ({ option, score: scoreOption(option, candidate.strategy) })).sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  const runnerUp = ranked[1];
  const confidence = runnerUp ? Math.max(0, Math.min(1, winner.score - runnerUp.score + 0.5)) : 1;
  if (confidence < candidate.escalation.threshold) return { kind: "escalate", reason: "decision-uncertainty" };
  return { kind: "act", optionId: winner.option.id, action: winner.option.action, expectedEffect: winner.option.expectedEffect, score: winner.score, confidence };
}
