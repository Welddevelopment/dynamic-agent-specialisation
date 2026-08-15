import { digest } from "../core/canonical.js";
import { assertProvisionalObserverContract, createProvisionalObserverContract } from "./customer-local-observer-contract.js";
import {
  CUSTOMER_LOCAL_QUALIFICATION_EXPECTATIONS,
  assertCustomerLocalBindingCandidate,
  createCustomerLocalBindingCandidate,
} from "./customer-local-binding-qualification.js";

const HASH = /^[a-f0-9]{64}$/;
const ALIAS = /^[A-Z][A-Z0-9_]{5,120}$/;
const SECRET_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\bBasic\s+[A-Za-z0-9+/=]{8,}|\bsk-[A-Za-z0-9_-]{8,}|-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----|\b(?:password|secret|token|api[-_]?key)\s*[:=]\s*["']?[^\s,"'}]{6,})/i;
const SOURCE_KINDS = new Set(["openapi", "mcp-tools-list"]);
const PROVENANCE_STATES = new Set([
  "reviewed-source-observed",
  "customer-confirmed",
  "engineer-supplied-unproved",
]);
const CONFLICT_KEY_SOURCES = Object.freeze({
  openapi: new Set(["http-idempotency-header", "assigned-work-fields"]),
  "mcp-tools-list": new Set(["mcp-required-input-field", "assigned-work-fields"]),
});
const CANONICAL_CLASSIFICATIONS = Object.freeze(
  Object.fromEntries(Object.entries(CUSTOMER_LOCAL_QUALIFICATION_EXPECTATIONS).map(([id, value]) => [id, Object.freeze({ ...value })])),
);

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }
function stable(value) { return JSON.parse(JSON.stringify(value)); }
function clean(value, maximum = 240) { return String(value ?? "").trim().slice(0, maximum); }
function exactKeys(value, allowed, label) {
  requireCondition(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  requireCondition(extras.length === 0, `${label} contains unsupported fields: ${extras.join(",")}`);
}
function assertNoSecrets(value, label) {
  requireCondition(!SECRET_VALUE.test(JSON.stringify(value)), `${label} contains possible credential material`);
}
function strings(values, label, { allowEmpty = false } = {}) {
  requireCondition(Array.isArray(values) && (allowEmpty || values.length > 0), `${label} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  const normalized = values.map((value) => clean(value, 180));
  requireCondition(normalized.every(Boolean) && new Set(normalized).size === normalized.length, `${label} must contain unique non-empty values`);
  return normalized;
}
function hash(value, label) { requireCondition(HASH.test(value ?? ""), `${label} must be an exact SHA-256 hash`); return value; }

function provenance(value, label, expectedState) {
  exactKeys(value, ["status", "suppliedBy", "sourceHash"], `${label} provenance`);
  requireCondition(PROVENANCE_STATES.has(value.status), `${label} provenance status is unsupported`);
  if (expectedState) requireCondition(value.status === expectedState, `${label} must remain ${expectedState}`);
  const normalized = { status: value.status, suppliedBy: clean(value.suppliedBy, 180), sourceHash: hash(value.sourceHash, `${label} provenance sourceHash`) };
  requireCondition(normalized.suppliedBy, `${label} provenance needs an exact supplier/reviewer identity`);
  return normalized;
}

function assertStructuralInputs(structuralBinding, workPlan) {
  requireCondition(workPlan?.schemaVersion === "das.onboarding-binding-work-plan.v1" && workPlan.workPlanHash === digest(withoutHash(workPlan, "workPlanHash")), "Package factory work plan integrity mismatch");
  requireCondition(structuralBinding?.schemaVersion === "das.reviewed-onboarding-structural-binding.v1" && structuralBinding.artifactHash === digest(withoutHash(structuralBinding, "artifactHash")), "Package factory structural receipt integrity mismatch");
  requireCondition(structuralBinding.workPlanHash === workPlan.workPlanHash && structuralBinding.sessionId === workPlan.sessionId && structuralBinding.systemId === workPlan.systemId, "Package factory inputs belong to different review chains");
  requireCondition(structuralBinding.confirmationHash === workPlan.confirmationHash, "Package factory role-owner confirmation was substituted");
  const roleId = clean(structuralBinding.roleId);
  const descriptorRoleId = clean(structuralBinding.descriptor?.roleId);
  requireCondition(roleId && (!descriptorRoleId || descriptorRoleId === roleId || descriptorRoleId === `${structuralBinding.sessionId}:${roleId}`), "Package factory requires one exact unchanged role identity");
  requireCondition(structuralBinding.status === "structurally-compiled-runtime-unprobed", "Package factory requires a completely structurally compiled, unprobed receipt");
  requireCondition(Array.isArray(structuralBinding.operations) && structuralBinding.operations.length > 0 && structuralBinding.operations.every((operation) => operation.status === "structurally-compiled-runtime-unprobed" && HASH.test(operation.boundedInputSchemaHash ?? "")), "Package factory requires every operation to be structurally compiled and schema-bound");
  requireCondition(SOURCE_KINDS.has(structuralBinding.source?.kind) && structuralBinding.source.kind === workPlan.source?.kind && structuralBinding.source.sourceHash === workPlan.source.sourceHash && HASH.test(structuralBinding.source.sourceHash), "Package factory source identity does not match the reviewed chain");
  requireCondition(HASH.test(structuralBinding.successCriteriaHash ?? ""), "Package factory needs the exact success-criteria hash");
}

function normalizeSourceIdentity({ sourceIdentity, structuralBinding, workPlan }) {
  exactKeys(sourceIdentity, ["kind", "sourceHash", "provenance", "openapi", "mcp"], "Source identity");
  requireCondition(sourceIdentity.kind === structuralBinding.source.kind && sourceIdentity.sourceHash === structuralBinding.source.sourceHash, "Source identity was substituted after structural compilation");
  const result = {
    kind: sourceIdentity.kind,
    sourceHash: hash(sourceIdentity.sourceHash, "Source identity sourceHash"),
    provenance: provenance(sourceIdentity.provenance, "Source identity", "reviewed-source-observed"),
  };
  requireCondition(result.provenance.sourceHash === result.sourceHash, "Source provenance does not identify the exact reviewed source");
  const segmentTransports = new Set((structuralBinding.compilerSegments ?? []).map((segment) => segment.transportIdentityHash));
  requireCondition(segmentTransports.size > 0 && [...segmentTransports].every((value) => HASH.test(value)), "Structural receipt lacks exact compiler transport identities");
  if (sourceIdentity.kind === "openapi") {
    requireCondition(sourceIdentity.mcp === undefined, "OpenAPI source identity cannot contain MCP metadata");
    exactKeys(sourceIdentity.openapi, ["documentHash", "baseUrl", "transportIdentityHash"], "OpenAPI source metadata");
    requireCondition(sourceIdentity.openapi.documentHash === result.sourceHash, "OpenAPI document hash does not match the reviewed source");
    const baseUrl = clean(sourceIdentity.openapi.baseUrl, 500);
    let parsed;
    try { parsed = new URL(baseUrl); } catch { throw new Error("OpenAPI transport requires an exact HTTP(S) base URL"); }
    requireCondition(["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password, "OpenAPI transport requires a credential-free exact HTTP(S) base URL");
    const transportIdentityHash = hash(sourceIdentity.openapi.transportIdentityHash, "OpenAPI transport identity");
    requireCondition(transportIdentityHash === digest({ baseUrl }) && segmentTransports.has(transportIdentityHash), "OpenAPI transport identity does not match the structurally compiled transport");
    requireCondition(workPlan.adapterConfigurationDraft?.sourceHash === result.sourceHash && workPlan.adapterConfigurationDraft?.baseUrl === new URL(baseUrl).origin, "OpenAPI transport differs from the reviewed work-plan origin");
    result.openapi = { documentHash: result.sourceHash, baseUrl, transportIdentityHash };
  } else {
    requireCondition(sourceIdentity.openapi === undefined, "MCP source identity cannot contain OpenAPI metadata");
    exactKeys(sourceIdentity.mcp, ["serverId", "serverVersion", "toolsListHash", "transportIdentityHash"], "MCP source metadata");
    const serverId = clean(sourceIdentity.mcp.serverId, 160);
    const serverVersion = clean(sourceIdentity.mcp.serverVersion, 120);
    requireCondition(serverId && serverVersion, "MCP source requires exact server id and version");
    requireCondition(sourceIdentity.mcp.toolsListHash === result.sourceHash, "MCP tools/list hash does not match the reviewed source");
    const transportIdentityHash = hash(sourceIdentity.mcp.transportIdentityHash, "MCP transport identity");
    const exactTransport = digest({ server: { id: serverId, version: serverVersion, toolsListHash: result.sourceHash } });
    requireCondition(transportIdentityHash === exactTransport && segmentTransports.has(transportIdentityHash), "MCP transport identity does not match the pinned server and structurally compiled transport");
    requireCondition(workPlan.adapterConfigurationDraft?.sourceHash === result.sourceHash && workPlan.adapterConfigurationDraft?.serverId === serverId && workPlan.adapterConfigurationDraft?.serverVersion === serverVersion, "MCP server identity differs from the reviewed work-plan draft");
    result.mcp = { serverId, serverVersion, toolsListHash: result.sourceHash, transportIdentityHash };
  }
  return result;
}

function normalizeActionRuntime(value, sourceIdentity) {
  exactKeys(value, ["bindingId", "surfaceId", "credentialAliases", "implementationHash", "runtimeSchemaHash", "authenticationIdentityHash", "provenance"], "Action runtime declaration");
  const aliases = strings(value.credentialAliases, "Action credential aliases");
  requireCondition(aliases.every((alias) => ALIAS.test(alias)), "Action credentials must be environment-reference aliases only");
  return {
    bindingId: clean(value.bindingId, 180),
    surfaceId: clean(value.surfaceId, 180),
    credentialAliases: aliases,
    implementationHash: hash(value.implementationHash, "Action implementation hash"),
    runtimeSchemaHash: hash(value.runtimeSchemaHash, "Action runtime schema hash"),
    authenticationIdentityHash: hash(value.authenticationIdentityHash, "Action authentication identity hash"),
    sourceHash: sourceIdentity.sourceHash,
    transportIdentityHash: sourceIdentity.openapi?.transportIdentityHash ?? sourceIdentity.mcp.transportIdentityHash,
    provenance: provenance(value.provenance, "Action runtime", "engineer-supplied-unproved"),
  };
}

function normalizeWriteSafety(value, { operation, sourceKind, structuralBinding }) {
  exactKeys(value, ["sourceName", "stableIdentity", "idempotency", "allowedMutation", "reconciliation", "retryPolicy", "terminalBehavior", "review"], `Write-safety declaration ${value?.sourceName ?? "unknown"}`);
  requireCondition(value.sourceName === operation.sourceName, `Write-safety declaration belongs to another operation: ${value.sourceName}`);

  exactKeys(value.stableIdentity, ["fields", "provenance"], `Stable identity ${value.sourceName}`);
  const stableIdentity = {
    fields: strings(value.stableIdentity.fields, `Stable identity fields ${value.sourceName}`),
    provenance: provenance(value.stableIdentity.provenance, `Stable identity ${value.sourceName}`, "customer-confirmed"),
  };
  requireCondition(stableIdentity.provenance.sourceHash === structuralBinding.confirmationHash, `Stable identity ${value.sourceName} provenance does not identify the exact role-owner confirmation`);

  exactKeys(value.idempotency, ["conflictKeyFields", "conflictKeySource", "conflictBehavior", "provenance"], `Idempotency ${value.sourceName}`);
  requireCondition(CONFLICT_KEY_SOURCES[sourceKind].has(value.idempotency.conflictKeySource), `Idempotency ${value.sourceName} uses a source-incompatible conflict key`);
  requireCondition(value.idempotency.conflictBehavior === "halt-handoff-no-overwrite", `Idempotency ${value.sourceName} must halt on a conflicting key`);
  const idempotency = {
    conflictKeyFields: strings(value.idempotency.conflictKeyFields, `Conflict-key fields ${value.sourceName}`),
    conflictKeySource: value.idempotency.conflictKeySource,
    conflictBehavior: "halt-handoff-no-overwrite",
    provenance: provenance(value.idempotency.provenance, `Idempotency ${value.sourceName}`, "engineer-supplied-unproved"),
  };

  exactKeys(value.allowedMutation, ["entityKinds", "scopeFields", "maximumWritesPerAssignedItem", "provenance"], `Allowed mutation ${value.sourceName}`);
  requireCondition(value.allowedMutation.maximumWritesPerAssignedItem === 1, `Allowed mutation ${value.sourceName} must permit at most one business write per assigned item`);
  const allowedMutation = {
    entityKinds: strings(value.allowedMutation.entityKinds, `Allowed entity kinds ${value.sourceName}`),
    scopeFields: strings(value.allowedMutation.scopeFields, `Mutation scope fields ${value.sourceName}`),
    maximumWritesPerAssignedItem: 1,
    provenance: provenance(value.allowedMutation.provenance, `Allowed mutation ${value.sourceName}`, "customer-confirmed"),
  };
  requireCondition(allowedMutation.provenance.sourceHash === structuralBinding.confirmationHash, `Allowed mutation ${value.sourceName} provenance does not identify the exact role-owner confirmation`);

  exactKeys(value.reconciliation, ["readOperation", "inputBindings", "requiredPredicates", "proofSource", "provenance"], `Reconciliation ${value.sourceName}`);
  const readOperation = structuralBinding.operations.find((candidate) => candidate.sourceName === value.reconciliation.readOperation);
  requireCondition(readOperation?.mode === "read" && readOperation.status === "structurally-compiled-runtime-unprobed", `Reconciliation ${value.sourceName} must use a separately reviewed read operation`);
  requireCondition(value.reconciliation.proofSource === "separate-independent-observer", `Reconciliation ${value.sourceName} cannot use the action response or action runtime as proof`);
  const reconciliation = {
    readOperation: value.reconciliation.readOperation,
    inputBindings: strings(value.reconciliation.inputBindings, `Reconciliation input bindings ${value.sourceName}`),
    requiredPredicates: strings(value.reconciliation.requiredPredicates, `Reconciliation predicates ${value.sourceName}`),
    proofSource: "separate-independent-observer",
    provenance: provenance(value.reconciliation.provenance, `Reconciliation ${value.sourceName}`, "engineer-supplied-unproved"),
  };

  exactKeys(value.retryPolicy, ["automaticRetries", "eligibleClassification", "requiresExplicitGate", "maximumGatedRetries", "provenance"], `Retry policy ${value.sourceName}`);
  requireCondition(value.retryPolicy.automaticRetries === 0 && value.retryPolicy.eligibleClassification === "not-started" && value.retryPolicy.requiresExplicitGate === true && value.retryPolicy.maximumGatedRetries === 1, `Retry policy ${value.sourceName} must prohibit blind retry and allow only one explicitly gated not-started retry`);
  const retryPolicy = {
    automaticRetries: 0,
    eligibleClassification: "not-started",
    requiresExplicitGate: true,
    maximumGatedRetries: 1,
    provenance: provenance(value.retryPolicy.provenance, `Retry policy ${value.sourceName}`, "engineer-supplied-unproved"),
  };

  exactKeys(value.terminalBehavior, ["unknown", "unavailable", "partial", "incorrect", "duplicate", "collateral", "provenance"], `Terminal behavior ${value.sourceName}`);
  const expectedTerminal = {
    unknown: "halt-handoff-no-retry",
    unavailable: "halt-handoff-no-retry",
    partial: "halt-quarantine-no-retry",
    incorrect: "halt-quarantine-no-retry",
    duplicate: "halt-quarantine-no-retry",
    collateral: "halt-quarantine-no-retry",
  };
  for (const [key, expected] of Object.entries(expectedTerminal)) requireCondition(value.terminalBehavior[key] === expected, `Terminal behavior ${value.sourceName}.${key} cannot be weakened`);
  const terminalBehavior = { ...expectedTerminal, provenance: provenance(value.terminalBehavior.provenance, `Terminal behavior ${value.sourceName}`, "customer-confirmed") };
  requireCondition(terminalBehavior.provenance.sourceHash === structuralBinding.confirmationHash, `Terminal behavior ${value.sourceName} provenance does not identify the exact role-owner confirmation`);

  exactKeys(value.review, ["responsibility", "reviewedBy", "confirmationHash", "successCriteriaHash", "provenance"], `Write-safety review ${value.sourceName}`);
  requireCondition(value.review.responsibility === "customer-local-engineer-and-role-owner-reviewed-unproved", `Write-safety ${value.sourceName} must remain owner/engineer reviewed and unproved`);
  requireCondition(value.review.confirmationHash === structuralBinding.confirmationHash && value.review.successCriteriaHash === structuralBinding.successCriteriaHash, `Write-safety ${value.sourceName} review belongs to another confirmation or outcome contract`);
  const review = {
    responsibility: value.review.responsibility,
    reviewedBy: clean(value.review.reviewedBy, 180),
    confirmationHash: value.review.confirmationHash,
    successCriteriaHash: value.review.successCriteriaHash,
    provenance: provenance(value.review.provenance, `Write-safety review ${value.sourceName}`, "customer-confirmed"),
  };
  requireCondition(review.reviewedBy, `Write-safety ${value.sourceName} needs exact reviewer identity`);
  requireCondition(review.provenance.sourceHash === structuralBinding.confirmationHash, `Write-safety ${value.sourceName} review provenance does not identify the exact role-owner confirmation`);
  return { sourceName: value.sourceName, stableIdentity, idempotency, allowedMutation, reconciliation, retryPolicy, terminalBehavior, review, status: "declarative-write-safety-reviewed-unproved" };
}

function normalizeObserverDeclaration(value, { structuralBinding, writeContracts, actionRuntime }) {
  exactKeys(value, ["runtime", "stableIdentity", "freshness", "outcomeRules", "duplicateRule", "collateralRules", "predicates", "invariants", "evidenceTiming", "proofRuleReview"], "Observer/proof declaration");
  exactKeys(value.runtime, ["observerId", "surfaceId", "credentialAliases", "implementationHash", "sourceHash", "runtimeSchemaHash", "transportIdentityHash", "authenticationIdentityHash", "readOperations", "provenance"], "Observer runtime declaration");
  const aliases = strings(value.runtime.credentialAliases, "Observer credential aliases");
  requireCondition(aliases.every((alias) => ALIAS.test(alias)), "Observer credentials must be environment-reference aliases only");
  const runtime = {
    observerId: clean(value.runtime.observerId, 180),
    surfaceId: clean(value.runtime.surfaceId, 180),
    credentialAliases: aliases,
    implementationHash: hash(value.runtime.implementationHash, "Observer implementation hash"),
    sourceHash: hash(value.runtime.sourceHash, "Observer source hash"),
    runtimeSchemaHash: hash(value.runtime.runtimeSchemaHash, "Observer runtime schema hash"),
    transportIdentityHash: hash(value.runtime.transportIdentityHash, "Observer transport identity hash"),
    authenticationIdentityHash: hash(value.runtime.authenticationIdentityHash, "Observer authentication identity hash"),
    readOperations: strings(value.runtime.readOperations, "Observer read operations"),
    provenance: provenance(value.runtime.provenance, "Observer runtime", "engineer-supplied-unproved"),
  };
  requireCondition(runtime.observerId && runtime.surfaceId, "Observer runtime requires exact identities");
  requireCondition(runtime.sourceHash !== actionRuntime.sourceHash, "Observer proof source must be distinct from the action source");
  requireCondition(runtime.authenticationIdentityHash !== actionRuntime.authenticationIdentityHash, "Action and observer authentication identities must be distinct");

  exactKeys(value.stableIdentity, ["fields", "provenance"], "Observer stable identity");
  const stableIdentity = { fields: strings(value.stableIdentity.fields, "Observer stable identity fields"), provenance: provenance(value.stableIdentity.provenance, "Observer stable identity", "customer-confirmed") };
  requireCondition(stableIdentity.provenance.sourceHash === structuralBinding.confirmationHash, "Observer stable-identity provenance does not identify the exact role-owner confirmation");
  for (const contract of writeContracts) requireCondition(contract.stableIdentity.fields.every((field) => stableIdentity.fields.includes(field)), `Observer stable identity omits confirmed write identity field for ${contract.sourceName}`);

  exactKeys(value.freshness, ["snapshotGeneratedAtField", "caughtUpThroughField", "maximumAgeMs", "provenance"], "Observer freshness");
  requireCondition(Number.isFinite(value.freshness.maximumAgeMs) && value.freshness.maximumAgeMs >= 0, "Observer freshness maximum age is invalid");
  const freshness = { snapshotGeneratedAtField: clean(value.freshness.snapshotGeneratedAtField), caughtUpThroughField: clean(value.freshness.caughtUpThroughField), maximumAgeMs: value.freshness.maximumAgeMs, provenance: provenance(value.freshness.provenance, "Observer freshness", "engineer-supplied-unproved") };
  requireCondition(freshness.snapshotGeneratedAtField && freshness.caughtUpThroughField, "Observer freshness fields are required");

  exactKeys(value.outcomeRules, ["requiredExactFields", "statusField", "completionStatuses", "provenance"], "Observer outcome rules");
  const outcomeRules = { requiredExactFields: strings(value.outcomeRules.requiredExactFields, "Observer exact outcome fields"), statusField: clean(value.outcomeRules.statusField), completionStatuses: strings(value.outcomeRules.completionStatuses, "Observer completion statuses"), provenance: provenance(value.outcomeRules.provenance, "Observer outcome rules", "customer-confirmed") };
  requireCondition(outcomeRules.statusField, "Observer outcome status field is required");
  requireCondition(outcomeRules.provenance.sourceHash === structuralBinding.confirmationHash, "Observer outcome-rule provenance does not identify the exact role-owner confirmation");

  exactKeys(value.duplicateRule, ["maximumDistinctResults", "resultIdentityField", "provenance"], "Observer duplicate rule");
  requireCondition(value.duplicateRule.maximumDistinctResults === 1, "Observer duplicate rule must allow at most one distinct result");
  const duplicateRule = { maximumDistinctResults: 1, resultIdentityField: clean(value.duplicateRule.resultIdentityField), provenance: provenance(value.duplicateRule.provenance, "Observer duplicate rule", "customer-confirmed") };
  requireCondition(duplicateRule.resultIdentityField, "Observer result identity field is required");
  requireCondition(duplicateRule.provenance.sourceHash === structuralBinding.confirmationHash, "Observer duplicate-rule provenance does not identify the exact role-owner confirmation");

  exactKeys(value.collateralRules, ["changedEntitiesField", "unrelatedStateDigestField", "allowedChangedEntityKinds", "provenance"], "Observer collateral rules");
  const collateralRules = { changedEntitiesField: clean(value.collateralRules.changedEntitiesField), unrelatedStateDigestField: clean(value.collateralRules.unrelatedStateDigestField), allowedChangedEntityKinds: strings(value.collateralRules.allowedChangedEntityKinds, "Observer allowed changed-entity kinds"), provenance: provenance(value.collateralRules.provenance, "Observer collateral rules", "customer-confirmed") };
  requireCondition(collateralRules.changedEntitiesField && collateralRules.unrelatedStateDigestField, "Observer collateral evidence fields are required");
  requireCondition(collateralRules.provenance.sourceHash === structuralBinding.confirmationHash, "Observer collateral-rule provenance does not identify the exact role-owner confirmation");
  for (const contract of writeContracts) requireCondition(contract.allowedMutation.entityKinds.every((kind) => collateralRules.allowedChangedEntityKinds.includes(kind)), `Observer collateral rules omit allowed mutation kind for ${contract.sourceName}`);

  exactKeys(value.predicates, ["values", "provenance"], "Observer predicates");
  const predicates = { values: strings(value.predicates.values, "Observer predicates"), provenance: provenance(value.predicates.provenance, "Observer predicates", "engineer-supplied-unproved") };
  exactKeys(value.invariants, ["values", "provenance"], "Observer invariants");
  const invariants = { values: strings(value.invariants.values, "Observer invariants"), provenance: provenance(value.invariants.provenance, "Observer invariants", "engineer-supplied-unproved") };
  const evidenceTiming = stable(value.evidenceTiming);
  exactKeys(evidenceTiming, ["beforeActionBaselineRequired", "afterActionFenceRequired", "futureEvidenceRejected", "preExistingMatchRejected", "provenance"], "Observer evidence timing");
  requireCondition(evidenceTiming.beforeActionBaselineRequired === true && evidenceTiming.afterActionFenceRequired === true && evidenceTiming.futureEvidenceRejected === true && evidenceTiming.preExistingMatchRejected === true, "Observer timing cannot weaken baseline, fence, future-evidence, or pre-existing-match controls");
  evidenceTiming.provenance = provenance(evidenceTiming.provenance, "Observer evidence timing", "engineer-supplied-unproved");

  exactKeys(value.proofRuleReview, ["responsibility", "reviewedBy", "confirmationHash", "successCriteriaHash", "provenance"], "Observer proof-rule review");
  requireCondition(value.proofRuleReview.responsibility === "engineer-owned-reviewed-unproved", "Observer proof rules must remain engineer-owned, reviewed, and unproved");
  requireCondition(value.proofRuleReview.confirmationHash === structuralBinding.confirmationHash && value.proofRuleReview.successCriteriaHash === structuralBinding.successCriteriaHash, "Observer proof rules belong to another confirmation or outcome contract");
  const proofRuleReview = { responsibility: value.proofRuleReview.responsibility, reviewedBy: clean(value.proofRuleReview.reviewedBy, 180), confirmationHash: value.proofRuleReview.confirmationHash, successCriteriaHash: value.proofRuleReview.successCriteriaHash, provenance: provenance(value.proofRuleReview.provenance, "Observer proof-rule review", "engineer-supplied-unproved") };
  requireCondition(proofRuleReview.reviewedBy, "Observer proof rules require exact reviewer identity");

  return { runtime, stableIdentity, freshness, outcomeRules, duplicateRule, collateralRules, predicates, invariants, evidenceTiming, proofRuleReview };
}

function actionOperation(structural, writeContract) {
  const common = { sourceName: structural.sourceName, targetExposedName: structural.targetExposedName, mode: structural.mode, authorityAction: structural.authorityAction, boundedInputSchemaHash: structural.boundedInputSchemaHash };
  if (structural.mode === "read") return common;
  return {
    ...common,
    writeSafetyContractHash: writeContract.contractHash,
    stableIdentityRule: `fields:${writeContract.stableIdentity.fields.join(",")};review:${writeContract.review.confirmationHash}`,
    idempotencyRule: `source:${writeContract.idempotency.conflictKeySource};fields:${writeContract.idempotency.conflictKeyFields.join(",")};conflict:${writeContract.idempotency.conflictBehavior}`,
    reconciliationRule: `read:${writeContract.reconciliation.readOperation};proof:${writeContract.reconciliation.proofSource};unknown:${writeContract.terminalBehavior.unknown};unavailable:${writeContract.terminalBehavior.unavailable}`,
  };
}

function createWriteContractReceipt(value) {
  const contract = { schemaVersion: "das.customer-local-declarative-write-safety.v1", ...stable(value), executable: false, qualified: false, activationReady: false, evidenceBoundary: "Explicit owner/engineer write-safety meaning only. The rules are provenance-bound but remain unproved until a separate runtime and independent observer pass frozen qualification." };
  contract.contractHash = digest(contract);
  return Object.freeze(contract);
}

export function createCustomerLocalBindingPackage({ structuralBinding, workPlan, sourceIdentity, actionRuntime: actionInput, writeSafety, observerProof }) {
  assertNoSecrets({ sourceIdentity, actionInput, writeSafety, observerProof }, "Package-factory inputs");
  assertStructuralInputs(structuralBinding, workPlan);
  const source = normalizeSourceIdentity({ sourceIdentity, structuralBinding, workPlan });
  const actionRuntime = normalizeActionRuntime(actionInput, source);
  requireCondition(actionRuntime.bindingId && actionRuntime.surfaceId, "Action runtime requires exact binding and surface identities");
  const actionRuntimeDeclaration = {
    schemaVersion: "das.customer-local-action-runtime-declaration.v1",
    ...actionRuntime,
    status: "engineer-declared-unprobed-non-executable",
    credentialsResolved: false,
    runtimeAuthorityGranted: false,
    probed: false,
    executable: false,
    activationReady: false,
    evidenceBoundary: "Exact engineer-supplied action runtime identity declaration only. No credential value, authority, runtime probe, qualification or activation is established.",
  };
  actionRuntimeDeclaration.declarationHash = digest(actionRuntimeDeclaration);

  const writes = structuralBinding.operations.filter((operation) => operation.mode === "write");
  requireCondition(Array.isArray(writeSafety) && writeSafety.length === writes.length, "Write-safety inputs must cover every structurally compiled write exactly once");
  requireCondition(new Set(writeSafety.map((item) => item.sourceName)).size === writeSafety.length, "Write-safety inputs cannot duplicate operations");
  const inputByName = new Map(writeSafety.map((item) => [item.sourceName, item]));
  const writeContracts = writes.map((operation) => createWriteContractReceipt(normalizeWriteSafety(inputByName.get(operation.sourceName), { operation, sourceKind: source.kind, structuralBinding })));
  requireCondition(writeContracts.every((contract) => contract.review.confirmationHash === structuralBinding.confirmationHash), "Write-safety confirmation chain changed");

  const observerDeclaration = normalizeObserverDeclaration(observerProof, { structuralBinding, writeContracts, actionRuntime });
  const observerContract = createProvisionalObserverContract({
    structuralBinding,
    workPlan,
    observerId: observerDeclaration.runtime.observerId,
    surfaceId: observerDeclaration.runtime.surfaceId,
    credentialAliases: observerDeclaration.runtime.credentialAliases,
    implementationHash: observerDeclaration.runtime.implementationHash,
    sourceHash: observerDeclaration.runtime.sourceHash,
    runtimeSchemaHash: observerDeclaration.runtime.runtimeSchemaHash,
    transportIdentityHash: observerDeclaration.runtime.transportIdentityHash,
    readOperations: observerDeclaration.runtime.readOperations,
    stableIdentity: { fields: observerDeclaration.stableIdentity.fields },
    freshness: {
      snapshotGeneratedAtField: observerDeclaration.freshness.snapshotGeneratedAtField,
      caughtUpThroughField: observerDeclaration.freshness.caughtUpThroughField,
      maximumAgeMs: observerDeclaration.freshness.maximumAgeMs,
    },
    outcomeRules: {
      requiredExactFields: observerDeclaration.outcomeRules.requiredExactFields,
      statusField: observerDeclaration.outcomeRules.statusField,
      completionStatuses: observerDeclaration.outcomeRules.completionStatuses,
    },
    duplicateRule: {
      maximumDistinctResults: observerDeclaration.duplicateRule.maximumDistinctResults,
      resultIdentityField: observerDeclaration.duplicateRule.resultIdentityField,
    },
    collateralRules: {
      changedEntitiesField: observerDeclaration.collateralRules.changedEntitiesField,
      unrelatedStateDigestField: observerDeclaration.collateralRules.unrelatedStateDigestField,
      allowedChangedEntityKinds: observerDeclaration.collateralRules.allowedChangedEntityKinds,
    },
    proofRuleReview: {
      responsibility: observerDeclaration.proofRuleReview.responsibility,
      reviewedBy: observerDeclaration.proofRuleReview.reviewedBy,
      confirmationHash: observerDeclaration.proofRuleReview.confirmationHash,
      successCriteriaHash: observerDeclaration.proofRuleReview.successCriteriaHash,
    },
  });
  const candidate = createCustomerLocalBindingCandidate({
    structuralBinding,
    workPlan,
    observerContract,
    action: {
      bindingId: actionRuntime.bindingId,
      surfaceId: actionRuntime.surfaceId,
      credentialAliases: actionRuntime.credentialAliases,
      implementationHash: actionRuntime.implementationHash,
      sourceHash: actionRuntime.sourceHash,
      runtimeSchemaHash: actionRuntime.runtimeSchemaHash,
      transportIdentityHash: actionRuntime.transportIdentityHash,
      operations: structuralBinding.operations.map((operation) => actionOperation(operation, writeContracts.find((contract) => contract.sourceName === operation.sourceName))),
    },
  });

  const proofContractInput = {
    schemaVersion: "das.customer-local-declarative-observer-proof-input.v1",
    runtime: observerDeclaration.runtime,
    stableIdentity: observerDeclaration.stableIdentity,
    freshness: observerDeclaration.freshness,
    outcomeRules: observerDeclaration.outcomeRules,
    duplicateRule: observerDeclaration.duplicateRule,
    collateralRules: observerDeclaration.collateralRules,
    predicates: observerDeclaration.predicates,
    invariants: observerDeclaration.invariants,
    evidenceTiming: observerDeclaration.evidenceTiming,
    canonicalClassifications: CANONICAL_CLASSIFICATIONS,
    classificationRuleProvenance: { status: "das-fixed-safety-rule", sourceHash: digest(CANONICAL_CLASSIFICATIONS), suppliedBy: "DAS frozen qualification profile" },
    proofRuleReview: observerDeclaration.proofRuleReview,
    provisionalObserverContractHash: observerContract.contractHash,
    status: "declarative-observer-proof-reviewed-unproved",
    executable: false,
    qualified: false,
    activationReady: false,
    evidenceBoundary: "Observer identity, proof predicates, invariants, timing, and all ten classifications are declared. Authentication, implementation and direct observation remain unproved.",
  };
  proofContractInput.contractHash = digest(proofContractInput);

  const runtimeWorkPack = {
    schemaVersion: "das.customer-local-runtime-work-pack.v1",
    sessionId: structuralBinding.sessionId,
    systemId: structuralBinding.systemId,
    roleId: structuralBinding.roleId ?? structuralBinding.descriptor?.roleId ?? null,
    workPlanHash: workPlan.workPlanHash,
    structuralBindingHash: structuralBinding.artifactHash,
    sourceIdentityHash: digest(source),
    actionRuntimeDeclarationHash: actionRuntimeDeclaration.declarationHash,
    actionCandidateHash: candidate.candidateHash,
    observerContractHash: observerContract.contractHash,
    proofContractInputHash: proofContractInput.contractHash,
    writeSafetyContractHashes: writeContracts.map((contract) => contract.contractHash),
    generatedArtifacts: ["source-identity-receipt", "action-runtime-declaration", "declarative-write-safety-contracts", "declarative-observer-proof-input", "non-executable-action-observer-candidate", "runtime-work-pack", "generation-receipt"],
    exactEngineerWork: [
      "implement-and-authenticate-action-runtime-against-exact-action-identities",
      "implement-and-authenticate-separate-read-only-observer-against-exact-observer-identities",
      "prove-stable-identity-idempotency-conflict-and-reconciliation-semantics",
      "prove-outcome-predicates-freshness-duplicate-and-collateral-rules",
      "bind-customer-local-credential-values-outside-generated-artifacts",
      "run-all-ten-canonical-controls-in-an-integrity-bound-disposable-world",
      "run-separate-mandatory-customer-environment-acceptance",
    ],
    exactBlockers: [
      "action-runtime-implementation-unprobed",
      "observer-runtime-implementation-unprobed",
      "independent-authentication-unproved",
      "write-safety-semantics-unproved",
      "observer-proof-semantics-unproved",
      "customer-local-credentials-unresolved",
      "canonical-local-qualification-not-run",
      "mandatory-customer-environment-acceptance-not-run",
      "comparison-execution-blocked",
      "controlled-activation-blocked",
    ],
    measurements: {
      structurallyCompiledOperations: structuralBinding.operations.length,
      declarativeWriteSafetyContractsGenerated: writeContracts.length,
      observerProofContractsGenerated: 1,
      canonicalClassificationsBound: Object.keys(CANONICAL_CLASSIFICATIONS).length,
      provenanceBoundSections: writeContracts.length * 7 + 12,
      packageSpecificExecutableCodeGenerated: 0,
      credentialValues: 0,
      modelCalls: 0,
      spendUsd: 0,
    },
    gates: { sourcePinned: true, roleOwnerAndEngineerDeclarationsBound: true, credentialValuesPresent: false, runtimeAuthorityGranted: false, actionRuntimeProbed: false, observerRuntimeProbed: false, independentlyAuthenticated: false, canonicalQualificationRun: false, mandatoryAcceptanceRun: false, comparisonReady: false, executable: false, activationReady: false },
    evidenceBoundary: "Integrity-bound runtime implementation work pack only. It enumerates exact remaining engineering and proof work; it is not executable code, qualification, acceptance, comparison readiness or activation.",
  };
  runtimeWorkPack.workPackHash = digest(runtimeWorkPack);

  const receipt = {
    schemaVersion: "das.customer-local-binding-package-generation.v1",
    sessionId: structuralBinding.sessionId,
    systemId: structuralBinding.systemId,
    roleId: runtimeWorkPack.roleId,
    workPlanHash: workPlan.workPlanHash,
    structuralBindingHash: structuralBinding.artifactHash,
    confirmationHash: structuralBinding.confirmationHash,
    successCriteriaHash: structuralBinding.successCriteriaHash,
    sourceIdentityHash: runtimeWorkPack.sourceIdentityHash,
    actionRuntimeDeclarationHash: actionRuntimeDeclaration.declarationHash,
    writeSafetyContractHashes: runtimeWorkPack.writeSafetyContractHashes,
    proofContractInputHash: proofContractInput.contractHash,
    observerContractHash: observerContract.contractHash,
    candidateHash: candidate.candidateHash,
    workPackHash: runtimeWorkPack.workPackHash,
    status: "generated-reviewed-non-executable-runtime-work-pack",
    credentialValuesIncluded: false,
    runtimeAuthorityGranted: false,
    executableOperations: 0,
    comparisonReady: false,
    qualified: false,
    activated: false,
    modelCalls: 0,
    spendUsd: 0,
    evidenceBoundary: "DAS generated exact non-executable candidates and a work pack from reviewed source plus explicit owner/engineer meaning. No runtime, proof, customer comparison or activation is established.",
  };
  receipt.receiptHash = digest(receipt);
  const output = { schemaVersion: "das.customer-local-binding-package.v1", sourceIdentity: source, actionRuntimeDeclaration, writeSafetyContracts: writeContracts, proofContractInput, observerContract, candidate, runtimeWorkPack, receipt };
  assertNoSecrets(output, "Generated customer-local binding package");
  return Object.freeze(output);
}

export function assertCustomerLocalBindingPackage({ package: value, structuralBinding, workPlan, sourceIdentity, actionRuntime, writeSafety, observerProof }) {
  requireCondition(value?.schemaVersion === "das.customer-local-binding-package.v1", "Unsupported customer-local binding package");
  requireCondition(value.receipt?.receiptHash === digest(withoutHash(value.receipt, "receiptHash")), "Binding package generation receipt integrity mismatch");
  requireCondition(value.runtimeWorkPack?.workPackHash === digest(withoutHash(value.runtimeWorkPack, "workPackHash")), "Binding package work-pack integrity mismatch");
  requireCondition(value.actionRuntimeDeclaration?.declarationHash === digest(withoutHash(value.actionRuntimeDeclaration, "declarationHash")), "Binding package action-runtime declaration integrity mismatch");
  requireCondition(value.proofContractInput?.contractHash === digest(withoutHash(value.proofContractInput, "contractHash")), "Binding package observer-proof input integrity mismatch");
  requireCondition(value.writeSafetyContracts?.every((contract) => contract.contractHash === digest(withoutHash(contract, "contractHash"))), "Binding package write-safety integrity mismatch");
  assertProvisionalObserverContract({ contract: value.observerContract, structuralBinding, workPlan });
  assertCustomerLocalBindingCandidate({ candidate: value.candidate, structuralBinding, workPlan, observerContract: value.observerContract });
  requireCondition(value.receipt.sourceIdentityHash === digest(value.sourceIdentity) && value.receipt.actionRuntimeDeclarationHash === value.actionRuntimeDeclaration.declarationHash && value.receipt.candidateHash === value.candidate.candidateHash && value.receipt.observerContractHash === value.observerContract.contractHash && value.receipt.proofContractInputHash === value.proofContractInput.contractHash && value.receipt.workPackHash === value.runtimeWorkPack.workPackHash, "Binding package receipt does not bind its exact generated artifacts");
  const expected = createCustomerLocalBindingPackage({ structuralBinding, workPlan, sourceIdentity, actionRuntime, writeSafety, observerProof });
  requireCondition(expected.receipt.receiptHash === value.receipt.receiptHash, "Binding package no longer matches its exact reviewed inputs");
  requireCondition(value.receipt.executableOperations === 0 && value.receipt.runtimeAuthorityGranted === false && value.receipt.comparisonReady === false && value.receipt.qualified === false && value.receipt.activated === false, "Binding package widened a protected gate");
  requireCondition(value.candidate.executable === false && value.observerContract.executable === false && value.runtimeWorkPack.gates.executable === false, "Binding package fabricated executable evidence");
  assertNoSecrets(value, "Customer-local binding package");
  return true;
}

export const CUSTOMER_LOCAL_BINDING_PACKAGE_CLASSIFICATIONS = CANONICAL_CLASSIFICATIONS;
