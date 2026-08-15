import crypto from "node:crypto";
import fs from "node:fs";
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
import {
  assertCustomerLocalAcceptanceOnly,
  createCustomerLocalQualificationHarnessContract,
  sealCustomerLocalAcceptanceOnly,
} from "../../product/customer-local-binding-qualification.js";
import { runCustomerLocalQualificationRuntimeBridge } from "../../product/customer-local-qualification-runtime-bridge.js";
import { writeCustomerLocalBindingPluginScaffold } from "../../product/customer-local-binding-plugin-scaffold.js";
import { createCustomerLocalTransportImplementationWorkPack } from "../../product/customer-local-transport-implementation-assistance.js";
import {
  createCustomerLocalDeclarativeRuntimePlan,
  createDeclarativeRuntimeExecutionProfile,
  inspectCustomerLocalDeclarativeRuntime,
  writeCustomerLocalDeclarativeRuntime,
} from "../../product/customer-local-declarative-runtime-compiler.js";
import {
  createNonactivatingDeploymentBundlePlan,
  inspectNonactivatingDeploymentBundle,
  writeNonactivatingDeploymentBundle,
} from "../../product/nonactivating-deployment-bundle.js";
import { prepareDAS024QualificationBinding } from "../das024-authoring/qualification-harness.js";
import { DAS027_FRESH_FIXTURES } from "./fixtures.js";

const OUTPUT_ROOT = path.resolve("artifacts/onboarding/das027-declarative-runtime-v1");
const FIXED_NOW_MS = 1_000;
const FIXED_ISO = "2026-08-14T18:00:00.000Z";
const VALID_UNTIL = "2026-08-15T18:00:00.000Z";
const FROZEN_SOURCE_FILES = Object.freeze([
  "reports/0105-das027-declarative-runtime-compiler-preregistration.md",
  "src/product/customer-local-declarative-runtime-compiler.js",
  "src/product/customer-local-transport-implementation-assistance.js",
  "src/product/customer-local-binding-package-factory.js",
  "src/product/customer-local-binding-plugin-scaffold.js",
  "src/product/customer-local-binding-qualification.js",
  "src/product/customer-local-qualification-runtime-bridge.js",
  "src/product/nonactivating-deployment-bundle.js",
  "src/experiments/das024-authoring/qualification-harness.js",
  "src/experiments/das027-declarative-runtime/fixtures.js",
  "src/experiments/das027-declarative-runtime/rehearsal.js",
]);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

function sealed(value, hashKey) {
  const record = structuredClone(value);
  record[hashKey] = digest(record);
  return record;
}

function rawSha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function writePrivate(file, value) {
  fs.writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.chmodSync(file, 0o600);
}

function sourceManifest() {
  return FROZEN_SOURCE_FILES.map((relative) => ({ relative, sha256: rawSha256(fs.readFileSync(path.resolve(relative))) }));
}

function reconstruct(fixture, stateRoot) {
  const initial = createSourceGroundedBindingDraftSession({
    sessionId: fixture.id,
    businessIntake: structuredClone(fixture.businessIntake),
    actionSource: structuredClone(fixture.actionSource),
    observerSource: structuredClone(fixture.observerSource),
    credentialAliases: structuredClone(fixture.credentialAliases),
  });
  const completed = applySourceGroundedBindingDraftAnswers({
    session: initial,
    expectedSessionHash: initial.sessionHash,
    answers: structuredClone(fixture.answers),
    suppliedBy: { owner: fixture.answers.ownerReviewer, engineer: fixture.answers.engineerReviewer },
  });
  requireCondition(completed.status === "complete-non-executable-package-input-draft", `${fixture.id} did not complete the exact reviewed DAS-024 draft`);
  const credentialRefs = fixture.sourceKind === "openapi"
    ? Object.fromEntries(Object.keys(fixture.actionSource.document.components?.securitySchemes ?? {}).map((schemeName) => [schemeName, fixture.credentialAliases.action[0]]))
    : {};
  const prepared = prepareDAS024QualificationBinding({ fixture, stateDirectory: path.join(stateRoot, "reviewed-binding"), credentialRefs });
  const packageInputDraft = materializeSourceGroundedBindingPackageInputs({ session: completed, structuralBinding: prepared.structuralBinding, workPlan: prepared.workPlan });
  const generatedPackage = createCustomerLocalBindingPackage({
    structuralBinding: prepared.structuralBinding,
    workPlan: prepared.workPlan,
    sourceIdentity: packageInputDraft.sourceIdentity,
    actionRuntime: packageInputDraft.actionRuntime,
    writeSafety: packageInputDraft.writeSafety,
    observerProof: packageInputDraft.observerProof,
  });
  const scaffold = writeCustomerLocalBindingPluginScaffold({ directory: path.join(stateRoot, "das025-project"), packageInputDraft, generatedPackage });
  const workPack = createCustomerLocalTransportImplementationWorkPack({
    draftSession: completed,
    packageInputDraft,
    generatedPackage,
    scaffoldPlan: scaffold.plan,
    scaffoldReceipt: scaffold.receipt,
  });
  const executionProfile = createDeclarativeRuntimeExecutionProfile({
    workPack,
    ownerConfirmedBy: fixture.answers.ownerReviewer,
    engineerConfirmedBy: fixture.answers.engineerReviewer,
    timeoutMs: 2_000,
    maximumRequestsPerMinute: 60,
  });
  return { initial, completed, prepared, packageInputDraft, generatedPackage, scaffold, workPack, executionProfile };
}

async function importCompiledRuntime(runtime) {
  inspectCustomerLocalDeclarativeRuntime({ directory: runtime.root, expectedReceiptHash: runtime.receipt.receiptHash });
  const action = await import(`${pathToFileURL(path.join(runtime.root, "action-plugin", "index.js")).href}?v=${runtime.receipt.actionImplementationContentHash}`);
  const observer = await import(`${pathToFileURL(path.join(runtime.root, "observer-plugin", "index.js")).href}?v=${runtime.receipt.observerImplementationContentHash}`);
  requireCondition(typeof action.createActionAdapter === "function" && typeof observer.createObserverAdapter === "function", "DAS-027 generated modules do not expose the exact adapter factories");
  return { action, observer };
}

function qualificationPackage(reconstruction, runtime) {
  const actionRuntime = structuredClone(reconstruction.packageInputDraft.actionRuntime);
  actionRuntime.implementationHash = runtime.receipt.actionImplementationContentHash;
  const observerProof = structuredClone(reconstruction.packageInputDraft.observerProof);
  observerProof.runtime.implementationHash = runtime.receipt.observerImplementationContentHash;
  return createCustomerLocalBindingPackage({
    structuralBinding: reconstruction.prepared.structuralBinding,
    workPlan: reconstruction.prepared.workPlan,
    sourceIdentity: reconstruction.packageInputDraft.sourceIdentity,
    actionRuntime,
    writeSafety: reconstruction.packageInputDraft.writeSafety,
    observerProof,
  });
}

function qualificationAggregate(receipt) {
  return {
    businessWrites: receipt.cases.reduce((sum, item) => sum + item.businessWrites, 0),
    observerWrites: receipt.cases.reduce((sum, item) => sum + item.observerWrites, 0),
    blindRetries: 0,
    lostResponseFreshRuntimeReattachments: receipt.cases.filter((item) => item.restartedAfterLostResponse).length,
    lostResponseReplays: receipt.cases.filter((item) => item.id === "lost-response" && item.businessWrites > 1).length,
    unexpectedIncorrectEffects: receipt.cases.filter((item) => !item.passed || item.observerWrites !== 0 || item.businessWrites > item.maximumBusinessWrites).length,
  };
}

function exactBoundary(candidate, plane, packageIdentityHash) {
  if (plane === "action") return Object.freeze({
    bindingId: candidate.action.bindingId,
    surfaceId: candidate.action.surfaceId,
    implementationHash: candidate.action.implementationHash,
    sourceHash: candidate.action.sourceHash,
    runtimeSchemaHash: candidate.action.runtimeSchemaHash,
    transportIdentityHash: candidate.action.transportIdentityHash,
    credentialAlias: candidate.action.credentialAliases[0],
    principalId: `das027-action-${packageIdentityHash.slice(0, 16)}`,
    qualificationAuthorityActions: candidate.action.operations.filter((operation) => operation.mode === "write").map((operation) => operation.authorityAction).sort(),
    productionAuthorityGranted: false,
  });
  return Object.freeze({
    observerId: candidate.observer.observerId,
    surfaceId: candidate.observer.surfaceId,
    implementationHash: candidate.observer.implementationHash,
    sourceHash: candidate.observer.sourceHash,
    runtimeSchemaHash: candidate.observer.runtimeSchemaHash,
    transportIdentityHash: candidate.observer.transportIdentityHash,
    credentialAlias: candidate.observer.credentialAliases[0],
    principalId: `das027-observer-${packageIdentityHash.slice(0, 16)}`,
    readOnly: true,
    writeOperations: [],
    productionAuthorityGranted: false,
  });
}

function testCredentialResolver({ alias, plane, packageIdentityHash, secretValue, audit }) {
  return async (request) => {
    requireCondition(request.alias === alias && request.plane === plane && request.packageIdentityHash === packageIdentityHash, `${plane} resolver rejected an alias/package widening`);
    audit.push({ type: "credential-lease-issued", alias, plane, packageIdentityHash });
    return Object.freeze({
      alias,
      plane,
      packageIdentityHash,
      persistable: false,
      loggable: false,
      async use(operation) {
        requireCondition(typeof operation === "function", "Credential lease requires one bounded use callback");
        return operation(secretValue);
      },
    });
  };
}

function compiledDriverFactory({ fixture, runtimeModules, runtime, qualificationPackage: boundPackage, packageIdentityHash }) {
  return async function driverFactory({ testCase, candidate, observerContract, harnessContract, bridgeContract }) {
    requireCondition(candidate.candidateHash === boundPackage.candidate.candidateHash && observerContract.contractHash === boundPackage.observerContract.contractHash, "DAS-027 driver received another candidate or observer contract");
    const durable = {
      records: [],
      businessWrites: 0,
      observerWrites: 0,
      unrelatedStateDigest: fixture.qualificationWorld.protectedStateDigest,
      additionalChanges: [],
      restartSequence: 0,
      eventSequence: 0,
      lastEvent: null,
      audit: [],
    };
    const storageIdentityHash = digest({ packageIdentityHash, controlId: testCase.id, store: "das027-disposable-customer-local-v1" });
    const actionBoundary = exactBoundary(candidate, "action", packageIdentityHash);
    const observerBoundary = exactBoundary(candidate, "observer", packageIdentityHash);
    const actionSecret = `local-action-lease-${packageIdentityHash.slice(0, 20)}`;
    const observerSecret = `local-observer-lease-${packageIdentityHash.slice(0, 20)}`;

    function build(processInstanceId) {
      const actionResolver = testCredentialResolver({ alias: actionBoundary.credentialAlias, plane: "action", packageIdentityHash, secretValue: actionSecret, audit: durable.audit });
      const observerResolver = testCredentialResolver({ alias: observerBoundary.credentialAlias, plane: "observer", packageIdentityHash, secretValue: observerSecret, audit: durable.audit });
      const authority = {
        async assertExact(request) {
          const expectedAction = actionBoundary.qualificationAuthorityActions[0];
          requireCondition(request.requiredAuthorityAction === expectedAction && request.packageIdentityHash === packageIdentityHash, "DAS-027 exact authority action/package mismatch");
          requireCondition(request.operationIdentityHash === runtimeModules.action.IMPLEMENTATION_CONTRACT.writeOperation.operationIdentityHash && request.maximumWrites === 1, "DAS-027 authority widened operation or write ceiling");
          requireCondition(request.authorityAction === expectedAction && request.roleId === fixture.id && request.approved === true, "DAS-027 disposable authority context is absent or wider than the exact role");
          durable.eventSequence += 1;
          durable.lastEvent = { type: "authority", sequence: durable.eventSequence, operationIdentityHash: request.operationIdentityHash };
          return { allowed: true, packageIdentityHash, operationIdentityHash: request.operationIdentityHash, authorityReceiptHash: digest({ packageIdentityHash, request, sequence: durable.eventSequence }) };
        },
      };
      const actionTransport = {
        async execute({ request, lease, authorityReceipt, packageIdentityHash: requestPackage }) {
          requireCondition(requestPackage === packageIdentityHash && authorityReceipt?.allowed === true, "DAS-027 action transport lacks exact authority receipt");
          requireCondition(durable.lastEvent?.type === "authority" && durable.lastEvent.operationIdentityHash === runtimeModules.action.IMPLEMENTATION_CONTRACT.writeOperation.operationIdentityHash, "DAS-027 authority hook was not immediately before transport");
          await lease.use((secret) => requireCondition(secret === actionSecret, "DAS-027 action lease value mismatch"));
          const expected = runtimeModules.action.IMPLEMENTATION_CONTRACT.writeOperation;
          if (expected.family === "openapi") {
            requireCondition(request.family === "openapi" && request.method === expected.method && request.operationIdentityHash === expected.operationIdentityHash, "DAS-027 OpenAPI method/operation widened");
            const expectedRoute = expected.parameters
              .filter((parameter) => parameter.in === "path")
              .reduce((route, parameter) => route.replace(`{${parameter.name}}`, encodeURIComponent(String(testCase.payload.assignedWork[parameter.name]))), expected.route);
            requireCondition(!/[{}]/.test(expectedRoute) && request.route === expectedRoute, "DAS-027 OpenAPI endpoint widened");
          } else {
            requireCondition(request.family === "mcp-tools-list" && request.serverId === expected.serverId && request.serverVersion === expected.serverVersion && request.tool === expected.operationName && request.inputSchemaHash === expected.operationIdentityHash, "DAS-027 MCP server/tool/schema widened");
          }
          durable.eventSequence += 1;
          durable.lastEvent = { type: "transport", sequence: durable.eventSequence };
          if (["not-started", "unknown", "unavailable"].includes(testCase.id)) return { status: "accepted-no-commit", transportAttemptId: digest({ packageIdentityHash, control: testCase.id }), responseShapeHash: digest(null) };
          const assigned = structuredClone(testCase.payload.assignedWork);
          const record = { ...assigned, [fixture.qualificationWorld.resultIdentityField]: `${packageIdentityHash.slice(0, 12)}-result-1`, [fixture.qualificationWorld.statusField]: fixture.qualificationWorld.completionStatus };
          if (testCase.id === "partial") delete record[fixture.qualificationWorld.partialField];
          if (testCase.id === "incorrect") record[fixture.qualificationWorld.incorrectField] = structuredClone(fixture.qualificationWorld.incorrectValue);
          durable.records.push(record);
          durable.businessWrites += 1;
          if (testCase.id === "duplicate") {
            durable.records.push({ ...record, [fixture.qualificationWorld.resultIdentityField]: `${packageIdentityHash.slice(0, 12)}-result-2` });
            durable.businessWrites += 1;
          }
          if (testCase.id === "collateral") {
            durable.unrelatedStateDigest = `${fixture.qualificationWorld.protectedStateDigest}:mutated`;
            durable.additionalChanges.push({ kind: "protected-unrelated-state", id: `protected-${packageIdentityHash.slice(0, 12)}` });
          }
          if (testCase.id === "lost-response") {
            const error = new Error("simulated response lost after exact durable commit");
            error.responseLost = true;
            throw error;
          }
          return { status: "created", transportAttemptId: digest({ packageIdentityHash, control: testCase.id }), responseShapeHash: digest({ created: true }) };
        },
        async read({ request, lease, packageIdentityHash: requestPackage }) {
          requireCondition(requestPackage === packageIdentityHash, "DAS-027 reconciliation crossed package identity");
          await lease.use((secret) => requireCondition(secret === actionSecret, "DAS-027 reconciliation lease mismatch"));
          return { matches: structuredClone(durable.records), requestHash: digest(request), proof: false };
        },
      };
      const observerTransport = {
        async observe({ phase, lease, packageIdentityHash: requestPackage }) {
          requireCondition(requestPackage === packageIdentityHash, "DAS-027 observer crossed package identity");
          await lease.use((secret) => requireCondition(secret === observerSecret, "DAS-027 observer lease mismatch"));
          if (phase === "after" && testCase.id === "unavailable") return { availability: "unavailable", reason: "fictional-independent-observer-unavailable" };
          if (phase === "after" && testCase.id === "unknown") return { availability: "unknown", reason: "fictional-independent-observer-could-not-establish-state" };
          const observedAt = phase === "after" && testCase.id === "stale" ? 900 : FIXED_NOW_MS;
          return {
            snapshotGeneratedAt: observedAt,
            caughtUpThrough: observedAt,
            matches: phase === "before" ? [] : structuredClone(durable.records),
            changedEntities: phase === "before" ? [] : [
              ...durable.records.map((record) => ({ kind: fixture.qualificationWorld.allowedChangedEntityKind, id: record[fixture.qualificationWorld.resultIdentityField] })),
              ...structuredClone(durable.additionalChanges),
            ],
            unrelatedStateDigest: phase === "before" ? fixture.qualificationWorld.protectedStateDigest : durable.unrelatedStateDigest,
          };
        },
      };
      const actionAdapter = runtimeModules.action.createActionAdapter({ resolveCredentialLease: actionResolver, transport: actionTransport, authority, now: () => FIXED_NOW_MS });
      const observerAdapter = runtimeModules.observer.createObserverAdapter({ resolveCredentialLease: observerResolver, transport: observerTransport, now: () => FIXED_NOW_MS });
      const driver = {
        schemaVersion: "das.customer-local-qualification-world-driver.v1",
        packageIdentityHash,
        bridgeContractHash: bridgeContract.contractHash,
        harnessContractHash: harnessContract.contractHash,
        harnessIdentityHash: harnessContract.worldImplementationHash,
        persistentStoreSchemaHash: harnessContract.persistentStoreSchemaHash,
        controlId: testCase.id,
        storageIdentityHash,
        processInstanceId,
        action: actionBoundary,
        observer: observerBoundary,
        async execute({ assignedWork, fault, controlId }) {
          requireCondition(controlId === testCase.id && fault?.kind === testCase.id && digest(assignedWork) === digest(testCase.payload.assignedWork), "DAS-027 execute input changed after freeze");
          return actionAdapter.execute({ assignedWork, authorityContext: { roleId: fixture.id, authorityAction: actionBoundary.qualificationAuthorityActions[0], approved: true } });
        },
        async observe({ phase, observerContractHash, controlId, observationNotBeforeMs }) {
          requireCondition(controlId === testCase.id && observerContractHash === observerContract.contractHash, "DAS-027 observer input crossed the qualification contract");
          return observerAdapter.observe({ phase, assignedWork: testCase.payload.assignedWork, observationNotBeforeMs, observerContractHash });
        },
        snapshot() { return { records: structuredClone(durable.records), businessWrites: durable.businessWrites, observerWrites: durable.observerWrites, unrelatedStateDigest: durable.unrelatedStateDigest, additionalChanges: structuredClone(durable.additionalChanges), eventSequence: durable.eventSequence }; },
        businessWrites() { return durable.businessWrites; },
        observerWrites() { return durable.observerWrites; },
        async restart({ testCase: restartedCase, candidate: restartedCandidate, observerContract: restartedObserver, harnessContract: restartedHarness, packageIdentityHash: restartedPackage, bridgeContract: restartedBridge }) {
          requireCondition(restartedPackage === packageIdentityHash && restartedCase.id === testCase.id && restartedCandidate.candidateHash === candidate.candidateHash && restartedObserver.contractHash === observerContract.contractHash && restartedHarness.contractHash === harnessContract.contractHash && restartedBridge.contractHash === bridgeContract.contractHash, "DAS-027 restart changed a frozen identity");
          durable.restartSequence += 1;
          return build(`${fixture.id}:${testCase.id}:fresh-${durable.restartSequence}`);
        },
      };
      return Object.freeze(driver);
    }
    return build(`${fixture.id}:${testCase.id}:original`);
  };
}

async function runQualification({ fixture, reconstruction, runtime, runtimeModules }) {
  const boundPackage = qualificationPackage(reconstruction, runtime);
  const packageIdentityHash = reconstruction.workPack.packageIdentityHash;
  const harnessContract = createCustomerLocalQualificationHarnessContract({
    harnessId: `${fixture.id}:das027-compiled-runtime-qualification-v1`,
    worldImplementationHash: digest({ runtimeImplementationHash: runtime.plan.implementationIdentity.implementationHash, driver: "das027-compiled-disposable-driver-v1", packageIdentityHash }),
    persistentStoreSchemaHash: digest({ schema: "das027-compiled-disposable-store-v1", packageIdentityHash }),
    authenticationAuthorityHash: digest({ authority: "das027-separate-boundary-challenge-v1", packageIdentityHash }),
    observerEvidenceSchemaHash: digest({ evidence: "das027-generated-observer-mapping-v1", observerImplementationContentHash: runtime.receipt.observerImplementationContentHash, packageIdentityHash }),
  });
  const qualification = await runCustomerLocalQualificationRuntimeBridge({
    candidate: boundPackage.candidate,
    observerContract: boundPackage.observerContract,
    harnessContract,
    packageIdentityHash,
    assignedWork: fixture.qualificationWorld.assignedWork,
    driverFactory: compiledDriverFactory({ fixture, runtimeModules, runtime, qualificationPackage: boundPackage, packageIdentityHash }),
    now: () => FIXED_NOW_MS,
  });
  requireCondition(qualification.qualificationReceipt.qualificationPassed === true && qualification.qualificationReceipt.controlsPassed === 10, `${fixture.id} compiled candidate failed unchanged DAS-023 qualification`);
  const acceptance = sealCustomerLocalAcceptanceOnly({ qualificationReceipt: qualification.qualificationReceipt, candidate: boundPackage.candidate, observerContract: boundPackage.observerContract, caseContract: qualification.caseContract, harnessContract });
  assertCustomerLocalAcceptanceOnly({ receipt: acceptance, qualificationReceipt: qualification.qualificationReceipt, candidate: boundPackage.candidate, observerContract: boundPackage.observerContract, caseContract: qualification.caseContract, harnessContract });
  return { boundPackage, packageIdentityHash, harnessContract, qualification, acceptance };
}

function packagingInputs({ fixture, reconstruction, runtime, qualification }) {
  const tenantId = `fictional-${fixture.id}-tenant`;
  const roleId = `${fixture.id}-specialist`;
  const roleRevision = 1;
  const sourcePairHash = digest({ actionSourceHash: reconstruction.completed.sources.action.sourceHash, observerSourceHash: reconstruction.completed.sources.observer.sourceHash });
  const roleContract = sealed({
    schemaVersion: "das.customer-local-role-contract.v1",
    tenantId,
    roleId,
    revision: roleRevision,
    sourceIdentity: { kind: fixture.sourceKind, sourceHash: sourcePairHash },
    outcome: fixture.businessIntake.roleOutcome,
    authority: { allowed: [...fixture.answers.authority], approvalRequired: [...fixture.answers.approvals], forbidden: [...fixture.answers.forbiddenActions] },
    authorizations: { customerExecution: false, modelSpend: false, activation: false },
  }, "contractHash");
  const specialist = sealed({
    schemaVersion: "das.nonactivating-specialist.v1",
    tenantId,
    roleId,
    roleRevision,
    specialistId: `synthetic-provisional-${fixture.id}`,
    status: "synthetic-provisional",
    candidateFingerprint: qualification.boundPackage.candidate.candidateHash,
    selectionEvidence: null,
    bindingPackageReceiptHash: qualification.boundPackage.receipt.receiptHash,
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
    sourceHash: sourcePairHash,
    draftHash: reconstruction.packageInputDraft.draftHash,
    packageReceiptHash: qualification.boundPackage.receipt.receiptHash,
    planHash: runtime.plan.planHash,
    scaffoldReceiptHash: runtime.receipt.receiptHash,
    generatedProjectHash: runtime.plan.implementationIdentity.implementationHash,
    action: { projectIdentity: runtime.receipt.actionImplementationContentHash, authenticationIdentity: reconstruction.packageInputDraft.actionRuntime.authenticationIdentityHash },
    observer: { projectIdentity: runtime.receipt.observerImplementationContentHash, authenticationIdentity: reconstruction.packageInputDraft.observerProof.runtime.authenticationIdentityHash, readOnly: true, writeOperations: [] },
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
    packageReceiptHash: qualification.boundPackage.receipt.receiptHash,
    generatedProjectHash: runtime.plan.implementationIdentity.implementationHash,
    actionImplementationIntentHash: reconstruction.scaffold.plan.actionContract.implementationIntentHash,
    actionImplementationContentHash: runtime.receipt.actionImplementationContentHash,
    observerImplementationIntentHash: reconstruction.scaffold.plan.observerContract.implementationIntentHash,
    observerImplementationContentHash: runtime.receipt.observerImplementationContentHash,
    conformanceReceiptHash: qualification.qualification.qualificationReceipt.receiptHash,
    scope: "fictional-disposable-local",
    customerEnvironmentImplemented: false,
    customerExecutableOperations: 0,
  }, "identityHash");
  const aggregate = qualificationAggregate(qualification.qualification.qualificationReceipt);
  const conformanceEvidence = sealed({
    schemaVersion: "das.nonactivating-conformance-evidence.v1",
    tenantId,
    roleId,
    roleRevision,
    specialistHash: specialist.specialistHash,
    packageReceiptHash: qualification.boundPackage.receipt.receiptHash,
    conformanceReceiptHash: qualification.qualification.qualificationReceipt.receiptHash,
    sourceArtifact: { path: `das027:${fixture.id}`, sha256: rawSha256(JSON.stringify(runtime.receipt)), summaryHash: runtime.plan.planHash, resultHash: qualification.qualification.resultHash },
    scope: "fictional-disposable-local",
    observedAt: FIXED_ISO,
    validUntil: VALID_UNTIL,
    controlsPassed: qualification.qualification.qualificationReceipt.controlsPassed,
    controlsRequired: qualification.qualification.qualificationReceipt.controlsRequired,
    observerWrites: aggregate.observerWrites,
    lostResponseReplays: aggregate.lostResponseReplays,
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
    packageReceiptHash: qualification.boundPackage.receipt.receiptHash,
    action: { sourceIdentity: reconstruction.completed.sources.action.sourceHash, authenticationIdentity: reconstruction.packageInputDraft.actionRuntime.authenticationIdentityHash, credentialAlias: fixture.credentialAliases.action[0], implementationContentHash: runtime.receipt.actionImplementationContentHash },
    observer: { sourceIdentity: reconstruction.completed.sources.observer.sourceHash, authenticationIdentity: reconstruction.packageInputDraft.observerProof.runtime.authenticationIdentityHash, credentialAlias: fixture.credentialAliases.observer[0], implementationContentHash: runtime.receipt.observerImplementationContentHash, independent: true, readOnly: true, writeOperations: [] },
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
    unresolvedBlockers: [...runtime.plan.remainingBlockers],
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
  return { roleContract, specialist, pluginProjectIdentities, implementationIdentities, conformanceEvidence, observerBindings, readinessInput, rollbackInput, unresolvedBlockers: [...runtime.plan.remainingBlockers], now: FIXED_ISO };
}

function packageNonactivating({ fixture, reconstruction, runtime, qualification, directory }) {
  const inputs = packagingInputs({ fixture, reconstruction, runtime, qualification });
  const plan = createNonactivatingDeploymentBundlePlan(inputs);
  const signing = crypto.generateKeyPairSync("ed25519");
  const written = writeNonactivatingDeploymentBundle({ directory, plan, signingPrivateKey: signing.privateKey, signingPublicKey: signing.publicKey });
  const diagnostics = inspectNonactivatingDeploymentBundle({ directory, expectedPublicKey: signing.publicKey, now: FIXED_ISO, expected: { tenantId: plan.bundle.tenantId, roleId: plan.bundle.roleId, roleRevision: plan.bundle.roleRevision, specialistHash: plan.bundle.specialistHash, bundleHash: plan.bundle.bundleHash } });
  requireCondition(diagnostics.packageIntegrityValid && diagnostics.readyForNonactivatingHandoff && diagnostics.customerExecutionReady === false && diagnostics.activationReady === false, `${fixture.id} failed DAS-020 nonactivating packaging`);
  writePrivate(path.join(path.dirname(directory), "release-public-key.pem"), signing.publicKey.export({ format: "pem", type: "spki" }).toString());
  return { inputs, plan, written, diagnostics };
}

function captureAttack(attacks, id, operation, expected) {
  try {
    operation();
    attacks.push({ id, passed: false, reason: "unsafe-input-accepted" });
  } catch (error) {
    const reason = String(error?.message ?? error);
    attacks.push({ id, passed: expected.test(reason), reason });
  }
}

async function runtimeAttacks({ fixture, reconstruction, runtime, runtimeModules, qualification, otherRuntime }) {
  const attacks = [];
  const assignedWork = fixture.qualificationWorld.assignedWork;
  let transportCalls = 0;
  const denyAdapter = runtimeModules.action.createActionAdapter({
    resolveCredentialLease: testCredentialResolver({ alias: fixture.credentialAliases.action[0], plane: "action", packageIdentityHash: reconstruction.workPack.packageIdentityHash, secretValue: "local-denial-probe", audit: [] }),
    transport: { async execute() { transportCalls += 1; return {}; }, async read() { return {}; } },
    authority: { async assertExact() { throw new Error("exact authority denied in attack"); } },
    now: () => FIXED_NOW_MS,
  });
  try { await denyAdapter.execute({ assignedWork, authorityContext: { roleId: fixture.id, authorityAction: fixture.answers.authority[0], approved: false } }); } catch {}
  requireCondition(transportCalls === 0, "Authority-bypass attack reached the action transport");
  attacks.push({ id: "authority-bypass", passed: true, reason: "transport remained untouched after authority denial" });

  captureAttack(attacks, "observer-write-surface", () => runtimeModules.observer.createObserverAdapter({ resolveCredentialLease: async () => ({}), transport: { async observe() {}, async execute() {} } }), /read-only transport/i);
  const implementationFile = path.join(runtime.root, "action-plugin", "index.js");
  const original = fs.readFileSync(implementationFile, "utf8");
  fs.appendFileSync(implementationFile, "\n// mutation attack\n");
  captureAttack(attacks, "implementation-byte-mutation", () => inspectCustomerLocalDeclarativeRuntime({ directory: runtime.root, expectedReceiptHash: runtime.receipt.receiptHash }), /implementation changed|identity changed/i);
  fs.writeFileSync(implementationFile, original, { mode: 0o600 });
  inspectCustomerLocalDeclarativeRuntime({ directory: runtime.root, expectedReceiptHash: runtime.receipt.receiptHash });

  const widenedSource = structuredClone(fixture.actionSource);
  if (widenedSource.kind === "openapi") widenedSource.document.paths["/widened"] = { post: { operationId: "widenedWrite", requestBody: { content: { "application/json": { schema: { type: "object", properties: {}, additionalProperties: false } } } }, responses: { "200": { description: "widened" } } } };
  else widenedSource.toolsList.tools.push({ name: "widenedWrite", annotations: { readOnlyHint: false }, inputSchema: { type: "object", properties: {}, additionalProperties: false } });
  captureAttack(attacks, "endpoint-tool-schema-widening", () => createCustomerLocalDeclarativeRuntimePlan({
    draftSession: reconstruction.completed,
    packageInputDraft: reconstruction.packageInputDraft,
    generatedPackage: reconstruction.generatedPackage,
    scaffoldPlan: reconstruction.scaffold.plan,
    scaffoldReceipt: reconstruction.scaffold.receipt,
    workPack: reconstruction.workPack,
    actionSource: widenedSource,
    observerSource: fixture.observerSource,
    executionProfile: reconstruction.executionProfile,
  }), /source bytes differ|source identities/i);

  captureAttack(attacks, "cross-package-implementation-evidence", () => inspectCustomerLocalDeclarativeRuntime({
    directory: runtime.root,
    expectedReceiptHash: otherRuntime.receipt.receiptHash,
  }), /belongs to another implementation/i);

  const actionResponseProof = structuredClone(reconstruction.workPack);
  actionResponseProof.evidenceMappings.actionEvidence.mayProveBusinessOutcome = true;
  actionResponseProof.workPackHash = digest(withoutHash(actionResponseProof, "workPackHash"));
  captureAttack(attacks, "action-response-as-proof", () => createCustomerLocalDeclarativeRuntimePlan({
    draftSession: reconstruction.completed,
    packageInputDraft: reconstruction.packageInputDraft,
    generatedPackage: reconstruction.generatedPackage,
    scaffoldPlan: reconstruction.scaffold.plan,
    scaffoldReceipt: reconstruction.scaffold.receipt,
    workPack: actionResponseProof,
    actionSource: fixture.actionSource,
    observerSource: fixture.observerSource,
    executionProfile: reconstruction.executionProfile,
  }), /weakened independent observation|stale|another source|decision chain/i);

  const resultText = JSON.stringify({ runtimeReceipt: runtime.receipt, qualification: qualification.qualification.qualificationReceipt });
  requireCondition(!resultText.includes("local-action-lease-") && !resultText.includes("local-observer-lease-"), "Credential lease value leaked into durable evidence");
  attacks.push({ id: "alias-value-leak", passed: true, reason: "customer-local test lease values absent from implementation and qualification receipts" });
  const lost = qualification.qualification.qualificationReceipt.cases.find((item) => item.id === "lost-response");
  requireCondition(lost.businessWrites === 1 && lost.restartedAfterLostResponse === true, "Lost-response control replayed or failed fresh-process recovery");
  attacks.push({ id: "lost-response-retry-replay", passed: true, reason: "one write, fresh observer reattachment, no replay" });
  requireCondition(attacks.every((attack) => attack.passed), `${fixture.id} DAS-027 attacks failed: ${JSON.stringify(attacks.filter((attack) => !attack.passed))}`);
  return attacks;
}

function preciseUnsupportedControl(fixture) {
  const nested = structuredClone(fixture.actionSource);
  if (nested.kind === "openapi") {
    const operation = Object.values(nested.document.paths).flatMap((item) => Object.values(item)).find((candidate) => candidate?.operationId === fixture.answers.actionOperation);
    operation.requestBody.content["application/json"].schema.properties.unsupportedNested = { type: "object", properties: { value: { type: "string" } }, additionalProperties: false };
  } else {
    const tool = nested.toolsList.tools.find((candidate) => candidate.name === fixture.answers.actionOperation);
    tool.inputSchema.properties.unsupportedNested = { type: "object", properties: { value: { type: "string" } }, additionalProperties: false };
  }
  const nestedFixture = structuredClone(fixture);
  nestedFixture.id = `${fixture.id}-unsupported-nested-control`;
  nestedFixture.actionSource = nested;
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), `das027-unsupported-${fixture.sourceKind}-`));
  try {
    const reconstruction = reconstruct(nestedFixture, stateRoot);
    createCustomerLocalDeclarativeRuntimePlan({
      draftSession: reconstruction.completed,
      packageInputDraft: reconstruction.packageInputDraft,
      generatedPackage: reconstruction.generatedPackage,
      scaffoldPlan: reconstruction.scaffold.plan,
      scaffoldReceipt: reconstruction.scaffold.receipt,
      workPack: reconstruction.workPack,
      actionSource: nestedFixture.actionSource,
      observerSource: nestedFixture.observerSource,
      executionProfile: reconstruction.executionProfile,
    });
    return { id: "nested-schema", blocked: false, exactWork: "unsafe nested schema accepted" };
  } catch (error) {
    return { id: "nested-schema", blocked: true, exactWork: String(error.message) };
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
}

export async function runDAS027Rehearsal({ outputRoot = OUTPUT_ROOT } = {}) {
  const started = performance.now();
  requireCondition(!fs.existsSync(outputRoot), "DAS-027 rehearsal refuses to overwrite an existing artifact directory");
  fs.mkdirSync(outputRoot, { recursive: false, mode: 0o700 });
  fs.chmodSync(outputRoot, 0o700);
  const prepared = [];
  for (const fixture of DAS027_FRESH_FIXTURES) {
    const fixtureRoot = path.join(outputRoot, fixture.id);
    fs.mkdirSync(fixtureRoot, { mode: 0o700 });
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), `das027-${fixture.sourceKind}-`));
    try {
      const reconstruction = reconstruct(fixture, stateRoot);
      const runtime = writeCustomerLocalDeclarativeRuntime({
        directory: path.join(fixtureRoot, "compiled-runtime"),
        draftSession: reconstruction.completed,
        packageInputDraft: reconstruction.packageInputDraft,
        generatedPackage: reconstruction.generatedPackage,
        scaffoldPlan: reconstruction.scaffold.plan,
        scaffoldReceipt: reconstruction.scaffold.receipt,
        workPack: reconstruction.workPack,
        actionSource: fixture.actionSource,
        observerSource: fixture.observerSource,
        executionProfile: reconstruction.executionProfile,
      });
      const runtimeModules = await importCompiledRuntime(runtime);
      const qualification = await runQualification({ fixture, reconstruction, runtime, runtimeModules });
      const packaging = packageNonactivating({ fixture, reconstruction, runtime, qualification, directory: path.join(fixtureRoot, "nonactivating-bundle") });
      prepared.push({ fixture, reconstruction, runtime, runtimeModules, qualification, packaging, unsupported: preciseUnsupportedControl(fixture) });
    } finally {
      fs.rmSync(stateRoot, { recursive: true, force: true });
    }
  }

  const runs = [];
  for (let index = 0; index < prepared.length; index += 1) {
    const current = prepared[index];
    const other = prepared[(index + 1) % prepared.length];
    const attacks = await runtimeAttacks({ fixture: current.fixture, reconstruction: current.reconstruction, runtime: current.runtime, runtimeModules: current.runtimeModules, qualification: current.qualification, otherRuntime: other.runtime });
    const aggregate = qualificationAggregate(current.qualification.qualification.qualificationReceipt);
    const result = {
      fixtureId: current.fixture.id,
      sourceKind: current.fixture.sourceKind,
      identities: {
        das024DraftHash: current.reconstruction.packageInputDraft.draftHash,
        das023PackageReceiptHash: current.reconstruction.generatedPackage.receipt.receiptHash,
        das026WorkPackHash: current.reconstruction.workPack.workPackHash,
        das027PlanHash: current.runtime.plan.planHash,
        das027RuntimeReceiptHash: current.runtime.receipt.receiptHash,
        actionImplementationContentHash: current.runtime.receipt.actionImplementationContentHash,
        observerImplementationContentHash: current.runtime.receipt.observerImplementationContentHash,
        qualificationPackageReceiptHash: current.qualification.boundPackage.receipt.receiptHash,
        qualificationReceiptHash: current.qualification.qualification.qualificationReceipt.receiptHash,
        acceptanceOnlyReceiptHash: current.qualification.acceptance.receiptHash,
        nonactivatingBundleHash: current.packaging.plan.bundle.bundleHash,
      },
      implementation: current.runtime.plan.measurements,
      qualification: { controlsPassed: current.qualification.qualification.qualificationReceipt.controlsPassed, controlsRequired: current.qualification.qualification.qualificationReceipt.controlsRequired, ...aggregate },
      packaging: { packageIntegrityValid: current.packaging.diagnostics.packageIntegrityValid, readyForNonactivatingHandoff: current.packaging.diagnostics.readyForNonactivatingHandoff, customerExecutionReady: false, activationReady: false, blockers: current.packaging.plan.blockerLedger.blockers },
      unsupported: current.unsupported,
      attacks,
      manualPackageSpecificExecutableFiles: 0,
      manualPackageSpecificExecutableLines: 0,
      customerExecutableOperations: 0,
      modelCalls: 0,
      spendUsd: 0,
      evidenceBoundary: "Compiled executable disposable local candidate plus nonactivating package only. No real customer provider, credential, authority, environment acceptance, execution or activation.",
    };
    result.resultHash = digest(result);
    runs.push(result);
    writePrivate(path.join(outputRoot, current.fixture.id, "fixture-result.json"), result);
  }

  const report = {
    schemaVersion: "das.das027-declarative-runtime-report.v1",
    preregistration: "reports/0105-das027-declarative-runtime-compiler-preregistration.md",
    sourceManifest: sourceManifest(),
    runs,
    aggregate: {
      packages: runs.length,
      sourceFamilies: runs.map((run) => run.sourceKind),
      generatedExecutableFiles: runs.reduce((sum, run) => sum + run.implementation.generatedExecutableFiles, 0),
      generatedExecutableLines: runs.reduce((sum, run) => sum + run.implementation.generatedExecutableLines, 0),
      generatedExecutableOperations: runs.reduce((sum, run) => sum + run.implementation.generatedExecutableOperations, 0),
      manualPackageSpecificExecutableFiles: 0,
      manualPackageSpecificExecutableLines: 0,
      controlsPassed: runs.reduce((sum, run) => sum + run.qualification.controlsPassed, 0),
      controlsRequired: runs.reduce((sum, run) => sum + run.qualification.controlsRequired, 0),
      freshProcessLostResponseRecoveries: runs.reduce((sum, run) => sum + run.qualification.lostResponseFreshRuntimeReattachments, 0),
      lostResponseReplays: runs.reduce((sum, run) => sum + run.qualification.lostResponseReplays, 0),
      observerWrites: runs.reduce((sum, run) => sum + run.qualification.observerWrites, 0),
      unexpectedIncorrectEffects: runs.reduce((sum, run) => sum + run.qualification.unexpectedIncorrectEffects, 0),
      attacksPassed: runs.reduce((sum, run) => sum + run.attacks.filter((attack) => attack.passed).length, 0),
      attacksRequired: runs.reduce((sum, run) => sum + run.attacks.length, 0),
      nonactivatingBundles: runs.filter((run) => run.packaging.packageIntegrityValid && run.packaging.activationReady === false).length,
      customerExecutableOperations: 0,
      modelCalls: 0,
      spendUsd: 0,
      activeMachineMs: Math.round((performance.now() - started) * 1000) / 1000,
    },
    verdict: "passed-bounded-declarative-disposable-runtime-compilation",
    strongestAccurateFinding: "For one fresh OpenAPI package and one fresh pinned-MCP package inside a strict flat-schema declarative subset, DAS generated actual separate runnable action/observer implementation bytes from exact confirmed inputs. Both candidates passed the unchanged ten-control qualification and entered signed nonactivating packages. Real customer transports, credentials, authority, environment acceptance, execution and activation remain unproved and false.",
    evidenceBoundary: "Private fictional deterministic local evidence only. This does not establish arbitrary source support, self-serve onboarding, customer execution, production reliability, deployment, demand or human setup time.",
  };
  report.resultHash = digest(report);
  writePrivate(path.join(outputRoot, "result.json"), report);
  const summary = { schemaVersion: "das.das027-summary.v1", resultHash: report.resultHash, verdict: report.verdict, aggregate: report.aggregate, evidenceBoundary: report.evidenceBoundary };
  summary.summaryHash = digest(summary);
  writePrivate(path.join(outputRoot, "summary.json"), summary);
  return Object.freeze(report);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runDAS027Rehearsal().then((report) => process.stdout.write(`${JSON.stringify({ verdict: report.verdict, resultHash: report.resultHash, aggregate: report.aggregate }, null, 2)}\n`)).catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
