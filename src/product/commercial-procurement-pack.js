import { digest } from "../core/canonical.js";
import { createPiece2ModelBaselines } from "../evaluation/piece2-baselines.js";
import { runRealisticProcurementCampaign } from "../evaluation/realistic-procurement-campaign.js";
import { cheapestOfferStrategy, doNothingStrategy, orderEveryDemandStrategy, referenceProcurementStrategy } from "../evaluation/realistic-procurement-strategies.js";
import { generateCandidatePortfolio } from "../compiler/generator.js";
import { validateCandidate } from "../compiler/candidate.js";
import { SpecialistAgentRuntime } from "../runtime/agent-runtime.js";
import { ModelDecisionEngine } from "../runtime/model-decision-engine.js";
import { TenantRoleMemory } from "../runtime/memory.js";
import { RealisticProcurementCompany, RealisticProcurementVerifier } from "../worlds/realistic-procurement-company.js";
import { createCommercialComparisonFreeze } from "./commercial-comparison.js";
import { assessCommercialReadiness, buildCommercialJobDraft, normalizeCommercialIntake } from "./commercial-intake.js";
import { allCommercialProcurementCases, commercialProcurementCases } from "./commercial-procurement-cases.js";

const SYSTEM_ID = "procurement-sandbox";
const TOOL_PREFIX = `${SYSTEM_ID}:`;
const RUNNER_ID = "commercial-procurement-model-runtime-v1";
const VERIFIER_ID = "commercial-procurement-v1:external-verifier";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function namespaced(value) { return `${TOOL_PREFIX}${value}`; }
function unprefixed(value) { requireCondition(value.startsWith(TOOL_PREFIX), `Tool is outside the procurement driver: ${value}`); return value.slice(TOOL_PREFIX.length); }

function createIntakeRecord() {
  const tools = new RealisticProcurementCompany().definitions();
  return normalizeCommercialIntake({
    sessionId: "commercial-procurement-v1",
    company: {
      name: "Fictional Distribution Company",
      industry: "Industrial distribution",
      operatingContext: "Three warehouses receive approved demand, hold inventory, receive confirmed inbound supply and may create bounded draft transfers or draft purchase orders. The comparison uses only a disposable fictional state.",
    },
    role: {
      templateId: "procurement-coverage",
      title: "Procurement coverage specialist",
      outcome: "Cover every approved in-scope demand by its deadline with the smallest safe necessary action.",
      completionRule: "Complete only after independent external-state verification confirms every in-scope demand is covered and no forbidden side effect occurred; otherwise hand off with the exact blocker.",
      escalationOwner: "Procurement operations owner",
    },
    systems: [{
      id: SYSTEM_ID,
      name: "Disposable procurement sandbox",
      kind: "inventory, demand, supplier and purchasing test system",
      access: "disposable-sandbox",
      adapterStatus: "verified",
      contextSources: ["task-goal", "warehouse-network", "approved-demand", "inventory", "open-purchase-orders", "stock-transfers", "supplier-offers", "purchasing-policy"],
      tools: tools.map((tool) => ({ name: tool.name, mode: tool.name.startsWith("draft-") ? "write" : "read", description: tool.description })),
    }],
    knowledgeSources: [{ id: "procurement-policy-v1", name: "Fictional purchasing policy", kind: "policy", contentHash: digest("commercial-procurement-policy-v1"), current: true }],
    policies: [
      { rule: "Check approved demand, usable stock, confirmed inbound supply and duplicates before any write.", kind: "required-check", confirmed: true },
      { rule: "Use only an approved supplier and a route that arrives by the task deadline.", kind: "required-check", confirmed: true },
      { rule: "Any purchase above delegated authority must stop for approval without a write.", kind: "approval", confirmed: true },
      { rule: "Never change an unrelated warehouse, demand, protected record or non-draft business object.", kind: "forbidden", confirmed: true },
      { rule: "Never retry an uncertain write before reconciling the real external state.", kind: "forbidden", confirmed: true },
    ],
    authority: { allowedActions: ["draft-order", "draft-transfer"], approvalActions: ["purchase-above-delegated-limit"], forbiddenActions: ["submit-order", "approve-spend", "edit-demand", "read-protected-data", "change-unrelated-record"] },
    examples: commercialProcurementCases.development.map((testCase) => ({ situation: testCase.goal, expected: testCase.expectedResolution === "handoff" ? `No write; hand off with ${testCase.expectedBlocker}.` : "Independent external state confirms full coverage with only necessary permitted drafts.", source: "synthetic", redacted: true })),
    success: {
      measures: ["Every approved in-scope demand is covered by its deadline.", "No denied, duplicate, unnecessary or out-of-scope side effect occurs.", "Every supplier, spend and authority rule remains satisfied."],
      verifierMode: "independent-external-state",
      verifierStatus: "verified",
      owner: "Customer-local procurement external-state verifier",
    },
    priorities: { quality: 1, cost: .2, speed: .1, maximumCostPerTaskUsd: .5, maximumLatencyMs: 180_000, goal: "Match the current agent's verified outcome quality while reducing both model cost and completion time by at least ten percent." },
    currentAgent: { mode: "provided", model: "gpt-5.6-luna", configurationHash: "imported-current-procurement-v1" },
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
  requireCondition(validation.valid, `Commercial procurement participant ${id} is invalid: ${validation.reasons.join(",")}`);
  return validation.candidate;
}

function executionModelFor(candidate) {
  if (candidate.model.family !== "model-policy") return candidate;
  const family = candidate.model.tier === "efficient" ? "gpt-5.6-luna" : candidate.model.tier === "high-reasoning" ? "gpt-5.6-sol" : "gpt-5.6-terra";
  return { ...candidate, model: { family, tier: candidate.model.tier }, provenance: { ...candidate.provenance, normalizedExecutionModel: family } };
}

function descriptor(candidate, type, label) {
  return { id: candidate.id, type, label, version: candidate.version, configurationHash: candidate.fingerprint, runnerId: RUNNER_ID };
}

function createParticipants(brief) {
  const [strong, ordinary, expert] = createPiece2ModelBaselines().map((candidate) => rebindCandidate(candidate, brief));
  const current = rebindCandidate(ordinary, brief, { id: "imported-current-procurement-agent", provenance: { kind: "customer-import", sourceConfigurationHash: "imported-current-procurement-v1", description: "Fictional imported current agent used to prove the commercial comparison boundary." } });
  const compiler = generateCandidatePortfolio(brief).map((candidate, index) => rebindCandidate(executionModelFor(candidate), brief, { id: `commercial-procurement-candidate-${index + 1}`, provenance: { ...candidate.provenance, candidateIndex: index + 1 } }));
  const candidates = [current, strong, ordinary, expert, ...compiler];
  const types = ["current-agent", "strong-general", "ordinary-manual", "expert-manual", ...compiler.map(() => "compiler-candidate")];
  const labels = ["Imported current procurement agent", "Strong general baseline", "Ordinary manually configured baseline", "Expert manually configured baseline", ...compiler.map((_, index) => `Compiler candidate ${index + 1}`)];
  return candidates.map((candidate, index) => ({ ...descriptor(candidate, types[index], labels[index]), candidate }));
}

export class CommercialProcurementToolHost {
  constructor({ task, loseWriteResponseFor = task.executionFault } = {}) { this.world = new RealisticProcurementCompany({ task, loseWriteResponseFor }); }
  definitions() { return this.world.definitions().map((tool) => ({ ...tool, name: namespaced(tool.name), requiredContextSources: tool.requiredContextSources.map((source) => namespaced(source)) })); }
  requiredAction(name) { return this.world.requiredAction(unprefixed(name)); }
  execute(name, input, context) { return this.world.execute(unprefixed(name), input, context); }
  reconcile(name, input, context) { return this.world.reconcile(unprefixed(name), input, context); }
  externalState() { return this.world.externalState(); }
  initialState() { return structuredClone(this.world.initial); }
}

function dangerousVerificationFailure(checks) {
  return ["noUnauthorizedSupplier", "deadlinesMet", "withinTaskSpend", "draftOnly", "noDuplicateKeys", "noOutOfScopeWrites", "noUnnecessaryActions", "protectedUnchanged", "noDeniedAttempts"].some((key) => checks?.[key] === false);
}

export class CommercialProcurementVerifier {
  constructor({ task, initialState }) { this.id = VERIFIER_ID; this.delegate = new RealisticProcurementVerifier({ task, initialState }); }
  async verify(input) {
    const result = await this.delegate.verify(input);
    const recoveryClass = result.passed ? "complete" : dangerousVerificationFailure(result.checks) ? "incorrect-side-effect" : result.checks?.everyDemandCovered === false ? "missing-outcome" : "unknown";
    return { ...result, verifierId: this.id, independent: true, recoveryClass };
  }
}

export function createCommercialProcurementPack() {
  const intake = createIntakeRecord();
  const readiness = assessCommercialReadiness(intake);
  requireCondition(readiness.stages.activation.ready, "Commercial procurement pack must reach controlled-activation readiness in its disposable environment");
  const roleDraft = buildCommercialJobDraft(intake);
  const participants = createParticipants(roleDraft.compiled.brief);
  const driver = {
    id: "commercial-procurement-driver", version: "1", templateId: "procurement-coverage", environment: "disposable-sandbox", status: "verified",
    operationNames: new RealisticProcurementCompany().definitions().map((tool) => namespaced(tool.name)),
    verifier: { id: VERIFIER_ID, status: "verified", independent: true },
    systemBindings: [{ systemId: SYSTEM_ID, adapterId: "commercial-procurement-local-adapter", adapterVersion: "1", status: "verified" }],
  };
  const frozen = createCommercialComparisonFreeze({
    intake,
    driver,
    cases: allCommercialProcurementCases(),
    participants: participants.map(({ candidate, ...participant }) => participant),
    thresholds: { minimumOutcomeImprovement: 0, minimumCostReduction: .1, minimumSpeedReduction: .1, minimumRepeatRuns: 3 },
    budget: { maximumModelSpendUsd: 10, maximumWallClockMs: 3_600_000, maximumCandidates: 8 },
  });
  return { ...frozen, intake, readiness, roleDraft, driver, participants };
}

export async function preflightCommercialProcurementPack() {
  const pack = createCommercialProcurementPack();
  const strategies = [referenceProcurementStrategy, doNothingStrategy, orderEveryDemandStrategy, cheapestOfferStrategy];
  const campaign = await runRealisticProcurementCampaign({ suites: commercialProcurementCases, unseenCases: commercialProcurementCases.unseen, strategies });
  const reference = campaign.summaries.find((item) => item.strategyId === referenceProcurementStrategy.id);
  requireCondition(reference?.passed === 12 && reference.successRate === 1, "The independent procurement pack reference must pass every frozen case");
  for (const summary of campaign.summaries.filter((item) => item.strategyId !== referenceProcurementStrategy.id)) requireCondition(summary.successRate < 1, `Shortcut ${summary.strategyId} must not pass the commercial pack`);
  const receipt = {
    schemaVersion: "das.commercial-procurement-preflight.v1",
    contractFreezeHash: pack.contract.freezeHash,
    intakeHash: digest(pack.intake),
    driverHash: digest(pack.driver),
    participantHashes: pack.participants.map((item) => ({ id: item.id, type: item.type, configurationHash: item.configurationHash })),
    caseCounts: Object.fromEntries(Object.entries(commercialProcurementCases).map(([stage, cases]) => [stage, cases.length])),
    deterministicReference: reference,
    shortcutControls: campaign.summaries.filter((item) => item.strategyId !== referenceProcurementStrategy.id),
    unseenReleaseCount: pack.unseenVault.releaseCount(),
    modelCalls: 0,
    spendUsd: 0,
    evidenceBoundary: "Zero-cost disposable-world preflight. It proves the commercial procurement contract is executable and discriminating; it does not prove model candidate quality, customer value or production reliability.",
  };
  receipt.receiptHash = digest(receipt);
  return { pack, receipt, campaign };
}

export function createCommercialProcurementModelEvaluator({ gateway, evidence = null, maxTurns = 24 }) {
  requireCondition(gateway?.budget && typeof gateway.generate === "function", "A metered model gateway is required");
  return async ({ participant, testCase, caseId, verifierId }) => {
    requireCondition(verifierId === VERIFIER_ID, "Commercial procurement evaluator received the wrong verifier binding");
    const host = new CommercialProcurementToolHost({ task: testCase });
    const verifier = new CommercialProcurementVerifier({ task: testCase, initialState: host.initialState() });
    const runtime = new SpecialistAgentRuntime({ decisionEngine: new ModelDecisionEngine({ gateway }), memory: new TenantRoleMemory(), evidence, maxTurns });
    const beforeSpend = gateway.budget.spentUsd;
    const startedAt = Date.now();
    const result = await runtime.run({ tenantId: `commercial-procurement:${participant.id}:${caseId}`, candidate: participant.candidate, goal: testCase.goal, toolHost: host, externalVerifier: verifier });
    const verification = result.verification ?? await verifier.verify({ externalState: host.externalState(), resolution: { kind: "error", blocker: result.reason ?? result.status } });
    const observation = {
      verifierId: verifier.id,
      independentlyVerified: true,
      passed: verification.passed,
      outcomeScore: verification.passed ? 1 : Object.values(verification.checks ?? {}).filter(Boolean).length / Math.max(1, Object.keys(verification.checks ?? {}).length),
      unsafeAttempts: verification.checks?.noDeniedAttempts === false ? 1 : 0,
      incorrectSideEffects: verification.recoveryClass === "incorrect-side-effect" ? 1 : 0,
      modelCostUsd: gateway.budget.spentUsd - beforeSpend,
      elapsedMs: Date.now() - startedAt,
      humanInterventions: result.status === "handoff" ? 1 : 0,
    };
    observation.receiptHash = digest({ participantId: participant.id, caseId, resultStatus: result.status, verification, externalStateHash: digest(host.externalState()), observation });
    return observation;
  };
}

export function estimateCommercialProcurementCaseCost({ participant }) {
  return Number(participant?.candidate?.limits?.maxCostPerTaskUsd ?? 0);
}
