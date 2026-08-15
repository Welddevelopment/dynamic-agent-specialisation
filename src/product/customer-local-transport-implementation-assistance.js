import { digest } from "../core/canonical.js";
import { assertSourceGroundedBindingDraftSession } from "./source-grounded-binding-package-draft.js";
import { CUSTOMER_LOCAL_BINDING_PACKAGE_CLASSIFICATIONS } from "./customer-local-binding-package-factory.js";

const HASH = /^[a-f0-9]{64}$/;
const ALIAS = /^[A-Z][A-Z0-9_]{5,120}$/;
const SECRET_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\bBasic\s+[A-Za-z0-9+/=]{8,}|\bsk-[A-Za-z0-9_-]{8,}|-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----|\b(?:password|secret|token|api[-_]?key)\s*[:=]\s*["']?[^\s,"'}]{6,})/i;
const CONTROL_IDS = Object.freeze([
  "completed",
  "not-started",
  "partial",
  "incorrect",
  "duplicate",
  "stale",
  "collateral",
  "unknown",
  "unavailable",
  "lost-response",
]);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

function clean(value, maximum = 240) {
  return String(value ?? "").trim().slice(0, maximum);
}

function exactHash(value, label) {
  requireCondition(HASH.test(value ?? ""), `${label} must be an exact SHA-256 hash`);
  return value;
}

function noSecrets(value, label) {
  requireCondition(!SECRET_VALUE.test(JSON.stringify(value)), `${label} contains possible credential material`);
}

function exactAliases(value, label) {
  requireCondition(Array.isArray(value) && value.length > 0, `${label} must contain at least one alias`);
  const aliases = value.map((item) => clean(item, 140));
  requireCondition(aliases.every((alias) => ALIAS.test(alias)) && new Set(aliases).size === aliases.length, `${label} must contain unique environment-reference aliases only`);
  return aliases;
}

function assertIntegrityBoundInputs({ draftSession, packageInputDraft, generatedPackage, scaffoldPlan, scaffoldReceipt }) {
  assertSourceGroundedBindingDraftSession(draftSession);
  requireCondition(draftSession.status === "complete-non-executable-package-input-draft" && draftSession.readiness.packageInputDraftComplete === true, "Transport assistance requires a complete reviewed DAS-024 draft session");
  requireCondition(packageInputDraft?.schemaVersion === "das.source-grounded-binding-package-input-draft.v1" && packageInputDraft.draftHash === digest(withoutHash(packageInputDraft, "draftHash")), "DAS-024 package-input draft integrity mismatch");
  requireCondition(packageInputDraft.sessionHash === draftSession.sessionHash, "DAS-024 package-input draft belongs to another reviewed session revision");
  requireCondition(generatedPackage?.schemaVersion === "das.customer-local-binding-package.v1", "Transport assistance requires the exact DAS-023 generated package");
  requireCondition(generatedPackage.receipt?.receiptHash === digest(withoutHash(generatedPackage.receipt, "receiptHash")), "DAS-023 package receipt integrity mismatch");
  requireCondition(generatedPackage.receipt.sourceIdentityHash === digest(generatedPackage.sourceIdentity), "DAS-023 package source identity changed");
  requireCondition(scaffoldPlan?.schemaVersion === "das.customer-local-binding-plugin-scaffold-plan.v1" && scaffoldPlan.planHash === digest(withoutHash(scaffoldPlan, "planHash")), "DAS-025 scaffold plan integrity mismatch");
  requireCondition(scaffoldReceipt?.schemaVersion === "das.customer-local-binding-plugin-scaffold-receipt.v1" && scaffoldReceipt.receiptHash === digest(withoutHash(scaffoldReceipt, "receiptHash")), "DAS-025 scaffold receipt integrity mismatch");
  requireCondition(scaffoldReceipt.planHash === scaffoldPlan.planHash && scaffoldReceipt.generatedProjectHash === scaffoldPlan.generatedProjectHash, "DAS-025 scaffold receipt belongs to another generated project");
  requireCondition(scaffoldPlan.draftHash === packageInputDraft.draftHash && scaffoldPlan.packageReceiptHash === generatedPackage.receipt.receiptHash, "DAS-025 project does not belong to the exact DAS-024/DAS-023 chain");
  requireCondition(scaffoldReceipt.draftHash === packageInputDraft.draftHash && scaffoldReceipt.packageReceiptHash === generatedPackage.receipt.receiptHash, "DAS-025 scaffold receipt does not bind the exact DAS-024/DAS-023 chain");
  requireCondition(scaffoldPlan.gates?.sourcePinned === true && scaffoldPlan.gates?.actionObserverSeparated === true, "DAS-025 source/trust-plane gates are not intact");
  requireCondition(scaffoldPlan.gates?.executable === false && scaffoldReceipt.executable === false && scaffoldReceipt.qualified === false && scaffoldReceipt.activated === false, "DAS-025 input widened a protected gate");
  requireCondition(draftSession.sources.action.sourceHash === packageInputDraft.sourceIdentity.sourceHash, "Reviewed action source changed after DAS-024");
  requireCondition(draftSession.sources.observer.sourceHash === packageInputDraft.observerProof.runtime.sourceHash, "Reviewed observer source changed after DAS-024");
  requireCondition(draftSession.sources.action.kind === packageInputDraft.sourceIdentity.kind && draftSession.sources.observer.kind === packageInputDraft.sourceIdentity.kind, "DAS-026 supports one exact source family per action/observer pair");
  noSecrets({ draftSession, packageInputDraft, generatedPackage, scaffoldPlan, scaffoldReceipt }, "DAS-026 input chain");
}

function operationByName(source, name, expectedMode, label) {
  const matches = source.operations.filter((operation) => operation.name === name);
  requireCondition(matches.length === 1, `${label} operation ${name} is missing or duplicated in the pinned source`);
  const operation = matches[0];
  requireCondition(operation.modeProposal === expectedMode, `${label} operation ${name} is not source-grounded as ${expectedMode}`);
  requireCondition(operation.instructionLikeDescription !== true, `${label} operation ${name} contains instruction-like untrusted source text and requires manual review`);
  return operation;
}

function openApiOperation(operation, source, plane) {
  requireCondition(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(operation.method), `OpenAPI ${operation.name} uses an unsupported method`);
  requireCondition(clean(operation.route).startsWith("/"), `OpenAPI ${operation.name} has an invalid route`);
  const parameters = operation.parameters ?? [];
  const parameterNames = new Set(parameters.map((parameter) => parameter.name));
  const bodyFields = operation.inputFields.filter((field) => !parameterNames.has(field));
  return {
    family: "openapi",
    plane,
    operationName: operation.name,
    sourceHash: source.sourceHash,
    transportIdentity: {
      baseUrl: source.sourceIdentity.baseUrl,
      method: operation.method,
      routeTemplate: operation.route,
      inputSchemaHash: operation.inputSchemaHash,
      responseShapeHashes: operation.responses.map((response) => ({ status: response.status, contentSchemaHashes: response.contentSchemaHashes })),
    },
    inputMapping: {
      path: parameters.filter((item) => item.in === "path").map((item) => ({ field: item.name, required: item.required, schemaHash: item.schemaHash })),
      query: parameters.filter((item) => item.in === "query").map((item) => ({ field: item.name, required: item.required, schemaHash: item.schemaHash })),
      header: parameters.filter((item) => item.in === "header").map((item) => ({ field: item.name, required: item.required, schemaHash: item.schemaHash })),
      body: bodyFields.map((field) => ({ field, required: operation.requiredFields.includes(field) })),
    },
    execution: "not-implemented",
  };
}

function mcpOperation(operation, source, plane) {
  return {
    family: "mcp-tools-list",
    plane,
    operationName: operation.name,
    sourceHash: source.sourceHash,
    transportIdentity: {
      serverId: source.sourceIdentity.serverId,
      serverVersion: source.sourceIdentity.serverVersion,
      toolsListHash: source.sourceHash,
      inputSchemaHash: operation.inputSchemaHash,
    },
    inputMapping: {
      fields: operation.inputFields.map((field) => ({ field, required: operation.requiredFields.includes(field) })),
    },
    execution: "not-implemented",
  };
}

function transportOperation(operation, source, plane) {
  return source.kind === "openapi" ? openApiOperation(operation, source, plane) : mcpOperation(operation, source, plane);
}

function provenance(path, sourceHash, status) {
  return Object.freeze({ path, sourceHash: exactHash(sourceHash, `${path} provenance`), status });
}

function classificationHooks(proof, write) {
  const terminal = write.terminalBehavior;
  const expected = CUSTOMER_LOCAL_BINDING_PACKAGE_CLASSIFICATIONS;
  return CONTROL_IDS.map((id) => {
    const canonical = expected[id];
    requireCondition(canonical, `Missing canonical classification ${id}`);
    const requiredEvidence = id === "not-started"
      ? ["before-action-baseline", "after-action-independent-observation", "zero-matching-results"]
      : id === "unavailable" || id === "unknown"
        ? ["independent-observer-status"]
        : ["before-action-baseline", "after-action-independent-observation", "freshness-fence", "duplicate-and-collateral-check"];
    return {
      id,
      expectedClassification: canonical.classification,
      expectedDisposition: canonical.disposition,
      maximumBusinessWrites: canonical.maximumBusinessWrites,
      requiredEvidence,
      actionResponseMayProveOutcome: false,
      retry: id === "not-started" ? { automatic: false, explicitGateRequired: true, maximum: write.retryPolicy.maximumGatedRetries } : { automatic: false, explicitGateRequired: false, maximum: 0 },
      terminalRule: terminal[id] ?? (id === "stale" ? "halt-handoff-no-retry" : id === "completed" ? "accept-after-independent-proof" : id === "lost-response" ? "reconcile-before-any-retry" : canonical.disposition),
      implementation: "hook-required-not-implemented",
      proofContractHash: proof.contractHash,
    };
  });
}

function dependencyTasks({ family, writeOperation, readOperation, observerOperations, aliases }) {
  const tasks = [
    { id: "T01", dependsOn: [], owner: "customer-local-engineer", work: `implement ${family} client boundary with exact pinned source identity and no dynamic operation selection`, acceptance: "client refuses source, operation, method/tool, and schema substitutions" },
    { id: "T02", dependsOn: ["T01"], owner: "workspace-administrator", work: `bind opaque credential leases to approved aliases only: ${aliases.join(", ")}`, acceptance: "no credential value enters generated source, receipts, logs, or evidence" },
    { id: "T03", dependsOn: ["T01"], owner: "customer-local-engineer", work: `implement exact pre-write authority hook for ${writeOperation}`, acceptance: "write transport cannot be reached until exact role, operation, target, scope, limit, expiry, and approval checks pass" },
    { id: "T04", dependsOn: ["T02", "T03"], owner: "customer-local-engineer", work: `implement exact ${writeOperation} serializer and authenticated action transport`, acceptance: "one source-grounded operation only; unapproved fields and operations fail closed" },
    { id: "T05", dependsOn: ["T01", "T02"], owner: "customer-local-engineer", work: `implement read-only reconciliation operation ${readOperation}`, acceptance: "reconciliation has no write surface and uses reviewed stable identity mapping" },
    { id: "T06", dependsOn: ["T01", "T02"], owner: "customer-local-engineer", work: `implement separately authenticated read-only observer operations ${observerOperations.join(", ")}`, acceptance: "observer has distinct source/auth/alias/implementation identity and zero writes" },
    { id: "T07", dependsOn: ["T04"], owner: "customer-local-engineer", work: "implement action-evidence mapping as acknowledgement and transport diagnostics only", acceptance: "action evidence cannot satisfy outcome proof" },
    { id: "T08", dependsOn: ["T06"], owner: "customer-local-engineer-and-role-owner", work: "implement observer-evidence mapping, freshness fences, exact outcome predicates, duplicate and collateral rules", acceptance: "every mapped proof field is separately observed and review-bound" },
    { id: "T09", dependsOn: ["T05", "T08"], owner: "customer-local-engineer", work: "implement all ten outcome classifiers and reconcile-before-retry state machine", acceptance: "zero blind retries; unknown/unavailable halt; unsafe outcomes quarantine" },
    { id: "T10", dependsOn: ["T03", "T04", "T05", "T06", "T07", "T08", "T09"], owner: "customer-local-engineer", work: "run generated integrity, authority, transport, proof, retry, mutation, and canonical-control tests", acceptance: "every frozen negative control fails closed" },
    { id: "T11", dependsOn: ["T10"], owner: "independent-qualification-runner", work: "run unchanged DAS-023 disposable qualification and preserve exact receipts", acceptance: "10/10 exact controls, restart reconciliation, zero surviving incorrect effects" },
    { id: "T12", dependsOn: ["T11"], owner: "customer-and-operator", work: "perform separate customer-environment acceptance and activation decision", acceptance: "outside DAS-026; no automatic readiness promotion" },
  ];
  return tasks;
}

function generatedTests({ packageIdentityHash, actionOperationName, observerOperationNames }) {
  const tests = [
    ...CONTROL_IDS.map((id) => ({ id: `canonical:${id}`, kind: "canonical-outcome", controlId: id, status: "generated-not-run", packageIdentityHash })),
    { id: "negative:credential-value", kind: "secret-boundary", expected: "reject", status: "generated-not-run" },
    { id: "negative:authority-bypass", kind: "pre-write-authority", operation: actionOperationName, expected: "reject-before-transport", status: "generated-not-run" },
    { id: "negative:operation-substitution", kind: "source-identity", expected: "reject", status: "generated-not-run" },
    { id: "negative:action-response-proof", kind: "evidence-separation", expected: "reject", status: "generated-not-run" },
    { id: "negative:observer-write", kind: "observer-read-only", operations: observerOperationNames, expected: "reject", status: "generated-not-run" },
    { id: "negative:shared-auth-or-alias", kind: "trust-plane-separation", expected: "reject", status: "generated-not-run" },
    { id: "negative:blind-retry", kind: "reconciliation", expected: "reject", status: "generated-not-run" },
    { id: "negative:stale-or-cross-package", kind: "integrity", expected: "reject", status: "generated-not-run" },
  ];
  return tests;
}

export function createCustomerLocalTransportImplementationWorkPack({
  draftSession,
  packageInputDraft,
  generatedPackage,
  scaffoldPlan,
  scaffoldReceipt,
}) {
  assertIntegrityBoundInputs({ draftSession, packageInputDraft, generatedPackage, scaffoldPlan, scaffoldReceipt });

  const actionAliases = exactAliases(packageInputDraft.actionRuntime.credentialAliases, "Action credentials");
  const observerAliases = exactAliases(packageInputDraft.observerProof.runtime.credentialAliases, "Observer credentials");
  requireCondition(actionAliases.every((alias) => !observerAliases.includes(alias)), "Action and observer credential aliases must remain disjoint");
  requireCondition(packageInputDraft.actionRuntime.authenticationIdentityHash !== packageInputDraft.observerProof.runtime.authenticationIdentityHash, "Action and observer authentication identities must remain distinct");
  requireCondition(draftSession.sources.action.sourceHash !== draftSession.sources.observer.sourceHash, "Action and observer source material must remain distinct");

  const writes = packageInputDraft.writeSafety;
  requireCondition(Array.isArray(writes) && writes.length === 1, "DAS-026 v1 supports exactly one reviewed bounded write per package");
  const write = writes[0];
  const actionOperation = operationByName(draftSession.sources.action, write.sourceName, "write", "Action");
  const reconciliationOperation = operationByName(draftSession.sources.action, write.reconciliation.readOperation, "read", "Reconciliation");
  const observerOperations = packageInputDraft.observerProof.runtime.readOperations.map((name) => operationByName(draftSession.sources.observer, name, "read", "Observer"));
  const candidateAction = generatedPackage.candidate.action.operations.find((operation) => operation.sourceName === write.sourceName);
  requireCondition(candidateAction?.authorityAction, "Reviewed package lacks an exact pre-write authority action");

  const chainIdentity = {
    draftSessionHash: draftSession.sessionHash,
    das024DraftHash: packageInputDraft.draftHash,
    das023PackageReceiptHash: generatedPackage.receipt.receiptHash,
    das025ScaffoldPlanHash: scaffoldPlan.planHash,
    das025ScaffoldReceiptHash: scaffoldReceipt.receiptHash,
    das025GeneratedProjectHash: scaffoldReceipt.generatedProjectHash,
    actionSourceHash: draftSession.sources.action.sourceHash,
    observerSourceHash: draftSession.sources.observer.sourceHash,
    confirmationHash: generatedPackage.receipt.confirmationHash,
    successCriteriaHash: generatedPackage.receipt.successCriteriaHash,
  };
  const packageIdentityHash = digest(chainIdentity);

  const actionTransport = {
    schemaVersion: "das.customer-local-action-transport-skeleton.v1",
    packageIdentityHash,
    bindingId: packageInputDraft.actionRuntime.bindingId,
    surfaceId: packageInputDraft.actionRuntime.surfaceId,
    sourceKind: draftSession.sources.action.kind,
    credentialResolution: { interface: "resolveOpaqueLease(alias, exactUseContext)", aliases: actionAliases, valuesIncluded: false, persistenceAllowed: false, loggingAllowed: false, implementation: "customer-local-hook-required" },
    preWriteAuthorityHook: {
      interface: "assertExactAuthority({roleId, operation, target, scope, limits, approval, expiresAt, stateVersion})",
      requiredAuthorityAction: candidateAction.authorityAction,
      mustRunImmediatelyBeforeTransport: true,
      mayGrantBroaderAuthority: false,
      implementation: "customer-local-hook-required",
      provenance: provenance("candidate.action.authorityAction", generatedPackage.receipt.confirmationHash, "owner-confirmed"),
    },
    write: transportOperation(actionOperation, draftSession.sources.action, "action"),
    reconciliationRead: transportOperation(reconciliationOperation, draftSession.sources.action, "action-readback"),
    stableIdentity: { fields: [...write.stableIdentity.fields], provenance: structuredClone(write.stableIdentity.provenance) },
    idempotency: {
      conflictKeyFields: [...write.idempotency.conflictKeyFields],
      conflictKeySource: write.idempotency.conflictKeySource,
      conflictBehavior: write.idempotency.conflictBehavior,
      automaticRetries: 0,
      onlyEligibleClassification: "not-started",
      explicitGateRequired: true,
      maximumGatedRetries: 1,
      reconcileBeforeAnyRetry: true,
      provenance: structuredClone(write.idempotency.provenance),
    },
    allowedMutation: structuredClone(write.allowedMutation),
    reconciliation: structuredClone(write.reconciliation),
    status: "generated-source-grounded-non-executable",
    executable: false,
  };
  actionTransport.transportSkeletonHash = digest(actionTransport);

  const observerTransport = {
    schemaVersion: "das.customer-local-observer-transport-skeleton.v1",
    packageIdentityHash,
    observerId: packageInputDraft.observerProof.runtime.observerId,
    surfaceId: packageInputDraft.observerProof.runtime.surfaceId,
    sourceKind: draftSession.sources.observer.kind,
    sourceHash: draftSession.sources.observer.sourceHash,
    transportIdentityHash: packageInputDraft.observerProof.runtime.transportIdentityHash,
    authenticationIdentityHash: packageInputDraft.observerProof.runtime.authenticationIdentityHash,
    credentialResolution: { interface: "resolveOpaqueReadOnlyLease(alias, exactUseContext)", aliases: observerAliases, valuesIncluded: false, persistenceAllowed: false, loggingAllowed: false, implementation: "customer-local-hook-required" },
    operations: observerOperations.map((operation) => transportOperation(operation, draftSession.sources.observer, "independent-observer")),
    readOnly: true,
    writeOperations: [],
    stableIdentity: structuredClone(packageInputDraft.observerProof.stableIdentity),
    freshness: structuredClone(packageInputDraft.observerProof.freshness),
    status: "generated-source-grounded-non-executable",
    executable: false,
  };
  observerTransport.transportSkeletonHash = digest(observerTransport);

  const evidenceMappings = {
    schemaVersion: "das.customer-local-action-observer-evidence-mappings.v1",
    packageIdentityHash,
    actionEvidence: {
      source: "action-transport-only",
      permittedFields: ["requestIdentityHash", "operationIdentityHash", "transportAttemptId", "responseStatus", "responseShapeHash", "responseLost"],
      mayProveBusinessOutcome: false,
      mappingImplementation: "customer-local-hook-required",
    },
    observerEvidence: {
      sourceHash: draftSession.sources.observer.sourceHash,
      authenticationIdentityHash: packageInputDraft.observerProof.runtime.authenticationIdentityHash,
      requiredExactFields: [...packageInputDraft.observerProof.outcomeRules.requiredExactFields],
      statusField: packageInputDraft.observerProof.outcomeRules.statusField,
      completionStatuses: [...packageInputDraft.observerProof.outcomeRules.completionStatuses],
      resultIdentityField: packageInputDraft.observerProof.duplicateRule.resultIdentityField,
      changedEntitiesField: packageInputDraft.observerProof.collateralRules.changedEntitiesField,
      unrelatedStateDigestField: packageInputDraft.observerProof.collateralRules.unrelatedStateDigestField,
      snapshotGeneratedAtField: packageInputDraft.observerProof.freshness.snapshotGeneratedAtField,
      caughtUpThroughField: packageInputDraft.observerProof.freshness.caughtUpThroughField,
      predicates: [...packageInputDraft.observerProof.predicates.values],
      invariants: [...packageInputDraft.observerProof.invariants.values],
      mappingImplementation: "customer-local-hook-required",
    },
    actionObserverEvidencePathsSeparate: true,
    proofContractHash: generatedPackage.proofContractInput.contractHash,
  };
  evidenceMappings.mappingTableHash = digest(evidenceMappings);

  const classifications = classificationHooks(generatedPackage.proofContractInput, write);
  const tasks = dependencyTasks({
    family: draftSession.sources.action.kind,
    writeOperation: actionOperation.name,
    readOperation: reconciliationOperation.name,
    observerOperations: observerOperations.map((operation) => operation.name),
    aliases: [...actionAliases, ...observerAliases],
  });
  const tests = generatedTests({ packageIdentityHash, actionOperationName: actionOperation.name, observerOperationNames: observerOperations.map((operation) => operation.name) });

  const manualBlockers = [
    "customer-local-credential-alias-resolver-not-implemented",
    `${draftSession.sources.action.kind}-action-client-and-authentication-not-implemented`,
    "exact-pre-write-authority-hook-not-implemented",
    "action-serialization-and-response-mapping-not-tested",
    "reconciliation-readback-not-implemented",
    `${draftSession.sources.observer.kind}-independent-observer-client-and-authentication-not-implemented`,
    "observer-evidence-mapping-and-proof-classification-not-tested",
    "ten-control-conformance-not-run",
    "customer-environment-acceptance-not-run",
    "customer-execution-and-activation-not-authorized",
  ];

  const pack = {
    schemaVersion: "das.customer-local-transport-implementation-work-pack.v1",
    chainIdentity,
    packageIdentityHash,
    actionTransport,
    observerTransport,
    evidenceMappings,
    classificationHooks: classifications,
    generatedTests: tests,
    dependencyOrderedTasks: tasks,
    manualBlockers,
    provenanceSummary: {
      sourceGroundedOperationFacts: 2 + observerOperations.length,
      ownerConfirmedBusinessSections: 4,
      engineerConfirmedSafetyAndProofSections: 7,
      independentlyVerifiedSections: 0,
      inferredAuthorityFields: 0,
      inferredCredentialValues: 0,
      inferredProofFields: 0,
    },
    measurements: {
      sourceFamily: draftSession.sources.action.kind,
      sourceGroundedTransportOperations: 2 + observerOperations.length,
      generatedTransportSkeletons: 2,
      generatedCredentialResolverInterfaces: 2,
      generatedAuthorityHooks: 1,
      generatedEvidenceMappingTables: 2,
      generatedClassificationHooks: classifications.length,
      generatedConformanceAndNegativeTests: tests.length,
      generatedDependencyOrderedTasks: tasks.length,
      packageSpecificExecutableFilesGenerated: 0,
      packageSpecificExecutableLinesGenerated: 0,
      remainingManualImplementationTasks: tasks.filter((task) => !["T11", "T12"].includes(task.id)).length,
      remainingExternalQualificationOrActivationTasks: 2,
      credentialValues: 0,
      modelCalls: 0,
      spendUsd: 0,
    },
    gates: {
      exactReviewedChainBound: true,
      sourcePinned: true,
      actionObserverSeparated: true,
      credentialValuesPresent: false,
      runtimeAuthorityGranted: false,
      transportImplemented: false,
      evidenceMappingsImplemented: false,
      conformanceRun: false,
      customerExecutable: false,
      comparisonReady: false,
      activationReady: false,
    },
    status: "complete-non-executable-implementation-work-pack",
    evidenceBoundary: "Source-grounded implementation assistance only. Transport identities, interfaces, mappings, hooks, tests, tasks and blockers are generated, but no credential, authority, live transport, proof, qualification, customer execution or activation is established.",
  };
  pack.workPackHash = digest(pack);
  noSecrets(pack, "DAS-026 implementation work pack");
  return Object.freeze(pack);
}

export function assertCustomerLocalTransportImplementationWorkPack({
  workPack,
  draftSession,
  packageInputDraft,
  generatedPackage,
  scaffoldPlan,
  scaffoldReceipt,
}) {
  requireCondition(workPack?.schemaVersion === "das.customer-local-transport-implementation-work-pack.v1" && workPack.workPackHash === digest(withoutHash(workPack, "workPackHash")), "DAS-026 work-pack integrity mismatch");
  requireCondition(workPack.classificationHooks.length === CONTROL_IDS.length && CONTROL_IDS.every((id) => workPack.classificationHooks.some((hook) => hook.id === id)), "DAS-026 work pack omits a canonical classification hook");
  requireCondition(workPack.actionTransport.preWriteAuthorityHook.mustRunImmediatelyBeforeTransport === true && workPack.actionTransport.idempotency.automaticRetries === 0 && workPack.actionTransport.idempotency.reconcileBeforeAnyRetry === true, "DAS-026 work pack weakened authority or retry controls");
  requireCondition(workPack.evidenceMappings.actionEvidence.mayProveBusinessOutcome === false && workPack.observerTransport.readOnly === true && workPack.observerTransport.writeOperations.length === 0, "DAS-026 work pack weakened independent observation");
  requireCondition(Object.values(workPack.gates).every((value) => typeof value === "boolean") && workPack.gates.customerExecutable === false && workPack.gates.comparisonReady === false && workPack.gates.activationReady === false, "DAS-026 work pack widened a protected gate");
  noSecrets(workPack, "DAS-026 implementation work pack");
  const expected = createCustomerLocalTransportImplementationWorkPack({ draftSession, packageInputDraft, generatedPackage, scaffoldPlan, scaffoldReceipt });
  requireCondition(expected.workPackHash === workPack.workPackHash, "DAS-026 work pack is stale or belongs to another source, role, package, scaffold, or reviewed decision chain");
  return true;
}

export const DAS026_CANONICAL_CONTROLS = CONTROL_IDS;
