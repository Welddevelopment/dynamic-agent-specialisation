import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalJson, digest } from "../src/core/canonical.js";
import {
  DAS020_REQUIRED_BLOCKERS,
  NonactivatingDeploymentStateStore,
  createNonactivatingDeploymentBundlePlan,
  inspectNonactivatingDeploymentBundle,
  writeNonactivatingDeploymentBundle,
} from "../src/product/nonactivating-deployment-bundle.js";

const NOW = "2026-08-14T12:00:00.000Z";

function sealed(value, hashField) {
  const record = structuredClone(value);
  record[hashField] = digest(record);
  return record;
}

export function das020Fixture(overrides = {}) {
  const tenantId = "fictional-northstar-tenant";
  const roleId = "invoice-dispute-specialist";
  const roleRevision = 3;
  const packageReceiptHash = digest({ package: "das023-northstar-v1" });
  const generatedProjectHash = digest({ generated: "das025-northstar-v1" });
  const roleContract = sealed({
    schemaVersion: "das.customer-local-role-contract.v1",
    tenantId,
    roleId,
    revision: roleRevision,
    sourceIdentity: { kind: "openapi", sourceHash: digest({ source: "northstar-openapi-v1" }) },
    outcome: "Record an approved invoice dispute and prove the independent case state.",
    authority: { allowed: ["create-dispute-draft"], forbidden: ["approve-refund", "send-payment"] },
    authorizations: { customerExecution: false, modelSpend: false, activation: false },
  }, "contractHash");
  const specialist = sealed({
    schemaVersion: "das.nonactivating-specialist.v1",
    tenantId,
    roleId,
    roleRevision,
    specialistId: "synthetic-provisional-invoice-dispute-v1",
    status: "synthetic-provisional",
    candidateFingerprint: digest({ candidate: "synthetic-provisional-invoice-dispute-v1" }),
    selectionEvidence: null,
    bindingPackageReceiptHash: packageReceiptHash,
    active: false,
    activationAuthorized: false,
    customerExecutionAuthorized: false,
  }, "specialistHash");
  const pluginProjectIdentities = sealed({
    schemaVersion: "das.nonactivating-plugin-project-identities.v1",
    tenantId,
    roleId,
    roleRevision,
    specialistHash: specialist.specialistHash,
    sourceHash: roleContract.sourceIdentity.sourceHash,
    draftHash: digest({ draft: "das024-northstar-v1" }),
    packageReceiptHash,
    planHash: digest({ plan: "das025-northstar-v1" }),
    scaffoldReceiptHash: digest({ receipt: "das025-northstar-v1" }),
    generatedProjectHash,
    action: { projectIdentity: "northstar-action-project-v1", authenticationIdentity: "northstar-action-auth-v1" },
    observer: { projectIdentity: "northstar-observer-project-v1", authenticationIdentity: "northstar-observer-auth-v1", readOnly: true, writeOperations: [] },
    executable: false,
    qualified: false,
    customerEnvironmentAccepted: false,
    activationReady: false,
  }, "identityHash");
  const implementationIdentities = sealed({
    schemaVersion: "das.nonactivating-implementation-identities.v1",
    tenantId,
    roleId,
    roleRevision,
    specialistHash: specialist.specialistHash,
    packageReceiptHash,
    generatedProjectHash,
    actionImplementationIntentHash: digest({ intent: "action" }),
    actionImplementationContentHash: digest({ content: "action" }),
    observerImplementationIntentHash: digest({ intent: "observer" }),
    observerImplementationContentHash: digest({ content: "observer" }),
    conformanceReceiptHash: digest({ conformance: "fictional-local-v1" }),
    scope: "fictional-disposable-local",
    customerEnvironmentImplemented: false,
    customerExecutableOperations: 0,
  }, "identityHash");
  const conformanceEvidence = sealed({
    schemaVersion: "das.nonactivating-conformance-evidence.v1",
    tenantId,
    roleId,
    roleRevision,
    specialistHash: specialist.specialistHash,
    packageReceiptHash,
    conformanceReceiptHash: implementationIdentities.conformanceReceiptHash,
    scope: "fictional-disposable-local",
    observedAt: "2026-08-14T10:00:00.000Z",
    validUntil: "2026-08-15T10:00:00.000Z",
    controlsPassed: 10,
    controlsRequired: 10,
    observerWrites: 0,
    lostResponseReplays: 0,
    customerEnvironmentConformance: false,
    customerAcceptance: false,
    activationReady: false,
  }, "evidenceHash");
  const observerBindings = sealed({
    schemaVersion: "das.nonactivating-observer-bindings.v1",
    tenantId,
    roleId,
    roleRevision,
    specialistHash: specialist.specialistHash,
    packageReceiptHash,
    action: { sourceIdentity: "northstar-action-api-v1", authenticationIdentity: "northstar-action-auth-v1", credentialAlias: "NORTHSTAR_ACTION_CREDENTIAL", implementationContentHash: implementationIdentities.actionImplementationContentHash },
    observer: { sourceIdentity: "northstar-read-model-v1", authenticationIdentity: "northstar-observer-auth-v1", credentialAlias: "NORTHSTAR_OBSERVER_CREDENTIAL", implementationContentHash: implementationIdentities.observerImplementationContentHash, independent: true, readOnly: true, writeOperations: [] },
    actionResponseAcceptedAsIndependentProof: false,
    customerBound: false,
    customerProbed: false,
    customerQualified: false,
    activationReady: false,
  }, "bindingsHash");
  const readinessInput = sealed({
    schemaVersion: "das.nonactivating-readiness-input.v1",
    tenantId,
    roleId,
    roleRevision,
    specialistHash: specialist.specialistHash,
    unresolvedBlockers: ["workspace-admin-access-not-approved"],
    comparisonComplete: false,
    executionReady: false,
    customerAcceptanceComplete: false,
    activationReady: false,
    activationAuthorized: false,
  }, "receiptHash");
  const rollbackInput = sealed({
    schemaVersion: "das.nonactivating-rollback-input.v1",
    tenantId,
    roleId,
    roleRevision,
    specialistHash: specialist.specialistHash,
    previousBundleHash: null,
    fallback: "leave-current-specialist-unchanged",
    activationAuthorized: false,
    executionAuthorized: false,
  }, "rollbackInputHash");
  return { roleContract, specialist, pluginProjectIdentities, implementationIdentities, conformanceEvidence, observerBindings, readinessInput, rollbackInput, unresolvedBlockers: [], now: NOW, ...overrides };
}

function keys() { return crypto.generateKeyPairSync("ed25519"); }
function temporary() { return fs.mkdtempSync(path.join(os.tmpdir(), "das020-")); }
function prepare(overrides = {}) {
  const signing = keys();
  const root = temporary();
  const directory = path.join(root, "bundle");
  const plan = createNonactivatingDeploymentBundlePlan(das020Fixture(overrides));
  const written = writeNonactivatingDeploymentBundle({ directory, plan, signingPrivateKey: signing.privateKey, signingPublicKey: signing.publicKey });
  return { signing, root, directory, plan, written };
}

test("DAS-020 creates a signed exact nonactivating deployment bundle with generated blockers", () => {
  const { signing, directory, plan } = prepare();
  const diagnostics = inspectNonactivatingDeploymentBundle({ directory, expectedPublicKey: signing.publicKey, now: NOW, expected: { tenantId: plan.bundle.tenantId, roleId: plan.bundle.roleId, roleRevision: plan.bundle.roleRevision, specialistHash: plan.bundle.specialistHash, bundleHash: plan.bundle.bundleHash } });
  assert.equal(diagnostics.readyForNonactivatingHandoff, true);
  assert.equal(diagnostics.customerExecutionReady, false);
  assert.equal(diagnostics.activationReady, false);
  assert.equal(plan.bundle.status, "complete-package-blocked-nonactivating");
  assert.equal(plan.bundle.executableCustomerOperations, 0);
  assert.equal(plan.blockerLedger.blockers.includes("selected-specialist-not-proved"), true);
  assert.equal(DAS020_REQUIRED_BLOCKERS.every((blocker) => plan.blockerLedger.blockers.includes(blocker)), true);
  assert.equal(plan.blockerLedger.blockers.includes("workspace-admin-access-not-approved"), true);
});

test("restart preserves signed state and rollback remains exact and nonactivating", () => {
  const { signing, directory, plan } = prepare();
  const first = new NonactivatingDeploymentStateStore({ directory, expectedPublicKey: signing.publicKey, now: () => NOW });
  const preview = first.markPreviewLoaded({ expectedRevision: 0, signingPrivateKey: signing.privateKey });
  assert.equal(preview.status, "preview-loaded-nonactivating");
  assert.equal(preview.activationAuthorized, false);
  const restarted = new NonactivatingDeploymentStateStore({ directory, expectedPublicKey: signing.publicKey, now: () => NOW });
  assert.equal(restarted.snapshot().events.at(-1).revision, 1);
  assert.equal(restarted.snapshot().events.at(-1).status, "preview-loaded-nonactivating");
  assert.throws(() => restarted.rollback({ expectedRevision: 0, signingPrivateKey: signing.privateKey, expectedRollbackPlanHash: plan.rollbackPlan.rollbackPlanHash, expectedBundleHash: plan.bundle.bundleHash }), /revision changed/i);
  assert.throws(() => restarted.rollback({ expectedRevision: 1, signingPrivateKey: signing.privateKey, expectedRollbackPlanHash: digest({ other: "plan" }), expectedBundleHash: plan.bundle.bundleHash }), /another plan or bundle/i);
  const rollback = restarted.rollback({ expectedRevision: 1, signingPrivateKey: signing.privateKey, expectedRollbackPlanHash: plan.rollbackPlan.rollbackPlanHash, expectedBundleHash: plan.bundle.bundleHash });
  assert.equal(rollback.status, "rolled-back-nonactivating");
  assert.equal(rollback.customerExecutionAuthorized, false);
  const finalRestart = new NonactivatingDeploymentStateStore({ directory, expectedPublicKey: signing.publicKey, now: () => NOW });
  assert.equal(finalRestart.snapshot().events.at(-1).status, "rolled-back-nonactivating");
  assert.throws(() => finalRestart.markPreviewLoaded({ expectedRevision: 2, signingPrivateKey: signing.privateKey }), /cannot transition again/i);
});

test("source, role, specialist, observer, readiness, freshness and secret attacks fail before packaging", () => {
  const base = das020Fixture();
  const changedRole = structuredClone(base.roleContract);
  changedRole.roleId = "another-role";
  changedRole.contractHash = digest(Object.fromEntries(Object.entries(changedRole).filter(([key]) => key !== "contractHash")));
  assert.throws(() => createNonactivatingDeploymentBundlePlan({ ...base, roleContract: changedRole }), /another tenant, role, or revision/i);

  const crossedPlugin = structuredClone(base.pluginProjectIdentities);
  crossedPlugin.specialistHash = digest({ other: "specialist" });
  crossedPlugin.identityHash = digest(Object.fromEntries(Object.entries(crossedPlugin).filter(([key]) => key !== "identityHash")));
  assert.throws(() => createNonactivatingDeploymentBundlePlan({ ...base, pluginProjectIdentities: crossedPlugin }), /another specialist/i);

  const writerObserver = structuredClone(base.observerBindings);
  writerObserver.observer.writeOperations = ["delete-record"];
  writerObserver.bindingsHash = digest(Object.fromEntries(Object.entries(writerObserver).filter(([key]) => key !== "bindingsHash")));
  assert.throws(() => createNonactivatingDeploymentBundlePlan({ ...base, observerBindings: writerObserver }), /read-only/i);

  const widened = structuredClone(base.readinessInput);
  widened.activationReady = true;
  widened.receiptHash = digest(Object.fromEntries(Object.entries(widened).filter(([key]) => key !== "receiptHash")));
  assert.throws(() => createNonactivatingDeploymentBundlePlan({ ...base, readinessInput: widened }), /widened a protected gate/i);

  const stale = structuredClone(base.conformanceEvidence);
  stale.validUntil = "2026-08-14T11:00:00.000Z";
  stale.evidenceHash = digest(Object.fromEntries(Object.entries(stale).filter(([key]) => key !== "evidenceHash")));
  assert.throws(() => createNonactivatingDeploymentBundlePlan({ ...base, conformanceEvidence: stale }), /stale/i);

  const secretRole = structuredClone(base.roleContract);
  secretRole.apiKey = "sk-not-allowed-in-artifact";
  secretRole.contractHash = digest(Object.fromEntries(Object.entries(secretRole).filter(([key]) => key !== "contractHash")));
  assert.throws(() => createNonactivatingDeploymentBundlePlan({ ...base, roleContract: secretRole }), /credential or secret material/i);
});

test("unsigned, wrong-key, post-signature mutation, unexpected-file and permissive-mode attacks fail inspection", () => {
  const unsigned = prepare();
  fs.unlinkSync(path.join(unsigned.directory, "release-signature.json"));
  assert.equal(inspectNonactivatingDeploymentBundle({ directory: unsigned.directory, expectedPublicKey: unsigned.signing.publicKey, now: NOW }).readyForNonactivatingHandoff, false);

  const wrongKey = prepare();
  assert.equal(inspectNonactivatingDeploymentBundle({ directory: wrongKey.directory, expectedPublicKey: keys().publicKey, now: NOW }).readyForNonactivatingHandoff, false);

  const mutated = prepare();
  const rolePath = path.join(mutated.directory, "role-contract.json");
  const role = JSON.parse(fs.readFileSync(rolePath, "utf8"));
  role.revision += 1;
  fs.writeFileSync(rolePath, `${JSON.stringify(role, null, 2)}\n`, { mode: 0o600 });
  assert.equal(inspectNonactivatingDeploymentBundle({ directory: mutated.directory, expectedPublicKey: mutated.signing.publicKey, now: NOW }).readyForNonactivatingHandoff, false);

  const extra = prepare();
  fs.writeFileSync(path.join(extra.directory, "surprise.json"), "{}\n", { mode: 0o600 });
  assert.equal(inspectNonactivatingDeploymentBundle({ directory: extra.directory, expectedPublicKey: extra.signing.publicKey, now: NOW }).readyForNonactivatingHandoff, false);

  const permissive = prepare();
  fs.chmodSync(path.join(permissive.directory, "specialist.json"), 0o644);
  assert.equal(inspectNonactivatingDeploymentBundle({ directory: permissive.directory, expectedPublicKey: permissive.signing.publicKey, now: NOW }).readyForNonactivatingHandoff, false);
});

test("runtime-state mutation, wrong signing authority and overwrite fail closed", () => {
  const { signing, directory, plan } = prepare();
  const statePath = path.join(directory, "state", "runtime-state.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.events[0].status = "active";
  state.stateHash = digest(Object.fromEntries(Object.entries(state).filter(([key]) => key !== "stateHash")));
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  assert.equal(inspectNonactivatingDeploymentBundle({ directory, expectedPublicKey: signing.publicKey, now: NOW }).readyForNonactivatingHandoff, false);
  assert.throws(() => new NonactivatingDeploymentStateStore({ directory, expectedPublicKey: signing.publicKey, now: () => NOW }), /invalid/i);

  const clean = prepare();
  const store = new NonactivatingDeploymentStateStore({ directory: clean.directory, expectedPublicKey: clean.signing.publicKey, now: () => NOW });
  assert.throws(() => store.markPreviewLoaded({ expectedRevision: 0, signingPrivateKey: keys().privateKey }), /does not match/i);
  assert.throws(() => writeNonactivatingDeploymentBundle({ directory: clean.directory, plan: clean.plan, signingPrivateKey: clean.signing.privateKey, signingPublicKey: clean.signing.publicKey }), /refuses to overwrite/i);
  assert.equal(plan.bundle.activationAuthorized, false);
});

test("a caller cannot mutate a prepared plan before the writer signs it", () => {
  const signing = keys();
  const root = temporary();
  const plan = createNonactivatingDeploymentBundlePlan(das020Fixture());
  const mutated = structuredClone(plan);
  mutated.bundle.activationAuthorized = true;
  assert.throws(() => writeNonactivatingDeploymentBundle({ directory: path.join(root, "bundle"), plan: mutated, signingPrivateKey: signing.privateKey, signingPublicKey: signing.publicKey }), /integrity mismatch|protected gate/i);
  assert.equal(fs.existsSync(path.join(root, "bundle")), false);
});

test("stale conformance blocks preview but never blocks the signed rollback escape path", () => {
  const { signing, directory, plan } = prepare();
  const afterExpiry = "2026-08-16T12:00:00.000Z";
  assert.equal(inspectNonactivatingDeploymentBundle({ directory, expectedPublicKey: signing.publicKey, now: afterExpiry }).readyForNonactivatingHandoff, false);
  const store = new NonactivatingDeploymentStateStore({ directory, expectedPublicKey: signing.publicKey, now: () => afterExpiry });
  assert.throws(() => store.markPreviewLoaded({ expectedRevision: 0, signingPrivateKey: signing.privateKey }), /current conformance evidence/i);
  const rolledBack = store.rollback({ expectedRevision: 0, signingPrivateKey: signing.privateKey, expectedRollbackPlanHash: plan.rollbackPlan.rollbackPlanHash, expectedBundleHash: plan.bundle.bundleHash });
  assert.equal(rolledBack.status, "rolled-back-nonactivating");
  assert.equal(rolledBack.activationAuthorized, false);
});

test("even a caller with no blocker list cannot omit generated blockers", () => {
  const plan = createNonactivatingDeploymentBundlePlan(das020Fixture({ unresolvedBlockers: [] }));
  const required = ["selected-specialist-not-proved", ...DAS020_REQUIRED_BLOCKERS];
  assert.equal(required.every((blocker) => plan.blockerLedger.blockers.includes(blocker)), true);
  assert.equal(plan.readinessReceipt.status, "complete-package-blocked-nonactivating");
  assert.equal(plan.readinessReceipt.activationReady, false);
});
