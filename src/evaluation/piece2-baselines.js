import { validateCandidate } from "../compiler/candidate.js";
import { realisticProcurementBrief } from "../roles/realistic-procurement.js";

const common = {
  roleId: realisticProcurementBrief.id,
  context: { sources: realisticProcurementBrief.environment.contextSources, selection: "Use the full bounded task context available through tools." },
  tools: realisticProcurementBrief.environment.tools,
  memory: { kind: "task-scoped", scope: "current bounded task" },
  authority: { allowedActions: realisticProcurementBrief.authority.allowedActions },
  escalation: { enabled: true, threshold: 0, mode: "precise blocker only" },
  verifier: { kind: "independent-external-state", binding: realisticProcurementBrief.successCriteria.verifierId },
  limits: { maxCostPerTaskUsd: .25, maxLatencyMs: 180_000 },
  version: "1.0.0",
};

const raw = [
  {
    ...common,
    id: "baseline-strong-general-terra",
    model: { family: "gpt-5.6-terra", tier: "balanced" },
    instructions: { style: "general-purpose agent", emphasis: ["complete the assigned goal", "use available evidence", "follow explicit policy"] },
    strategy: { qualityWeight: .8, costWeight: .1, speedWeight: .1, riskTolerance: .1, requireCompleteContext: true },
    provenance: { kind: "baseline", type: "strong-general", setupProtocolMinutes: 10, description: "Powerful general model with full tools/context but minimal procurement-specific engineering." },
  },
  {
    ...common,
    id: "baseline-ordinary-manual-luna",
    model: { family: "gpt-5.6-luna", tier: "economy" },
    instructions: { style: "ordinary procurement assistant", emphasis: ["cover approved shortages", "check stock and open orders", "use approved suppliers", "escalate beyond authority"] },
    memory: { kind: "task-scoped", scope: "observations and draft idempotency keys" },
    strategy: { qualityWeight: .8, costWeight: .15, speedWeight: .05, riskTolerance: .08, requireCompleteContext: true },
    provenance: { kind: "baseline", type: "ordinary-manual", setupProtocolMinutes: 180, description: "Plausible manually configured specialist without compiler tournament or failure-driven refinement." },
  },
  {
    ...common,
    id: "baseline-expert-manual-sol",
    model: { family: "gpt-5.6-sol", tier: "frontier" },
    instructions: { style: "expert procurement control loop", emphasis: ["bind every write to task.demandBatchId", "aggregate approved eligible demand", "subtract usable stock and confirmed inbound before action", "finish successfully when eligible work is empty", "prefer feasible transfer then approved on-time offer", "respect delegated authority", "use stable idempotency keys and reconcile unknown writes"] },
    memory: { kind: "task-scoped-audit", scope: "batch requirements, coverage calculation, action keys, reconciliation state" },
    strategy: { qualityWeight: 1, costWeight: .02, speedWeight: .03, riskTolerance: .01, requireCompleteContext: true },
    provenance: { kind: "baseline", type: "expert-manual", setupProtocolMinutes: 960, description: "Carefully engineered specialist given the strongest available model and explicit known failure controls." },
  },
];

export function createPiece2ModelBaselines() {
  return raw.map((candidate) => {
    const validation = validateCandidate(candidate, realisticProcurementBrief);
    if (!validation.valid) throw new Error(`Invalid Piece 2 baseline ${candidate.id}: ${validation.reasons.join(",")}`);
    return validation.candidate;
  });
}
