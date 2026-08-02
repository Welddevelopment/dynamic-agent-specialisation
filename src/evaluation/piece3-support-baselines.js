import { validateCandidate } from "../compiler/candidate.js";
import { realisticSupportBrief } from "../roles/realistic-support.js";

const common = {
  roleId: realisticSupportBrief.id,
  context: { sources: realisticSupportBrief.environment.contextSources, selection: "Use the bounded assigned-queue context available through tools." },
  tools: realisticSupportBrief.environment.tools,
  memory: { kind: "task-scoped", scope: "current assigned support queue" },
  authority: { allowedActions: realisticSupportBrief.authority.allowedActions },
  escalation: { enabled: true, threshold: 0, mode: "precise blocker only" },
  verifier: { kind: "independent-external-state", binding: realisticSupportBrief.successCriteria.verifierId },
  limits: { maxCostPerTaskUsd: .5, maxLatencyMs: 300_000 },
  version: "1.0.0",
};

const raw = [
  {
    ...common,
    id: "support-baseline-strong-general-terra",
    model: { family: "gpt-5.6-terra", tier: "balanced" },
    instructions: { style: "general-purpose operations agent", emphasis: ["complete the assigned goal", "use available external evidence", "follow explicit policy and authority", "avoid unsupported actions"] },
    strategy: { qualityWeight: .8, costWeight: .1, speedWeight: .1, riskTolerance: .08, requireCompleteContext: true },
    provenance: { kind: "baseline", type: "strong-general", setupProtocolId: "piece3-support-strong-general-v1", description: "Strong general model with full tools and minimal support-specific configuration." },
  },
  {
    ...common,
    id: "support-baseline-ordinary-manual-luna",
    model: { family: "gpt-5.6-luna", tier: "economy" },
    instructions: { style: "ordinary SaaS support assistant", emphasis: ["work only the assigned queue", "inspect ticket, account, billing, incident, knowledge and policy evidence as relevant", "resolve ordinary issues with the smallest permitted action", "escalate exact blockers and never guess financial or security facts", "avoid duplicate adjustments and closures"] },
    memory: { kind: "task-scoped", scope: "ticket findings, action keys, completed items and unresolved blockers" },
    strategy: { qualityWeight: .8, costWeight: .15, speedWeight: .05, riskTolerance: .05, requireCompleteContext: true },
    provenance: { kind: "baseline", type: "ordinary-manual", setupProtocolId: "piece3-support-ordinary-manual-v1", description: "Plausible manually configured support specialist without compiler tournament or failure-driven refinement." },
  },
  {
    ...common,
    id: "support-baseline-expert-manual-sol",
    model: { family: "gpt-5.6-sol", tier: "frontier" },
    instructions: { style: "expert support operations control loop", emphasis: ["enumerate and finish every assigned ticket before completing or handing off", "distinguish active same-service incidents from unrelated noise", "verify settled duplicate billing evidence before exactly one bounded credit", "finish other safe tickets before a precise approval handoff", "route security to security-response without account mutation", "route reproducible bugs or unverified billing to the correct queue", "merge exact duplicates, make no action for resolved tickets", "use stable idempotency keys and reconcile uncertain writes before retry"] },
    memory: { kind: "task-scoped-audit", scope: "per-ticket evidence, selected route, action keys, blocked approvals and reconciliation state" },
    strategy: { qualityWeight: 1, costWeight: .02, speedWeight: .03, riskTolerance: .01, requireCompleteContext: true },
    provenance: { kind: "baseline", type: "expert-manual", setupProtocolId: "piece3-support-expert-manual-v1", description: "Carefully engineered specialist with explicit exposed-world controls and the strongest available model." },
  },
];

export function createPiece3SupportBaselines() {
  return raw.map((candidate) => {
    const validation = validateCandidate(candidate, realisticSupportBrief);
    if (!validation.valid) throw new Error(`Invalid Piece 3 support baseline ${candidate.id}: ${validation.reasons.join(",")}`);
    return validation.candidate;
  });
}
