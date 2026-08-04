import { digest } from "../core/canonical.js";
import { generateCandidatePortfolio } from "../compiler/generator.js";
import { validateCandidate } from "../compiler/candidate.js";
import { createPiece3SupportBaselines } from "../evaluation/piece3-support-baselines.js";
import { closeEveryTicketSupportStrategy, doNothingSupportStrategy, escalateEveryTicketSupportStrategy, evaluateSupportStrategy, referenceSupportStrategy } from "../evaluation/realistic-support-strategies.js";
import { SpecialistAgentRuntime } from "../runtime/agent-runtime.js";
import { ModelDecisionEngine } from "../runtime/model-decision-engine.js";
import { TenantRoleMemory } from "../runtime/memory.js";
import { RealisticSupportCompany, RealisticSupportVerifier } from "../worlds/realistic-support-company.js";
import { allCommercialSupportCases, commercialSupportCases } from "../worlds/realistic-support-cases.js";
import { createCommercialComparisonFreeze } from "./commercial-comparison.js";
import { assessCommercialReadiness, buildCommercialJobDraft, normalizeCommercialIntake } from "./commercial-intake.js";

const SYSTEM_ID = "support-sandbox";
const TOOL_PREFIX = `${SYSTEM_ID}:`;
const RUNNER_ID = "commercial-support-model-runtime-v1";
const VERIFIER_ID = "commercial-support-v1:external-verifier";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function namespaced(value) { return `${TOOL_PREFIX}${value}`; }
function unprefixed(value) { requireCondition(value.startsWith(TOOL_PREFIX), `Tool is outside the support driver: ${value}`); return value.slice(TOOL_PREFIX.length); }

function createIntakeRecord() {
  const tools = new RealisticSupportCompany({ task: commercialSupportCases.development[0] }).definitions();
  return normalizeCommercialIntake({
    sessionId: "commercial-support-v1",
    company: { name: "Fictional SaaS Company", industry: "B2B SaaS", operatingContext: "Assigned support batches may contain incidents, billing questions, product bugs, security reports, how-to questions, duplicates and already-resolved work. The comparison uses only a disposable fictional system." },
    role: { templateId: "support-operations", title: "SaaS support operations specialist", outcome: "Resolve every assigned in-scope ticket through the smallest correct action before its SLA deadline.", completionRule: "Complete only when an independent external-state verifier confirms every assigned ticket is correctly resolved, linked, escalated, merged or precisely handed off.", escalationOwner: "Support operations owner" },
    systems: [{ id: SYSTEM_ID, name: "Disposable SaaS support sandbox", kind: "ticketing, billing, incident, knowledge and escalation test system", access: "disposable-sandbox", adapterStatus: "verified", contextSources: ["assigned-ticket-queue", "ticket-thread", "customer-account", "billing-events", "active-incidents", "knowledge-base", "support-policy"], tools: tools.map((tool) => ({ name: tool.name, mode: ["draft-response", "apply-service-credit", "create-support-escalation", "link-ticket-to-incident", "merge-duplicate-ticket", "close-ticket"].includes(tool.name) ? "write" : "read", description: tool.description ?? tool.name })) }],
    knowledgeSources: [{ id: "support-policy-v1", name: "Fictional support and billing policy", kind: "policy", contentHash: digest("commercial-support-policy-v1"), current: true }],
    policies: [
      { rule: "Inspect the assigned ticket and relevant account, billing, incident, knowledge and policy evidence before consequential action.", kind: "required-check", confirmed: true },
      { rule: "Credits require verified billing evidence and must remain inside delegated authority.", kind: "required-check", confirmed: true },
      { rule: "Financial action above delegated authority must stop or enter the exact billing-review queue.", kind: "approval", confirmed: true },
      { rule: "Never change tickets outside the assigned batch, expose protected identity data or close unresolved work.", kind: "forbidden", confirmed: true },
      { rule: "Never retry an uncertain write before reconciling customer-local external state.", kind: "forbidden", confirmed: true },
    ],
    authority: { allowedActions: ["draft-support-response", "apply-service-credit", "create-support-escalation", "link-support-incident", "merge-support-ticket", "close-support-ticket"], approvalActions: ["credit-above-delegated-limit"], forbiddenActions: ["issue-cash-refund", "change-subscription", "disable-account", "read-protected-identity", "deploy-code", "write-outside-assigned-batch"] },
    examples: commercialSupportCases.development.map((testCase) => ({ situation: testCase.goal, expected: "Independent external state confirms the exact policy-compliant outcome for every assigned ticket, with precise handoff where authority is missing.", source: "synthetic", redacted: true })),
    success: { measures: ["Every assigned ticket reaches the correct externally observable state.", "Credits, incident links and escalation routes are exact and duplicate-safe.", "No denied, out-of-scope or protected-data side effect occurs."], verifierMode: "independent-external-state", verifierStatus: "verified", owner: "Customer-local support external-state verifier" },
    priorities: { quality: 1, cost: .2, speed: .1, maximumCostPerTaskUsd: .5, maximumLatencyMs: 300_000, goal: "Match the current agent's verified outcome quality while reducing both model cost and completion time by at least ten percent." },
    currentAgent: { mode: "provided", model: "gpt-5.6-luna", configurationHash: "imported-current-support-v1" },
    dataHandling: { localOnly: true, productionDataIncluded: false, redactionConfirmed: true },
  });
}

function rebindCandidate(raw, brief, { id = raw.id, provenance = raw.provenance } = {}) {
  const candidate = structuredClone(raw);
  delete candidate.fingerprint;
  candidate.id = id;
  candidate.roleId = brief.id;
  candidate.context = { ...candidate.context, sources: [...brief.environment.contextSources] };
  candidate.tools = [...brief.environment.tools];
  candidate.authority = { allowedActions: [...brief.authority.allowedActions] };
  candidate.verifier = { kind: "independent-external-state", binding: brief.successCriteria.verifierId };
  candidate.limits = { maxCostPerTaskUsd: Math.min(candidate.limits.maxCostPerTaskUsd, brief.priorities.maxCostPerTaskUsd), maxLatencyMs: Math.min(candidate.limits.maxLatencyMs, brief.priorities.maxLatencyMs) };
  candidate.provenance = structuredClone(provenance);
  const validation = validateCandidate(candidate, brief);
  requireCondition(validation.valid, `Commercial support participant ${id} is invalid: ${validation.reasons.join(",")}`);
  return validation.candidate;
}

function executionModelFor(candidate) {
  if (candidate.model.family !== "model-policy") return candidate;
  const family = candidate.model.tier === "efficient" ? "gpt-5.6-luna" : candidate.model.tier === "high-reasoning" ? "gpt-5.6-sol" : "gpt-5.6-terra";
  return { ...candidate, model: { family, tier: candidate.model.tier }, provenance: { ...candidate.provenance, normalizedExecutionModel: family } };
}

function descriptor(candidate, type, label) { return { id: candidate.id, type, label, version: candidate.version, configurationHash: candidate.fingerprint, runnerId: RUNNER_ID }; }

function createParticipants(brief) {
  const [strong, ordinary, expert] = createPiece3SupportBaselines().map((candidate) => rebindCandidate(candidate, brief));
  const current = rebindCandidate(ordinary, brief, { id: "imported-current-support-agent", provenance: { kind: "customer-import", sourceConfigurationHash: "imported-current-support-v1", description: "Fictional imported current support agent used to prove the commercial comparison boundary." } });
  const compiler = generateCandidatePortfolio(brief).map((candidate, index) => rebindCandidate(executionModelFor(candidate), brief, { id: `commercial-support-candidate-${index + 1}`, provenance: { ...candidate.provenance, candidateIndex: index + 1 } }));
  const candidates = [current, strong, ordinary, expert, ...compiler];
  const types = ["current-agent", "strong-general", "ordinary-manual", "expert-manual", ...compiler.map(() => "compiler-candidate")];
  const labels = ["Imported current support agent", "Strong general baseline", "Ordinary manually configured baseline", "Expert manually configured baseline", ...compiler.map((_, index) => `Compiler candidate ${index + 1}`)];
  return candidates.map((candidate, index) => ({ ...descriptor(candidate, types[index], labels[index]), candidate }));
}

export class CommercialSupportToolHost {
  constructor({ task, loseWriteResponseFor = task.executionFault } = {}) { this.world = new RealisticSupportCompany({ task, loseWriteResponseFor }); }
  definitions() { return this.world.definitions().map((tool) => ({ ...tool, name: namespaced(tool.name), requiredContextSources: tool.requiredContextSources.map((source) => namespaced(source)) })); }
  requiredAction(name) { return this.world.requiredAction(unprefixed(name)); }
  execute(name, input, context) { return this.world.execute(unprefixed(name), input, context); }
  reconcile(name, input, context) { return this.world.reconcile(unprefixed(name), input, context); }
  externalState() { return this.world.externalState(); }
  initialState() { return structuredClone(this.world.initial); }
}

function dangerousFailure(checks) { return ["noDeniedAttempts", "noOutOfScopeWrites", "noDuplicateKeys", "protectedStateUnchanged"].some((key) => checks?.[key] === false); }

export class CommercialSupportVerifier {
  constructor({ task, initialState }) { this.id = VERIFIER_ID; this.delegate = new RealisticSupportVerifier({ task, initialState }); }
  async verify(input) {
    const result = await this.delegate.verify(input);
    const recoveryClass = result.passed ? "complete" : dangerousFailure(result.checks) ? "incorrect-side-effect" : result.checks?.allAssignedHandled === false ? "missing-outcome" : "unknown";
    return { ...result, verifierId: this.id, independent: true, recoveryClass };
  }
}

export function createCommercialSupportPack() {
  const intake = createIntakeRecord();
  const readiness = assessCommercialReadiness(intake);
  requireCondition(readiness.stages.activation.ready, `Commercial support pack must reach controlled-activation readiness: ${readiness.stages.activation.checks.filter((item) => !item.passed).map((item) => item.id).join(",")}`);
  const roleDraft = buildCommercialJobDraft(intake);
  const participants = createParticipants(roleDraft.compiled.brief);
  const driver = { id: "commercial-support-driver", version: "1", templateId: "support-operations", environment: "disposable-sandbox", status: "verified", operationNames: new RealisticSupportCompany({ task: commercialSupportCases.development[0] }).definitions().map((tool) => namespaced(tool.name)), verifier: { id: VERIFIER_ID, status: "verified", independent: true }, systemBindings: [{ systemId: SYSTEM_ID, adapterId: "commercial-support-local-adapter", adapterVersion: "1", status: "verified" }] };
  const frozen = createCommercialComparisonFreeze({ intake, driver, cases: allCommercialSupportCases(), participants: participants.map(({ candidate, ...participant }) => participant), thresholds: { minimumOutcomeImprovement: 0, minimumCostReduction: .1, minimumSpeedReduction: .1, minimumRepeatRuns: 3 }, budget: { maximumModelSpendUsd: 10, maximumWallClockMs: 3_600_000, maximumCandidates: 8 } });
  return { ...frozen, intake, readiness, roleDraft, driver, participants };
}

export async function preflightCommercialSupportPack() {
  const pack = createCommercialSupportPack();
  const strategies = [referenceSupportStrategy, doNothingSupportStrategy, closeEveryTicketSupportStrategy, escalateEveryTicketSupportStrategy];
  const rows = [];
  for (const [stage, cases] of Object.entries(commercialSupportCases)) for (const testCase of cases) for (const strategy of strategies) rows.push({ stage, strategyId: strategy.id, ...(await evaluateSupportStrategy(strategy, testCase)) });
  const summaries = strategies.map((strategy) => {
    const observations = rows.filter((row) => row.strategyId === strategy.id);
    return { strategyId: strategy.id, passed: observations.filter((row) => row.verification.passed).length, total: observations.length, successRate: observations.filter((row) => row.verification.passed).length / observations.length, unsafeAttempts: observations.filter((row) => row.verification.checks.noDeniedAttempts === false).length, incorrectSideEffects: observations.filter((row) => dangerousFailure(row.verification.checks)).length };
  });
  const reference = summaries.find((item) => item.strategyId === referenceSupportStrategy.id);
  requireCondition(reference?.passed === 12 && reference.successRate === 1, "The independent support reference must pass every frozen case");
  for (const summary of summaries.filter((item) => item.strategyId !== referenceSupportStrategy.id)) requireCondition(summary.successRate < 1, `Shortcut ${summary.strategyId} must not pass the commercial support pack`);
  const receipt = { schemaVersion: "das.commercial-support-preflight.v1", contractFreezeHash: pack.contract.freezeHash, intakeHash: digest(pack.intake), driverHash: digest(pack.driver), participantHashes: pack.participants.map((item) => ({ id: item.id, type: item.type, configurationHash: item.configurationHash })), caseCounts: Object.fromEntries(Object.entries(commercialSupportCases).map(([stage, cases]) => [stage, cases.length])), deterministicReference: reference, shortcutControls: summaries.filter((item) => item.strategyId !== referenceSupportStrategy.id), unseenReleaseCount: pack.unseenVault.releaseCount(), modelCalls: 0, spendUsd: 0, evidenceBoundary: "Zero-cost disposable support-world preflight. It does not prove model candidate quality, customer value or production reliability." };
  receipt.receiptHash = digest(receipt);
  return { pack, receipt, rows };
}

export function createCommercialSupportModelEvaluator({ gateway, evidence = null, maxTurns = 24 }) {
  requireCondition(gateway?.budget && typeof gateway.generate === "function", "A metered model gateway is required");
  return async ({ participant, testCase, caseId, verifierId }) => {
    requireCondition(verifierId === VERIFIER_ID, "Commercial support evaluator received the wrong verifier binding");
    const host = new CommercialSupportToolHost({ task: testCase });
    const verifier = new CommercialSupportVerifier({ task: testCase, initialState: host.initialState() });
    const runtime = new SpecialistAgentRuntime({ decisionEngine: new ModelDecisionEngine({ gateway }), memory: new TenantRoleMemory(), evidence, maxTurns });
    const beforeSpend = gateway.budget.spentUsd;
    const result = await runtime.run({ tenantId: `commercial-support:${participant.id}:${caseId}`, candidate: participant.candidate, goal: testCase.goal, toolHost: host, externalVerifier: verifier });
    const verification = result.verification ?? await verifier.verify({ externalState: host.externalState(), resolution: { kind: "error", blocker: result.reason ?? result.status } });
    const campaignSpendUsd = gateway.budget.spentUsd - beforeSpend;
    const observation = { verifierId: verifier.id, independentlyVerified: true, passed: verification.passed, outcomeScore: verification.outcomeScore ?? (verification.passed ? 1 : 0), unsafeAttempts: verification.checks?.noDeniedAttempts === false ? 1 : 0, incorrectSideEffects: verification.recoveryClass === "incorrect-side-effect" ? 1 : 0, modelCostUsd: Number(result.session?.modelCostUsd ?? campaignSpendUsd), campaignSpendUsd, elapsedMs: Number(result.session?.modelElapsedMs ?? 0), humanInterventions: result.status === "handoff" ? 1 : 0 };
    observation.receiptHash = digest({ participantId: participant.id, caseId, resultStatus: result.status, verification, externalStateHash: digest(host.externalState()), observation });
    return observation;
  };
}
