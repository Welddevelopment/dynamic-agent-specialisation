import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson, digest } from "../core/canonical.js";

const HASH = /^[a-f0-9]{64}$/;
const SAFE_ALIAS = /^[A-Z][A-Z0-9_]{2,127}$/;
const SECRET_KEY = /(^|[-_])(api[-_]?key|password|passwd|secret|token|credential[-_]?value|private[-_]?key|access[-_]?key)($|[-_])/i;
const SECRET_VALUE = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+\/-]{12,}|\bsk-[A-Za-z0-9_-]{12,})/i;
const REQUIRED_BLOCKERS = Object.freeze([
  "customer-credentials-not-resolved",
  "customer-action-transport-not-bound",
  "customer-observer-transport-not-bound",
  "customer-environment-conformance-not-run",
  "mandatory-customer-acceptance-not-run",
  "comparison-readiness-unproved",
  "customer-execution-not-authorized",
  "activation-not-authorized",
]);

const IMMUTABLE_FILES = Object.freeze([
  "blockers.json",
  "conformance-evidence.json",
  "deployment-bundle.json",
  "implementation-identities.json",
  "observer-bindings.json",
  "plugin-project-identities.json",
  "readiness-receipt.json",
  "role-contract.json",
  "rollback-plan.json",
  "specialist.json",
  "state-genesis.json",
]);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function clone(value) { return structuredClone(value); }
function withoutHash(value, key) { const copy = clone(value); delete copy[key]; return copy; }
function json(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function rawSha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function canonicalBytes(value) { return Buffer.from(canonicalJson(value), "utf8"); }
function mode(file) { return fs.statSync(file).mode & 0o777; }

function assertHash(value, label) {
  requireCondition(HASH.test(value ?? ""), `${label} must be an exact SHA-256 identity`);
}

function assertRecord(record, schemaVersion, hashField, label) {
  requireCondition(record?.schemaVersion === schemaVersion, `Unsupported ${label} schema`);
  assertHash(record[hashField], `${label} ${hashField}`);
  requireCondition(record[hashField] === digest(withoutHash(record, hashField)), `${label} integrity mismatch`);
}

function assertNoSecrets(value, label = "deployment bundle", pathPrefix = label) {
  if (Array.isArray(value)) return value.forEach((child, index) => assertNoSecrets(child, label, `${pathPrefix}[${index}]`));
  if (typeof value === "string") {
    requireCondition(!SECRET_VALUE.test(value), `${label} contains credential or secret material at ${pathPrefix}`);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    requireCondition(!(SECRET_KEY.test(key) && child !== null && child !== undefined && String(child).trim()), `${label} contains credential or secret material at ${pathPrefix}.${key}`);
    assertNoSecrets(child, label, `${pathPrefix}.${key}`);
  }
}

function exportedPublicKey(publicKey) {
  const key = publicKey?.type === "public" ? publicKey : crypto.createPublicKey(publicKey);
  return key.export({ format: "pem", type: "spki" }).toString();
}

function assertSigningPair(privateKey, publicKey) {
  const probe = Buffer.from("das-nonactivating-deployment-bundle-signing-pair-v1");
  const signature = crypto.sign(null, probe, privateKey);
  requireCondition(crypto.verify(null, probe, publicKey, signature), "Signing private key does not match the pinned public key");
}

function signRecord(record, privateKey) {
  return crypto.sign(null, canonicalBytes(record), privateKey).toString("base64");
}

function verifyRecordSignature(record, signature, publicKey, label) {
  requireCondition(typeof signature === "string" && signature.length > 40, `${label} signature is missing`);
  requireCondition(crypto.verify(null, canonicalBytes(record), publicKey, Buffer.from(signature, "base64")), `${label} signature verification failed`);
}

function assertRoleContract(role) {
  assertRecord(role, "das.customer-local-role-contract.v1", "contractHash", "role contract");
  requireCondition(role.tenantId && role.roleId && Number.isInteger(role.revision) && role.revision >= 1, "Role contract identity is incomplete");
  requireCondition(role.sourceIdentity?.sourceHash && HASH.test(role.sourceIdentity.sourceHash), "Role contract source identity is incomplete");
  requireCondition(role.authorizations?.customerExecution === false && role.authorizations?.modelSpend === false && role.authorizations?.activation === false, "Role contract widened execution, spend, or activation authority");
}

function assertSpecialist(specialist, role) {
  assertRecord(specialist, "das.nonactivating-specialist.v1", "specialistHash", "specialist");
  requireCondition(specialist.tenantId === role.tenantId && specialist.roleId === role.roleId && specialist.roleRevision === role.revision, "Specialist belongs to another tenant, role, or revision");
  requireCondition(["synthetic-provisional", "selected-proved-not-active"].includes(specialist.status), "Specialist must be provisional or separately proved but inactive");
  assertHash(specialist.candidateFingerprint, "Specialist candidate fingerprint");
  requireCondition(specialist.active === false && specialist.activationAuthorized === false && specialist.customerExecutionAuthorized === false, "Specialist widened activation or execution authority");
  if (specialist.status === "synthetic-provisional") requireCondition(specialist.selectionEvidence === null, "Synthetic provisional specialist cannot carry selection evidence");
  else {
    requireCondition(specialist.selectionEvidence?.status === "proved-selected-not-active", "Selected specialist lacks exact selection evidence");
    assertHash(specialist.selectionEvidence?.resultHash, "Selected specialist result hash");
  }
}

function assertPluginProjects(plugin, role, specialist) {
  assertRecord(plugin, "das.nonactivating-plugin-project-identities.v1", "identityHash", "plugin-project identities");
  requireCondition(plugin.tenantId === role.tenantId && plugin.roleId === role.roleId && plugin.roleRevision === role.revision, "Plugin-project identities belong to another tenant, role, or revision");
  requireCondition(plugin.specialistHash === specialist.specialistHash, "Plugin-project identities belong to another specialist");
  requireCondition(plugin.sourceHash === role.sourceIdentity.sourceHash, "Plugin-project identities belong to another source revision");
  for (const key of ["draftHash", "packageReceiptHash", "planHash", "scaffoldReceiptHash", "generatedProjectHash"]) assertHash(plugin[key], `Plugin-project ${key}`);
  requireCondition(plugin.action?.projectIdentity && plugin.observer?.projectIdentity && plugin.action.projectIdentity !== plugin.observer.projectIdentity, "Action and observer project identities must remain separate");
  requireCondition(plugin.action?.authenticationIdentity !== plugin.observer?.authenticationIdentity, "Action and observer authentication identities must remain separate");
  requireCondition(plugin.observer?.readOnly === true && (plugin.observer?.writeOperations ?? []).length === 0, "Observer project must remain read-only");
  requireCondition(plugin.executable === false && plugin.qualified === false && plugin.customerEnvironmentAccepted === false && plugin.activationReady === false, "Generated plugin projects were incorrectly promoted to readiness");
}

function assertImplementations(implementation, role, specialist, plugin) {
  assertRecord(implementation, "das.nonactivating-implementation-identities.v1", "identityHash", "implementation identities");
  requireCondition(implementation.tenantId === role.tenantId && implementation.roleId === role.roleId && implementation.roleRevision === role.revision, "Implementation identities belong to another tenant, role, or revision");
  requireCondition(implementation.specialistHash === specialist.specialistHash && implementation.packageReceiptHash === plugin.packageReceiptHash && implementation.generatedProjectHash === plugin.generatedProjectHash, "Implementation identities belong to another specialist, package, or scaffold");
  for (const key of ["actionImplementationIntentHash", "actionImplementationContentHash", "observerImplementationIntentHash", "observerImplementationContentHash", "conformanceReceiptHash"]) assertHash(implementation[key], `Implementation ${key}`);
  requireCondition(implementation.actionImplementationContentHash !== implementation.observerImplementationContentHash, "Action and observer implementation identities must remain separate");
  requireCondition(implementation.scope === "fictional-disposable-local" && implementation.customerEnvironmentImplemented === false && implementation.customerExecutableOperations === 0, "Implementation identity scope was incorrectly promoted beyond fictional local evidence");
}

function assertConformance(conformance, role, specialist, plugin, implementation, now, { allowStale = false } = {}) {
  assertRecord(conformance, "das.nonactivating-conformance-evidence.v1", "evidenceHash", "conformance evidence");
  requireCondition(conformance.tenantId === role.tenantId && conformance.roleId === role.roleId && conformance.roleRevision === role.revision, "Conformance evidence belongs to another tenant, role, or revision");
  requireCondition(conformance.specialistHash === specialist.specialistHash && conformance.packageReceiptHash === plugin.packageReceiptHash && conformance.conformanceReceiptHash === implementation.conformanceReceiptHash, "Conformance evidence belongs to another specialist, package, or implementation");
  requireCondition(conformance.scope === "fictional-disposable-local" && conformance.customerEnvironmentConformance === false && conformance.customerAcceptance === false && conformance.activationReady === false, "Conformance evidence was promoted beyond its local fictional scope");
  requireCondition(conformance.controlsPassed === conformance.controlsRequired && conformance.controlsRequired >= 10, "Conformance evidence is incomplete");
  requireCondition(conformance.observerWrites === 0 && conformance.lostResponseReplays === 0, "Conformance evidence contains unsafe observer writes or replayed lost-response writes");
  const observed = Date.parse(conformance.observedAt);
  const validUntil = Date.parse(conformance.validUntil);
  const instant = Date.parse(now);
  requireCondition(Number.isFinite(observed) && Number.isFinite(validUntil) && Number.isFinite(instant) && observed <= validUntil && observed <= instant, "Conformance evidence is future-dated or has invalid freshness bounds");
  if (!allowStale) requireCondition(instant <= validUntil, "Conformance evidence is stale");
}

function assertObserverBindings(bindings, role, specialist, plugin, implementation) {
  assertRecord(bindings, "das.nonactivating-observer-bindings.v1", "bindingsHash", "observer bindings");
  requireCondition(bindings.tenantId === role.tenantId && bindings.roleId === role.roleId && bindings.roleRevision === role.revision, "Observer bindings belong to another tenant, role, or revision");
  requireCondition(bindings.specialistHash === specialist.specialistHash && bindings.packageReceiptHash === plugin.packageReceiptHash, "Observer bindings belong to another specialist or package");
  requireCondition(bindings.action.implementationContentHash === implementation.actionImplementationContentHash && bindings.observer.implementationContentHash === implementation.observerImplementationContentHash, "Observer bindings changed implementation identity");
  requireCondition(bindings.action.sourceIdentity !== bindings.observer.sourceIdentity && bindings.action.authenticationIdentity !== bindings.observer.authenticationIdentity, "Action and independent observer identities were collapsed");
  requireCondition(SAFE_ALIAS.test(bindings.action.credentialAlias) && SAFE_ALIAS.test(bindings.observer.credentialAlias) && bindings.action.credentialAlias !== bindings.observer.credentialAlias, "Action and observer require separate safe customer-local credential aliases");
  requireCondition(bindings.observer.independent === true && bindings.observer.readOnly === true && bindings.observer.writeOperations.length === 0, "Observer binding must be independent and read-only");
  requireCondition(bindings.actionResponseAcceptedAsIndependentProof === false, "Action response cannot be accepted as independent proof");
  requireCondition(bindings.customerBound === false && bindings.customerProbed === false && bindings.customerQualified === false && bindings.activationReady === false, "Observer bindings were incorrectly promoted to customer readiness");
}

function assertReadinessInput(readiness, role, specialist) {
  assertRecord(readiness, "das.nonactivating-readiness-input.v1", "receiptHash", "readiness input");
  requireCondition(readiness.tenantId === role.tenantId && readiness.roleId === role.roleId && readiness.roleRevision === role.revision && readiness.specialistHash === specialist.specialistHash, "Readiness input belongs to another tenant, role, revision, or specialist");
  requireCondition(readiness.comparisonComplete === false && readiness.executionReady === false && readiness.customerAcceptanceComplete === false && readiness.activationReady === false && readiness.activationAuthorized === false, "Readiness input widened a protected gate");
}

function deriveBlockers(specialist, supplied = []) {
  const derived = [...REQUIRED_BLOCKERS];
  if (specialist.status === "synthetic-provisional") derived.unshift("selected-specialist-not-proved");
  const extras = supplied.map(String).filter(Boolean);
  return Object.freeze([...new Set([...derived, ...extras])].sort());
}

function assertRollbackInput(rollback, role, specialist) {
  assertRecord(rollback, "das.nonactivating-rollback-input.v1", "rollbackInputHash", "rollback input");
  requireCondition(rollback.tenantId === role.tenantId && rollback.roleId === role.roleId && rollback.roleRevision === role.revision && rollback.specialistHash === specialist.specialistHash, "Rollback input belongs to another tenant, role, revision, or specialist");
  if (rollback.previousBundleHash !== null) assertHash(rollback.previousBundleHash, "Rollback previous bundle hash");
  requireCondition(rollback.fallback === "leave-current-specialist-unchanged" && rollback.activationAuthorized === false && rollback.executionAuthorized === false, "Rollback input widened authority or lacks a safe fallback");
}

function stateEvent(payload, privateKey) {
  const event = clone(payload);
  event.eventHash = digest(event);
  event.signature = signRecord(withoutHash(event, "signature"), privateKey);
  return event;
}

function verifyStateEvent(event, publicKey) {
  requireCondition(event.eventHash === digest(withoutHash(withoutHash(event, "signature"), "eventHash")), "Deployment runtime event integrity mismatch");
  verifyRecordSignature(withoutHash(event, "signature"), event.signature, publicKey, "Deployment runtime event");
}

function makeState({ bundleHash, tenantId, roleId, roleRevision, specialistHash, blockerLedgerHash, rollbackPlanHash, privateKey }) {
  const genesis = stateEvent({
    schemaVersion: "das.nonactivating-deployment-state-event.v1",
    revision: 0,
    type: "deployment.packaged-nonactivating",
    status: "packaged-nonactivating",
    previousEventHash: null,
    bundleHash,
    tenantId,
    roleId,
    roleRevision,
    specialistHash,
    blockerLedgerHash,
    rollbackPlanHash,
    restoredBundleHash: null,
    executableCustomerOperations: 0,
    customerExecutionAuthorized: false,
    activationAuthorized: false,
  }, privateKey);
  const state = { schemaVersion: "das.nonactivating-deployment-runtime-state.v1", events: [genesis] };
  state.stateHash = digest(state);
  return state;
}

function verifyRuntimeState(state, { publicKey, expected }) {
  requireCondition(state?.schemaVersion === "das.nonactivating-deployment-runtime-state.v1", "Unsupported deployment runtime-state schema");
  requireCondition(state.stateHash === digest(withoutHash(state, "stateHash")), "Deployment runtime-state integrity mismatch");
  requireCondition(Array.isArray(state.events) && state.events.length >= 1, "Deployment runtime state has no signed events");
  let previous = null;
  for (let index = 0; index < state.events.length; index += 1) {
    const event = state.events[index];
    verifyStateEvent(event, publicKey);
    requireCondition(event.revision === index && event.previousEventHash === previous, "Deployment runtime-state event chain is invalid");
    requireCondition(event.bundleHash === expected.bundleHash && event.tenantId === expected.tenantId && event.roleId === expected.roleId && event.roleRevision === expected.roleRevision && event.specialistHash === expected.specialistHash && event.blockerLedgerHash === expected.blockerLedgerHash && event.rollbackPlanHash === expected.rollbackPlanHash, "Deployment runtime state crossed a bundle, tenant, role, revision, specialist, blocker, or rollback boundary");
    requireCondition(event.executableCustomerOperations === 0 && event.customerExecutionAuthorized === false && event.activationAuthorized === false, "Deployment runtime state widened execution or activation authority");
    requireCondition(["packaged-nonactivating", "preview-loaded-nonactivating", "rolled-back-nonactivating"].includes(event.status), "Deployment runtime state entered an unsupported or active status");
    previous = event.eventHash;
  }
  requireCondition(state.events[0].eventHash === expected.genesisEventHash, "Deployment runtime-state genesis does not match the signed release");
  return true;
}

function writePrivate(file, value) {
  fs.writeFileSync(file, typeof value === "string" ? value : json(value), { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.chmodSync(file, 0o600);
}

function staticRecords(plan) {
  return {
    "blockers.json": plan.blockerLedger,
    "conformance-evidence.json": plan.conformanceEvidence,
    "deployment-bundle.json": plan.bundle,
    "implementation-identities.json": plan.implementationIdentities,
    "observer-bindings.json": plan.observerBindings,
    "plugin-project-identities.json": plan.pluginProjectIdentities,
    "readiness-receipt.json": plan.readinessReceipt,
    "role-contract.json": plan.roleContract,
    "rollback-plan.json": plan.rollbackPlan,
    "specialist.json": plan.specialist,
    "state-genesis.json": plan.stateGenesis,
  };
}

function parseJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }

function assertPlanIntegrity(plan) {
  requireCondition(plan?.schemaVersion === "das.nonactivating-deployment-bundle-plan.v1", "A valid DAS-020 bundle plan is required");
  assertNoSecrets(plan, "DAS-020 bundle plan");
  assertRoleContract(plan.roleContract);
  assertSpecialist(plan.specialist, plan.roleContract);
  assertPluginProjects(plan.pluginProjectIdentities, plan.roleContract, plan.specialist);
  assertImplementations(plan.implementationIdentities, plan.roleContract, plan.specialist, plan.pluginProjectIdentities);
  assertConformance(plan.conformanceEvidence, plan.roleContract, plan.specialist, plan.pluginProjectIdentities, plan.implementationIdentities, plan.bundle?.createdAt);
  assertObserverBindings(plan.observerBindings, plan.roleContract, plan.specialist, plan.pluginProjectIdentities, plan.implementationIdentities);
  assertRecord(plan.blockerLedger, "das.nonactivating-deployment-blocker-ledger.v1", "blockerLedgerHash", "blocker ledger");
  assertRecord(plan.rollbackPlan, "das.nonactivating-deployment-rollback-plan.v1", "rollbackPlanHash", "rollback plan");
  assertRecord(plan.readinessReceipt, "das.nonactivating-deployment-readiness-receipt.v1", "readinessReceiptHash", "readiness receipt");
  assertRecord(plan.bundle, "das.nonactivating-deployment-bundle.v1", "bundleHash", "deployment bundle");
  const required = plan.specialist.status === "synthetic-provisional" ? ["selected-specialist-not-proved", ...REQUIRED_BLOCKERS] : [...REQUIRED_BLOCKERS];
  requireCondition(required.every((entry) => plan.blockerLedger.blockers.includes(entry)) && plan.blockerLedger.allResolved === false, "DAS-020 plan omitted a mandatory blocker");
  requireCondition(plan.bundle.tenantId === plan.roleContract.tenantId && plan.bundle.roleId === plan.roleContract.roleId && plan.bundle.roleRevision === plan.roleContract.revision && plan.bundle.specialistHash === plan.specialist.specialistHash && plan.bundle.pluginProjectIdentityHash === plan.pluginProjectIdentities.identityHash && plan.bundle.implementationIdentityHash === plan.implementationIdentities.identityHash && plan.bundle.conformanceEvidenceHash === plan.conformanceEvidence.evidenceHash && plan.bundle.observerBindingsHash === plan.observerBindings.bindingsHash && plan.bundle.readinessReceiptHash === plan.readinessReceipt.readinessReceiptHash && plan.bundle.blockerLedgerHash === plan.blockerLedger.blockerLedgerHash && plan.bundle.rollbackPlanHash === plan.rollbackPlan.rollbackPlanHash, "DAS-020 bundle plan identity chain mismatch");
  requireCondition(plan.bundle.executableCustomerOperations === 0 && plan.bundle.customerExecutionAuthorized === false && plan.bundle.modelSpendAuthorized === false && plan.bundle.activationAuthorized === false && plan.readinessReceipt.customerExecutionReady === false && plan.readinessReceipt.activationReady === false && plan.readinessReceipt.activationAuthorized === false, "DAS-020 bundle plan widened a protected gate");
  return true;
}

export function createNonactivatingDeploymentBundlePlan({
  roleContract,
  specialist,
  pluginProjectIdentities,
  implementationIdentities,
  conformanceEvidence,
  observerBindings,
  readinessInput,
  rollbackInput,
  unresolvedBlockers = [],
  now = new Date().toISOString(),
} = {}) {
  assertNoSecrets({ roleContract, specialist, pluginProjectIdentities, implementationIdentities, conformanceEvidence, observerBindings, readinessInput, rollbackInput, unresolvedBlockers }, "DAS-020 input");
  assertRoleContract(roleContract);
  assertSpecialist(specialist, roleContract);
  assertPluginProjects(pluginProjectIdentities, roleContract, specialist);
  assertImplementations(implementationIdentities, roleContract, specialist, pluginProjectIdentities);
  assertConformance(conformanceEvidence, roleContract, specialist, pluginProjectIdentities, implementationIdentities, now);
  assertObserverBindings(observerBindings, roleContract, specialist, pluginProjectIdentities, implementationIdentities);
  assertReadinessInput(readinessInput, roleContract, specialist);
  assertRollbackInput(rollbackInput, roleContract, specialist);

  const blockers = deriveBlockers(specialist, [...readinessInput.unresolvedBlockers, ...unresolvedBlockers]);
  const blockerLedger = {
    schemaVersion: "das.nonactivating-deployment-blocker-ledger.v1",
    tenantId: roleContract.tenantId,
    roleId: roleContract.roleId,
    roleRevision: roleContract.revision,
    specialistHash: specialist.specialistHash,
    blockers,
    requiredBlockers: specialist.status === "synthetic-provisional" ? ["selected-specialist-not-proved", ...REQUIRED_BLOCKERS].sort() : [...REQUIRED_BLOCKERS].sort(),
    allResolved: false,
  };
  blockerLedger.blockerLedgerHash = digest(blockerLedger);

  const rollbackPlan = {
    schemaVersion: "das.nonactivating-deployment-rollback-plan.v1",
    tenantId: roleContract.tenantId,
    roleId: roleContract.roleId,
    roleRevision: roleContract.revision,
    specialistHash: specialist.specialistHash,
    previousBundleHash: rollbackInput.previousBundleHash,
    fallback: rollbackInput.fallback,
    allowedFromStatuses: ["packaged-nonactivating", "preview-loaded-nonactivating"],
    targetStatus: "rolled-back-nonactivating",
    activationAuthorized: false,
    executionAuthorized: false,
  };
  rollbackPlan.rollbackPlanHash = digest(rollbackPlan);

  const readinessReceipt = {
    schemaVersion: "das.nonactivating-deployment-readiness-receipt.v1",
    tenantId: roleContract.tenantId,
    roleId: roleContract.roleId,
    roleRevision: roleContract.revision,
    roleContractHash: roleContract.contractHash,
    specialistHash: specialist.specialistHash,
    pluginProjectIdentityHash: pluginProjectIdentities.identityHash,
    implementationIdentityHash: implementationIdentities.identityHash,
    conformanceEvidenceHash: conformanceEvidence.evidenceHash,
    observerBindingsHash: observerBindings.bindingsHash,
    sourceReadinessReceiptHash: readinessInput.receiptHash,
    blockerLedgerHash: blockerLedger.blockerLedgerHash,
    comparisonComplete: false,
    customerEnvironmentConformance: false,
    mandatoryCustomerAcceptanceComplete: false,
    executableCustomerOperations: 0,
    customerExecutionReady: false,
    activationReady: false,
    activationAuthorized: false,
    status: "complete-package-blocked-nonactivating",
    evidenceBoundary: "Exact package preparation only. Local fictional conformance and generated scaffolds do not establish customer execution, comparison readiness, acceptance, activation, or deployment.",
  };
  readinessReceipt.readinessReceiptHash = digest(readinessReceipt);

  const bundle = {
    schemaVersion: "das.nonactivating-deployment-bundle.v1",
    status: "complete-package-blocked-nonactivating",
    createdAt: now,
    tenantId: roleContract.tenantId,
    roleId: roleContract.roleId,
    roleRevision: roleContract.revision,
    roleContractHash: roleContract.contractHash,
    sourceHash: roleContract.sourceIdentity.sourceHash,
    specialistHash: specialist.specialistHash,
    specialistStatus: specialist.status,
    pluginProjectIdentityHash: pluginProjectIdentities.identityHash,
    generatedProjectHash: pluginProjectIdentities.generatedProjectHash,
    implementationIdentityHash: implementationIdentities.identityHash,
    conformanceEvidenceHash: conformanceEvidence.evidenceHash,
    observerBindingsHash: observerBindings.bindingsHash,
    readinessReceiptHash: readinessReceipt.readinessReceiptHash,
    blockerLedgerHash: blockerLedger.blockerLedgerHash,
    rollbackPlanHash: rollbackPlan.rollbackPlanHash,
    executableCustomerOperations: 0,
    customerExecutionAuthorized: false,
    modelSpendAuthorized: false,
    activationAuthorized: false,
  };
  bundle.bundleHash = digest(bundle);

  return Object.freeze({
    schemaVersion: "das.nonactivating-deployment-bundle-plan.v1",
    roleContract: clone(roleContract),
    specialist: clone(specialist),
    pluginProjectIdentities: clone(pluginProjectIdentities),
    implementationIdentities: clone(implementationIdentities),
    conformanceEvidence: clone(conformanceEvidence),
    observerBindings: clone(observerBindings),
    readinessReceipt,
    blockerLedger,
    rollbackPlan,
    bundle,
  });
}

export function writeNonactivatingDeploymentBundle({ directory, plan, signingPrivateKey, signingPublicKey }) {
  assertPlanIntegrity(plan);
  assertSigningPair(signingPrivateKey, signingPublicKey);
  const root = path.resolve(directory);
  requireCondition(!fs.existsSync(root), "Nonactivating deployment bundle refuses to overwrite an existing directory");
  fs.mkdirSync(root, { recursive: false, mode: 0o700 });
  fs.chmodSync(root, 0o700);
  fs.mkdirSync(path.join(root, "state"), { mode: 0o700 });
  fs.chmodSync(path.join(root, "state"), 0o700);

  const initialState = makeState({
    bundleHash: plan.bundle.bundleHash,
    tenantId: plan.bundle.tenantId,
    roleId: plan.bundle.roleId,
    roleRevision: plan.bundle.roleRevision,
    specialistHash: plan.bundle.specialistHash,
    blockerLedgerHash: plan.blockerLedger.blockerLedgerHash,
    rollbackPlanHash: plan.rollbackPlan.rollbackPlanHash,
    privateKey: signingPrivateKey,
  });
  const stateGenesis = {
    schemaVersion: "das.nonactivating-deployment-state-genesis.v1",
    bundleHash: plan.bundle.bundleHash,
    genesisEventHash: initialState.events[0].eventHash,
    blockerLedgerHash: plan.blockerLedger.blockerLedgerHash,
    rollbackPlanHash: plan.rollbackPlan.rollbackPlanHash,
  };
  stateGenesis.genesisHash = digest(stateGenesis);

  const records = staticRecords({ ...plan, stateGenesis });
  for (const relative of IMMUTABLE_FILES) writePrivate(path.join(root, relative), records[relative]);
  writePrivate(path.join(root, "state", "runtime-state.json"), initialState);

  const files = IMMUTABLE_FILES.map((relative) => {
    const content = fs.readFileSync(path.join(root, relative));
    return { path: relative, sha256: rawSha256(content), bytes: content.length, mode: "0600" };
  });
  const releaseManifest = {
    schemaVersion: "das.nonactivating-deployment-release-manifest.v1",
    bundleHash: plan.bundle.bundleHash,
    tenantId: plan.bundle.tenantId,
    roleId: plan.bundle.roleId,
    roleRevision: plan.bundle.roleRevision,
    specialistHash: plan.bundle.specialistHash,
    blockerLedgerHash: plan.blockerLedger.blockerLedgerHash,
    rollbackPlanHash: plan.rollbackPlan.rollbackPlanHash,
    genesisEventHash: initialState.events[0].eventHash,
    mutableStatePath: "state/runtime-state.json",
    files,
  };
  releaseManifest.manifestHash = digest(releaseManifest);
  writePrivate(path.join(root, "release-manifest.json"), releaseManifest);
  const publicKeyPem = exportedPublicKey(signingPublicKey);
  const releaseSignature = {
    schemaVersion: "das.nonactivating-deployment-release-signature.v1",
    algorithm: "Ed25519",
    manifestHash: releaseManifest.manifestHash,
    publicKeyPem,
    signature: signRecord(releaseManifest, signingPrivateKey),
  };
  writePrivate(path.join(root, "release-signature.json"), releaseSignature);
  return Object.freeze({ root, bundle: clone(plan.bundle), releaseManifest, releaseSignature, initialState: clone(initialState) });
}

function loadStaticRecords(root) {
  return {
    blockerLedger: parseJson(path.join(root, "blockers.json")),
    conformanceEvidence: parseJson(path.join(root, "conformance-evidence.json")),
    bundle: parseJson(path.join(root, "deployment-bundle.json")),
    implementationIdentities: parseJson(path.join(root, "implementation-identities.json")),
    observerBindings: parseJson(path.join(root, "observer-bindings.json")),
    pluginProjectIdentities: parseJson(path.join(root, "plugin-project-identities.json")),
    readinessReceipt: parseJson(path.join(root, "readiness-receipt.json")),
    roleContract: parseJson(path.join(root, "role-contract.json")),
    rollbackPlan: parseJson(path.join(root, "rollback-plan.json")),
    specialist: parseJson(path.join(root, "specialist.json")),
    stateGenesis: parseJson(path.join(root, "state-genesis.json")),
  };
}

export function inspectNonactivatingDeploymentBundle({ directory, expectedPublicKey, now = new Date().toISOString(), expected = {}, allowStaleConformanceForRollback = false }) {
  requireCondition(expectedPublicKey, "Inspection requires an externally pinned public key");
  const root = path.resolve(directory);
  const failures = [];
  const gates = [];
  const gate = (id, passed, detail) => { gates.push({ id, passed: Boolean(passed), detail }); if (!passed) failures.push(id); };
  let records = null;
  try {
    gate("private-root", mode(root) === 0o700, `mode:${mode(root).toString(8)}`);
    gate("private-state-directory", mode(path.join(root, "state")) === 0o700, `mode:${mode(path.join(root, "state")).toString(8)}`);
    const manifest = parseJson(path.join(root, "release-manifest.json"));
    const signature = parseJson(path.join(root, "release-signature.json"));
    const expectedPem = exportedPublicKey(expectedPublicKey);
    gate("manifest-integrity", manifest.manifestHash === digest(withoutHash(manifest, "manifestHash")), manifest.manifestHash ?? "missing");
    gate("pinned-signing-key", signature.publicKeyPem === expectedPem, "release key equals externally pinned key");
    gate("signature-manifest-binding", signature.manifestHash === manifest.manifestHash, signature.manifestHash ?? "missing");
    let signatureValid = false;
    try { verifyRecordSignature(manifest, signature.signature, expectedPublicKey, "Release manifest"); signatureValid = true; } catch {}
    gate("release-signature", signatureValid, signature.algorithm ?? "missing");
    const allowed = new Set([...IMMUTABLE_FILES, "release-manifest.json", "release-signature.json", "state/runtime-state.json"]);
    const actual = [];
    for (const entry of fs.readdirSync(root)) {
      if (entry === "state") {
        for (const stateFile of fs.readdirSync(path.join(root, entry))) actual.push(`${entry}/${stateFile}`);
      } else actual.push(entry);
    }
    gate("exact-file-allowlist", actual.length === allowed.size && actual.every((entry) => allowed.has(entry)), actual.sort().join(","));
    const manifestPaths = manifest.files?.map((entry) => entry.path) ?? [];
    gate("signed-file-coverage", manifestPaths.length === IMMUTABLE_FILES.length && IMMUTABLE_FILES.every((entry) => manifestPaths.includes(entry)), `${manifestPaths.length}/${IMMUTABLE_FILES.length}`);
    for (const entry of manifest.files ?? []) {
      const file = path.join(root, entry.path);
      gate(`signed-file:${entry.path}`, fs.existsSync(file) && rawSha256(fs.readFileSync(file)) === entry.sha256 && mode(file) === 0o600, entry.sha256);
    }
    gate("private-manifest", mode(path.join(root, "release-manifest.json")) === 0o600, "0600 required");
    gate("private-signature", mode(path.join(root, "release-signature.json")) === 0o600, "0600 required");
    gate("private-runtime-state", mode(path.join(root, "state", "runtime-state.json")) === 0o600, "0600 required");

    records = loadStaticRecords(root);
    assertRoleContract(records.roleContract);
    assertSpecialist(records.specialist, records.roleContract);
    assertPluginProjects(records.pluginProjectIdentities, records.roleContract, records.specialist);
    assertImplementations(records.implementationIdentities, records.roleContract, records.specialist, records.pluginProjectIdentities);
    assertConformance(records.conformanceEvidence, records.roleContract, records.specialist, records.pluginProjectIdentities, records.implementationIdentities, now, { allowStale: allowStaleConformanceForRollback });
    assertObserverBindings(records.observerBindings, records.roleContract, records.specialist, records.pluginProjectIdentities, records.implementationIdentities);
    assertRecord(records.blockerLedger, "das.nonactivating-deployment-blocker-ledger.v1", "blockerLedgerHash", "blocker ledger");
    assertRecord(records.rollbackPlan, "das.nonactivating-deployment-rollback-plan.v1", "rollbackPlanHash", "rollback plan");
    assertRecord(records.readinessReceipt, "das.nonactivating-deployment-readiness-receipt.v1", "readinessReceiptHash", "readiness receipt");
    assertRecord(records.bundle, "das.nonactivating-deployment-bundle.v1", "bundleHash", "deployment bundle");
    assertRecord(records.stateGenesis, "das.nonactivating-deployment-state-genesis.v1", "genesisHash", "state genesis");
    assertNoSecrets(records, "DAS-020 package records");
    const required = records.specialist.status === "synthetic-provisional" ? ["selected-specialist-not-proved", ...REQUIRED_BLOCKERS] : [...REQUIRED_BLOCKERS];
    gate("mandatory-blockers-preserved", required.every((entry) => records.blockerLedger.blockers.includes(entry)) && records.blockerLedger.allResolved === false, `${records.blockerLedger.blockers.length} blockers`);
    gate("exact-identity-chain", records.bundle.tenantId === records.roleContract.tenantId && records.bundle.roleId === records.roleContract.roleId && records.bundle.roleRevision === records.roleContract.revision && records.bundle.specialistHash === records.specialist.specialistHash && records.bundle.pluginProjectIdentityHash === records.pluginProjectIdentities.identityHash && records.bundle.implementationIdentityHash === records.implementationIdentities.identityHash && records.bundle.conformanceEvidenceHash === records.conformanceEvidence.evidenceHash && records.bundle.observerBindingsHash === records.observerBindings.bindingsHash && records.bundle.readinessReceiptHash === records.readinessReceipt.readinessReceiptHash && records.bundle.blockerLedgerHash === records.blockerLedger.blockerLedgerHash && records.bundle.rollbackPlanHash === records.rollbackPlan.rollbackPlanHash, "role→specialist→plugins→implementation→conformance→observer→readiness→blockers→rollback");
    gate("manifest-identity-chain", manifest.bundleHash === records.bundle.bundleHash && manifest.tenantId === records.bundle.tenantId && manifest.roleId === records.bundle.roleId && manifest.roleRevision === records.bundle.roleRevision && manifest.specialistHash === records.bundle.specialistHash && manifest.blockerLedgerHash === records.blockerLedger.blockerLedgerHash && manifest.rollbackPlanHash === records.rollbackPlan.rollbackPlanHash && manifest.genesisEventHash === records.stateGenesis.genesisEventHash, "manifest matches signed records");
    gate("protected-gates-false", records.bundle.executableCustomerOperations === 0 && records.bundle.customerExecutionAuthorized === false && records.bundle.modelSpendAuthorized === false && records.bundle.activationAuthorized === false && records.readinessReceipt.customerExecutionReady === false && records.readinessReceipt.activationReady === false && records.readinessReceipt.activationAuthorized === false, "zero execution/spend/activation authority");
    gate("expected-identity", (!expected.tenantId || expected.tenantId === records.bundle.tenantId) && (!expected.roleId || expected.roleId === records.bundle.roleId) && (expected.roleRevision === undefined || expected.roleRevision === records.bundle.roleRevision) && (!expected.specialistHash || expected.specialistHash === records.bundle.specialistHash) && (!expected.bundleHash || expected.bundleHash === records.bundle.bundleHash), "caller-pinned expected identities match");
    const state = parseJson(path.join(root, "state", "runtime-state.json"));
    let stateValid = false;
    try {
      stateValid = verifyRuntimeState(state, { publicKey: expectedPublicKey, expected: { bundleHash: records.bundle.bundleHash, tenantId: records.bundle.tenantId, roleId: records.bundle.roleId, roleRevision: records.bundle.roleRevision, specialistHash: records.bundle.specialistHash, blockerLedgerHash: records.blockerLedger.blockerLedgerHash, rollbackPlanHash: records.rollbackPlan.rollbackPlanHash, genesisEventHash: records.stateGenesis.genesisEventHash } });
    } catch {}
    gate("restart-safe-runtime-state", stateValid, state.events?.at(-1)?.status ?? "missing");
  } catch (error) {
    gate("package-readable-and-valid", false, error instanceof Error ? error.message : String(error));
  }
  const latestStatus = (() => { try { return parseJson(path.join(root, "state", "runtime-state.json")).events.at(-1).status; } catch { return "unreadable"; } })();
  const packageIntegrityValid = failures.length === 0;
  return Object.freeze({ schemaVersion: "das.nonactivating-deployment-bundle-diagnostics.v1", packageIntegrityValid, readyForNonactivatingHandoff: packageIntegrityValid && latestStatus !== "rolled-back-nonactivating", customerExecutionReady: false, activationReady: false, failures, gates, bundleHash: records?.bundle?.bundleHash ?? null, latestStatus, evidenceBoundary: "Signed customer-local nonactivating package diagnostics only. A clean result preserves blockers and never establishes customer execution or activation." });
}

export class NonactivatingDeploymentStateStore {
  constructor({ directory, expectedPublicKey, now = () => new Date().toISOString() }) {
    this.directory = path.resolve(directory);
    this.expectedPublicKey = expectedPublicKey;
    this.now = now;
    this.#loadAndVerify();
  }

  #loadAndVerify() {
    const diagnostics = inspectNonactivatingDeploymentBundle({ directory: this.directory, expectedPublicKey: this.expectedPublicKey, now: this.now(), allowStaleConformanceForRollback: true });
    requireCondition(diagnostics.packageIntegrityValid, `Nonactivating deployment bundle is invalid: ${diagnostics.failures.join(",")}`);
    this.records = loadStaticRecords(this.directory);
    this.statePath = path.join(this.directory, "state", "runtime-state.json");
    this.state = parseJson(this.statePath);
  }

  snapshot() { return clone(this.state); }

  #transition({ type, status, expectedRevision, signingPrivateKey, restoredBundleHash = null }) {
    assertSigningPair(signingPrivateKey, this.expectedPublicKey);
    this.#loadAndVerify();
    const previous = this.state.events.at(-1);
    requireCondition(previous.revision === expectedRevision, "Deployment runtime-state revision changed; refusing stale transition");
    requireCondition(previous.status !== "rolled-back-nonactivating", "Rolled-back deployment bundle cannot transition again");
    requireCondition(status !== "controlled-active" && status !== "active" && status !== "executable", "Nonactivating deployment bundle has no activation transition");
    if (status === "rolled-back-nonactivating") requireCondition(this.records.rollbackPlan.allowedFromStatuses.includes(previous.status), "Rollback is not allowed from the current status");
    const event = stateEvent({
      schemaVersion: "das.nonactivating-deployment-state-event.v1",
      revision: previous.revision + 1,
      type,
      status,
      previousEventHash: previous.eventHash,
      bundleHash: this.records.bundle.bundleHash,
      tenantId: this.records.bundle.tenantId,
      roleId: this.records.bundle.roleId,
      roleRevision: this.records.bundle.roleRevision,
      specialistHash: this.records.bundle.specialistHash,
      blockerLedgerHash: this.records.blockerLedger.blockerLedgerHash,
      rollbackPlanHash: this.records.rollbackPlan.rollbackPlanHash,
      restoredBundleHash,
      executableCustomerOperations: 0,
      customerExecutionAuthorized: false,
      activationAuthorized: false,
    }, signingPrivateKey);
    const next = { schemaVersion: this.state.schemaVersion, events: [...this.state.events, event] };
    next.stateHash = digest(next);
    const temporary = `${this.statePath}.tmp`;
    fs.writeFileSync(temporary, json(next), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, this.statePath);
    fs.chmodSync(this.statePath, 0o600);
    this.state = next;
    return clone(event);
  }

  markPreviewLoaded({ expectedRevision, signingPrivateKey }) {
    this.#loadAndVerify();
    requireCondition(this.state.events.at(-1).status !== "rolled-back-nonactivating", "Rolled-back deployment bundle cannot transition again");
    const freshDiagnostics = inspectNonactivatingDeploymentBundle({ directory: this.directory, expectedPublicKey: this.expectedPublicKey, now: this.now() });
    requireCondition(freshDiagnostics.readyForNonactivatingHandoff, `Preview requires current conformance evidence: ${freshDiagnostics.failures.join(",")}`);
    return this.#transition({ type: "deployment.preview-loaded", status: "preview-loaded-nonactivating", expectedRevision, signingPrivateKey });
  }

  rollback({ expectedRevision, signingPrivateKey, expectedRollbackPlanHash, expectedBundleHash }) {
    requireCondition(expectedRollbackPlanHash === this.records.rollbackPlan.rollbackPlanHash && expectedBundleHash === this.records.bundle.bundleHash, "Rollback request belongs to another plan or bundle");
    return this.#transition({ type: "deployment.rolled-back", status: "rolled-back-nonactivating", expectedRevision, signingPrivateKey, restoredBundleHash: this.records.rollbackPlan.previousBundleHash });
  }
}

export const DAS020_REQUIRED_BLOCKERS = REQUIRED_BLOCKERS;
