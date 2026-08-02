export function seedGeneralEngineeringKnowledge(knowledge) {
  const entries = [
    { id: "prior:structured-context", claim: "Structured bounded context is a candidate worth testing for multi-constraint roles.", source: "internal-design-prior", observedAt: "2026-08-02", scope: "candidate-generation-not-performance-proof", confidence: .5, tags: ["general", "operations", "support", "revops", "software", "finance"] },
    { id: "prior:external-verifier", claim: "Candidates whose outcome can be checked independently should be preferred for consequential work.", source: "internal-safety-prior", observedAt: "2026-08-02", scope: "hard-design-requirement", confidence: 1, tags: ["general"] },
    { id: "prior:structured-memory", claim: "A tenant-scoped decision/outcome ledger is a candidate worth testing for repeated operational work.", source: "internal-design-prior", observedAt: "2026-08-02", scope: "candidate-generation-not-performance-proof", confidence: .5, tags: ["operations", "support", "revops", "software", "finance"] },
    { id: "observation:per-item-route-ledger", claim: "In multi-record operational work, maintain a separate evidence-selected route and required-outcome checklist for every assigned item; finish every outcome on that route and audit all assigned items before completion, without allowing one item's route to bleed into another.", source: "piece4-revops-development-observation", observedAt: "2026-08-02", scope: "exposed-development-evidence-not-unseen-performance", confidence: .8, tags: ["operations", "revops", "support"] },
    { id: "observation:model-promotion-after-safe-planning-miss", claim: "When several economy-model configurations repeat the same safe planning error while a balanced-model baseline solves the same exposed workflow, test the strongest configurations unchanged on the balanced model before adding more prompt rules; reserve the frontier model for a later finalist only if balanced promotion fails.", source: "piece4-revops-development-comparison", observedAt: "2026-08-02", scope: "exposed-development-model-selection-evidence", confidence: .85, tags: ["general", "operations", "revops"] },
  ];
  for (const entry of entries) knowledge.add(entry);
}

export function learnFromCompilation(knowledge, { role, result }) {
  knowledge.add({
    id: `observation:${role.id}:${result.retained.id}`,
    claim: `${result.retained.id} survived the deterministic staged tournament for ${role.id}.`,
    source: `freeze:${result.freeze.freezeHash}`,
    observedAt: new Date().toISOString(),
    scope: "deterministic-reference-only-not-model-evidence",
    confidence: .35,
    tags: ["general", ...role.tags],
  });
}
