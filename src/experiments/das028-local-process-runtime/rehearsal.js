import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { digest } from "../../core/canonical.js";
import {
  applySourceGroundedBindingDraftAnswers,
  createSourceGroundedBindingDraftSession,
  materializeSourceGroundedBindingPackageInputs,
} from "../../product/source-grounded-binding-package-draft.js";
import { createCustomerLocalBindingPackage } from "../../product/customer-local-binding-package-factory.js";
import { assertCustomerLocalAcceptanceOnly, createCustomerLocalQualificationHarnessContract, sealCustomerLocalAcceptanceOnly } from "../../product/customer-local-binding-qualification.js";
import { runCustomerLocalQualificationRuntimeBridge } from "../../product/customer-local-qualification-runtime-bridge.js";
import { writeCustomerLocalBindingPluginScaffold } from "../../product/customer-local-binding-plugin-scaffold.js";
import { createCustomerLocalTransportImplementationWorkPack } from "../../product/customer-local-transport-implementation-assistance.js";
import { createDeclarativeRuntimeExecutionProfile, inspectCustomerLocalDeclarativeRuntime, writeCustomerLocalDeclarativeRuntime } from "../../product/customer-local-declarative-runtime-compiler.js";
import { createNonactivatingDeploymentBundlePlan, inspectNonactivatingDeploymentBundle, writeNonactivatingDeploymentBundle } from "../../product/nonactivating-deployment-bundle.js";
import {
  assertCustomerLocalProcessEndpoint,
  createCustomerLocalActionProcessTransport,
  createCustomerLocalObserverProcessTransport,
  createCustomerLocalProcessEndpoint,
  createCustomerLocalProcessTransportReceipt,
  createCustomerLocalSecretLeaseResolver,
  probeCustomerLocalProcessEndpoint,
} from "../../product/customer-local-process-transport.js";
import { prepareDAS024QualificationBinding } from "../das024-authoring/qualification-harness.js";
import { startDAS028ProcessCluster, initializeDAS028State } from "./process-cluster.js";
import { DAS028_FRESH_FIXTURES } from "./fixtures.js";

const OUTPUT_ROOT = path.resolve("artifacts/onboarding/das028-customer-shaped-local-process-v1");
const FIXED_NOW_MS = 1_000;
const FIXED_ISO = "2026-08-14T22:00:00.000Z";
const VALID_UNTIL = "2026-08-15T22:00:00.000Z";
const FROZEN_SOURCE_FILES = Object.freeze([
  "reports/0107-das028-customer-shaped-local-process-transport-preregistration.md",
  "src/product/customer-local-process-transport.js",
  "src/experiments/das028-local-process-runtime/process-worker.js",
  "src/experiments/das028-local-process-runtime/process-cluster.js",
  "src/experiments/das028-local-process-runtime/fixtures.js",
  "src/experiments/das028-local-process-runtime/rehearsal.js",
]);

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }
function rawSha256(value) { return createHash("sha256").update(value).digest("hex"); }
function sealed(value, hashKey) { const record = structuredClone(value); record[hashKey] = digest(record); return record; }
function writePrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.chmodSync(file, 0o600);
}
function sourceManifest() { return FROZEN_SOURCE_FILES.map((relative) => ({ relative, sha256: rawSha256(fs.readFileSync(path.resolve(relative))) })); }

function reconstruct(fixture, stateRoot) {
  const initial = createSourceGroundedBindingDraftSession({ sessionId: fixture.id, businessIntake: structuredClone(fixture.businessIntake), actionSource: structuredClone(fixture.actionSource), observerSource: structuredClone(fixture.observerSource), credentialAliases: structuredClone(fixture.credentialAliases) });
  const completed = applySourceGroundedBindingDraftAnswers({ session: initial, expectedSessionHash: initial.sessionHash, answers: structuredClone(fixture.answers), suppliedBy: { owner: fixture.answers.ownerReviewer, engineer: fixture.answers.engineerReviewer } });
  requireCondition(completed.status === "complete-non-executable-package-input-draft", `${fixture.id} did not complete DAS-024 review`);
  const credentialRefs = fixture.sourceKind === "openapi" ? Object.fromEntries(Object.keys(fixture.actionSource.document.components?.securitySchemes ?? {}).map((name) => [name, fixture.credentialAliases.action[0]])) : {};
  const prepared = prepareDAS024QualificationBinding({ fixture, stateDirectory: path.join(stateRoot, "reviewed-binding"), credentialRefs });
  const packageInputDraft = materializeSourceGroundedBindingPackageInputs({ session: completed, structuralBinding: prepared.structuralBinding, workPlan: prepared.workPlan });
  const generatedPackage = createCustomerLocalBindingPackage({ structuralBinding: prepared.structuralBinding, workPlan: prepared.workPlan, sourceIdentity: packageInputDraft.sourceIdentity, actionRuntime: packageInputDraft.actionRuntime, writeSafety: packageInputDraft.writeSafety, observerProof: packageInputDraft.observerProof });
  const scaffold = writeCustomerLocalBindingPluginScaffold({ directory: path.join(stateRoot, "das025-project"), packageInputDraft, generatedPackage });
  const workPack = createCustomerLocalTransportImplementationWorkPack({ draftSession: completed, packageInputDraft, generatedPackage, scaffoldPlan: scaffold.plan, scaffoldReceipt: scaffold.receipt });
  const executionProfile = createDeclarativeRuntimeExecutionProfile({ workPack, ownerConfirmedBy: fixture.answers.ownerReviewer, engineerConfirmedBy: fixture.answers.engineerReviewer, timeoutMs: 350, maximumRequestsPerMinute: 60 });
  return { initial, completed, prepared, packageInputDraft, generatedPackage, scaffold, workPack, executionProfile };
}

async function importCompiledRuntime(runtime) {
  inspectCustomerLocalDeclarativeRuntime({ directory: runtime.root, expectedReceiptHash: runtime.receipt.receiptHash });
  const action = await import(`${pathToFileURL(path.join(runtime.root, "action-plugin", "index.js")).href}?v=${runtime.receipt.actionImplementationContentHash}`);
  const observer = await import(`${pathToFileURL(path.join(runtime.root, "observer-plugin", "index.js")).href}?v=${runtime.receipt.observerImplementationContentHash}`);
  return { action, observer };
}

function qualificationPackage(reconstruction, runtime) {
  const actionRuntime = structuredClone(reconstruction.packageInputDraft.actionRuntime);
  actionRuntime.implementationHash = runtime.receipt.actionImplementationContentHash;
  const observerProof = structuredClone(reconstruction.packageInputDraft.observerProof);
  observerProof.runtime.implementationHash = runtime.receipt.observerImplementationContentHash;
  return createCustomerLocalBindingPackage({ structuralBinding: reconstruction.prepared.structuralBinding, workPlan: reconstruction.prepared.workPlan, sourceIdentity: reconstruction.packageInputDraft.sourceIdentity, actionRuntime, writeSafety: reconstruction.packageInputDraft.writeSafety, observerProof });
}

function exactBoundary(candidate, plane, packageIdentityHash) {
  if (plane === "action") return Object.freeze({ bindingId: candidate.action.bindingId, surfaceId: candidate.action.surfaceId, implementationHash: candidate.action.implementationHash, sourceHash: candidate.action.sourceHash, runtimeSchemaHash: candidate.action.runtimeSchemaHash, transportIdentityHash: candidate.action.transportIdentityHash, credentialAlias: candidate.action.credentialAliases[0], principalId: `das028-action-${packageIdentityHash.slice(0, 16)}`, qualificationAuthorityActions: candidate.action.operations.filter((operation) => operation.mode === "write").map((operation) => operation.authorityAction).sort(), productionAuthorityGranted: false });
  return Object.freeze({ observerId: candidate.observer.observerId, surfaceId: candidate.observer.surfaceId, implementationHash: candidate.observer.implementationHash, sourceHash: candidate.observer.sourceHash, runtimeSchemaHash: candidate.observer.runtimeSchemaHash, transportIdentityHash: candidate.observer.transportIdentityHash, credentialAlias: candidate.observer.credentialAliases[0], principalId: `das028-observer-${packageIdentityHash.slice(0, 16)}`, readOnly: true, writeOperations: [], productionAuthorityGranted: false });
}

function authPlacement(fixture, plane) {
  if (fixture.sourceKind === "mcp-tools-list") return { kind: "mcp-lease-header" };
  const source = plane === "action" ? fixture.actionSource.document : fixture.observerSource.document;
  const scheme = Object.values(source.components?.securitySchemes ?? {})[0];
  return scheme.type === "http" ? { kind: "bearer" } : { kind: "api-key-header", wireName: scheme.name };
}

function localProcessDriverFactory({ fixture, runtimeModules, boundPackage, reconstruction, runtime, cluster, fixtureRoot, diagnostics }) {
  const packageIdentityHash = reconstruction.workPack.packageIdentityHash;
  return async function driverFactory({ testCase, candidate, observerContract, harnessContract, bridgeContract }) {
    const stateFile = path.join(fixtureRoot, "state", `${testCase.id}.json`);
    initializeDAS028State({ stateFile, world: fixture.qualificationWorld });
    await cluster.configure({ controlId: testCase.id, assignedWork: testCase.payload.assignedWork, stateFile, networkFault: null, delayMs: 0 });
    const actionBoundary = exactBoundary(candidate, "action", packageIdentityHash);
    const observerBoundary = exactBoundary(candidate, "observer", packageIdentityHash);
    let generation = 0;
    const storageIdentityHash = digest({ packageIdentityHash, controlId: testCase.id, stateFile: path.basename(stateFile), schema: "das028-process-state-v1" });

    function build() {
      const endpoints = cluster.endpoints();
      const actionResolver = createCustomerLocalSecretLeaseResolver({ secretClient: cluster.secretClient, alias: actionBoundary.credentialAlias, plane: "action", packageIdentityHash });
      const observerResolver = createCustomerLocalSecretLeaseResolver({ secretClient: cluster.secretClient, alias: observerBoundary.credentialAlias, plane: "observer", packageIdentityHash });
      const actionTransport = createCustomerLocalActionProcessTransport({ endpoint: endpoints.action, writeOperation: runtimeModules.action.IMPLEMENTATION_CONTRACT.writeOperation, reconciliationOperation: runtimeModules.action.IMPLEMENTATION_CONTRACT.reconciliationOperation, sourceBaseUrl: runtimeModules.action.IMPLEMENTATION_CONTRACT.baseUrl ?? null, authenticationPlacement: authPlacement(fixture, "action"), timeoutMs: 300 });
      const observerTransport = createCustomerLocalObserverProcessTransport({ endpoint: endpoints.observer, operations: runtimeModules.observer.IMPLEMENTATION_CONTRACT.operations, authenticationPlacement: authPlacement(fixture, "observer"), timeoutMs: 300 });
      const authority = { async assertExact(request) {
        const expected = actionBoundary.qualificationAuthorityActions[0];
        requireCondition(request.requiredAuthorityAction === expected && request.authorityAction === expected && request.packageIdentityHash === packageIdentityHash && request.operationIdentityHash === runtimeModules.action.IMPLEMENTATION_CONTRACT.writeOperation.operationIdentityHash && request.maximumWrites === 1 && request.approved === true, "DAS-028 exact authority denied or widened before network send");
        return { allowed: true, packageIdentityHash, operationIdentityHash: request.operationIdentityHash, authorityReceiptHash: digest({ packageIdentityHash, request }) };
      } };
      const actionAdapter = runtimeModules.action.createActionAdapter({ resolveCredentialLease: actionResolver, transport: actionTransport, authority, now: () => FIXED_NOW_MS });
      const observerAdapter = runtimeModules.observer.createObserverAdapter({ resolveCredentialLease: observerResolver, transport: observerTransport, now: () => FIXED_NOW_MS });
      const processInstanceId = `${endpoints.action.processInstanceId}|${endpoints.observer.processInstanceId}|driver-${generation}`;
      return Object.freeze({
        schemaVersion: "das.customer-local-qualification-world-driver.v1", packageIdentityHash, bridgeContractHash: bridgeContract.contractHash, harnessContractHash: harnessContract.contractHash,
        harnessIdentityHash: harnessContract.worldImplementationHash, persistentStoreSchemaHash: harnessContract.persistentStoreSchemaHash, controlId: testCase.id, storageIdentityHash, processInstanceId,
        action: actionBoundary, observer: observerBoundary,
        async execute({ assignedWork, fault, controlId }) {
          requireCondition(controlId === testCase.id && fault?.kind === testCase.id && digest(assignedWork) === digest(testCase.payload.assignedWork), "DAS-028 execute input changed after freeze");
          try { return await actionAdapter.execute({ assignedWork, authorityContext: { roleId: fixture.id, authorityAction: actionBoundary.qualificationAuthorityActions[0], approved: true } }); }
          catch (error) { diagnostics.push({ controlId: testCase.id, stage: "action", message: String(error?.message ?? error), responseLost: error?.responseLost === true }); throw error; }
        },
        async observe({ phase, observerContractHash, controlId, observationNotBeforeMs }) {
          requireCondition(controlId === testCase.id && observerContractHash === observerContract.contractHash, "DAS-028 observer crossed the qualification contract");
          return observerAdapter.observe({ phase, assignedWork: testCase.payload.assignedWork, observationNotBeforeMs, observerContractHash });
        },
        snapshot() { const state = cluster.stateSnapshot(); return { records: state.records, businessWrites: state.businessWrites, observerWrites: state.observerWrites, unrelatedStateDigest: state.unrelatedStateDigest, additionalChanges: state.additionalChanges, revision: state.revision }; },
        businessWrites() { return cluster.stateSnapshot().businessWrites; }, observerWrites() { return cluster.stateSnapshot().observerWrites; },
        async restart({ testCase: restartedCase, candidate: restartedCandidate, observerContract: restartedObserver, harnessContract: restartedHarness, packageIdentityHash: restartedPackage, bridgeContract: restartedBridge }) {
          requireCondition(restartedPackage === packageIdentityHash && restartedCase.id === testCase.id && restartedCandidate.candidateHash === candidate.candidateHash && restartedObserver.contractHash === observerContract.contractHash && restartedHarness.contractHash === harnessContract.contractHash && restartedBridge.contractHash === bridgeContract.contractHash, "DAS-028 restart changed a frozen identity");
          await cluster.restartBusinessServers();
          generation += 1;
          return build();
        },
      });
    }
    return build();
  };
}

async function runQualification({ fixture, reconstruction, runtime, runtimeModules, cluster, fixtureRoot }) {
  const boundPackage = qualificationPackage(reconstruction, runtime);
  const packageIdentityHash = reconstruction.workPack.packageIdentityHash;
  const harnessContract = createCustomerLocalQualificationHarnessContract({
    harnessId: `${fixture.id}:das028-local-process-qualification-v1`,
    worldImplementationHash: digest({ driver: "das028-separate-local-processes-v1", packageIdentityHash }),
    persistentStoreSchemaHash: digest({ schema: "das028-durable-json-store-v1", packageIdentityHash }),
    authenticationAuthorityHash: digest({ authority: "das028-secret-process-and-boundary-challenge-v1", packageIdentityHash }),
    observerEvidenceSchemaHash: digest({ evidence: "das028-independent-observer-process-v1", packageIdentityHash }),
  });
  const diagnostics = [];
  const qualification = await runCustomerLocalQualificationRuntimeBridge({ candidate: boundPackage.candidate, observerContract: boundPackage.observerContract, harnessContract, packageIdentityHash, assignedWork: fixture.qualificationWorld.assignedWork, driverFactory: localProcessDriverFactory({ fixture, runtimeModules, boundPackage, reconstruction, runtime, cluster, fixtureRoot, diagnostics }), now: () => FIXED_NOW_MS });
  if (!(qualification.qualificationReceipt.qualificationPassed === true && qualification.qualificationReceipt.controlsPassed === 10)) {
    const diagnostic = { cases: qualification.qualificationReceipt.cases.map((entry) => ({ id: entry.id, passed: entry.passed, observedClassification: entry.observedClassification, expectedClassification: entry.expectedClassification })), driver: diagnostics, process: await cluster.stats(), state: cluster.stateSnapshot() };
    throw new Error(`${fixture.id} failed unchanged DAS-023 qualification: ${JSON.stringify(diagnostic)}`);
  }
  const acceptance = sealCustomerLocalAcceptanceOnly({ qualificationReceipt: qualification.qualificationReceipt, candidate: boundPackage.candidate, observerContract: boundPackage.observerContract, caseContract: qualification.caseContract, harnessContract });
  assertCustomerLocalAcceptanceOnly({ receipt: acceptance, qualificationReceipt: qualification.qualificationReceipt, candidate: boundPackage.candidate, observerContract: boundPackage.observerContract, caseContract: qualification.caseContract, harnessContract });
  return { boundPackage, harnessContract, qualification, acceptance };
}

function qualificationAggregate(receipt) {
  return {
    businessWrites: receipt.cases.reduce((sum, item) => sum + item.businessWrites, 0),
    observerWrites: receipt.cases.reduce((sum, item) => sum + item.observerWrites, 0),
    freshProcessLostResponseRecoveries: receipt.cases.filter((item) => item.restartedAfterLostResponse).length,
    lostResponseReplays: receipt.cases.filter((item) => item.id === "lost-response" && item.businessWrites > 1).length,
    incorrectEffects: receipt.cases.filter((item) => !item.passed || item.observerWrites !== 0 || item.businessWrites > item.maximumBusinessWrites).length,
  };
}

function packageNonactivating({ fixture, reconstruction, runtime, qualification, processReceipt, directory }) {
  const tenantId = `fictional-${fixture.id}-tenant`;
  const roleId = `${fixture.id}-specialist`;
  const roleRevision = 1;
  const sourcePairHash = digest({ actionSourceHash: reconstruction.completed.sources.action.sourceHash, observerSourceHash: reconstruction.completed.sources.observer.sourceHash });
  const roleContract = sealed({ schemaVersion: "das.customer-local-role-contract.v1", tenantId, roleId, revision: roleRevision, sourceIdentity: { kind: fixture.sourceKind, sourceHash: sourcePairHash }, outcome: fixture.businessIntake.roleOutcome, authority: { allowed: [...fixture.answers.authority], approvalRequired: [...fixture.answers.approvals], forbidden: [...fixture.answers.forbiddenActions] }, authorizations: { customerExecution: false, modelSpend: false, activation: false } }, "contractHash");
  const specialist = sealed({ schemaVersion: "das.nonactivating-specialist.v1", tenantId, roleId, roleRevision, specialistId: `synthetic-provisional-${fixture.id}`, status: "synthetic-provisional", candidateFingerprint: qualification.boundPackage.candidate.candidateHash, selectionEvidence: null, bindingPackageReceiptHash: qualification.boundPackage.receipt.receiptHash, active: false, activationAuthorized: false, customerExecutionAuthorized: false }, "specialistHash");
  const pluginProjectIdentities = sealed({ schemaVersion: "das.nonactivating-plugin-project-identities.v1", tenantId, roleId, roleRevision, specialistHash: specialist.specialistHash, sourceHash: sourcePairHash, draftHash: reconstruction.packageInputDraft.draftHash, packageReceiptHash: qualification.boundPackage.receipt.receiptHash, planHash: runtime.plan.planHash, scaffoldReceiptHash: runtime.receipt.receiptHash, generatedProjectHash: runtime.plan.implementationIdentity.implementationHash, action: { projectIdentity: runtime.receipt.actionImplementationContentHash, authenticationIdentity: reconstruction.packageInputDraft.actionRuntime.authenticationIdentityHash }, observer: { projectIdentity: runtime.receipt.observerImplementationContentHash, authenticationIdentity: reconstruction.packageInputDraft.observerProof.runtime.authenticationIdentityHash, readOnly: true, writeOperations: [] }, executable: false, qualified: false, customerEnvironmentAccepted: false, activationReady: false }, "identityHash");
  const implementationIdentities = sealed({ schemaVersion: "das.nonactivating-implementation-identities.v1", tenantId, roleId, roleRevision, specialistHash: specialist.specialistHash, packageReceiptHash: qualification.boundPackage.receipt.receiptHash, generatedProjectHash: runtime.plan.implementationIdentity.implementationHash, actionImplementationIntentHash: reconstruction.scaffold.plan.actionContract.implementationIntentHash, actionImplementationContentHash: runtime.receipt.actionImplementationContentHash, observerImplementationIntentHash: reconstruction.scaffold.plan.observerContract.implementationIntentHash, observerImplementationContentHash: runtime.receipt.observerImplementationContentHash, conformanceReceiptHash: qualification.qualification.qualificationReceipt.receiptHash, scope: "fictional-disposable-local", customerEnvironmentImplemented: false, customerExecutableOperations: 0 }, "identityHash");
  const aggregate = qualificationAggregate(qualification.qualification.qualificationReceipt);
  const conformanceEvidence = sealed({ schemaVersion: "das.nonactivating-conformance-evidence.v1", tenantId, roleId, roleRevision, specialistHash: specialist.specialistHash, packageReceiptHash: qualification.boundPackage.receipt.receiptHash, conformanceReceiptHash: qualification.qualification.qualificationReceipt.receiptHash, sourceArtifact: { path: `das028:${fixture.id}`, sha256: rawSha256(JSON.stringify(processReceipt)), summaryHash: processReceipt.receiptHash, resultHash: qualification.qualification.resultHash }, scope: "fictional-disposable-local", observedAt: FIXED_ISO, validUntil: VALID_UNTIL, controlsPassed: qualification.qualification.qualificationReceipt.controlsPassed, controlsRequired: qualification.qualification.qualificationReceipt.controlsRequired, observerWrites: aggregate.observerWrites, lostResponseReplays: aggregate.lostResponseReplays, customerEnvironmentConformance: false, customerAcceptance: false, activationReady: false }, "evidenceHash");
  const observerBindings = sealed({ schemaVersion: "das.nonactivating-observer-bindings.v1", tenantId, roleId, roleRevision, specialistHash: specialist.specialistHash, packageReceiptHash: qualification.boundPackage.receipt.receiptHash, action: { sourceIdentity: reconstruction.completed.sources.action.sourceHash, authenticationIdentity: reconstruction.packageInputDraft.actionRuntime.authenticationIdentityHash, credentialAlias: fixture.credentialAliases.action[0], implementationContentHash: runtime.receipt.actionImplementationContentHash }, observer: { sourceIdentity: reconstruction.completed.sources.observer.sourceHash, authenticationIdentity: reconstruction.packageInputDraft.observerProof.runtime.authenticationIdentityHash, credentialAlias: fixture.credentialAliases.observer[0], implementationContentHash: runtime.receipt.observerImplementationContentHash, independent: true, readOnly: true, writeOperations: [] }, actionResponseAcceptedAsIndependentProof: false, customerBound: false, customerProbed: false, customerQualified: false, activationReady: false }, "bindingsHash");
  const readinessInput = sealed({ schemaVersion: "das.nonactivating-readiness-input.v1", tenantId, roleId, roleRevision, specialistHash: specialist.specialistHash, unresolvedBlockers: [...runtime.plan.remainingBlockers, "fictional localhost process conformance is not customer environment acceptance", "HTTP-local-only transport has no TLS claim", "customer credentials, runtime authority and activation remain absent"], comparisonComplete: false, executionReady: false, customerAcceptanceComplete: false, activationReady: false, activationAuthorized: false }, "receiptHash");
  const rollbackInput = sealed({ schemaVersion: "das.nonactivating-rollback-input.v1", tenantId, roleId, roleRevision, specialistHash: specialist.specialistHash, previousBundleHash: null, fallback: "leave-current-specialist-unchanged", activationAuthorized: false, executionAuthorized: false }, "rollbackInputHash");
  const plan = createNonactivatingDeploymentBundlePlan({ roleContract, specialist, pluginProjectIdentities, implementationIdentities, conformanceEvidence, observerBindings, readinessInput, rollbackInput, unresolvedBlockers: readinessInput.unresolvedBlockers, now: FIXED_ISO });
  const signing = crypto.generateKeyPairSync("ed25519");
  writeNonactivatingDeploymentBundle({ directory, plan, signingPrivateKey: signing.privateKey, signingPublicKey: signing.publicKey });
  const diagnostics = inspectNonactivatingDeploymentBundle({ directory, expectedPublicKey: signing.publicKey, now: FIXED_ISO, expected: { tenantId, roleId, roleRevision, specialistHash: specialist.specialistHash, bundleHash: plan.bundle.bundleHash } });
  requireCondition(diagnostics.packageIntegrityValid && diagnostics.readyForNonactivatingHandoff && diagnostics.customerExecutionReady === false && diagnostics.activationReady === false, `${fixture.id} failed DAS-020 packaging`);
  writePrivate(path.join(path.dirname(directory), "release-public-key.pem"), signing.publicKey.export({ format: "pem", type: "spki" }).toString());
  return { plan, diagnostics };
}

function capture(attacks, id, operation, expected) {
  try { operation(); attacks.push({ id, passed: false, reason: "unsafe input accepted" }); }
  catch (error) { const reason = String(error?.message ?? error); attacks.push({ id, passed: expected.test(reason), reason }); }
}

async function captureAsync(attacks, id, operation, expected) {
  try { await operation(); attacks.push({ id, passed: false, reason: "unsafe input accepted" }); }
  catch (error) { const reason = String(error?.message ?? error); attacks.push({ id, passed: expected.test(reason), reason }); }
}

function authorityFor(runtimeModules, fixture, packageIdentityHash, allowed = true) {
  return { async assertExact(request) {
    requireCondition(allowed && request.approved === true && request.packageIdentityHash === packageIdentityHash && request.operationIdentityHash === runtimeModules.action.IMPLEMENTATION_CONTRACT.writeOperation.operationIdentityHash && request.maximumWrites === 1, "exact authority revoked before network send");
    return { allowed: true, packageIdentityHash, operationIdentityHash: request.operationIdentityHash };
  } };
}

function adaptersFor({ fixture, reconstruction, runtimeModules, cluster, allowed = true, timeoutMs = 180, maximumResponseBytes }) {
  const packageIdentityHash = reconstruction.workPack.packageIdentityHash;
  const endpoints = cluster.endpoints();
  const actionResolver = createCustomerLocalSecretLeaseResolver({ secretClient: cluster.secretClient, alias: fixture.credentialAliases.action[0], plane: "action", packageIdentityHash });
  const observerResolver = createCustomerLocalSecretLeaseResolver({ secretClient: cluster.secretClient, alias: fixture.credentialAliases.observer[0], plane: "observer", packageIdentityHash });
  const actionTransport = createCustomerLocalActionProcessTransport({ endpoint: endpoints.action, writeOperation: runtimeModules.action.IMPLEMENTATION_CONTRACT.writeOperation, reconciliationOperation: runtimeModules.action.IMPLEMENTATION_CONTRACT.reconciliationOperation, sourceBaseUrl: runtimeModules.action.IMPLEMENTATION_CONTRACT.baseUrl ?? null, authenticationPlacement: authPlacement(fixture, "action"), timeoutMs, ...(maximumResponseBytes ? { maximumResponseBytes } : {}) });
  const observerTransport = createCustomerLocalObserverProcessTransport({ endpoint: endpoints.observer, operations: runtimeModules.observer.IMPLEMENTATION_CONTRACT.operations, authenticationPlacement: authPlacement(fixture, "observer"), timeoutMs, ...(maximumResponseBytes ? { maximumResponseBytes } : {}) });
  return {
    action: runtimeModules.action.createActionAdapter({ resolveCredentialLease: actionResolver, transport: actionTransport, authority: authorityFor(runtimeModules, fixture, packageIdentityHash, allowed), now: () => FIXED_NOW_MS }),
    observer: runtimeModules.observer.createObserverAdapter({ resolveCredentialLease: observerResolver, transport: observerTransport, now: () => FIXED_NOW_MS }),
    actionTransport,
    observerTransport,
  };
}

async function startAdversaryServer(responseIdentity) {
  const server = http.createServer((_req, res) => {
    const body = JSON.stringify(responseIdentity);
    res.writeHead(200, { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)), "x-das-server-identity": "0".repeat(64), "x-das-process-instance": "adversary" });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: server.address().port };
}

async function transportAttacks({ fixture, reconstruction, runtime, runtimeModules, cluster, fixtureRoot, otherRuntimeReceiptHash }) {
  const attacks = [];
  const packageIdentityHash = reconstruction.workPack.packageIdentityHash;
  const endpoints = cluster.endpoints();
  capture(attacks, "hostname-substitution", () => createCustomerLocalProcessEndpoint({ ...endpoints.action, host: "localhost" }), /127\.0\.0\.1|DNS|host substitution/i);
  capture(attacks, "tls-downgrade-claim", () => assertCustomerLocalProcessEndpoint({ ...endpoints.action, protocol: "https:", tls: true, tlsVerified: true }), /integrity|HTTP-local|TLS|protocol/i);
  capture(attacks, "same-process-observer-shortcut", () => createCustomerLocalProcessTransportReceipt({ packageIdentityHash, actionEndpoint: endpoints.action, observerEndpoint: { ...endpoints.action, role: "observer" }, secretEndpoint: endpoints.secret, actionAlias: fixture.credentialAliases.action[0], observerAlias: fixture.credentialAliases.observer[0], runtimeReceiptHash: runtime.receipt.receiptHash }), /integrity|separate|distinct|collapsed/i);
  capture(attacks, "cross-package-runtime-evidence", () => inspectCustomerLocalDeclarativeRuntime({ directory: runtime.root, expectedReceiptHash: otherRuntimeReceiptHash }), /another implementation|belongs/i);

  const adversary = await startAdversaryServer({ role: "action", packageIdentityHash });
  try {
    const substituted = createCustomerLocalProcessEndpoint({ role: "action", packageIdentityHash, serverIdentityHash: endpoints.action.serverIdentityHash, processInstanceId: "substituted-process", host: "127.0.0.1", port: adversary.port, revision: endpoints.action.revision + 1, pid: process.pid });
    await captureAsync(attacks, "port-and-server-identity-substitution", () => probeCustomerLocalProcessEndpoint({ endpoint: substituted }), /identity drifted|process|server/i);
  } finally { await new Promise((resolve) => adversary.server.close(resolve)); }

  const closed = await startAdversaryServer({ role: "action", packageIdentityHash });
  const closedPort = closed.port;
  await new Promise((resolve) => closed.server.close(resolve));
  const disconnectedEndpoint = createCustomerLocalProcessEndpoint({ role: "action", packageIdentityHash, serverIdentityHash: endpoints.action.serverIdentityHash, processInstanceId: "disconnected-process", host: "127.0.0.1", port: closedPort, revision: 1, pid: process.pid });
  const disconnectedTransport = createCustomerLocalActionProcessTransport({ endpoint: disconnectedEndpoint, writeOperation: runtimeModules.action.IMPLEMENTATION_CONTRACT.writeOperation, reconciliationOperation: runtimeModules.action.IMPLEMENTATION_CONTRACT.reconciliationOperation, sourceBaseUrl: runtimeModules.action.IMPLEMENTATION_CONTRACT.baseUrl ?? null, authenticationPlacement: authPlacement(fixture, "action"), timeoutMs: 100 });
  const disconnectedAdapter = runtimeModules.action.createActionAdapter({
    resolveCredentialLease: createCustomerLocalSecretLeaseResolver({ secretClient: cluster.secretClient, alias: fixture.credentialAliases.action[0], plane: "action", packageIdentityHash }),
    transport: disconnectedTransport,
    authority: authorityFor(runtimeModules, fixture, packageIdentityHash, true),
    now: () => FIXED_NOW_MS,
  });
  await captureAsync(attacks, "connection-failure", () => disconnectedAdapter.execute({ assignedWork: fixture.qualificationWorld.assignedWork, authorityContext: { approved: true } }), /response unavailable|fetch failed|connect/i);

  async function configureAttack(id, networkFault = null, delayMs = 0) {
    const stateFile = path.join(fixtureRoot, "attacks", `${id}.json`);
    initializeDAS028State({ stateFile, world: fixture.qualificationWorld });
    await cluster.configure({ controlId: "completed", assignedWork: fixture.qualificationWorld.assignedWork, stateFile, networkFault, delayMs });
    return stateFile;
  }

  await configureAttack("authority-revocation");
  const beforeAuthority = await cluster.stats();
  const denied = adaptersFor({ fixture, reconstruction, runtimeModules, cluster, allowed: false });
  await captureAsync(attacks, "pre-write-authority-revocation", () => denied.action.execute({ assignedWork: fixture.qualificationWorld.assignedWork, authorityContext: { approved: true } }), /authority revoked/i);
  const afterAuthority = await cluster.stats();
  requireCondition(afterAuthority.action.requestsReceived === beforeAuthority.action.requestsReceived, "Revoked authority reached the network process");

  await configureAttack("path-tool-widening");
  const exact = adaptersFor({ fixture, reconstruction, runtimeModules, cluster });
  const actionLease = await createCustomerLocalSecretLeaseResolver({ secretClient: cluster.secretClient, alias: fixture.credentialAliases.action[0], plane: "action", packageIdentityHash })({ alias: fixture.credentialAliases.action[0], plane: "action", packageIdentityHash });
  const badRequest = fixture.sourceKind === "openapi"
    ? { family: "openapi", method: "POST", baseUrl: runtimeModules.action.IMPLEMENTATION_CONTRACT.baseUrl, route: "/redirected", query: {}, headers: {}, body: {}, operationIdentityHash: runtimeModules.action.IMPLEMENTATION_CONTRACT.writeOperation.operationIdentityHash }
    : { family: "mcp-tools-list", serverId: "redirected-server", serverVersion: "0", toolsListHash: runtimeModules.action.IMPLEMENTATION_CONTRACT.writeOperation.toolsListHash, tool: "redirectedTool", inputSchemaHash: runtimeModules.action.IMPLEMENTATION_CONTRACT.writeOperation.operationIdentityHash, operationIdentityHash: runtimeModules.action.IMPLEMENTATION_CONTRACT.writeOperation.operationIdentityHash, arguments: {} };
  await captureAsync(attacks, "path-tool-redirect", () => exact.actionTransport.execute({ request: badRequest, lease: actionLease, authorityReceipt: { allowed: true, packageIdentityHash }, packageIdentityHash }), /route|method|server|tool|widened/i);

  const observerHandle = await cluster.secretClient.issueHandle({ alias: fixture.credentialAliases.observer[0], plane: "observer", packageIdentityHash });
  const unauthenticated = await fetch(`${endpoints.action.origin}/identity-protected`);
  requireCondition(unauthenticated.status === 401, "Missing authentication did not fail with 401");
  attacks.push({ id: "missing-authentication-401", passed: true, reason: "action process rejected a request without an opaque lease handle" });
  const unauthorized = await fetch(`${endpoints.action.origin}/identity-protected`, { headers: authPlacement(fixture, "action").kind === "api-key-header" ? { [authPlacement(fixture, "action").wireName]: observerHandle.handle } : { authorization: `DASLease ${observerHandle.handle}` } });
  requireCondition(unauthorized.status === 403, "Credential-alias swap did not fail with 403");
  attacks.push({ id: "credential-alias-swap-403", passed: true, reason: "observer-scoped handle rejected by action process" });

  for (const [id, fault, expected] of [
    ["malformed-response", "malformed-response", /malformed JSON/i],
    ["oversize-response", "oversize-response", /size ceiling|exceeds/i],
    ["conflicting-framing", "conflicting-framing", /response unavailable|fetch failed|conflicting/i],
  ]) {
    await configureAttack(id, fault);
    const adapter = adaptersFor({ fixture, reconstruction, runtimeModules, cluster, maximumResponseBytes: 32 * 1024 });
    await captureAsync(attacks, id, () => adapter.action.execute({ assignedWork: fixture.qualificationWorld.assignedWork, authorityContext: { approved: true } }), expected);
    requireCondition(cluster.stateSnapshot().businessWrites === 0, `${id} attack caused a write`);
  }

  await configureAttack("timeout-race", "delay-before-commit", 600);
  const timeoutAdapter = adaptersFor({ fixture, reconstruction, runtimeModules, cluster, timeoutMs: 80 });
  await captureAsync(attacks, "timeout-race-before-commit", () => timeoutAdapter.action.execute({ assignedWork: fixture.qualificationWorld.assignedWork, authorityContext: { approved: true } }), /timeout|response unavailable/i);
  await new Promise((resolve) => setTimeout(resolve, 650));
  requireCondition(cluster.stateSnapshot().businessWrites === 0, "Timeout race committed after the caller stopped waiting");

  await configureAttack("observer-malformed", "observer-malformed-response");
  const badObserver = adaptersFor({ fixture, reconstruction, runtimeModules, cluster });
  await captureAsync(attacks, "observer-malformed-response", () => badObserver.observer.observe({ phase: "after", assignedWork: fixture.qualificationWorld.assignedWork, observationNotBeforeMs: FIXED_NOW_MS, observerContractHash: "f".repeat(64) }), /malformed JSON/i);

  const implementationFile = path.join(runtime.root, "action-plugin", "index.js");
  const original = fs.readFileSync(implementationFile, "utf8");
  fs.appendFileSync(implementationFile, "\n// DAS-028 mutation attack\n");
  capture(attacks, "implementation-mutation", () => inspectCustomerLocalDeclarativeRuntime({ directory: runtime.root, expectedReceiptHash: runtime.receipt.receiptHash }), /implementation changed|identity changed/i);
  fs.writeFileSync(implementationFile, original, { mode: 0o600 });
  inspectCustomerLocalDeclarativeRuntime({ directory: runtime.root, expectedReceiptHash: runtime.receipt.receiptHash });

  const evidenceText = JSON.stringify({ runtime: runtime.receipt, process: cluster.receipt(), stats: await cluster.stats() });
  requireCondition(!evidenceText.includes("daslh_") && !/(password|secretValue|apiKeyValue)/i.test(evidenceText), "Secret value or opaque handle leaked into durable evidence");
  attacks.push({ id: "credential-value-and-handle-leak", passed: true, reason: "durable evidence contains aliases and hashes only" });
  requireCondition(attacks.every((attack) => attack.passed), `${fixture.id} attacks failed: ${JSON.stringify(attacks.filter((attack) => !attack.passed))}`);
  return attacks;
}

export async function runDAS028Rehearsal({ outputRoot = OUTPUT_ROOT } = {}) {
  const started = performance.now();
  requireCondition(!fs.existsSync(outputRoot), "DAS-028 rehearsal refuses to overwrite existing artifacts");
  fs.mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(outputRoot, 0o700);
  const prepared = [];
  for (const fixture of DAS028_FRESH_FIXTURES) {
    const fixtureRoot = path.join(outputRoot, fixture.id);
    fs.mkdirSync(fixtureRoot, { mode: 0o700 });
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), `das028-${fixture.sourceKind}-`));
    try {
      const reconstruction = reconstruct(fixture, temporary);
      const runtime = writeCustomerLocalDeclarativeRuntime({ directory: path.join(fixtureRoot, "compiled-runtime"), draftSession: reconstruction.completed, packageInputDraft: reconstruction.packageInputDraft, generatedPackage: reconstruction.generatedPackage, scaffoldPlan: reconstruction.scaffold.plan, scaffoldReceipt: reconstruction.scaffold.receipt, workPack: reconstruction.workPack, actionSource: fixture.actionSource, observerSource: fixture.observerSource, executionProfile: reconstruction.executionProfile });
      const runtimeModules = await importCompiledRuntime(runtime);
      prepared.push({ fixture, fixtureRoot, reconstruction, runtime, runtimeModules });
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }

  const runs = [];
  for (let index = 0; index < prepared.length; index += 1) {
    const current = prepared[index];
    const { fixture, fixtureRoot, reconstruction, runtime, runtimeModules } = current;
    const packageIdentityHash = reconstruction.workPack.packageIdentityHash;
    const cluster = await startDAS028ProcessCluster({
      packageIdentityHash,
      runtimeReceiptHash: runtime.receipt.receiptHash,
      sourceHash: digest({ action: reconstruction.completed.sources.action.sourceHash, observer: reconstruction.completed.sources.observer.sourceHash }),
      roleHash: digest(fixture.businessIntake),
      actionContract: runtimeModules.action.IMPLEMENTATION_CONTRACT,
      observerContract: runtimeModules.observer.IMPLEMENTATION_CONTRACT,
      actionAlias: fixture.credentialAliases.action[0],
      observerAlias: fixture.credentialAliases.observer[0],
      actionAuthenticationPlacement: authPlacement(fixture, "action"),
      observerAuthenticationPlacement: authPlacement(fixture, "observer"),
      world: fixture.qualificationWorld,
    });
    try {
      const initialProcessReceipt = cluster.receipt();
      const qualification = await runQualification({ fixture, reconstruction, runtime, runtimeModules, cluster, fixtureRoot });
      const postQualificationProcessReceipt = cluster.receipt();
      const attacks = await transportAttacks({ fixture, reconstruction, runtime, runtimeModules, cluster, fixtureRoot, otherRuntimeReceiptHash: prepared[(index + 1) % prepared.length].runtime.receipt.receiptHash });
      const packaging = packageNonactivating({ fixture, reconstruction, runtime, qualification, processReceipt: postQualificationProcessReceipt, directory: path.join(fixtureRoot, "nonactivating-bundle") });
      const aggregate = qualificationAggregate(qualification.qualification.qualificationReceipt);
      const processStats = await cluster.stats();
      const lost = qualification.qualification.qualificationReceipt.cases.find((entry) => entry.id === "lost-response");
      requireCondition(lost.businessWrites === 1 && lost.restartedAfterLostResponse === true && aggregate.lostResponseReplays === 0, "DAS-028 lost-response recovery replayed or did not restart");
      const result = {
        fixtureId: fixture.id,
        sourceKind: fixture.sourceKind,
        identities: {
          das024DraftHash: reconstruction.packageInputDraft.draftHash,
          das023PackageReceiptHash: reconstruction.generatedPackage.receipt.receiptHash,
          das026WorkPackHash: reconstruction.workPack.workPackHash,
          das027RuntimeReceiptHash: runtime.receipt.receiptHash,
          actionImplementationContentHash: runtime.receipt.actionImplementationContentHash,
          observerImplementationContentHash: runtime.receipt.observerImplementationContentHash,
          das028InitialProcessReceiptHash: initialProcessReceipt.receiptHash,
          das028PostRestartProcessReceiptHash: postQualificationProcessReceipt.receiptHash,
          qualificationReceiptHash: qualification.qualification.qualificationReceipt.receiptHash,
          acceptanceOnlyReceiptHash: qualification.acceptance.receiptHash,
          nonactivatingBundleHash: packaging.plan.bundle.bundleHash,
        },
        processBoundary: {
          processCount: 3,
          actionObserverSecretDistinct: true,
          actionObserverCredentialsDistinct: true,
          processRestarts: processStats.restarts,
          initialPortsDistinct: initialProcessReceipt.distinctPorts,
          protocol: "http-local-only",
          tls: false,
          redirectsAllowed: false,
          credentialValuesPresent: false,
          opaqueHandlesPersisted: false,
        },
        implementation: runtime.plan.measurements,
        qualification: { controlsPassed: qualification.qualification.qualificationReceipt.controlsPassed, controlsRequired: qualification.qualification.qualificationReceipt.controlsRequired, ...aggregate },
        packaging: { packageIntegrityValid: packaging.diagnostics.packageIntegrityValid, readyForNonactivatingHandoff: packaging.diagnostics.readyForNonactivatingHandoff, customerExecutionReady: false, activationReady: false },
        attacks,
        modelCalls: 0,
        spendUsd: 0,
        customerDataUsed: false,
        externalNetworkUsed: false,
        customerExecutionReady: false,
        activationReady: false,
        evidenceBoundary: "Fresh fictional customer-shaped localhost processes only. This is HTTP-local transport evidence, not TLS, OS isolation, a real provider, customer acceptance, deployment, production reliability or activation.",
      };
      result.resultHash = digest(result);
      runs.push(result);
      writePrivate(path.join(fixtureRoot, "fixture-result.json"), result);
    } finally { await cluster.close(); }
  }

  const report = {
    schemaVersion: "das.das028-customer-shaped-local-process-report.v1",
    preregistration: "reports/0107-das028-customer-shaped-local-process-transport-preregistration.md",
    sourceManifest: sourceManifest(),
    freshFixtureIds: DAS028_FRESH_FIXTURES.map((fixture) => fixture.id),
    runs,
    aggregate: {
      packages: runs.length,
      sourceFamilies: runs.map((run) => run.sourceKind),
      customerShapedProcessesPerPackage: 3,
      generatedExecutableFiles: runs.reduce((sum, run) => sum + run.implementation.generatedExecutableFiles, 0),
      generatedExecutableLines: runs.reduce((sum, run) => sum + run.implementation.generatedExecutableLines, 0),
      controlsPassed: runs.reduce((sum, run) => sum + run.qualification.controlsPassed, 0),
      controlsRequired: runs.reduce((sum, run) => sum + run.qualification.controlsRequired, 0),
      processRestarts: runs.reduce((sum, run) => sum + run.processBoundary.processRestarts, 0),
      freshProcessLostResponseRecoveries: runs.reduce((sum, run) => sum + run.qualification.freshProcessLostResponseRecoveries, 0),
      lostResponseReplays: runs.reduce((sum, run) => sum + run.qualification.lostResponseReplays, 0),
      observerWrites: runs.reduce((sum, run) => sum + run.qualification.observerWrites, 0),
      incorrectEffects: runs.reduce((sum, run) => sum + run.qualification.incorrectEffects, 0),
      attacksPassed: runs.reduce((sum, run) => sum + run.attacks.filter((attack) => attack.passed).length, 0),
      attacksRequired: runs.reduce((sum, run) => sum + run.attacks.length, 0),
      signedNonactivatingBundles: runs.filter((run) => run.packaging.packageIntegrityValid && run.packaging.activationReady === false).length,
      customerExecutableOperations: 0,
      modelCalls: 0,
      spendUsd: 0,
      activeMachineMs: Math.round((performance.now() - started) * 1000) / 1000,
    },
    verdict: "passed-bounded-customer-shaped-local-process-transport",
    strongestAccurateFinding: "Within a strict declarative subset, one fresh OpenAPI package and one fresh pinned-MCP package ran generated action and independent observer modules over separately started authenticated localhost processes with a third secret process. Both passed the unchanged ten-control qualification; post-commit response loss recovered after real process replacement with one write and no replay; signed bundles remained nonactivating.",
    remainingBlockers: ["No real customer/provider process or data", "No TLS or hostile-OS isolation claim", "No arbitrary nested schema, custom authentication, streaming or custom transform support", "No customer acceptance, production reliability, deployment or activation"],
    evidenceBoundary: "Private fictional local zero-spend evidence only. It does not establish customer execution, self-serve onboarding, arbitrary provider support, production security/reliability, demand, deployment or activation.",
  };
  report.resultHash = digest(report);
  writePrivate(path.join(outputRoot, "result.json"), report);
  const summary = { schemaVersion: "das.das028-summary.v1", resultHash: report.resultHash, verdict: report.verdict, aggregate: report.aggregate, evidenceBoundary: report.evidenceBoundary };
  summary.summaryHash = digest(summary);
  writePrivate(path.join(outputRoot, "summary.json"), summary);
  return Object.freeze(report);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runDAS028Rehearsal().then((report) => process.stdout.write(`${JSON.stringify({ verdict: report.verdict, resultHash: report.resultHash, aggregate: report.aggregate }, null, 2)}\n`)).catch((error) => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });
}
