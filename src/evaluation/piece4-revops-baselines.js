import { validateCandidate } from "../compiler/candidate.js";
import { realisticRevopsBrief } from "../roles/realistic-revops.js";

const common = {
  roleId: realisticRevopsBrief.id,
  context: { sources: realisticRevopsBrief.environment.contextSources, selection: "Use only the assigned CRM batch and bounded evidence exposed by tools." },
  tools: realisticRevopsBrief.environment.tools,
  memory: { kind: "task-scoped", scope: "current assigned lead batch" },
  authority: { allowedActions: realisticRevopsBrief.authority.allowedActions },
  escalation: { enabled: true, threshold: 0, mode: "precise review queue only" },
  verifier: { kind: "independent-external-state", binding: realisticRevopsBrief.successCriteria.verifierId },
  limits: { maxCostPerTaskUsd: .55, maxLatencyMs: 300_000 },
  version: "1.0.0",
};

const raw = [
  {
    ...common, id: "revops-baseline-strong-general-terra", model: { family: "gpt-5.6-terra", tier: "balanced" },
    instructions: { style: "general-purpose CRM operations agent", emphasis: ["complete the assigned goal", "use available CRM evidence", "follow consent and authority", "avoid unsupported writes"] },
    strategy: { qualityWeight: .8, costWeight: .1, speedWeight: .1, riskTolerance: .08, requireCompleteContext: true },
    provenance: { kind: "baseline", type: "strong-general", setupProtocolId: "piece4-revops-strong-general-v1", description: "Strong general model with the full bounded tool surface and minimal RevOps configuration." },
  },
  {
    ...common, id: "revops-baseline-ordinary-manual-luna", model: { family: "gpt-5.6-luna", tier: "economy" },
    instructions: { style: "ordinary CRM lead-routing assistant", emphasis: ["work only the assigned lead queue", "check exact contact, account, consent and territory evidence", "merge exact duplicates and preserve existing account ownership", "create one appropriate next task for routable leads", "suppress revoked consent and escalate ambiguous identity or territory", "use idempotency keys and avoid duplicate writes"] },
    memory: { kind: "task-scoped", scope: "lead evidence, chosen route, actions and unresolved review items" },
    strategy: { qualityWeight: .8, costWeight: .15, speedWeight: .05, riskTolerance: .05, requireCompleteContext: true },
    provenance: { kind: "baseline", type: "ordinary-manual", setupProtocolId: "piece4-revops-ordinary-manual-v1", description: "Plausible manually configured CRM specialist without compiler search or failure-driven refinement." },
  },
  {
    ...common, id: "revops-baseline-expert-manual-sol", model: { family: "gpt-5.6-sol", tier: "frontier" },
    instructions: { style: "expert revenue-operations control loop", emphasis: ["enumerate every assigned lead and lock one evidence-selected route per lead", "consent is checked before routing and revoked consent forbids outreach", "conflicting identity evidence requires identity-review before account or territory routing", "merge only an exact canonical lead match", "existing account domain retains its current owner and gets one expansion-review task", "partner referral uses partner routing; otherwise use current territory rules", "unknown territory enters territory-review without assignment", "complete every required route outcome, use stable keys and reconcile uncertain writes before retry"] },
    memory: { kind: "task-scoped-audit", scope: "per-lead identity, consent, account, territory, chosen route, keys and reconciliation state" },
    strategy: { qualityWeight: 1, costWeight: .02, speedWeight: .03, riskTolerance: .01, requireCompleteContext: true },
    provenance: { kind: "baseline", type: "expert-manual", setupProtocolId: "piece4-revops-expert-manual-v1", description: "Carefully engineered specialist with explicit exposed-world controls and the strongest available model." },
  },
];

export function createPiece4RevopsBaselines() { return raw.map((candidate) => { const validation = validateCandidate(candidate, realisticRevopsBrief); if (!validation.valid) throw new Error(`Invalid RevOps baseline ${candidate.id}: ${validation.reasons.join(",")}`); return validation.candidate; }); }
