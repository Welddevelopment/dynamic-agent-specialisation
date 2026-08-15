import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { normalizeCommercialIntake } from "./commercial-intake.js";
import { assertOnboardingSystemImportProposal } from "./onboarding-system-import.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function clean(value, maximum = 500) { return String(value ?? "").trim().slice(0, maximum); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }
function stable(value) { return JSON.parse(JSON.stringify(value)); }
function unique(values) { return [...new Set(values)]; }

function exactTargetOperations(intake, systemId) {
  const system = intake.systems.find((item) => item.id === systemId);
  requireCondition(system, `Onboarding system is missing: ${systemId}`);
  return new Map(system.tools.map((tool) => [`${system.id}:${tool.name}`, tool]));
}

function exactDecisionMap(proposal, decisions) {
  requireCondition(Array.isArray(decisions?.operationChoices), "System-import confirmation needs one decision for every proposed operation");
  const byName = new Map();
  for (const choice of decisions.operationChoices) {
    const sourceName = clean(choice?.sourceName, 240);
    requireCondition(sourceName && !byName.has(sourceName), `Duplicate or missing system-import operation decision: ${sourceName || "unknown"}`);
    byName.set(sourceName, choice);
  }
  requireCondition(byName.size === proposal.operations.length && proposal.operations.every((operation) => byName.has(operation.sourceName)), "System-import confirmation must cover the exact proposed operation set");
  return byName;
}

function normalizeContextChoices(proposal, decisions) {
  requireCondition(Array.isArray(decisions?.contextChoices), "System-import confirmation needs an exact context-source decision set");
  const proposed = new Set(proposal.proposedContextSources);
  const byId = new Map();
  for (const choice of decisions.contextChoices) {
    const sourceId = clean(choice?.sourceId, 500);
    requireCondition(sourceId && proposed.has(sourceId) && !byId.has(sourceId), `Unknown, duplicate or missing system-import context decision: ${sourceId || "unknown"}`);
    requireCondition(typeof choice.approved === "boolean", `Context source ${sourceId} needs an explicit approval decision`);
    byId.set(sourceId, choice.approved);
  }
  requireCondition(byId.size === proposed.size, "System-import confirmation must review every proposed context source");
  return [...byId].filter(([, approved]) => approved).map(([sourceId]) => sourceId).sort();
}

function authorityMapping(intake, mode, choice, sourceName) {
  if (mode === "read") {
    requireCondition(!clean(choice.authorityAction, 160), `Read operation ${sourceName} cannot acquire write authority`);
    return { action: null, classification: "not-applicable", runtimeGrant: false };
  }
  const action = clean(choice.authorityAction, 160);
  requireCondition(action, `Write operation ${sourceName} needs an explicit mapping to the saved intake authority`);
  if (intake.authority.allowedActions.includes(action)) return { action, classification: "already-declared-allowed-action", runtimeGrant: false };
  if (intake.authority.approvalActions.includes(action)) return { action, classification: "already-declared-approval-required-action", runtimeGrant: false };
  throw new Error(`Write operation ${sourceName} tried to widen authority beyond the saved intake: ${action}`);
}

export function confirmOnboardingSystemImport({ proposal, intake: input, source, decisions, confirmedBy }) {
  assertOnboardingSystemImportProposal({ proposal, intake: input, source });
  const intake = normalizeCommercialIntake(input);
  const targets = exactTargetOperations(intake, proposal.systemId);
  const bySource = exactDecisionMap(proposal, decisions);
  const approvedContextSources = normalizeContextChoices(proposal, decisions);
  const approvedContextSet = new Set(approvedContextSources);
  const usedTargets = new Set();
  const operationChoices = proposal.operations.map((operation) => {
    const choice = bySource.get(operation.sourceName);
    requireCondition(typeof choice.approved === "boolean", `Operation ${operation.sourceName} needs an explicit approval decision`);
    if (!choice.approved) {
      requireCondition(!clean(choice.targetExposedName, 240) && !clean(choice.confirmedMode, 40) && !clean(choice.authorityAction, 160), `Rejected operation ${operation.sourceName} cannot retain a target, mode or authority mapping`);
      return {
        sourceName: operation.sourceName,
        proposedExposedName: operation.proposedExposedName,
        approved: false,
        rejectionReason: clean(choice.rejectionReason, 500) || "Customer did not approve this operation for the bounded role.",
        targetExposedName: null,
        confirmedMode: null,
        authority: { action: null, classification: "not-applicable", runtimeGrant: false },
        requiredContextSources: [],
        sourceInputSchemaHash: operation.boundedInputSchemaHash,
        runtimeInputSchemaHash: null,
        executable: false,
      };
    }
    const targetExposedName = clean(choice.targetExposedName, 240);
    const target = targets.get(targetExposedName);
    requireCondition(target && !usedTargets.has(targetExposedName), `Approved operation ${operation.sourceName} needs one unused exact operation from the saved intake`);
    usedTargets.add(targetExposedName);
    const confirmedMode = clean(choice.confirmedMode, 40);
    requireCondition(["read", "write"].includes(confirmedMode), `Operation ${operation.sourceName} needs an explicit read or write confirmation`);
    if (operation.modeProposal.value !== "review-required") requireCondition(confirmedMode === operation.modeProposal.value, `Operation ${operation.sourceName} mode differs from the pinned source evidence`);
    requireCondition(confirmedMode === target.mode, `Operation ${operation.sourceName} mode differs from its saved-intake target ${targetExposedName}`);
    const requiredContextSources = unique((choice.requiredContextSources ?? []).map((item) => clean(item, 500)).filter(Boolean)).sort();
    requireCondition(requiredContextSources.length === (choice.requiredContextSources ?? []).length && requiredContextSources.every((item) => approvedContextSet.has(item)), `Operation ${operation.sourceName} contains an unapproved or duplicate context source`);
    return {
      sourceName: operation.sourceName,
      proposedExposedName: operation.proposedExposedName,
      approved: true,
      rejectionReason: null,
      targetExposedName,
      confirmedMode,
      authority: authorityMapping(intake, confirmedMode, choice, operation.sourceName),
      requiredContextSources,
      sourceInputSchemaHash: operation.boundedInputSchemaHash,
      runtimeInputSchemaHash: null,
      executable: false,
    };
  });
  requireCondition(operationChoices.some((item) => item.approved), "Approve at least one exact system-import operation");
  const confirmation = {
    schemaVersion: "das.onboarding-system-import-confirmation.v1",
    proposalHash: proposal.proposalHash,
    sessionId: proposal.sessionId,
    intakeHash: proposal.intakeHash,
    systemId: proposal.systemId,
    source: { kind: proposal.source.kind, sourceHash: proposal.source.sourceHash },
    status: "customer-confirmed-engineering-required",
    confirmedBy: clean(confirmedBy, 240) || "customer-reviewer",
    operationChoices,
    approvedContextSources,
    gates: {
      authority: "mapped-to-existing-intake-only-not-runtime-granted",
      credentials: "not-collected",
      executableAdapter: "not-implemented",
      independentVerifier: "not-implemented",
      acceptance: "not-run",
      comparisonExecution: "blocked",
      controlledActivation: "blocked",
    },
    authorizations: { modelSpend: false, execution: false, customerWrites: false, activation: false },
    evidenceBoundary: "Digest-bound customer review of one pinned schema proposal. It maps approved source operations to an existing saved role and existing declared authority only. It does not implement an adapter or verifier, collect credentials, grant runtime authority, execute, spend or activate.",
  };
  confirmation.confirmationHash = digest(confirmation);
  return Object.freeze(confirmation);
}

export function assertOnboardingSystemImportConfirmation({ confirmation, proposal, intake, source }) {
  requireCondition(confirmation?.schemaVersion === "das.onboarding-system-import-confirmation.v1" && confirmation.confirmationHash === digest(withoutHash(confirmation, "confirmationHash")), "System-import confirmation integrity mismatch");
  assertOnboardingSystemImportProposal({ proposal, intake, source });
  requireCondition(confirmation.proposalHash === proposal.proposalHash && confirmation.sessionId === proposal.sessionId && confirmation.intakeHash === proposal.intakeHash && confirmation.systemId === proposal.systemId, "System-import confirmation belongs to another proposal or intake");
  requireCondition(confirmation.source.kind === proposal.source.kind && confirmation.source.sourceHash === proposal.source.sourceHash, "System-import confirmation source digest mismatch");
  requireCondition(confirmation.status === "customer-confirmed-engineering-required" && Object.values(confirmation.authorizations).every((value) => value === false), "System-import confirmation widened execution or activation authority");
  requireCondition(confirmation.gates.executableAdapter === "not-implemented" && confirmation.gates.independentVerifier === "not-implemented" && confirmation.gates.acceptance === "not-run", "System-import confirmation fabricated implementation or proof");
  return true;
}

function adapterDraft({ proposal, confirmation, adapterId }) {
  const approved = confirmation.operationChoices.filter((item) => item.approved);
  const operationBindings = approved.map((item) => {
    const common = {
      [proposal.source.kind === "openapi" ? "operationId" : "toolName"]: item.sourceName,
      exposedName: item.targetExposedName,
      mode: item.confirmedMode,
      requiredContextSources: item.requiredContextSources,
    };
    if (item.confirmedMode === "read") return common;
    return proposal.source.kind === "openapi"
      ? { ...common, authorityAction: item.authority.action, idempotencyHeader: null, verification: null }
      : { ...common, authorityAction: item.authority.action, idempotencyField: null, verification: null };
  });
  return proposal.source.kind === "openapi"
    ? {
        schemaVersion: "das.openapi-adapter-config-draft.v1",
        sourceHash: proposal.source.sourceHash,
        adapterId,
        adapterVersion: "0.1.0",
        baseUrl: proposal.source.serverOrigins?.length === 1 ? proposal.source.serverOrigins[0] : null,
        credentialRefs: {},
        operationBindings,
        compilable: false,
      }
    : {
        schemaVersion: "das.mcp-adapter-config-draft.v1",
        sourceHash: proposal.source.sourceHash,
        serverId: proposal.source.serverId,
        serverVersion: proposal.source.serverVersion,
        adapterVersion: "0.1.0",
        operationBindings,
        compilable: false,
      };
}

function verifierScaffold({ verifierId, intake, approvedOperations }) {
  const assertions = [
    ...(intake.success.measures ?? []).map((measure, index) => ({ id: `business-outcome-${index + 1}`, kind: "business-outcome", statement: measure, implementationStatus: "not-implemented" })),
    { id: "protected-state", kind: "incorrect-side-effect", statement: "Directly compare protected and unrelated external state before and after execution.", implementationStatus: "not-implemented" },
    { id: "authority-trace", kind: "authority", statement: "Reject any executed or attempted action outside the saved authority and approval boundary.", implementationStatus: "not-implemented" },
    ...approvedOperations.filter((item) => item.confirmedMode === "write").map((item) => ({ id: `read-back:${item.targetExposedName}`, kind: "write-outcome-read-back", statement: `Independently read external state for ${item.targetExposedName}; do not accept the candidate or adapter response as proof.`, implementationStatus: "not-implemented" })),
  ];
  return {
    schemaVersion: "das.independent-verifier-scaffold.v1",
    verifierId,
    status: "not-implemented",
    interface: "verify({ beforeState, afterState, assignedWork, authority, actionTrace }) -> { passed, requiredOutcomes, observedOutcomes, missingOutcomes, incorrectSideEffects, unsafeAttempts }",
    readsExternalStateDirectly: false,
    independentFromCandidate: true,
    candidateCannotWriteVerifierInputs: true,
    implementationHash: null,
    assertions,
    evidenceBoundary: "Generated verifier contract and assertion inventory only. No external-state reader or assertion has been implemented or executed.",
  };
}

function authoringInventory({ proposal, confirmation, intake, verifier }) {
  const approved = confirmation.operationChoices.filter((item) => item.approved);
  const system = intake.systems.find((item) => item.id === proposal.systemId);
  const mappedTargets = new Set(approved.map((item) => item.targetExposedName));
  const inventory = [];
  const add = (id, owner, status, detail) => inventory.push({ id, owner, status, detail });
  add("source-digest", "das", "generated", proposal.source.sourceHash);
  for (const operation of approved) {
    add(`source-operation:${operation.sourceName}`, "das", "generated", operation.sourceName);
    add(`target-operation:${operation.sourceName}`, "customer", "confirmed", operation.targetExposedName);
    add(`mode:${operation.sourceName}`, "customer", "confirmed", operation.confirmedMode);
    add(`source-input-schema:${operation.sourceName}`, "das", "generated", operation.sourceInputSchemaHash);
    add(`runtime-input-schema:${operation.sourceName}`, "engineer", "required", "Compile the reviewed source operation and pin the resulting runtime input-schema hash; write schemas may add explicit idempotency inputs.");
    add(`context:${operation.sourceName}`, "customer", "confirmed", operation.requiredContextSources.join(", ") || "none");
    if (operation.confirmedMode === "write") {
      add(`authority:${operation.sourceName}`, "customer", "confirmed-existing-only", operation.authority.action);
      add(`idempotency:${operation.sourceName}`, "engineer", "required", "Bind the exact idempotency header or required input field.");
      add(`reconciliation:${operation.sourceName}`, "engineer", "required", "Bind an approved read operation plus mappings and assertions for unknown outcomes.");
    }
    add(`transport:${operation.sourceName}`, "engineer", "required", `Compile and locally test through the generic ${proposal.source.kind === "openapi" ? "OpenAPI" : "MCP"} runtime.`);
  }
  for (const tool of system.tools) {
    const target = `${system.id}:${tool.name}`;
    if (!mappedTargets.has(target)) add(`coverage:${target}`, "engineer", "required", `The saved role operation ${target} has no approved source-operation mapping; the customer must supply and review a matching schema operation or create a new intake revision.`);
  }
  for (const assertion of verifier.assertions) add(`verifier:${assertion.id}`, "engineer", "required-independent-proof", assertion.statement);
  add("acceptance-campaign", "independent-verifier", "required-independent-proof", "Run every mandatory binding acceptance case after implementation.");
  const completed = inventory.filter((item) => ["generated", "confirmed", "confirmed-existing-only"].includes(item.status)).length;
  return {
    unit: "explicit-binding-and-verifier-fields",
    total: inventory.length,
    generatedOrCustomerConfirmed: completed,
    remainingEngineerOrIndependentProof: inventory.length - completed,
    completionRatio: Number((completed / inventory.length).toFixed(4)),
    customTransportSourceFilesRequired: 0,
    customTransportSourceFilesBoundary: "For the supported bounded OpenAPI/MCP shapes, the existing generic compiler/runtime is intended to replace custom transport code. This is a design property, not evidence that this draft compiles or works against the customer system.",
    inventory,
  };
}

export function createOnboardingBindingWorkPlan({ proposal, confirmation, intake: input, source, bindingScaffold }) {
  assertOnboardingSystemImportConfirmation({ confirmation, proposal, intake: input, source });
  const intake = normalizeCommercialIntake(input);
  requireCondition(bindingScaffold?.schemaVersion === "das.commercial-customer-binding.v1" && bindingScaffold.descriptorHash === digest(withoutHash(bindingScaffold, "descriptorHash")), "Binding work plan needs the exact generated customer-binding scaffold");
  requireCondition(bindingScaffold.sessionId === intake.sessionId && bindingScaffold.intakeHash === digest(intake), "Binding work plan scaffold belongs to another intake");
  const system = bindingScaffold.systems.find((item) => item.systemId === proposal.systemId);
  requireCondition(system, `Binding scaffold is missing system: ${proposal.systemId}`);
  const approvedOperations = confirmation.operationChoices.filter((item) => item.approved);
  const adapter = adapterDraft({ proposal, confirmation, adapterId: system.adapterId });
  const verifier = verifierScaffold({ verifierId: bindingScaffold.verifier.id, intake, approvedOperations });
  const authoring = authoringInventory({ proposal, confirmation, intake, verifier });
  const workPlan = {
    schemaVersion: "das.onboarding-binding-work-plan.v1",
    sessionId: intake.sessionId,
    intakeHash: digest(intake),
    systemId: proposal.systemId,
    proposalHash: proposal.proposalHash,
    confirmationHash: confirmation.confirmationHash,
    bindingScaffoldHash: bindingScaffold.descriptorHash,
    source: { kind: proposal.source.kind, sourceHash: proposal.source.sourceHash },
    status: "reviewed-scaffold-engineering-required-non-executable",
    approvedOperations,
    adapterConfigurationDraft: adapter,
    independentVerifierScaffold: verifier,
    authoring,
    exactRemainingWork: authoring.inventory.filter((item) => !["generated", "confirmed", "confirmed-existing-only"].includes(item.status)),
    gates: {
      sourceDigestMatched: true,
      customerReviewComplete: true,
      authorityWidened: false,
      credentialsCollected: false,
      adapterImplemented: false,
      independentVerifierImplemented: false,
      acceptanceRun: false,
      executable: false,
      activationReady: false,
    },
    evidenceBoundary: "This plan converts reviewed schema material into exact adapter configuration and independent-verifier scaffolds. It materially removes repeated configuration authoring, but every unresolved engineering field, direct verifier, acceptance case and live customer binding remains blocked and unproved.",
  };
  workPlan.workPlanHash = digest(workPlan);
  return Object.freeze(workPlan);
}

export function assertOnboardingBindingWorkPlan({ workPlan, proposal, confirmation, intake, source, bindingScaffold }) {
  requireCondition(workPlan?.schemaVersion === "das.onboarding-binding-work-plan.v1" && workPlan.workPlanHash === digest(withoutHash(workPlan, "workPlanHash")), "Onboarding binding work-plan integrity mismatch");
  const expected = createOnboardingBindingWorkPlan({ proposal, confirmation, intake, source, bindingScaffold });
  requireCondition(workPlan.workPlanHash === expected.workPlanHash, "Onboarding binding work plan no longer matches its exact source review or intake");
  return true;
}

export function writeOnboardingBindingWorkPlan({ directory, proposal, confirmation, workPlan }) {
  const root = path.resolve(directory);
  requireCondition(!fs.existsSync(root), "Onboarding binding work plan refuses to overwrite an existing directory");
  requireCondition(workPlan?.proposalHash === proposal.proposalHash && workPlan?.confirmationHash === confirmation.confirmationHash, "Onboarding binding work-plan files do not match the reviewed proposal");
  fs.mkdirSync(root, { recursive: false, mode: 0o700 });
  const files = {
    "review-confirmation.json": confirmation,
    "binding-work-plan.json": workPlan,
    "adapter-config.draft.json": workPlan.adapterConfigurationDraft,
    "independent-verifier-scaffold.json": workPlan.independentVerifierScaffold,
  };
  for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(root, name), `${JSON.stringify(stable(value), null, 2)}\n`, { mode: 0o600, flag: "wx" });
  fs.writeFileSync(path.join(root, "README.md"), `# Reviewed customer-local binding work plan\n\nThis directory is not executable. It contains one digest-bound customer review, an exact adapter configuration draft, and an independent-verifier assertion scaffold. Complete every item in \`exactRemainingWork\`, compile against the separately supplied pinned source, implement the independent external-state verifier, and pass the mandatory acceptance campaign. Never place credential values in these files.\n`, { mode: 0o600, flag: "wx" });
  const names = [...Object.keys(files), "README.md"];
  const fileHashes = Object.fromEntries(names.map((name) => [name, digest(fs.readFileSync(path.join(root, name), "utf8"))]));
  return Object.freeze({ root, files: names, fileHashes, workPlanHash: workPlan.workPlanHash, executable: false, evidenceBoundary: workPlan.evidenceBoundary });
}
