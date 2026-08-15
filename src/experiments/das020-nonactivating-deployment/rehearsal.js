import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "../../core/canonical.js";
import {
  DAS020_REQUIRED_BLOCKERS,
  NonactivatingDeploymentStateStore,
  createNonactivatingDeploymentBundlePlan,
  inspectNonactivatingDeploymentBundle,
  writeNonactivatingDeploymentBundle,
} from "../../product/nonactivating-deployment-bundle.js";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SOURCE_RELATIVE = "artifacts/onboarding/das025-plugin-project-rehearsal-v2/result.json";
const SOURCE_PATH = path.join(REPOSITORY_ROOT, SOURCE_RELATIVE);
const EXPECTED_SOURCE_SHA256 = "d35edc4e7bc56ba90864db1cd6315f65ad5ed30c62b7b8227a211cc43c050654";
const NOW = "2026-08-14T14:00:00.000Z";

function rawSha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function sealed(value, hashField) { const record = structuredClone(value); record[hashField] = digest(record); return record; }
function stripHash(record, hashField) { const copy = structuredClone(record); delete copy[hashField]; return copy; }
function writePrivate(file, value) { fs.writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }); fs.chmodSync(file, 0o600); }
function requireCondition(condition, message) { if (!condition) throw new Error(message); }

export function createDas020SyntheticInputs() {
  const sourceBytes = fs.readFileSync(SOURCE_PATH);
  const sourceArtifactSha256 = rawSha256(sourceBytes);
  requireCondition(sourceArtifactSha256 === EXPECTED_SOURCE_SHA256, "DAS-025 source artifact changed before DAS-020 packaging");
  const source = JSON.parse(sourceBytes.toString("utf8"));
  requireCondition(source.schemaVersion === "das.das025-plugin-project-rehearsal-summary.v1" && source.summaryHash === "3f6b9517c489faa32bd96b587778209041b738456d44a4cc56cb00030b87c1e7", "Unexpected DAS-025 source artifact identity");
  const evidence = source.results.find((item) => item.sourceKind === "openapi");
  requireCondition(evidence, "DAS-020 requires the frozen DAS-025 OpenAPI fixture evidence");

  const tenantId = "fictional-northstar-tenant";
  const roleId = "invoice-dispute-specialist";
  const roleRevision = 4;
  const roleContract = sealed({
    schemaVersion: "das.customer-local-role-contract.v1",
    tenantId,
    roleId,
    revision: roleRevision,
    sourceIdentity: { kind: "openapi", sourceHash: digest({ sourceFixture: evidence.fixtureId, das025SourceArtifactSha256: sourceArtifactSha256 }) },
    outcome: "Create one bounded invoice-dispute draft and prove its externally visible read-only case state without approving payment or refund.",
    authority: { allowed: ["create-dispute-draft"], approvalRequired: ["submit-dispute"], forbidden: ["approve-refund", "release-payment", "modify-unrelated-invoice"] },
    authorizations: { customerExecution: false, modelSpend: false, activation: false },
  }, "contractHash");
  const specialist = sealed({
    schemaVersion: "das.nonactivating-specialist.v1",
    tenantId,
    roleId,
    roleRevision,
    specialistId: "synthetic-provisional-northstar-dispute-v1",
    status: "synthetic-provisional",
    candidateFingerprint: digest({ specialist: "synthetic-provisional-northstar-dispute-v1", roleContractHash: roleContract.contractHash }),
    selectionEvidence: null,
    bindingPackageReceiptHash: evidence.reconstruction.originalDAS023PackageReceiptHash,
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
    draftHash: evidence.reconstruction.das024DraftHash,
    packageReceiptHash: evidence.reconstruction.originalDAS023PackageReceiptHash,
    planHash: evidence.scaffold.planHash,
    scaffoldReceiptHash: evidence.scaffold.receiptHash,
    generatedProjectHash: evidence.scaffold.generatedProjectHash,
    action: { projectIdentity: digest({ fixtureId: evidence.fixtureId, plane: "action-project" }), authenticationIdentity: digest({ fixtureId: evidence.fixtureId, plane: "action-auth" }) },
    observer: { projectIdentity: digest({ fixtureId: evidence.fixtureId, plane: "observer-project" }), authenticationIdentity: digest({ fixtureId: evidence.fixtureId, plane: "observer-auth" }), readOnly: true, writeOperations: [] },
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
    packageReceiptHash: evidence.reconstruction.originalDAS023PackageReceiptHash,
    generatedProjectHash: evidence.scaffold.generatedProjectHash,
    actionImplementationIntentHash: evidence.implementation.actionImplementationIntentHash,
    actionImplementationContentHash: evidence.implementation.actionImplementationContentHash,
    observerImplementationIntentHash: evidence.implementation.observerImplementationIntentHash,
    observerImplementationContentHash: evidence.implementation.observerImplementationContentHash,
    conformanceReceiptHash: evidence.implementation.conformanceReceiptHash,
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
    packageReceiptHash: evidence.reconstruction.originalDAS023PackageReceiptHash,
    conformanceReceiptHash: evidence.implementation.conformanceReceiptHash,
    sourceArtifact: { path: SOURCE_RELATIVE, sha256: sourceArtifactSha256, summaryHash: source.summaryHash, resultHash: evidence.resultHash },
    scope: "fictional-disposable-local",
    observedAt: "2026-08-14T13:00:00.000Z",
    validUntil: "2026-08-15T13:00:00.000Z",
    controlsPassed: evidence.qualification.controlsPassed,
    controlsRequired: evidence.qualification.controlsRequired,
    observerWrites: evidence.qualification.observerWrites,
    lostResponseReplays: evidence.qualification.lostResponseReplays,
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
    packageReceiptHash: evidence.reconstruction.originalDAS023PackageReceiptHash,
    action: { sourceIdentity: "fictional-northstar-action-openapi-v1", authenticationIdentity: "fictional-northstar-action-principal-v1", credentialAlias: "NORTHSTAR_ACTION_CREDENTIAL", implementationContentHash: evidence.implementation.actionImplementationContentHash },
    observer: { sourceIdentity: "fictional-northstar-read-model-v1", authenticationIdentity: "fictional-northstar-observer-principal-v1", credentialAlias: "NORTHSTAR_OBSERVER_CREDENTIAL", implementationContentHash: evidence.implementation.observerImplementationContentHash, independent: true, readOnly: true, writeOperations: [] },
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
    unresolvedBlockers: ["customer-role-owner-review-not-recorded", "customer-workspace-administrator-not-assigned"],
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
  return { roleContract, specialist, pluginProjectIdentities, implementationIdentities, conformanceEvidence, observerBindings, readinessInput, rollbackInput, unresolvedBlockers: [], now: NOW, sourceArtifactSha256, sourceSummaryHash: source.summaryHash };
}

function captureAttack(results, id, fn, expected) {
  try {
    fn();
    results.push({ id, passed: false, reason: "attack did not fail closed" });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    results.push({ id, passed: expected ? expected.test(reason) : true, reason });
  }
}

function prepareTemporaryPackage(inputs) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "das020-rehearsal-"));
  const directory = path.join(temporary, "bundle");
  const signing = crypto.generateKeyPairSync("ed25519");
  const plan = createNonactivatingDeploymentBundlePlan(inputs);
  writeNonactivatingDeploymentBundle({ directory, plan, signingPrivateKey: signing.privateKey, signingPublicKey: signing.publicKey });
  return { temporary, directory, signing, plan };
}

export function runDas020Rehearsal({ outputDirectory }) {
  const started = process.hrtime.bigint();
  requireCondition(!fs.existsSync(outputDirectory), "DAS-020 rehearsal refuses to overwrite an existing artifact directory");
  fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(outputDirectory, 0o700);
  const inputs = createDas020SyntheticInputs();
  const signing = crypto.generateKeyPairSync("ed25519");
  const plan = createNonactivatingDeploymentBundlePlan(inputs);
  const bundleDirectory = path.join(outputDirectory, "bundle");
  const written = writeNonactivatingDeploymentBundle({ directory: bundleDirectory, plan, signingPrivateKey: signing.privateKey, signingPublicKey: signing.publicKey });
  const publicKeyPem = signing.publicKey.export({ format: "pem", type: "spki" }).toString();
  writePrivate(path.join(outputDirectory, "release-public-key.pem"), publicKeyPem);

  const initialDiagnostics = inspectNonactivatingDeploymentBundle({ directory: bundleDirectory, expectedPublicKey: signing.publicKey, now: NOW, expected: { tenantId: plan.bundle.tenantId, roleId: plan.bundle.roleId, roleRevision: plan.bundle.roleRevision, specialistHash: plan.bundle.specialistHash, bundleHash: plan.bundle.bundleHash } });
  requireCondition(initialDiagnostics.readyForNonactivatingHandoff, "Fresh DAS-020 bundle failed its initial nonactivating diagnostics");
  const firstProcess = new NonactivatingDeploymentStateStore({ directory: bundleDirectory, expectedPublicKey: signing.publicKey, now: () => NOW });
  const previewEvent = firstProcess.markPreviewLoaded({ expectedRevision: 0, signingPrivateKey: signing.privateKey });
  const restartedProcess = new NonactivatingDeploymentStateStore({ directory: bundleDirectory, expectedPublicKey: signing.publicKey, now: () => NOW });
  requireCondition(restartedProcess.snapshot().events.at(-1).eventHash === previewEvent.eventHash, "Fresh-process reload lost the exact preview state");
  const rollbackEvent = restartedProcess.rollback({ expectedRevision: 1, signingPrivateKey: signing.privateKey, expectedRollbackPlanHash: plan.rollbackPlan.rollbackPlanHash, expectedBundleHash: plan.bundle.bundleHash });
  const afterRollback = new NonactivatingDeploymentStateStore({ directory: bundleDirectory, expectedPublicKey: signing.publicKey, now: () => NOW });
  const finalDiagnostics = inspectNonactivatingDeploymentBundle({ directory: bundleDirectory, expectedPublicKey: signing.publicKey, now: NOW });
  requireCondition(finalDiagnostics.packageIntegrityValid && !finalDiagnostics.readyForNonactivatingHandoff && afterRollback.snapshot().events.at(-1).status === "rolled-back-nonactivating", "Final rollback did not preserve a valid inactive package state");

  const attacks = [];
  const crossed = structuredClone(inputs.pluginProjectIdentities);
  crossed.specialistHash = digest({ another: "specialist" });
  crossed.identityHash = digest(stripHash(crossed, "identityHash"));
  captureAttack(attacks, "cross-specialist-evidence", () => createNonactivatingDeploymentBundlePlan({ ...inputs, pluginProjectIdentities: crossed }), /another specialist/i);
  const changedRole = structuredClone(inputs.roleContract);
  changedRole.revision += 1;
  changedRole.contractHash = digest(stripHash(changedRole, "contractHash"));
  captureAttack(attacks, "role-revision-mutation", () => createNonactivatingDeploymentBundlePlan({ ...inputs, roleContract: changedRole }), /another tenant, role, or revision/i);
  const changedSource = structuredClone(inputs.roleContract);
  changedSource.sourceIdentity.sourceHash = digest({ substituted: "source" });
  changedSource.contractHash = digest(stripHash(changedSource, "contractHash"));
  captureAttack(attacks, "source-mutation", () => createNonactivatingDeploymentBundlePlan({ ...inputs, roleContract: changedSource }), /another source revision|integrity/i);
  const stale = structuredClone(inputs.conformanceEvidence);
  stale.validUntil = "2026-08-14T13:30:00.000Z";
  stale.evidenceHash = digest(stripHash(stale, "evidenceHash"));
  captureAttack(attacks, "stale-evidence", () => createNonactivatingDeploymentBundlePlan({ ...inputs, conformanceEvidence: stale }), /stale/i);
  const collapsedObserver = structuredClone(inputs.observerBindings);
  collapsedObserver.observer.authenticationIdentity = collapsedObserver.action.authenticationIdentity;
  collapsedObserver.bindingsHash = digest(stripHash(collapsedObserver, "bindingsHash"));
  captureAttack(attacks, "action-observer-collapse", () => createNonactivatingDeploymentBundlePlan({ ...inputs, observerBindings: collapsedObserver }), /collapsed/i);
  const widenedReadiness = structuredClone(inputs.readinessInput);
  widenedReadiness.activationReady = true;
  widenedReadiness.receiptHash = digest(stripHash(widenedReadiness, "receiptHash"));
  captureAttack(attacks, "readiness-widening", () => createNonactivatingDeploymentBundlePlan({ ...inputs, readinessInput: widenedReadiness }), /protected gate/i);
  const secret = structuredClone(inputs.roleContract);
  secret.apiKey = "sk-forbidden-secret-material";
  secret.contractHash = digest(stripHash(secret, "contractHash"));
  captureAttack(attacks, "secret-leakage", () => createNonactivatingDeploymentBundlePlan({ ...inputs, roleContract: secret }), /secret material/i);

  const unsigned = prepareTemporaryPackage(inputs);
  fs.unlinkSync(path.join(unsigned.directory, "release-signature.json"));
  requireCondition(!inspectNonactivatingDeploymentBundle({ directory: unsigned.directory, expectedPublicKey: unsigned.signing.publicKey, now: NOW }).packageIntegrityValid, "Unsigned package was accepted");
  attacks.push({ id: "unsigned-release", passed: true, reason: "release signature removal invalidated package" });
  const wrongKey = prepareTemporaryPackage(inputs);
  requireCondition(!inspectNonactivatingDeploymentBundle({ directory: wrongKey.directory, expectedPublicKey: crypto.generateKeyPairSync("ed25519").publicKey, now: NOW }).packageIntegrityValid, "Self-signed package under another key was accepted");
  attacks.push({ id: "wrong-pinned-key", passed: true, reason: "externally pinned key rejected another release key" });
  const mutated = prepareTemporaryPackage(inputs);
  fs.appendFileSync(path.join(mutated.directory, "specialist.json"), "\n", { mode: 0o600 });
  requireCondition(!inspectNonactivatingDeploymentBundle({ directory: mutated.directory, expectedPublicKey: mutated.signing.publicKey, now: NOW }).packageIntegrityValid, "Post-signature file mutation was accepted");
  attacks.push({ id: "post-signature-file-mutation", passed: true, reason: "signed file hash changed" });
  const unexpected = prepareTemporaryPackage(inputs);
  fs.writeFileSync(path.join(unexpected.directory, "unexpected.json"), "{}\n", { mode: 0o600 });
  requireCondition(!inspectNonactivatingDeploymentBundle({ directory: unexpected.directory, expectedPublicKey: unexpected.signing.publicKey, now: NOW }).packageIntegrityValid, "Unexpected package file was accepted");
  attacks.push({ id: "unexpected-file", passed: true, reason: "exact allowlist rejected extra file" });
  const stateAttack = prepareTemporaryPackage(inputs);
  const stateFile = path.join(stateAttack.directory, "state", "runtime-state.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  state.events[0].status = "active";
  state.stateHash = digest(stripHash(state, "stateHash"));
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  requireCondition(!inspectNonactivatingDeploymentBundle({ directory: stateAttack.directory, expectedPublicKey: stateAttack.signing.publicKey, now: NOW }).packageIntegrityValid, "Mutated runtime state was accepted");
  attacks.push({ id: "runtime-state-mutation", passed: true, reason: "signed event chain rejected active-state substitution" });
  const rollbackAttack = prepareTemporaryPackage(inputs);
  const rollbackStore = new NonactivatingDeploymentStateStore({ directory: rollbackAttack.directory, expectedPublicKey: rollbackAttack.signing.publicKey, now: () => NOW });
  captureAttack(attacks, "cross-bundle-rollback", () => rollbackStore.rollback({ expectedRevision: 0, signingPrivateKey: rollbackAttack.signing.privateKey, expectedRollbackPlanHash: rollbackAttack.plan.rollbackPlan.rollbackPlanHash, expectedBundleHash: digest({ another: "bundle" }) }), /another plan or bundle/i);
  captureAttack(attacks, "stale-revision", () => rollbackStore.markPreviewLoaded({ expectedRevision: 4, signingPrivateKey: rollbackAttack.signing.privateKey }), /revision changed/i);
  requireCondition(["selected-specialist-not-proved", ...DAS020_REQUIRED_BLOCKERS].every((blocker) => plan.blockerLedger.blockers.includes(blocker)), "Generator allowed a mandatory blocker to be omitted");
  attacks.push({ id: "omitted-blocker", passed: true, reason: "mandatory blockers were derived even from an empty caller list" });
  requireCondition(attacks.every((attack) => attack.passed), `DAS-020 attack set failed: ${attacks.filter((attack) => !attack.passed).map((attack) => attack.id).join(",")}`);

  const activeMachineTimeMs = Number(process.hrtime.bigint() - started) / 1e6;
  const result = {
    schemaVersion: "das.das020-nonactivating-deployment-bundle-rehearsal.v1",
    status: "passed-private-fictional-local",
    sourceEvidence: { artifactPath: SOURCE_RELATIVE, artifactSha256: inputs.sourceArtifactSha256, summaryHash: inputs.sourceSummaryHash },
    bundle: { bundleHash: plan.bundle.bundleHash, specialistStatus: plan.bundle.specialistStatus, specialistHash: plan.bundle.specialistHash, roleContractHash: plan.bundle.roleContractHash, pluginProjectIdentityHash: plan.bundle.pluginProjectIdentityHash, implementationIdentityHash: plan.bundle.implementationIdentityHash, conformanceEvidenceHash: plan.bundle.conformanceEvidenceHash, observerBindingsHash: plan.bundle.observerBindingsHash, readinessReceiptHash: plan.bundle.readinessReceiptHash, blockerLedgerHash: plan.bundle.blockerLedgerHash, rollbackPlanHash: plan.bundle.rollbackPlanHash },
    packaging: { immutableFiles: written.releaseManifest.files.length, signedManifestFiles: written.releaseManifest.files.length, signatureAlgorithm: written.releaseSignature.algorithm, externallyPinnedPublicKeyRequired: true, overwriteRefused: true, privateRootMode: "0700", privateFileMode: "0600" },
    blockers: { total: plan.blockerLedger.blockers.length, exact: plan.blockerLedger.blockers, allResolved: false },
    runtime: { freshProcessReload: true, previewStatus: previewEvent.status, rollbackStatus: rollbackEvent.status, revisions: afterRollback.snapshot().events.length, packageIntegrityAfterRollback: finalDiagnostics.packageIntegrityValid, readyForNonactivatingHandoffAfterRollback: finalDiagnostics.readyForNonactivatingHandoff, executableCustomerOperations: 0, customerExecutionAuthorized: false, activationAuthorized: false },
    attacks: { passed: attacks.filter((attack) => attack.passed).length, required: attacks.length, results: attacks },
    humanSetupTimeMeasured: false,
    modelCalls: 0,
    spendUsd: 0,
    activeMachineTimeMs,
    evidenceBoundary: "Private deterministic fictional local packaging evidence. The specialist is synthetic/provisional; generated projects remain non-executable; implementation/conformance is fictional disposable evidence; customer bindings, comparison, acceptance, activation, deployment, value and production reliability remain unproved.",
  };
  result.resultHash = digest(result);
  writePrivate(path.join(outputDirectory, "result.json"), result);
  return Object.freeze(result);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputDirectory = process.argv[2] ? path.resolve(process.argv[2]) : path.join(REPOSITORY_ROOT, "artifacts", "onboarding", "das020-nonactivating-deployment-bundle-v1");
  const result = runDas020Rehearsal({ outputDirectory });
  process.stdout.write(`${JSON.stringify({ status: result.status, resultHash: result.resultHash, attacks: result.attacks, blockers: result.blockers.total, runtime: result.runtime, modelCalls: result.modelCalls, spendUsd: result.spendUsd }, null, 2)}\n`);
}
