import { digest } from "../core/canonical.js";
import { compileJobBrief } from "../compiler/job-brief.js";
import { commercialRoleTemplate } from "./commercial-role-templates.js";

const SECRET_KEYS = /(^|[-_])(api[-_]?key|password|secret|token|credential|private[-_]?key)($|[-_])/i;

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function cleanText(value, maximum = 2_000) { return String(value ?? "").trim().slice(0, maximum); }
function cleanList(value, maximum = 100) { return Array.isArray(value) ? value.slice(0, maximum) : []; }
function stableId(prefix, value, index) { return cleanText(value?.id, 120) || `${prefix}-${digest({ prefix, index, value }).slice(0, 12)}`; }

function assertNoSecrets(value, path = "intake") {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEYS.test(key) && cleanText(child)) throw new Error(`Credentials must not be stored in onboarding records: ${path}.${key}`);
    assertNoSecrets(child, `${path}.${key}`);
  }
}

function normalizeSystems(input) {
  return cleanList(input).map((system, index) => ({
    id: stableId("system", system, index),
    name: cleanText(system.name, 160),
    kind: cleanText(system.kind, 100),
    access: ["none", "historical-export", "disposable-sandbox", "customer-local-test", "approved-live"].includes(system.access) ? system.access : "none",
    adapterStatus: ["missing", "declared", "executable", "verified"].includes(system.adapterStatus) ? system.adapterStatus : "missing",
    contextSources: cleanList(system.contextSources, 30).map((item) => cleanText(item, 120)).filter(Boolean),
    tools: cleanList(system.tools, 40).map((tool, toolIndex) => ({ id: stableId("tool", tool, toolIndex), name: cleanText(tool.name, 120), mode: ["read", "write"].includes(tool.mode) ? tool.mode : "read", description: cleanText(tool.description, 500) })).filter((tool) => tool.name),
  })).filter((system) => system.name);
}

function normalizePolicies(input) {
  return cleanList(input).map((policy, index) => ({ id: stableId("policy", policy, index), rule: cleanText(policy.rule, 1_000), kind: ["required-check", "forbidden", "approval"].includes(policy.kind) ? policy.kind : "required-check", consequential: policy.consequential !== false, confirmed: policy.confirmed === true })).filter((policy) => policy.rule);
}

function normalizeExamples(input) {
  return cleanList(input).map((example, index) => ({ id: stableId("case", example, index), situation: cleanText(example.situation, 2_000), expected: cleanText(example.expected, 2_000), source: ["historical-redacted", "synthetic", "customer-authored"].includes(example.source) ? example.source : "customer-authored", redacted: example.redacted !== false })).filter((example) => example.situation && example.expected);
}

export function normalizeCommercialIntake(input) {
  assertNoSecrets(input);
  const template = commercialRoleTemplate(input?.role?.templateId);
  const normalized = {
    schemaVersion: "das.commercial-intake.v1",
    sessionId: cleanText(input?.sessionId, 120) || `onboarding-${digest(input ?? {}).slice(0, 16)}`,
    company: { name: cleanText(input?.company?.name, 200), website: cleanText(input?.company?.website, 500), industry: cleanText(input?.company?.industry, 200), operatingContext: cleanText(input?.company?.operatingContext, 4_000) },
    role: { templateId: template?.id ?? cleanText(input?.role?.templateId, 120), title: cleanText(input?.role?.title, 240) || template?.defaultRoleTitle || "", outcome: cleanText(input?.role?.outcome, 2_000) || template?.defaultOutcome || "", completionRule: cleanText(input?.role?.completionRule, 2_000) || template?.defaultCompletionRule || "", escalationOwner: cleanText(input?.role?.escalationOwner, 240) },
    systems: normalizeSystems(input?.systems),
    knowledgeSources: cleanList(input?.knowledgeSources).map((source, index) => ({ id: stableId("knowledge", source, index), name: cleanText(source.name, 200), kind: cleanText(source.kind, 100), contentHash: cleanText(source.contentHash, 128), current: source.current === true })).filter((source) => source.name),
    policies: normalizePolicies(input?.policies),
    authority: { allowedActions: cleanList(input?.authority?.allowedActions).map((item) => cleanText(item, 160)).filter(Boolean), approvalActions: cleanList(input?.authority?.approvalActions).map((item) => cleanText(item, 160)).filter(Boolean), forbiddenActions: cleanList(input?.authority?.forbiddenActions).map((item) => cleanText(item, 160)).filter(Boolean) },
    examples: normalizeExamples(input?.examples),
    success: { measures: cleanList(input?.success?.measures).map((item) => cleanText(item, 300)).filter(Boolean), verifierMode: ["not-defined", "historical-replay", "independent-external-state", "human-independent-review"].includes(input?.success?.verifierMode) ? input.success.verifierMode : "not-defined", verifierStatus: ["missing", "declared", "executable", "verified"].includes(input?.success?.verifierStatus) ? input.success.verifierStatus : "missing", owner: cleanText(input?.success?.owner, 240) },
    priorities: { quality: Number.isFinite(input?.priorities?.quality) ? input.priorities.quality : 1, cost: Number.isFinite(input?.priorities?.cost) ? input.priorities.cost : .25, speed: Number.isFinite(input?.priorities?.speed) ? input.priorities.speed : .2, maximumCostPerTaskUsd: Number.isFinite(input?.priorities?.maximumCostPerTaskUsd) ? input.priorities.maximumCostPerTaskUsd : .5, maximumLatencyMs: Number.isFinite(input?.priorities?.maximumLatencyMs) ? input.priorities.maximumLatencyMs : 300_000, goal: cleanText(input?.priorities?.goal, 500) || "Maximize independently verified quality, then reduce cost and speed." },
    currentAgent: { mode: ["none", "import-later", "provided"].includes(input?.currentAgent?.mode) ? input.currentAgent.mode : "import-later", model: cleanText(input?.currentAgent?.model, 160), configurationHash: cleanText(input?.currentAgent?.configurationHash, 128), historicalResultsHash: cleanText(input?.currentAgent?.historicalResultsHash, 128) },
    dataHandling: { localOnly: input?.dataHandling?.localOnly !== false, productionDataIncluded: input?.dataHandling?.productionDataIncluded === true, redactionConfirmed: input?.dataHandling?.redactionConfirmed === true },
  };
  return Object.freeze(normalized);
}

function explicitlySupplied(input, path) {
  let current = input;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, segment)) return false;
    current = current[segment];
  }
  if (typeof current === "string") return Boolean(current.trim());
  if (Array.isArray(current)) return current.length > 0;
  return current !== undefined && current !== null;
}

export function createCommercialIntakeProvenance({ input, intake }) {
  const normalized = intake ?? normalizeCommercialIntake(input);
  requireCondition(normalized?.schemaVersion === "das.commercial-intake.v1", "Commercial intake provenance needs a normalized intake");
  const template = commercialRoleTemplate(normalized.role.templateId);
  const facts = [
    ["company.name", "required-customer-fact"],
    ["company.website", "optional-customer-fact"],
    ["company.industry", "optional-customer-fact"],
    ["company.operatingContext", "required-customer-fact"],
    ["role.templateId", "customer-role-family-selection"],
    ["role.title", template ? "role-template-default" : "required-customer-fact"],
    ["role.outcome", template ? "role-template-default" : "required-customer-fact"],
    ["role.completionRule", template ? "role-template-default" : "required-customer-fact"],
    ["role.escalationOwner", "required-customer-fact"],
    ["systems", "required-customer-facts"],
    ["knowledgeSources", "optional-customer-facts"],
    ["policies", "required-customer-facts"],
    ["authority.allowedActions", "required-customer-authority"],
    ["authority.approvalActions", "optional-customer-authority"],
    ["authority.forbiddenActions", "required-customer-authority"],
    ["examples", "required-customer-facts"],
    ["success.measures", "required-customer-facts"],
    ["success.verifierMode", "required-customer-fact"],
    ["success.verifierStatus", "customer-declaration-not-proof"],
    ["success.owner", "required-customer-fact"],
    ["priorities.quality", "das-safe-default"],
    ["priorities.cost", "das-safe-default"],
    ["priorities.speed", "das-safe-default"],
    ["priorities.maximumCostPerTaskUsd", "das-safe-default"],
    ["priorities.maximumLatencyMs", "das-safe-default"],
    ["priorities.goal", "das-safe-default"],
    ["currentAgent.mode", "das-safe-default"],
    ["currentAgent.model", "optional-customer-fact"],
    ["currentAgent.configurationHash", "optional-customer-fact"],
    ["currentAgent.historicalResultsHash", "optional-customer-fact"],
    ["dataHandling.localOnly", "das-safe-default"],
    ["dataHandling.productionDataIncluded", "das-safe-default"],
    ["dataHandling.redactionConfirmed", "das-safe-default"],
  ].map(([path, fallback]) => ({
    path,
    status: explicitlySupplied(input, path) ? "customer-supplied" : fallback,
    valuePresent: (() => {
      const value = path.split(".").reduce((current, segment) => current?.[segment], normalized);
      return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "";
    })(),
  }));
  const receipt = {
    schemaVersion: "das.commercial-intake-provenance.v1",
    sessionId: normalized.sessionId,
    intakeHash: digest(normalized),
    facts,
    customerSuppliedCount: facts.filter((item) => item.status === "customer-supplied").length,
    templateDefaultCount: facts.filter((item) => item.status === "role-template-default").length,
    dasSafeDefaultCount: facts.filter((item) => item.status === "das-safe-default").length,
    boundary: "Provenance of normalized onboarding fields. Defaults are proposals or safe software defaults, not customer-supplied business truth or executable evidence.",
  };
  receipt.provenanceHash = digest(receipt);
  return Object.freeze(receipt);
}

function gate(id, label, checks) { return { id, label, ready: checks.every((check) => check.passed), checks }; }
function check(id, passed, question) { return { id, passed: Boolean(passed), question }; }

export function assessCommercialReadiness(intake) {
  const template = commercialRoleTemplate(intake.role.templateId);
  const confirmedPolicies = intake.policies.filter((policy) => policy.confirmed);
  const executableSystems = intake.systems.filter((system) => ["executable", "verified"].includes(system.adapterStatus));
  const writeSystems = intake.systems.filter((system) => system.tools.some((tool) => tool.mode === "write"));
  const draft = gate("design-preview", "Design preview", [
    check("company", intake.company.name, "What company is this specialist for?"),
    check("supported-role", template, "Which supported role family is closest to this job?"),
    check("outcome", intake.role.outcome, "What result should the specialist own?"),
    check("escalation-owner", intake.role.escalationOwner, "Who receives work the specialist cannot safely finish?"),
  ]);
  const comparison = gate("comparison-ready", "Ready for comparison", [
    check("design-preview", draft.ready, "Complete the role draft first."),
    check("systems", intake.systems.length > 0, "Which systems and information sources does the role use?"),
    check("policies", confirmedPolicies.length >= 3, "Confirm at least three consequential operating rules."),
    check("authority", intake.authority.allowedActions.length > 0 && intake.authority.forbiddenActions.length > 0, "What may the specialist do, and what must it never do?"),
    check("representative-cases", intake.examples.length >= 5, "Add at least five representative historical or customer-authored cases."),
    check("success", intake.success.measures.length >= 3 && intake.success.verifierMode !== "not-defined", "How will an independent checker know the work succeeded?"),
    check("current-agent", intake.currentAgent.mode !== "provided" || Boolean(intake.currentAgent.configurationHash), "Import the existing agent configuration or mark that no agent exists."),
    check("redaction", !intake.dataHandling.productionDataIncluded || intake.dataHandling.redactionConfirmed, "Confirm that supplied production-derived data is appropriately redacted."),
  ]);
  const activation = gate("controlled-activation", "Controlled activation", [
    check("comparison", comparison.ready, "Complete a fair comparison contract first."),
    check("safe-environment", intake.systems.length > 0 && intake.systems.every((system) => ["disposable-sandbox", "customer-local-test", "approved-live"].includes(system.access)), "Connect a disposable sandbox or explicitly approved bounded environment for every required system."),
    check("adapters", executableSystems.length === intake.systems.length, "Make every required system adapter executable and locally checked."),
    check("write-boundary", writeSystems.length === 0 || intake.authority.allowedActions.length > 0, "Bind every write path to explicit authority."),
    check("verifier", ["executable", "verified"].includes(intake.success.verifierStatus) && intake.success.verifierMode === "independent-external-state", "Connect an executable independent external-state verifier."),
    check("local-secrets", true, "Configure credentials customer-side; never place them in this onboarding record."),
  ]);
  const questions = [draft, comparison, activation].flatMap((item) => item.checks.filter((entry) => !entry.passed).map((entry) => ({ stage: item.id, id: entry.id, question: entry.question })));
  return { template, stages: { draft, comparison, activation }, highestReadyStage: activation.ready ? "controlled-activation" : comparison.ready ? "comparison-ready" : draft.ready ? "design-preview" : "not-ready", questions };
}

export function buildCommercialJobDraft(intake) {
  const readiness = assessCommercialReadiness(intake);
  if (!readiness.stages.draft.ready) throw new Error("Design preview information is incomplete");
  const tools = intake.systems.flatMap((system) => system.tools.map((tool) => `${system.id}:${tool.name}`));
  const contextSources = [...intake.systems.flatMap((system) => system.contextSources.map((source) => `${system.id}:${source}`)), ...intake.knowledgeSources.map((source) => `knowledge:${source.id}`)];
  const confirmed = intake.policies.filter((policy) => policy.confirmed);
  const briefInput = {
    id: `${intake.sessionId}:${intake.role.templateId}`,
    role: intake.role.title,
    outcome: { primary: intake.role.outcome, completionRule: intake.role.completionRule || `Complete only when ${intake.success.measures.join("; ") || "the declared external outcome is independently confirmed"}; otherwise hand off to ${intake.role.escalationOwner}.` },
    environment: { tags: [intake.role.templateId, cleanText(intake.company.industry, 80) || "unspecified-industry", "customer-draft"], contextSources, tools, facts: [intake.company.operatingContext, ...intake.systems.map((system) => `${system.name}: ${system.kind}; access ${system.access}; adapter ${system.adapterStatus}.`)].filter(Boolean) },
    policies: { requiredChecks: confirmed.filter((policy) => policy.kind !== "forbidden").map((policy) => policy.rule), forbidden: [...confirmed.filter((policy) => policy.kind === "forbidden").map((policy) => policy.rule), ...intake.authority.forbiddenActions] },
    authority: { allowedActions: intake.authority.allowedActions, forbiddenActions: intake.authority.forbiddenActions },
    examples: intake.examples.map((example) => ({ situation: example.situation, expected: example.expected })),
    successCriteria: { verifierId: `${intake.sessionId}:external-verifier`, independent: intake.success.verifierMode !== "not-defined", measures: intake.success.measures },
    priorities: { maxCostPerTaskUsd: intake.priorities.maximumCostPerTaskUsd, maxLatencyMs: intake.priorities.maximumLatencyMs, selection: { qualityWeight: intake.priorities.quality, costWeight: intake.priorities.cost, speedWeight: intake.priorities.speed, escalationPenalty: .4 }, order: ["safety", "independently verified completion", intake.priorities.goal, "cost", "speed"] },
    assumptions: intake.policies.filter((policy) => policy.consequential && !policy.confirmed).map((policy) => ({ description: policy.rule, consequential: true, status: "unconfirmed" })),
  };
  const compiled = compileJobBrief(briefInput);
  return { schemaVersion: "das.commercial-job-draft.v1", intakeHash: digest(intake), templateId: intake.role.templateId, readiness, compiled, comparisonDesignComplete: readiness.stages.comparison.ready, executableComparisonAuthorized: false, generatedEvidenceClaim: false };
}
