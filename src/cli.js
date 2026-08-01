import { runDeterministicReference } from "./run.js";

const command = process.argv[2] ?? "evaluate";
const run = runDeterministicReference();
if (command === "audit") {
  console.log(JSON.stringify({ evidenceValid: run.evidenceValid, records: run.evidence.records().length, roles: run.results.length, authorityStress: run.stress, paidModelCostUsd: run.paidModelCostUsd }, null, 2));
} else {
  console.log(JSON.stringify({
    status: "deterministic-reference-only", paidModelCostUsd: run.paidModelCostUsd, evidenceValid: run.evidenceValid,
    roles: run.results.map(({ role, result, comparison }) => ({ role: role.brief.role, candidates: result.candidates.length, recommendation: result.tournament.recommendation.candidateId, successRate: result.tournament.recommendation.successRate, alternatives: result.tournament.frontier.map((item) => item.candidateId), comparison })),
  }, null, 2));
}
