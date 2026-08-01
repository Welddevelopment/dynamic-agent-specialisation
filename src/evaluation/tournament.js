import { runCandidateOnCases } from "./runner.js";

function dominates(a, b) {
  const noWorse = a.successRate >= b.successRate && a.safetyViolations <= b.safetyViolations && a.estimatedCostUsd <= b.estimatedCostUsd && a.estimatedLatencyMs <= b.estimatedLatencyMs;
  const better = a.successRate > b.successRate || a.safetyViolations < b.safetyViolations || a.estimatedCostUsd < b.estimatedCostUsd || a.estimatedLatencyMs < b.estimatedLatencyMs;
  return noWorse && better;
}

export function paretoFrontier(results) { return results.filter((candidate) => !results.some((other) => other.candidateId !== candidate.candidateId && dominates(other, candidate))); }

export function rankForPriorities(results, priorities) {
  return [...results].sort((a, b) => {
    if (a.safetyViolations !== b.safetyViolations) return a.safetyViolations - b.safetyViolations;
    const utility = (item) => item.successRate * priorities.qualityWeight - item.estimatedCostUsd * priorities.costWeight - (item.estimatedLatencyMs / 1000) * priorities.speedWeight - item.incorrectEscalations * priorities.escalationPenalty;
    return utility(b) - utility(a);
  });
}

export function runStagedTournament({ candidates, role, unseenCases, evidence }) {
  const stages = [
    { id: "smoke", cases: role.cases.development.slice(0, 2), keep: Math.min(6, candidates.length) },
    { id: "development", cases: role.cases.development, keep: Math.min(3, candidates.length) },
    { id: "validation", cases: role.cases.validation, keep: Math.min(2, candidates.length) },
  ];
  let survivors = candidates;
  const history = [];
  for (const stage of stages) {
    const results = survivors.map((candidate) => runCandidateOnCases({ candidate, role, cases: stage.cases, evidence }));
    const safe = results.filter((result) => result.safetyViolations === 0);
    const frontier = paretoFrontier(safe);
    const ranked = rankForPriorities(safe, role.brief.priorities.selection);
    const chosenIds = new Set([...frontier, ...ranked].slice(0, stage.keep).map((result) => result.candidateId));
    survivors = survivors.filter((candidate) => chosenIds.has(candidate.id));
    history.push({ stage: stage.id, results, survivors: survivors.map((candidate) => candidate.id) });
    if (!survivors.length) break;
  }
  const finalists = survivors.map((candidate) => runCandidateOnCases({ candidate, role, cases: unseenCases, evidence }));
  const safeFinalists = finalists.filter((result) => result.safetyViolations === 0);
  const rankedFinalists = rankForPriorities(safeFinalists, role.brief.priorities.selection);
  return { history, finalists, frontier: paretoFrontier(safeFinalists), recommendation: rankedFinalists[0] ?? null };
}
