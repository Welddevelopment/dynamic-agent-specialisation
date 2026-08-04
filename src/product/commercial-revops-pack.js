import { digest } from "../core/canonical.js";
import { generateCandidatePortfolio } from "../compiler/generator.js";
import { validateCandidate } from "../compiler/candidate.js";
import { createPiece4RevopsBaselines } from "../evaluation/piece4-revops-baselines.js";
import { assignEveryLeadRevopsStrategy, doNothingRevopsStrategy, escalateEveryLeadRevopsStrategy, evaluateRevopsStrategy, referenceRevopsStrategy } from "../evaluation/realistic-revops-strategies.js";
import { SpecialistAgentRuntime } from "../runtime/agent-runtime.js";
import { ModelDecisionEngine } from "../runtime/model-decision-engine.js";
import { TenantRoleMemory } from "../runtime/memory.js";
import { RealisticRevopsCompany, RealisticRevopsVerifier } from "../worlds/realistic-revops-company.js";
import { allCommercialRevopsCases, commercialRevopsCases } from "../worlds/realistic-revops-cases.js";
import { createCommercialComparisonFreeze } from "./commercial-comparison.js";
import { assessCommercialReadiness, buildCommercialJobDraft, normalizeCommercialIntake } from "./commercial-intake.js";

const SYSTEM_ID = "revops-sandbox";
const TOOL_PREFIX = `${SYSTEM_ID}:`;
const RUNNER_ID = "commercial-revops-model-runtime-v1";
const VERIFIER_ID = "commercial-revops-v1:external-verifier";
function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function namespaced(value) { return `${TOOL_PREFIX}${value}`; }
function unprefixed(value) { requireCondition(value.startsWith(TOOL_PREFIX), `Tool is outside the RevOps driver: ${value}`); return value.slice(TOOL_PREFIX.length); }

function createIntakeRecord() {
  const tools = new RealisticRevopsCompany({ task: commercialRevopsCases.development[0] }).definitions();
  return normalizeCommercialIntake({
    sessionId: "commercial-revops-v1",
    company: { name: "Fictional B2B Company", industry: "B2B software", operatingContext: "Assigned lead batches may mix new prospects, duplicates, existing accounts, revoked consent, identity conflicts, partner referrals, unsupported territories and completed work. The comparison uses a disposable fictional CRM." },
    role: { templateId: "revenue-operations", title: "CRM and revenue-operations specialist", outcome: "Process every assigned lead through the smallest correct CRM route while preserving consent, identity, territory, ownership and account boundaries.", completionRule: "Complete only when an independent CRM-state verifier confirms every assigned lead was correctly routed, merged, linked, suppressed, escalated or left unchanged.", escalationOwner: "Revenue operations owner" },
    systems: [{ id: SYSTEM_ID, name: "Disposable CRM and routing sandbox", kind: "lead, contact, account, consent, territory and routing test system", access: "disposable-sandbox", adapterStatus: "verified", contextSources: ["assigned-lead-queue", "lead-record", "lead-index", "contact-index", "account-index", "consent-ledger", "territory-rules", "routing-policy"], tools: tools.map((tool) => ({ name: tool.name, mode: ["assign-lead-owner", "link-lead-to-account", "merge-duplicate-lead", "create-follow-up-task", "set-lead-disposition", "create-revops-escalation"].includes(tool.name) ? "write" : "read", description: tool.description ?? tool.name })) }],
    knowledgeSources: [{ id: "routing-policy-v1", name: "Fictional routing and consent policy", kind: "policy", contentHash: digest("commercial-revops-policy-v1"), current: true }],
    policies: [
      { rule: "Check the assigned lead, exact identity, account, consent, territory and routing policy before any write.", kind: "required-check", confirmed: true },
      { rule: "Revoked consent forbids outreach; identity conflict and unknown territory require exact review queues.", kind: "required-check", confirmed: true },
      { rule: "Ambiguous identity or territory must stop in the matching review queue without guessed assignment.", kind: "approval", confirmed: true },
      { rule: "Never write outside the assigned batch, overwrite account ownership, merge different people or access protected commercial records.", kind: "forbidden", confirmed: true },
      { rule: "Never retry an uncertain CRM write before reconciling actual external state.", kind: "forbidden", confirmed: true },
    ],
    authority: { allowedActions: ["assign-lead-owner", "link-lead-account", "merge-lead", "create-follow-up", "set-lead-disposition", "create-revops-escalation"], approvalActions: ["identity-review", "territory-review", "consent-review"], forbiddenActions: ["send-email", "change-account-owner", "delete-contact", "export-protected-data", "alter-consent", "change-territory-policy", "write-outside-assigned-batch"] },
    examples: commercialRevopsCases.development.map((testCase) => ({ situation: testCase.goal, expected: "Independent CRM state confirms one evidence-selected route per assigned lead and no unrelated write.", source: "synthetic", redacted: true })),
    success: { measures: ["Every assigned lead reaches the correct externally observable route.", "Identity, consent, territory and existing ownership remain correct.", "No denied, duplicate, out-of-scope or protected-data side effect occurs."], verifierMode: "independent-external-state", verifierStatus: "verified", owner: "Customer-local CRM external-state verifier" },
    priorities: { quality: 1, cost: .2, speed: .1, maximumCostPerTaskUsd: .55, maximumLatencyMs: 300_000, goal: "Match the current agent's verified outcome quality while reducing both model cost and completion time by at least ten percent." },
    currentAgent: { mode: "provided", model: "gpt-5.6-luna", configurationHash: "imported-current-revops-v1" },
    dataHandling: { localOnly: true, productionDataIncluded: false, redactionConfirmed: true },
  });
}

function rebindCandidate(raw, brief, { id = raw.id, provenance = raw.provenance } = {}) {
  const candidate = structuredClone(raw); delete candidate.fingerprint;
  candidate.id = id; candidate.roleId = brief.id;
  candidate.context = { ...candidate.context, sources: [...brief.environment.contextSources] };
  candidate.tools = [...brief.environment.tools]; candidate.authority = { allowedActions: [...brief.authority.allowedActions] };
  candidate.verifier = { kind: "independent-external-state", binding: brief.successCriteria.verifierId };
  candidate.limits = { maxCostPerTaskUsd: Math.min(candidate.limits.maxCostPerTaskUsd, brief.priorities.maxCostPerTaskUsd), maxLatencyMs: Math.min(candidate.limits.maxLatencyMs, brief.priorities.maxLatencyMs) };
  candidate.provenance = structuredClone(provenance);
  const validation = validateCandidate(candidate, brief); requireCondition(validation.valid, `Commercial RevOps participant ${id} is invalid: ${validation.reasons.join(",")}`); return validation.candidate;
}
function executionModelFor(candidate) { if (candidate.model.family !== "model-policy") return candidate; const family = candidate.model.tier === "efficient" ? "gpt-5.6-luna" : candidate.model.tier === "high-reasoning" ? "gpt-5.6-sol" : "gpt-5.6-terra"; return { ...candidate, model: { family, tier: candidate.model.tier }, provenance: { ...candidate.provenance, normalizedExecutionModel: family } }; }
function descriptor(candidate, type, label) { return { id: candidate.id, type, label, version: candidate.version, configurationHash: candidate.fingerprint, runnerId: RUNNER_ID }; }
function createParticipants(brief) {
  const [strong, ordinary, expert] = createPiece4RevopsBaselines().map((candidate) => rebindCandidate(candidate, brief));
  const current = rebindCandidate(ordinary, brief, { id: "imported-current-revops-agent", provenance: { kind: "customer-import", sourceConfigurationHash: "imported-current-revops-v1", description: "Fictional imported current CRM agent used to prove the commercial comparison boundary." } });
  const compiler = generateCandidatePortfolio(brief).map((candidate, index) => rebindCandidate(executionModelFor(candidate), brief, { id: `commercial-revops-candidate-${index + 1}`, provenance: { ...candidate.provenance, candidateIndex: index + 1 } }));
  const candidates = [current, strong, ordinary, expert, ...compiler];
  const types = ["current-agent", "strong-general", "ordinary-manual", "expert-manual", ...compiler.map(() => "compiler-candidate")];
  const labels = ["Imported current CRM agent", "Strong general baseline", "Ordinary manually configured baseline", "Expert manually configured baseline", ...compiler.map((_, index) => `Compiler candidate ${index + 1}`)];
  return candidates.map((candidate, index) => ({ ...descriptor(candidate, types[index], labels[index]), candidate }));
}

export class CommercialRevopsToolHost {
  constructor({ task, loseWriteResponseFor = task.executionFault } = {}) { this.world = new RealisticRevopsCompany({ task, loseWriteResponseFor }); }
  definitions() { return this.world.definitions().map((tool) => ({ ...tool, name: namespaced(tool.name), requiredContextSources: tool.requiredContextSources.map((source) => namespaced(source)) })); }
  requiredAction(name) { return this.world.requiredAction(unprefixed(name)); }
  execute(name, input, context) { return this.world.execute(unprefixed(name), input, context); }
  reconcile(name, input, context) { return this.world.reconcile(unprefixed(name), input, context); }
  externalState() { return this.world.externalState(); }
  initialState() { return structuredClone(this.world.initial); }
}
function dangerousFailure(verification) { return verification.recoveryClass === "unsafe" || verification.recoveryClass === "incorrect-side-effect" || ["noDeniedAttempts", "noOutOfScopeWrites", "noDuplicateKeys", "protectedStateUnchanged"].some((key) => verification.checks?.[key] === false); }
export class CommercialRevopsVerifier {
  constructor({ task, initialState }) { this.id = VERIFIER_ID; this.delegate = new RealisticRevopsVerifier({ task, initialState }); }
  async verify(input) { const result = await this.delegate.verify(input); return { ...result, verifierId: this.id, independent: true }; }
}

export function createCommercialRevopsPack() {
  const intake = createIntakeRecord(); const readiness = assessCommercialReadiness(intake);
  requireCondition(readiness.stages.activation.ready, `Commercial RevOps pack must reach controlled-activation readiness: ${readiness.stages.activation.checks.filter((item) => !item.passed).map((item) => item.id).join(",")}`);
  const roleDraft = buildCommercialJobDraft(intake); const participants = createParticipants(roleDraft.compiled.brief);
  const driver = { id: "commercial-revops-driver", version: "1", templateId: "revenue-operations", environment: "disposable-sandbox", status: "verified", operationNames: new RealisticRevopsCompany({ task: commercialRevopsCases.development[0] }).definitions().map((tool) => namespaced(tool.name)), verifier: { id: VERIFIER_ID, status: "verified", independent: true }, systemBindings: [{ systemId: SYSTEM_ID, adapterId: "commercial-revops-local-adapter", adapterVersion: "1", status: "verified" }] };
  const frozen = createCommercialComparisonFreeze({ intake, driver, cases: allCommercialRevopsCases(), participants: participants.map(({ candidate, ...participant }) => participant), thresholds: { minimumOutcomeImprovement: 0, minimumCostReduction: .1, minimumSpeedReduction: .1, minimumRepeatRuns: 3 }, budget: { maximumModelSpendUsd: 10, maximumWallClockMs: 3_600_000, maximumCandidates: 8 } });
  return { ...frozen, intake, readiness, roleDraft, driver, participants };
}

export async function preflightCommercialRevopsPack() {
  const pack = createCommercialRevopsPack(); const strategies = [referenceRevopsStrategy, doNothingRevopsStrategy, assignEveryLeadRevopsStrategy, escalateEveryLeadRevopsStrategy]; const rows = [];
  for (const [stage, cases] of Object.entries(commercialRevopsCases)) for (const testCase of cases) for (const strategy of strategies) rows.push({ stage, strategyId: strategy.id, ...(await evaluateRevopsStrategy(strategy, testCase)) });
  const summaries = strategies.map((strategy) => { const observations = rows.filter((row) => row.strategyId === strategy.id); return { strategyId: strategy.id, passed: observations.filter((row) => row.verification.passed).length, total: observations.length, successRate: observations.filter((row) => row.verification.passed).length / observations.length, unsafeAttempts: observations.filter((row) => row.verification.checks.noDeniedAttempts === false).length, incorrectSideEffects: observations.filter((row) => dangerousFailure(row.verification)).length }; });
  const reference = summaries.find((item) => item.strategyId === referenceRevopsStrategy.id); requireCondition(reference?.passed === 12 && reference.successRate === 1, "The independent RevOps reference must pass every frozen case");
  for (const summary of summaries.filter((item) => item.strategyId !== referenceRevopsStrategy.id)) requireCondition(summary.successRate < 1, `Shortcut ${summary.strategyId} must not pass the commercial RevOps pack`);
  const receipt = { schemaVersion: "das.commercial-revops-preflight.v1", contractFreezeHash: pack.contract.freezeHash, intakeHash: digest(pack.intake), driverHash: digest(pack.driver), participantHashes: pack.participants.map((item) => ({ id: item.id, type: item.type, configurationHash: item.configurationHash })), caseCounts: Object.fromEntries(Object.entries(commercialRevopsCases).map(([stage, cases]) => [stage, cases.length])), deterministicReference: reference, shortcutControls: summaries.filter((item) => item.strategyId !== referenceRevopsStrategy.id), unseenReleaseCount: pack.unseenVault.releaseCount(), modelCalls: 0, spendUsd: 0, evidenceBoundary: "Zero-cost disposable CRM preflight. It does not prove model candidate quality, customer value or production reliability." }; receipt.receiptHash = digest(receipt); return { pack, receipt, rows };
}

export function createCommercialRevopsModelEvaluator({ gateway, evidence = null, maxTurns = 24 }) {
  requireCondition(gateway?.budget && typeof gateway.generate === "function", "A metered model gateway is required");
  return async ({ participant, testCase, caseId, verifierId }) => {
    requireCondition(verifierId === VERIFIER_ID, "Commercial RevOps evaluator received the wrong verifier binding");
    const host = new CommercialRevopsToolHost({ task: testCase }); const verifier = new CommercialRevopsVerifier({ task: testCase, initialState: host.initialState() }); const runtime = new SpecialistAgentRuntime({ decisionEngine: new ModelDecisionEngine({ gateway }), memory: new TenantRoleMemory(), evidence, maxTurns }); const beforeSpend = gateway.budget.spentUsd;
    const result = await runtime.run({ tenantId: `commercial-revops:${participant.id}:${caseId}`, candidate: participant.candidate, goal: testCase.goal, toolHost: host, externalVerifier: verifier }); const verification = result.verification ?? await verifier.verify({ externalState: host.externalState(), resolution: { kind: "error", blocker: result.reason ?? result.status } }); const campaignSpendUsd = gateway.budget.spentUsd - beforeSpend;
    const observation = { verifierId: verifier.id, independentlyVerified: true, passed: verification.passed, outcomeScore: verification.outcomeScore ?? (verification.passed ? 1 : 0), unsafeAttempts: verification.checks?.noDeniedAttempts === false ? 1 : 0, incorrectSideEffects: dangerousFailure(verification) ? 1 : 0, modelCostUsd: Number(result.session?.modelCostUsd ?? campaignSpendUsd), campaignSpendUsd, elapsedMs: Number(result.session?.modelElapsedMs ?? 0), humanInterventions: result.status === "handoff" ? 1 : 0 }; observation.receiptHash = digest({ participantId: participant.id, caseId, resultStatus: result.status, verification, externalStateHash: digest(host.externalState()), observation }); return observation;
  };
}
