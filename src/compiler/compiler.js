import { compileJobBrief } from "./job-brief.js";
import { generateCandidatePortfolio } from "./generator.js";
import { validateCandidate, differenceDimensions } from "./candidate.js";
import { createBaselines } from "../evaluation/baselines.js";
import { freezeEvaluation, assertFreezeIntact } from "../evaluation/freeze.js";
import { runStagedTournament } from "../evaluation/tournament.js";
import { runCandidateOnCases } from "../evaluation/runner.js";
import { proposeControlledRefinements } from "./refinement.js";

export function compileSpecialist({ role, registry, evidence, knowledge = null }) {
  const compiled = compileJobBrief(role.brief);
  if (compiled.readiness !== "ready") throw new Error(`Job brief blocked: ${compiled.missing.join(",")}`);
  const priorSpecialists = registry.search({ roleTags: role.tags, environmentTags: role.brief.environment.tags });
  const knowledgeEntries = knowledge ? knowledge.query(["general", ...role.tags]) : [];
  const proposed = generateCandidatePortfolio(compiled.brief, { priorSpecialists, knowledgeEntries });
  const validations = proposed.map((candidate) => validateCandidate(candidate, compiled.brief));
  for (const validation of validations) evidence.append(validation.valid ? "candidate.admitted" : "candidate.rejected", { candidateId: validation.candidate.id, reasons: validation.reasons });
  const initialCandidates = validations.filter((entry) => entry.valid).map((entry) => entry.candidate);
  const developmentResults = initialCandidates.map((candidate) => runCandidateOnCases({ candidate, role, cases: role.cases.development, evidence }));
  const proposedRefinements = proposeControlledRefinements({ candidates: initialCandidates, developmentResults, brief: compiled.brief });
  const refinementValidations = proposedRefinements.map((candidate) => validateCandidate(candidate, compiled.brief));
  for (const validation of refinementValidations) evidence.append(validation.valid ? "candidate.refined" : "candidate.refinement-rejected", { candidateId: validation.candidate.id, reasons: validation.reasons, provenance: validation.candidate.provenance });
  const candidates = [...initialCandidates, ...refinementValidations.filter((entry) => entry.valid).map((entry) => entry.candidate)];
  if (candidates.length < 3) throw new Error("Compiler produced fewer than three valid candidates");
  const distinctPairs = candidates.flatMap((candidate, index) => candidates.slice(index + 1).map((other) => differenceDimensions(candidate, other)));
  if (!distinctPairs.some((dimensions) => dimensions.length >= 4)) throw new Error("Candidate portfolio lacks meaningful architectural diversity");
  const baselines = createBaselines(compiled.brief);
  const freeze = freezeEvaluation({ role, candidates, baselines });
  evidence.append("evaluation.frozen", freeze);
  const unseenCases = role.unseen.release({ freezeHash: freeze.freezeHash, role: role.id, candidateHashes: freeze.candidates, baselineHashes: freeze.baselines });
  evidence.append("unseen.released", { roleId: role.id, freezeHash: freeze.freezeHash, count: unseenCases.length });
  const tournament = runStagedTournament({ candidates, role, unseenCases, evidence });
  const baselineResults = baselines.map((candidate) => runCandidateOnCases({ candidate, role, cases: unseenCases, evidence }));
  assertFreezeIntact(freeze, { role, candidates, baselines });
  if (!tournament.recommendation) throw new Error("No safe finalist survived");
  const winner = candidates.find((candidate) => candidate.id === tournament.recommendation.candidateId);
  const compatibility = { roleTags: role.tags, environmentTags: role.brief.environment.tags, policyHash: freeze.freezeHash };
  const retained = registry.retainSpecialist({ candidate: winner, evidence: tournament.recommendation, compatibility, status: "recommended" });
  const alternatives = tournament.frontier.filter((item) => item.candidateId !== retained.id).map((item) => {
    const alternative = candidates.find((candidate) => candidate.id === item.candidateId);
    return registry.retainSpecialist({ candidate: alternative, evidence: item, compatibility, status: "available-alternative" });
  });
  evidence.append("specialist.recommended", { specialistId: retained.id, result: tournament.recommendation, alternatives: alternatives.map((item) => item.id) });
  return { brief: compiled.brief, candidates, baselines, baselineResults, freeze, tournament, retained, alternatives };
}
