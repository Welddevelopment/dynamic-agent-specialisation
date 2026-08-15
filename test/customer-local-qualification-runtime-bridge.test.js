import assert from "node:assert/strict";
import test from "node:test";
import { digest } from "../src/core/canonical.js";
import { createCustomerLocalQualificationHarnessContract } from "../src/product/customer-local-binding-qualification.js";
import {
  createCanonicalCustomerLocalQualificationCases,
  createCustomerLocalQualificationRuntimeBridge,
  runCustomerLocalQualificationRuntimeBridge,
} from "../src/product/customer-local-qualification-runtime-bridge.js";

const NOW_MS = 1_000;
const PACKAGE_IDENTITY_HASH = digest({ package: "neutral-held-out-qualification-v1" });
const ASSIGNED_WORK = Object.freeze({
  requestId: "request-42",
  idempotencyKey: "neutral:request-42:v1",
  amount: 12,
});

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

function observerContract() {
  const contract = {
    schemaVersion: "das.customer-local-observer-contract.v1",
    observerId: "neutral-independent-audit-v1",
    surfaceId: "neutral-read-only-audit-surface",
    credentialAliases: ["NEUTRAL_OBSERVER_CREDENTIAL"],
    implementationHash: digest({ implementation: "neutral-observer-v1" }),
    sourceHash: digest({ source: "neutral-observer-source-v1" }),
    runtimeSchemaHash: digest({ schema: "neutral-observer-schema-v1" }),
    transportIdentityHash: digest({ transport: "neutral-observer-transport-v1" }),
    readOperations: ["read-neutral-effects", "read-neutral-protected-scope"],
    writeOperations: [],
    evidenceProvenance: "observer-direct-external-state",
    stableIdentity: { fields: ["requestId", "idempotencyKey"] },
    freshness: {
      snapshotGeneratedAtField: "snapshotGeneratedAtMs",
      caughtUpThroughField: "caughtUpThroughMs",
      maximumAgeMs: 50,
    },
    outcomeRules: {
      requiredExactFields: ["requestId", "idempotencyKey", "amount"],
      statusField: "status",
      completionStatuses: ["draft"],
    },
    duplicateRule: { maximumDistinctResults: 1, resultIdentityField: "effectId" },
    collateralRules: {
      changedEntitiesField: "changedEntities",
      unrelatedStateDigestField: "unrelatedStateDigest",
      allowedChangedEntityKinds: ["neutral-effect"],
    },
    status: "provisional-observer-contract-non-executable",
    independentlyAuthenticated: "unproved",
    qualified: false,
    executable: false,
    activationReady: false,
    evidenceBoundary: "Neutral local test observer only.",
  };
  contract.contractHash = digest(contract);
  return Object.freeze(contract);
}

function candidateFor(contract) {
  const candidate = {
    schemaVersion: "das.customer-local-binding-candidate.v1",
    action: {
      bindingId: "neutral-action-binding-v1",
      surfaceId: "neutral-action-surface",
      credentialAliases: ["NEUTRAL_ACTION_CREDENTIAL"],
      implementationHash: digest({ implementation: "neutral-action-v1" }),
      sourceHash: digest({ source: "neutral-action-source-v1" }),
      runtimeSchemaHash: digest({ schema: "neutral-action-schema-v1" }),
      transportIdentityHash: digest({ transport: "neutral-action-transport-v1" }),
      operations: [{
        sourceName: "createNeutralDraft",
        targetExposedName: "neutral:create-draft",
        mode: "write",
        authorityAction: "create-neutral-draft",
        boundedInputSchemaHash: digest({ input: ["requestId", "idempotencyKey", "amount"] }),
        idempotencyRule: "One stable key per request.",
        reconciliationRule: "Read from the separate audit surface before any retry.",
        stableIdentityRule: "requestId + idempotencyKey",
      }],
    },
    observerContractHash: contract.contractHash,
    observer: {
      observerId: contract.observerId,
      surfaceId: contract.surfaceId,
      credentialAliases: [...contract.credentialAliases],
      implementationHash: contract.implementationHash,
      sourceHash: contract.sourceHash,
      runtimeSchemaHash: contract.runtimeSchemaHash,
      transportIdentityHash: contract.transportIdentityHash,
      readOperations: [...contract.readOperations],
    },
    status: "reviewed-candidate-non-executable",
    runtimeAuthorityGranted: false,
    credentialsResolved: false,
    acceptanceComplete: false,
    executableOperations: 0,
    executable: false,
    activationReady: false,
    evidenceBoundary: "Neutral local test candidate only.",
  };
  candidate.candidateHash = digest(candidate);
  return Object.freeze(candidate);
}

function frozenInputs() {
  const observer = observerContract();
  const candidate = candidateFor(observer);
  const harnessContract = createCustomerLocalQualificationHarnessContract({
    harnessId: "neutral-shared-runtime-bridge-v1",
    worldImplementationHash: digest({ world: "neutral-world-driver-v1" }),
    persistentStoreSchemaHash: digest({ store: "neutral-store-v1" }),
    authenticationAuthorityHash: digest({ authority: "shared-synthetic-challenge-v1" }),
    observerEvidenceSchemaHash: digest({ evidence: "neutral-observer-evidence-v1" }),
  });
  return { observer, candidate, harnessContract };
}

function createDriverFactory({ mutateInitial = null, mutateAfterExecute = null, restartMode = "valid", observerMutation = false } = {}) {
  function makeDriver({ testCase, candidate, observerContract, harnessContract, packageIdentityHash, bridgeContract, store = null, processInstanceId = null }) {
    const durableStore = store ?? {
      records: [],
      businessWrites: 0,
      observerWrites: 0,
      unrelatedStateDigest: "neutral-protected-state-v1",
      additionalChanges: [],
    };
    const driver = {
      schemaVersion: "das.customer-local-qualification-world-driver.v1",
      packageIdentityHash,
      bridgeContractHash: bridgeContract.contractHash,
      harnessContractHash: harnessContract.contractHash,
      harnessIdentityHash: harnessContract.worldImplementationHash,
      persistentStoreSchemaHash: harnessContract.persistentStoreSchemaHash,
      controlId: testCase.id,
      storageIdentityHash: digest({ packageIdentityHash, controlId: testCase.id, store: "neutral-durable-store" }),
      processInstanceId: processInstanceId ?? `neutral-original-${testCase.id}`,
      action: {
        bindingId: candidate.action.bindingId,
        surfaceId: candidate.action.surfaceId,
        implementationHash: candidate.action.implementationHash,
        sourceHash: candidate.action.sourceHash,
        runtimeSchemaHash: candidate.action.runtimeSchemaHash,
        transportIdentityHash: candidate.action.transportIdentityHash,
        credentialAlias: candidate.action.credentialAliases[0],
        principalId: "neutral-disposable-action-principal",
        qualificationAuthorityActions: ["create-neutral-draft"],
        productionAuthorityGranted: false,
      },
      observer: {
        observerId: candidate.observer.observerId,
        surfaceId: candidate.observer.surfaceId,
        implementationHash: candidate.observer.implementationHash,
        sourceHash: candidate.observer.sourceHash,
        runtimeSchemaHash: candidate.observer.runtimeSchemaHash,
        transportIdentityHash: candidate.observer.transportIdentityHash,
        credentialAlias: candidate.observer.credentialAliases[0],
        principalId: "neutral-disposable-observer-principal",
        readOnly: true,
        writeOperations: [],
        productionAuthorityGranted: false,
      },
      async execute({ assignedWork }) {
        if (["not-started", "unknown", "unavailable"].includes(testCase.id)) return { responseLost: false, response: { untrustedClaimOnly: true } };
        const record = { ...assignedWork, effectId: "effect-1", status: "draft" };
        if (testCase.id === "partial") delete record.amount;
        if (testCase.id === "incorrect") record.amount = 999;
        durableStore.records.push(record);
        durableStore.businessWrites += 1;
        if (testCase.id === "duplicate") {
          durableStore.records.push({ ...record, effectId: "effect-2" });
          durableStore.businessWrites += 1;
        }
        if (testCase.id === "collateral") {
          durableStore.unrelatedStateDigest = "neutral-protected-state-mutated";
          durableStore.additionalChanges.push({ kind: "protected-account", id: "protected-1" });
        }
        if (testCase.id === "lost-response") {
          const error = new Error("Synthetic response lost after one committed write");
          error.responseLost = true;
          throw error;
        }
        if (mutateAfterExecute) mutateAfterExecute(driver);
        return { responseLost: false, response: { effectId: "untrusted-response-value" } };
      },
      async observe({ phase }) {
        if (observerMutation) durableStore.observerWrites += 1;
        if (phase === "after" && testCase.id === "unknown") return { availability: "unknown", reason: "neutral-state-could-not-be-established" };
        if (phase === "after" && testCase.id === "unavailable") return { availability: "unavailable", reason: "neutral-observer-unavailable" };
        const observedAt = phase === "after" && testCase.id === "stale" ? 900 : NOW_MS;
        return {
          provenance: observerContract.evidenceProvenance,
          observerContractHash: observerContract.contractHash,
          snapshotGeneratedAtMs: observedAt,
          caughtUpThroughMs: observedAt,
          matches: phase === "before" ? [] : structuredClone(durableStore.records),
          changedEntities: phase === "before"
            ? []
            : [
                ...durableStore.records.map((record) => ({ kind: "neutral-effect", id: record.effectId })),
                ...durableStore.additionalChanges,
              ],
          unrelatedStateDigest: phase === "before" ? "neutral-protected-state-v1" : durableStore.unrelatedStateDigest,
        };
      },
      businessWrites() { return durableStore.businessWrites; },
      observerWrites() { return durableStore.observerWrites; },
      snapshot() {
        return {
          records: structuredClone(durableStore.records),
          businessWrites: durableStore.businessWrites,
          unrelatedStateDigest: durableStore.unrelatedStateDigest,
          additionalChanges: structuredClone(durableStore.additionalChanges),
        };
      },
      async restart(restartInput) {
        const restarted = makeDriver({
          ...restartInput,
          store: restartMode === "changed-store" ? null : durableStore,
          processInstanceId: restartMode === "same-process" ? driver.processInstanceId : `${driver.processInstanceId}-fresh`,
        });
        if (restartMode === "changed-store") restarted.storageIdentityHash = digest({ changed: true });
        return restarted;
      },
    };
    if (mutateInitial) mutateInitial(driver);
    return driver;
  }
  return async (input) => makeDriver(input);
}

test("shared bridge runs the immutable ten-control profile and remains non-executable", async () => {
  const { observer, candidate, harnessContract } = frozenInputs();
  const result = await runCustomerLocalQualificationRuntimeBridge({
    candidate,
    observerContract: observer,
    harnessContract,
    packageIdentityHash: PACKAGE_IDENTITY_HASH,
    assignedWork: ASSIGNED_WORK,
    driverFactory: createDriverFactory(),
    now: () => NOW_MS,
  });
  assert.equal(result.qualificationReceipt.qualificationPassed, true);
  assert.equal(result.qualificationReceipt.controlsPassed, 10);
  assert.deepEqual(result.cases.map((entry) => entry.id), ["completed", "not-started", "partial", "incorrect", "duplicate", "stale", "collateral", "unknown", "unavailable", "lost-response"]);
  assert.equal(result.qualificationReceipt.cases.find((entry) => entry.id === "lost-response").businessWrites, 1);
  assert.equal(result.qualificationReceipt.cases.find((entry) => entry.id === "lost-response").restartedAfterLostResponse, true);
  assert.equal(result.qualificationReceipt.cases.find((entry) => entry.id === "not-started").classification.retryEligible, true);
  assert.equal(result.qualificationReceipt.cases.filter((entry) => entry.id !== "not-started").every((entry) => entry.classification.retryEligible === false), true);
  assert.equal(result.executableOperations, 0);
  assert.equal(result.productionAuthorityGranted, false);
  assert.equal(result.executable, false);
  assert.equal(result.activationReady, false);
  assert.equal(result.modelCalls, 0);
  assert.equal(result.spendUsd, 0);
  assert.equal(result.resultHash, digest(withoutHash(result, "resultHash")));
});

test("canonical case generation cannot be caller-weakened", () => {
  const cases = createCanonicalCustomerLocalQualificationCases({ assignedWork: { ...ASSIGNED_WORK, nested: { approved: true } }, packageIdentityHash: PACKAGE_IDENTITY_HASH });
  assert.equal(cases.length, 10);
  assert.throws(() => { cases[0].expectedClassification = "unknown"; }, TypeError);
  assert.throws(() => { cases[0].payload.fault.kind = "not-started"; }, TypeError);
  assert.throws(() => { cases[0].payload.assignedWork.nested.approved = false; }, TypeError);
  assert.equal(cases[0].payload.qualificationPackageIdentityHash, PACKAGE_IDENTITY_HASH);
});

test("package, harness, runtime, source, schema, transport and implementation substitution fail closed", async () => {
  const { observer, candidate, harnessContract } = frozenInputs();
  const attacks = [
    [(driver) => { driver.packageIdentityHash = digest({ substituted: "package" }); }, /package or bridge identity mismatch/],
    [(driver) => { driver.harnessContractHash = digest({ substituted: "harness" }); }, /harness contract identity mismatch/],
    [(driver) => { driver.action.implementationHash = digest({ substituted: "implementation" }); }, /implementationHash drifted/],
    [(driver) => { driver.action.sourceHash = digest({ substituted: "source" }); }, /sourceHash drifted/],
    [(driver) => { driver.action.runtimeSchemaHash = digest({ substituted: "schema" }); }, /runtimeSchemaHash drifted/],
    [(driver) => { driver.action.transportIdentityHash = digest({ substituted: "transport" }); }, /transportIdentityHash drifted/],
  ];
  for (const [mutateInitial, message] of attacks) {
    await assert.rejects(() => runCustomerLocalQualificationRuntimeBridge({
      candidate,
      observerContract: observer,
      harnessContract,
      packageIdentityHash: PACKAGE_IDENTITY_HASH,
      assignedWork: ASSIGNED_WORK,
      driverFactory: createDriverFactory({ mutateInitial }),
      now: () => NOW_MS,
    }), message);
  }
});

test("collapsed principals, aliases, surfaces, observer mutation and production authority fail closed", async () => {
  const { observer, candidate, harnessContract } = frozenInputs();
  const attacks = [
    [(driver) => { driver.observer.principalId = driver.action.principalId; }, false, /principals collapsed/],
    [(driver) => { driver.observer.credentialAlias = driver.action.credentialAlias; }, false, /credential alias was not reviewed|aliases collapsed/],
    [(driver) => { driver.observer.surfaceId = driver.action.surfaceId; }, false, /boundary identity mismatch|surfaces collapsed/],
    [(driver) => { driver.action.productionAuthorityGranted = true; }, false, /widened production authority/],
    [null, true, /observer driver performed a write/],
  ];
  for (const [mutateInitial, observerMutation, message] of attacks) {
    await assert.rejects(() => runCustomerLocalQualificationRuntimeBridge({
      candidate,
      observerContract: observer,
      harnessContract,
      packageIdentityHash: PACKAGE_IDENTITY_HASH,
      assignedWork: ASSIGNED_WORK,
      driverFactory: createDriverFactory({ mutateInitial, observerMutation }),
      now: () => NOW_MS,
    }), message);
  }
});

test("a driver identity that changes after action execution fails before evidence can be accepted", async () => {
  const { observer, candidate, harnessContract } = frozenInputs();
  await assert.rejects(() => runCustomerLocalQualificationRuntimeBridge({
    candidate,
    observerContract: observer,
    harnessContract,
    packageIdentityHash: PACKAGE_IDENTITY_HASH,
    assignedWork: ASSIGNED_WORK,
    driverFactory: createDriverFactory({
      mutateAfterExecute(driver) { driver.action.sourceHash = digest({ drifted: "after-action" }); },
    }),
    now: () => NOW_MS,
  }), /driver identity changed after binding|sourceHash drifted/);
});

test("lost-response recovery requires a fresh process on the same durable store", async () => {
  const { observer, candidate, harnessContract } = frozenInputs();
  for (const [restartMode, message] of [["same-process", /same process identity/], ["changed-store", /different durable store/]]) {
    await assert.rejects(() => runCustomerLocalQualificationRuntimeBridge({
      candidate,
      observerContract: observer,
      harnessContract,
      packageIdentityHash: PACKAGE_IDENTITY_HASH,
      assignedWork: ASSIGNED_WORK,
      driverFactory: createDriverFactory({ restartMode }),
      now: () => NOW_MS,
    }), message);
  }
});

test("a driver cannot be reused under another bridge or bypass the synthetic authority", async () => {
  const { observer, candidate, harnessContract } = frozenInputs();
  const bridge = createCustomerLocalQualificationRuntimeBridge({
    candidate,
    observerContract: observer,
    harnessContract,
    packageIdentityHash: PACKAGE_IDENTITY_HASH,
    driverFactory: createDriverFactory(),
  });
  const cases = createCanonicalCustomerLocalQualificationCases({ assignedWork: ASSIGNED_WORK, packageIdentityHash: PACKAGE_IDENTITY_HASH });
  const world = await bridge.worldFactory({ testCase: cases[0] });
  const runtime = await bridge.actionRuntimeFactory({ world, testCase: cases[0] });
  const challenge = await bridge.authenticationAuthority.issueChallenge({
    boundary: "action",
    controlId: cases[0].id,
    candidateHash: candidate.candidateHash,
    observerContractHash: observer.contractHash,
  });
  const proof = await runtime.authenticate({ challenge });
  assert.equal(await bridge.authenticationAuthority.verify({ boundary: "action", runtime, challenge, proof }), true);
  const changedChallenge = { ...challenge, packageIdentityHash: digest({ other: "package" }) };
  changedChallenge.challengeHash = digest(withoutHash(changedChallenge, "challengeHash"));
  await assert.rejects(() => runtime.authenticate({ challenge: changedChallenge }), /cross-package or cross-harness/);
});
