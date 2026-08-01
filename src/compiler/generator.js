function candidate(base, variant) {
  return {
    id: `${base.id}:${variant.id}`,
    roleId: base.id,
    model: variant.model,
    instructions: variant.instructions,
    context: { sources: variant.contextSources, selection: variant.contextSelection },
    tools: variant.tools,
    memory: variant.memory,
    authority: { allowedActions: structuredClone(base.authority.allowedActions) },
    escalation: variant.escalation,
    verifier: { kind: "independent-external-state", binding: base.successCriteria.verifierId },
    limits: variant.limits,
    strategy: variant.strategy,
    provenance: { kind: "compiler-generated", parents: variant.parents ?? [], rationale: variant.rationale },
    version: "1.0.0",
  };
}

export function generateCandidatePortfolio(brief, { priorSpecialists = [], knowledgeEntries = [] } = {}) {
  const maxCost = brief.priorities.maxCostPerTaskUsd;
  const maxLatency = brief.priorities.maxLatencyMs;
  const sources = brief.environment.contextSources;
  const tools = brief.environment.tools;
  const variants = [
    {
      id: "balanced", model: { family: "model-policy", tier: "balanced" },
      instructions: { style: "structured", emphasis: ["outcome", "policy", "safe-completion"] },
      contextSources: sources, contextSelection: "relevance-ranked",
      tools, memory: { kind: "structured-task-ledger", scope: "role-and-tenant" },
      escalation: { enabled: true, threshold: 0.25, mode: "precise-blocker" },
      limits: { maxCostPerTaskUsd: maxCost * 0.5, maxLatencyMs: maxLatency * 0.65 },
      strategy: { qualityWeight: 0.65, costWeight: 0.2, speedWeight: 0.15, riskTolerance: 0.2, requireCompleteContext: true },
      rationale: "Balanced quality, cost, speed, and safe completion.",
    },
    {
      id: "quality", model: { family: "model-policy", tier: "high-reasoning" },
      instructions: { style: "deliberative", emphasis: ["constraint-satisfaction", "counterexample-check", "outcome"] },
      contextSources: sources, contextSelection: "full-bounded",
      tools, memory: { kind: "decision-and-outcome-ledger", scope: "role-and-tenant" },
      escalation: { enabled: true, threshold: 0.18, mode: "precise-blocker" },
      limits: { maxCostPerTaskUsd: maxCost * 0.9, maxLatencyMs: maxLatency * 0.9 },
      strategy: { qualityWeight: 0.82, costWeight: 0.08, speedWeight: 0.1, riskTolerance: 0.12, requireCompleteContext: true },
      rationale: "Maximize externally verified quality within the declared operating ceiling.",
    },
    {
      id: "economy", model: { family: "model-policy", tier: "efficient" },
      instructions: { style: "concise", emphasis: ["policy", "minimum-sufficient-action"] },
      contextSources: sources.filter((_, index) => index < Math.max(1, Math.ceil(sources.length * 0.7))), contextSelection: "minimal-relevant",
      tools, memory: { kind: "compact-outcome-ledger", scope: "role-and-tenant" },
      escalation: { enabled: true, threshold: 0.32, mode: "precise-blocker" },
      limits: { maxCostPerTaskUsd: maxCost * 0.2, maxLatencyMs: maxLatency * 0.45 },
      strategy: { qualityWeight: 0.52, costWeight: 0.35, speedWeight: 0.13, riskTolerance: 0.18, requireCompleteContext: false },
      rationale: "Seek the lowest sustainable cost without crossing hard safety boundaries.",
    },
    {
      id: "conservative", model: { family: "model-policy", tier: "balanced" },
      instructions: { style: "verification-first", emphasis: ["authority", "uncertainty", "escalation"] },
      contextSources: sources, contextSelection: "full-bounded",
      tools, memory: { kind: "decision-and-outcome-ledger", scope: "role-and-tenant" },
      escalation: { enabled: true, threshold: 0.12, mode: "precise-blocker" },
      limits: { maxCostPerTaskUsd: maxCost * 0.65, maxLatencyMs: maxLatency * 0.8 },
      strategy: { qualityWeight: 0.72, costWeight: 0.08, speedWeight: 0.05, riskTolerance: 0.05, requireCompleteContext: true },
      rationale: "Prefer safe escalation over uncertain autonomous action.",
    },
  ];
  const reused = priorSpecialists.slice(0, 2).map((record, index) => ({
    ...structuredClone(record.candidate), id: `${brief.id}:adapted-${index + 1}`, roleId: brief.id,
    provenance: { kind: "adapted-proven-specialist", parents: [record.fingerprint], rationale: `Adapted from similarity score ${record.similarity}.` },
  }));
  return [...variants.map((variant) => {
    const generated = candidate(brief, variant);
    generated.provenance.knowledgeIds = knowledgeEntries.map((entry) => entry.id);
    return generated;
  }), ...reused];
}
