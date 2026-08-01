import { EvidenceLedger } from "./core/evidence.js";
import { SpecialistRegistry } from "./compiler/registry.js";
import { compileSpecialist } from "./compiler/compiler.js";
import { roles } from "./roles/index.js";
import { EngineeringKnowledgeBase } from "./compiler/knowledge.js";
import { seedGeneralEngineeringKnowledge, learnFromCompilation } from "./compiler/default-knowledge.js";
import { runAuthorityStressCampaign } from "./evaluation/adversarial-campaign.js";

export function runDeterministicReference() {
  const evidence = new EvidenceLedger();
  const registry = new SpecialistRegistry();
  const knowledge = new EngineeringKnowledgeBase();
  seedGeneralEngineeringKnowledge(knowledge);
  const results = roles.map((role) => {
    const result = compileSpecialist({ role, registry, evidence, knowledge });
    learnFromCompilation(knowledge, { role, result });
    const baselineResults = result.baselineResults;
    const expert = baselineResults.find((item) => item.candidate.provenance.type === "expert-manual");
    const ordinary = baselineResults.find((item) => item.candidate.provenance.type === "ordinary-manual");
    const winner = result.tournament.recommendation;
    const comparison = {
      winnerSuccessRate: winner.successRate,
      ordinarySuccessRate: ordinary.successRate,
      expertSuccessRate: expert.successRate,
      winnerHumanMinutes: null,
      ordinaryHumanMinutes: null,
      expertHumanMinutes: null,
      effortStatus: "prospective-ledger-not-yet-run",
      note: "Deterministic reference numbers validate measurement wiring only; model performance and human effort have not yet been measured.",
    };
    evidence.append("baselines.compared", { roleId: role.id, comparison });
    return { role, result, baselineResults, comparison };
  });
  const stress = runAuthorityStressCampaign({ candidates: results.flatMap(({ result }) => result.candidates), casesPerCandidate: 500 });
  evidence.append("authority.stress-campaign", stress);
  return { results, registry, knowledge, stress, evidence, evidenceValid: evidence.verify(), paidModelCostUsd: 0 };
}
