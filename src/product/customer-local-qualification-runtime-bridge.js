import { digest } from "../core/canonical.js";
import {
  assertCustomerLocalBindingQualification,
  createCustomerLocalQualificationCaseContract,
  CUSTOMER_LOCAL_QUALIFICATION_CONTROLS,
  CUSTOMER_LOCAL_QUALIFICATION_EXPECTATIONS,
  runCustomerLocalBindingQualification,
} from "./customer-local-binding-qualification.js";

const HASH = /^[a-f0-9]{64}$/;
const SECRET_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\bBasic\s+[A-Za-z0-9+/=]{8,}|\bsk-[A-Za-z0-9_-]{8,}|-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----|\b(?:password|secret|token|api[-_]?key)\s*[:=]\s*["']?[^\s,"'}]{6,})/i;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

function clean(value, maximum = 200) {
  return String(value ?? "").trim().slice(0, maximum);
}

function exactSet(values) {
  return [...new Set(values)].sort();
}

function sameSet(left, right) {
  return JSON.stringify(exactSet(left)) === JSON.stringify(exactSet(right));
}

function assertNoSecrets(value, label) {
  requireCondition(!SECRET_VALUE.test(JSON.stringify(value)), `${label} contains possible credential material`);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertIntegrity(value, hashKey, schemaVersion, label) {
  requireCondition(value?.schemaVersion === schemaVersion, `${label} schema is unsupported`);
  requireCondition(value?.[hashKey] === digest(withoutHash(value, hashKey)), `${label} integrity mismatch`);
}

function assertProtectedInputs(candidate, observerContract, harnessContract) {
  assertIntegrity(candidate, "candidateHash", "das.customer-local-binding-candidate.v1", "Customer-local binding candidate");
  assertIntegrity(observerContract, "contractHash", "das.customer-local-observer-contract.v1", "Customer-local observer contract");
  assertIntegrity(harnessContract, "contractHash", "das.customer-local-qualification-harness.v1", "Customer-local qualification harness");
  requireCondition(candidate.observerContractHash === observerContract.contractHash, "Binding candidate and observer contract do not match");
  requireCondition(candidate.executable === false && candidate.activationReady === false && candidate.executableOperations === 0 && candidate.runtimeAuthorityGranted === false, "Binding candidate widened a protected gate");
  requireCondition(observerContract.executable === false && observerContract.activationReady === false && observerContract.writeOperations?.length === 0, "Observer contract widened a protected gate");
  requireCondition(harnessContract.productionAuthorityGranted === false && harnessContract.credentialValuesIncluded === false, "Qualification harness widened production authority or embedded credential values");
}

function actionIdentity(candidate) {
  return {
    bindingId: candidate.action.bindingId,
    surfaceId: candidate.action.surfaceId,
    implementationHash: candidate.action.implementationHash,
    sourceHash: candidate.action.sourceHash,
    runtimeSchemaHash: candidate.action.runtimeSchemaHash,
    transportIdentityHash: candidate.action.transportIdentityHash,
    credentialAliases: [...candidate.action.credentialAliases],
    qualificationAuthorityActions: candidate.action.operations
      .filter((operation) => operation.mode === "write")
      .map((operation) => operation.authorityAction)
      .sort(),
  };
}

function observerIdentity(candidate) {
  return {
    observerId: candidate.observer.observerId,
    surfaceId: candidate.observer.surfaceId,
    implementationHash: candidate.observer.implementationHash,
    sourceHash: candidate.observer.sourceHash,
    runtimeSchemaHash: candidate.observer.runtimeSchemaHash,
    transportIdentityHash: candidate.observer.transportIdentityHash,
    credentialAliases: [...candidate.observer.credentialAliases],
  };
}

function assertBoundaryIdentity(actual, expected, kind) {
  const idKey = kind === "action" ? "bindingId" : "observerId";
  requireCondition(actual?.[idKey] === expected[idKey] && actual?.surfaceId === expected.surfaceId, `${kind} driver boundary identity mismatch`);
  for (const key of ["implementationHash", "sourceHash", "runtimeSchemaHash", "transportIdentityHash"]) {
    requireCondition(actual?.[key] === expected[key], `${kind} driver ${key} drifted`);
  }
  requireCondition(expected.credentialAliases.includes(actual?.credentialAlias), `${kind} driver credential alias was not reviewed`);
  requireCondition(clean(actual?.principalId), `${kind} driver requires an exact synthetic principal identity`);
  requireCondition(actual?.productionAuthorityGranted === false, `${kind} driver widened production authority`);
  if (kind === "action") {
    requireCondition(sameSet(actual.qualificationAuthorityActions ?? [], expected.qualificationAuthorityActions), "action driver widened disposable qualification authority");
  } else {
    requireCondition(actual.readOnly === true && Array.isArray(actual.writeOperations) && actual.writeOperations.length === 0, "observer driver is not an exact read-only boundary");
  }
}

function driverIdentity(driver) {
  return {
    schemaVersion: driver.schemaVersion,
    packageIdentityHash: driver.packageIdentityHash,
    bridgeContractHash: driver.bridgeContractHash,
    harnessContractHash: driver.harnessContractHash,
    harnessIdentityHash: driver.harnessIdentityHash,
    persistentStoreSchemaHash: driver.persistentStoreSchemaHash,
    controlId: driver.controlId,
    storageIdentityHash: driver.storageIdentityHash,
    processInstanceId: driver.processInstanceId,
    action: structuredClone(driver.action),
    observer: structuredClone(driver.observer),
  };
}

function assertDriver({ driver, candidate, harnessContract, packageIdentityHash, bridgeContract, testCase, label }) {
  requireCondition(driver?.schemaVersion === "das.customer-local-qualification-world-driver.v1", `${label} driver schema is unsupported`);
  requireCondition(driver.packageIdentityHash === packageIdentityHash && driver.bridgeContractHash === bridgeContract.contractHash, `${label} driver package or bridge identity mismatch`);
  requireCondition(driver.harnessContractHash === harnessContract.contractHash, `${label} driver harness contract identity mismatch`);
  requireCondition(driver.harnessIdentityHash === harnessContract.worldImplementationHash, `${label} driver world implementation identity mismatch`);
  requireCondition(driver.persistentStoreSchemaHash === harnessContract.persistentStoreSchemaHash, `${label} driver persistent-store schema identity mismatch`);
  requireCondition(driver.controlId === testCase.id, `${label} driver belongs to another canonical control`);
  requireCondition(HASH.test(driver.storageIdentityHash) && clean(driver.processInstanceId), `${label} driver requires exact durable-store and process identities`);
  assertBoundaryIdentity(driver.action, actionIdentity(candidate), "action");
  assertBoundaryIdentity(driver.observer, observerIdentity(candidate), "observer");
  requireCondition(driver.action.surfaceId !== driver.observer.surfaceId, `${label} action and observer surfaces collapsed`);
  requireCondition(driver.action.transportIdentityHash !== driver.observer.transportIdentityHash, `${label} action and observer transports collapsed`);
  requireCondition(driver.action.credentialAlias !== driver.observer.credentialAlias, `${label} action and observer credential aliases collapsed`);
  requireCondition(driver.action.principalId !== driver.observer.principalId, `${label} action and observer principals collapsed`);
  requireCondition(typeof driver.execute === "function" && typeof driver.observe === "function" && typeof driver.snapshot === "function", `${label} driver is missing execute, observe or snapshot`);
  requireCondition(typeof driver.businessWrites === "function" && typeof driver.observerWrites === "function" && typeof driver.restart === "function", `${label} driver is missing exact counters or restart`);
  const businessWrites = driver.businessWrites();
  const observerWrites = driver.observerWrites();
  requireCondition(Number.isInteger(businessWrites) && businessWrites >= 0, `${label} driver business-write counter is invalid`);
  requireCondition(Number.isInteger(observerWrites) && observerWrites >= 0, `${label} driver observer-write counter is invalid`);
  assertNoSecrets({
    packageIdentityHash: driver.packageIdentityHash,
    action: driver.action,
    observer: driver.observer,
  }, `${label} driver identity`);
}

function proofPayload({ boundary, runtime, challenge }) {
  return {
    boundary,
    principalId: runtime.principalId,
    credentialAlias: runtime.credentialAlias,
    challengeHash: challenge.challengeHash,
    packageIdentityHash: challenge.packageIdentityHash,
    harnessContractHash: challenge.harnessContractHash,
    readOnly: boundary === "observer",
    productionAuthorityGranted: false,
  };
}

/**
 * Produces the one canonical ten-control case set. Callers provide business truth only;
 * they cannot weaken the expected classification, disposition, or write ceiling.
 */
export function createCanonicalCustomerLocalQualificationCases({ assignedWork, packageIdentityHash }) {
  requireCondition(assignedWork && typeof assignedWork === "object" && !Array.isArray(assignedWork), "Canonical qualification cases require exact assigned work");
  requireCondition(HASH.test(packageIdentityHash), "Canonical qualification cases require an exact package identity hash");
  assertNoSecrets(assignedWork, "Canonical qualification assigned work");
  return deepFreeze(CUSTOMER_LOCAL_QUALIFICATION_CONTROLS.map((id) => {
    const expectation = CUSTOMER_LOCAL_QUALIFICATION_EXPECTATIONS[id];
    return {
      id,
      expectedClassification: expectation.classification,
      expectedDisposition: expectation.disposition,
      maximumBusinessWrites: expectation.maximumBusinessWrites,
      payload: {
        assignedWork: structuredClone(assignedWork),
        fault: { kind: id },
        qualificationPackageIdentityHash: packageIdentityHash,
      },
    };
  }));
}

/**
 * Creates deterministic challenge/response authentication for a disposable local world.
 * It proves boundary separation only; it deliberately grants no customer or production authority.
 */
export function createSyntheticCustomerLocalChallengeAuthority({ harnessContract, packageIdentityHash }) {
  assertIntegrity(harnessContract, "contractHash", "das.customer-local-qualification-harness.v1", "Customer-local qualification harness");
  requireCondition(harnessContract.productionAuthorityGranted === false && harnessContract.credentialValuesIncluded === false, "Synthetic challenge authority requires a non-authorizing credential-free harness");
  requireCondition(HASH.test(packageIdentityHash), "Synthetic challenge authority requires an exact package identity hash");
  const authority = {
    authorityHash: harnessContract.authenticationAuthorityHash,
    async issueChallenge({ boundary, controlId, candidateHash, observerContractHash }) {
      requireCondition(["action", "observer"].includes(boundary), "Synthetic challenge requested an unsupported boundary");
      const challenge = {
        schemaVersion: "das.customer-local-synthetic-challenge.v1",
        boundary,
        controlId: clean(controlId),
        candidateHash,
        observerContractHash,
        packageIdentityHash,
        harnessContractHash: harnessContract.contractHash,
        nonce: digest({ boundary, controlId, candidateHash, observerContractHash, packageIdentityHash, harnessContractHash: harnessContract.contractHash }),
        productionAuthorityGranted: false,
      };
      challenge.challengeHash = digest(challenge);
      return Object.freeze(challenge);
    },
    async verify({ boundary, runtime, challenge, proof }) {
      if (challenge?.challengeHash !== digest(withoutHash(challenge, "challengeHash"))) return false;
      if (challenge.boundary !== boundary || challenge.packageIdentityHash !== packageIdentityHash || challenge.harnessContractHash !== harnessContract.contractHash) return false;
      const expected = proofPayload({ boundary, runtime, challenge });
      return proof?.proofHash === digest(expected)
        && Object.entries(expected).every(([key, value]) => proof[key] === value)
        && proof.productionAuthorityGranted === false;
    },
  };
  return Object.freeze(authority);
}

function createRuntimeAuthentication({ runtime, boundary, packageIdentityHash, harnessContract }) {
  return async ({ challenge }) => {
    requireCondition(challenge?.challengeHash === digest(withoutHash(challenge, "challengeHash")), `${boundary} runtime received a mutated challenge`);
    requireCondition(challenge.boundary === boundary && challenge.packageIdentityHash === packageIdentityHash && challenge.harnessContractHash === harnessContract.contractHash, `${boundary} runtime received a cross-package or cross-harness challenge`);
    const proof = proofPayload({ boundary, runtime, challenge });
    proof.proofHash = digest(proof);
    return Object.freeze(proof);
  };
}

/**
 * Wraps an explicitly authored disposable-world driver in the shared qualification runner.
 * The bridge supplies choreography, never business rules, credentials, or executable authority.
 */
export function createCustomerLocalQualificationRuntimeBridge({
  candidate,
  observerContract,
  harnessContract,
  packageIdentityHash,
  driverFactory,
}) {
  assertProtectedInputs(candidate, observerContract, harnessContract);
  requireCondition(HASH.test(packageIdentityHash), "Qualification runtime bridge requires an exact package identity hash");
  requireCondition(typeof driverFactory === "function", "Qualification runtime bridge requires a disposable world driver factory");
  const bridgeContract = {
    schemaVersion: "das.customer-local-qualification-runtime-bridge.v1",
    packageIdentityHash,
    candidateHash: candidate.candidateHash,
    observerContractHash: observerContract.contractHash,
    harnessContractHash: harnessContract.contractHash,
    actionIdentityHash: digest(actionIdentity(candidate)),
    observerIdentityHash: digest(observerIdentity(candidate)),
    canonicalControlsHash: digest(CUSTOMER_LOCAL_QUALIFICATION_EXPECTATIONS),
    driverAuthority: "disposable-local-qualification-only",
    productionAuthorityGranted: false,
    credentialsResolved: false,
    executableOperations: 0,
    executable: false,
    activationReady: false,
    evidenceBoundary: "Shared disposable local qualification choreography only. Package-specific business safety, proof semantics and runtimes remain explicit reviewed inputs.",
  };
  bridgeContract.contractHash = digest(bridgeContract);
  Object.freeze(bridgeContract);

  const driverByWorld = new WeakMap();

  function assertPinnedState(state, label) {
    assertDriver({ driver: state.driver, candidate, harnessContract, packageIdentityHash, bridgeContract, testCase: state.testCase, label });
    requireCondition(digest(driverIdentity(state.driver)) === state.driverIdentityHash, `${label} driver identity changed after binding`);
  }

  function wrapDriver(driver, testCase, label) {
    assertDriver({ driver, candidate, harnessContract, packageIdentityHash, bridgeContract, testCase, label });
    const state = { driver, testCase, driverIdentityHash: digest(driverIdentity(driver)), executeAttempts: 0, restartAttempts: 0 };
    const world = Object.freeze({
      harnessIdentityHash: driver.harnessIdentityHash,
      persistentStoreSchemaHash: driver.persistentStoreSchemaHash,
      storageIdentityHash: driver.storageIdentityHash,
      processInstanceId: driver.processInstanceId,
      businessWrites() {
        assertPinnedState(state, `${label} counter`);
        return state.driver.businessWrites();
      },
      observerWrites() {
        assertPinnedState(state, `${label} observer counter`);
        return state.driver.observerWrites();
      },
      snapshot() {
        assertPinnedState(state, `${label} snapshot`);
        return structuredClone(state.driver.snapshot());
      },
    });
    driverByWorld.set(world, state);
    return world;
  }

  function stateFor(world, label) {
    const state = driverByWorld.get(world);
    requireCondition(state, `${label} received a world outside this qualification bridge`);
    return state;
  }

  const worldFactory = async ({ testCase }) => {
    requireCondition(testCase?.payload?.qualificationPackageIdentityHash === packageIdentityHash, `${testCase?.id ?? "unknown"} case package identity mismatch`);
    const driver = await driverFactory({
      testCase: structuredClone(testCase),
      candidate,
      observerContract,
      harnessContract,
      packageIdentityHash,
      bridgeContract,
    });
    return wrapDriver(driver, testCase, `${testCase.id} initial`);
  };

  const actionRuntimeFactory = async ({ world, testCase }) => {
    const state = stateFor(world, `${testCase.id} action runtime`);
    const { driver } = state;
    assertPinnedState(state, `${testCase.id} action runtime`);
    const runtime = {
      ...actionIdentity(candidate),
      credentialAlias: driver.action.credentialAlias,
      principalId: driver.action.principalId,
      processInstanceId: driver.processInstanceId,
      productionAuthorityGranted: false,
      async execute({ assignedWork, fault }) {
        requireCondition(state.executeAttempts === 0, `${testCase.id} bridge blocked a blind action retry`);
        state.executeAttempts += 1;
        assertPinnedState(state, `${testCase.id} pre-action`);
        try {
          const result = await driver.execute({ assignedWork: structuredClone(assignedWork), fault: structuredClone(fault ?? {}), controlId: testCase.id });
          assertPinnedState(state, `${testCase.id} post-action`);
          return result;
        } catch (error) {
          assertPinnedState(state, `${testCase.id} post-action-error`);
          throw error;
        }
      },
    };
    runtime.authenticate = createRuntimeAuthentication({ runtime, boundary: "action", packageIdentityHash, harnessContract });
    return runtime;
  };

  const observerRuntimeFactory = async ({ world, testCase }) => {
    const state = stateFor(world, `${testCase.id} observer runtime`);
    const { driver } = state;
    assertPinnedState(state, `${testCase.id} observer runtime`);
    const runtime = {
      ...observerIdentity(candidate),
      credentialAlias: driver.observer.credentialAlias,
      principalId: driver.observer.principalId,
      processInstanceId: driver.processInstanceId,
      readOnly: true,
      writeOperations: [],
      productionAuthorityGranted: false,
      async observe(request) {
        assertPinnedState(state, `${testCase.id} pre-observation`);
        const beforeWrites = driver.observerWrites();
        const beforeSnapshotHash = digest(driver.snapshot());
        const evidence = await driver.observe({ ...structuredClone(request), controlId: testCase.id });
        requireCondition(driver.observerWrites() === beforeWrites, `${testCase.id} observer driver performed a write`);
        requireCondition(digest(driver.snapshot()) === beforeSnapshotHash, `${testCase.id} observer driver mutated external state`);
        assertPinnedState(state, `${testCase.id} post-observation`);
        return evidence;
      },
    };
    runtime.authenticate = createRuntimeAuthentication({ runtime, boundary: "observer", packageIdentityHash, harnessContract });
    return runtime;
  };

  const restartRuntimeFactory = async ({ world, testCase }) => {
    const prior = stateFor(world, `${testCase.id} restart`);
    requireCondition(prior.restartAttempts === 0, `${testCase.id} bridge blocked repeated restart choreography`);
    prior.restartAttempts += 1;
    assertPinnedState(prior, `${testCase.id} pre-restart`);
    const priorProcessInstanceId = prior.driver.processInstanceId;
    const priorStorageIdentityHash = prior.driver.storageIdentityHash;
    const restartedDriver = await prior.driver.restart({
      testCase: structuredClone(testCase),
      candidate,
      observerContract,
      harnessContract,
      packageIdentityHash,
      bridgeContract,
    });
    assertDriver({ driver: restartedDriver, candidate, harnessContract, packageIdentityHash, bridgeContract, testCase, label: `${testCase.id} restarted` });
    requireCondition(restartedDriver.processInstanceId !== priorProcessInstanceId, `${testCase.id} restart reused the same process identity`);
    requireCondition(restartedDriver.storageIdentityHash === priorStorageIdentityHash, `${testCase.id} restart attached to a different durable store`);
    const restartedWorld = wrapDriver(restartedDriver, testCase, `${testCase.id} restarted`);
    return {
      world: restartedWorld,
      observerRuntime: await observerRuntimeFactory({ world: restartedWorld, testCase }),
    };
  };

  return Object.freeze({
    contract: bridgeContract,
    worldFactory,
    actionRuntimeFactory,
    observerRuntimeFactory,
    restartRuntimeFactory,
    authenticationAuthority: createSyntheticCustomerLocalChallengeAuthority({ harnessContract, packageIdentityHash }),
  });
}

/** Runs the shared bridge and returns only non-executable local qualification evidence. */
export async function runCustomerLocalQualificationRuntimeBridge({
  candidate,
  observerContract,
  harnessContract,
  packageIdentityHash,
  assignedWork,
  driverFactory,
  now = () => Date.now(),
}) {
  const cases = createCanonicalCustomerLocalQualificationCases({ assignedWork, packageIdentityHash });
  const caseContract = createCustomerLocalQualificationCaseContract({ candidate, cases, harnessContract });
  const bridge = createCustomerLocalQualificationRuntimeBridge({ candidate, observerContract, harnessContract, packageIdentityHash, driverFactory });
  const qualificationReceipt = await runCustomerLocalBindingQualification({
    candidate,
    observerContract,
    caseContract,
    harnessContract,
    cases,
    worldFactory: bridge.worldFactory,
    actionRuntimeFactory: bridge.actionRuntimeFactory,
    observerRuntimeFactory: bridge.observerRuntimeFactory,
    restartRuntimeFactory: bridge.restartRuntimeFactory,
    authenticationAuthority: bridge.authenticationAuthority,
    now,
  });
  assertCustomerLocalBindingQualification({ receipt: qualificationReceipt, candidate, observerContract, caseContract, harnessContract });
  const result = {
    schemaVersion: "das.customer-local-qualification-runtime-bridge-result.v1",
    packageIdentityHash,
    bridgeContractHash: bridge.contract.contractHash,
    caseContractHash: caseContract.contractHash,
    qualificationReceiptHash: qualificationReceipt.receiptHash,
    cases,
    caseContract,
    qualificationReceipt,
    modelCalls: 0,
    spendUsd: 0,
    productionAuthorityGranted: false,
    credentialsResolved: false,
    executableOperations: 0,
    executable: false,
    activationReady: false,
    evidenceBoundary: "Shared disposable local qualification result only. It does not establish a customer binding, executable operation, commercial acceptance, comparison readiness or activation.",
  };
  result.resultHash = digest(result);
  return Object.freeze(result);
}
