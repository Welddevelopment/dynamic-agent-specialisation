export function createBaselines(brief) {
  const base = {
    roleId: brief.id,
    authority: { allowedActions: brief.authority.allowedActions },
    escalation: { enabled: true, threshold: 0.25, mode: "precise-blocker" },
    verifier: { kind: "independent-external-state", binding: brief.successCriteria.verifierId },
    version: "1.0.0",
  };
  return [
    {
      ...base, id: `${brief.id}:baseline-general`, model: { family: "baseline", tier: "general" },
      instructions: { style: "generic", emphasis: ["complete-task", "follow-policy"] },
      context: { sources: brief.environment.contextSources.slice(0, 2), selection: "all-provided" },
      tools: brief.environment.tools, memory: { kind: "conversation", scope: "single-task" },
      limits: { maxCostPerTaskUsd: brief.priorities.maxCostPerTaskUsd * .5, maxLatencyMs: brief.priorities.maxLatencyMs * .6 },
      strategy: { qualityWeight: .5, costWeight: .25, speedWeight: .25, riskTolerance: .25, requireCompleteContext: false },
      provenance: { kind: "baseline", type: "strong-general", effortProtocol: { setupBudgetMinutes: 10, observedSessionRequired: true } },
    },
    {
      ...base, id: `${brief.id}:baseline-ordinary`, model: { family: "baseline", tier: "balanced" },
      instructions: { style: "role-specific", emphasis: ["outcome", "policy", "escalation"] },
      context: { sources: brief.environment.contextSources, selection: "full-bounded" },
      tools: brief.environment.tools, memory: { kind: "task-ledger", scope: "role-and-tenant" },
      limits: { maxCostPerTaskUsd: brief.priorities.maxCostPerTaskUsd * .55, maxLatencyMs: brief.priorities.maxLatencyMs * .7 },
      strategy: { qualityWeight: .65, costWeight: .2, speedWeight: .15, riskTolerance: .18, requireCompleteContext: true },
      provenance: { kind: "baseline", type: "ordinary-manual", effortProtocol: { setupBudgetMinutes: 180, observedSessionRequired: true } },
    },
    {
      ...base, id: `${brief.id}:baseline-expert`, model: { family: "baseline", tier: "high-reasoning" },
      instructions: { style: "expert-structured", emphasis: ["constraints", "counterexample-check", "external-outcome"] },
      context: { sources: brief.environment.contextSources, selection: "full-bounded" },
      tools: brief.environment.tools, memory: { kind: "decision-and-outcome-ledger", scope: "role-and-tenant" },
      limits: { maxCostPerTaskUsd: brief.priorities.maxCostPerTaskUsd * .95, maxLatencyMs: brief.priorities.maxLatencyMs * .95 },
      strategy: { qualityWeight: .85, costWeight: .05, speedWeight: .1, riskTolerance: .1, requireCompleteContext: true },
      provenance: { kind: "baseline", type: "expert-manual", effortProtocol: { setupBudgetMinutes: 960, observedSessionRequired: true } },
    },
  ];
}
