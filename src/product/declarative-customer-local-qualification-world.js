import { digest } from "../core/canonical.js";

const HASH = /^[a-f0-9]{64}$/;
const SECRET_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\bBasic\s+[A-Za-z0-9+/=]{8,}|\bsk-[A-Za-z0-9_-]{8,}|-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----|\b(?:password|secret|token|api[-_]?key)\s*[:=]\s*["']?[^\s,"'}]{6,})/i;
const CONTROLS = Object.freeze(["completed", "not-started", "partial", "incorrect", "duplicate", "stale", "collateral", "unknown", "unavailable", "lost-response"]);

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function clean(value, maximum = 200) { return String(value ?? "").trim().slice(0, maximum); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }
function strings(values, label) {
  requireCondition(Array.isArray(values) && values.length > 0, `${label} must be a non-empty array`);
  const normalized = values.map((value) => clean(value, 160));
  requireCondition(normalized.every(Boolean) && new Set(normalized).size === normalized.length, `${label} must contain unique non-empty values`);
  return normalized;
}
function assertNoSecrets(value, label) { requireCondition(!SECRET_VALUE.test(JSON.stringify(value)), `${label} contains possible credential material`); }

export function createDeclarativeQualificationWorldContract({
  packageIdentityHash,
  assignedWork,
  stableIdentityFields,
  requiredExactFields,
  resultIdentityField,
  statusField,
  completionStatus,
  allowedChangedEntityKind,
  partialField,
  incorrectField,
  incorrectValue,
  protectedStateDigest,
  observationTimeMs = 1_000,
  staleObservationTimeMs = 900,
}) {
  requireCondition(HASH.test(packageIdentityHash ?? ""), "Declarative world requires an exact package identity hash");
  requireCondition(assignedWork && typeof assignedWork === "object" && !Array.isArray(assignedWork), "Declarative world requires exact assigned work");
  const stable = strings(stableIdentityFields, "Stable identity fields");
  const exact = strings(requiredExactFields, "Required exact fields");
  requireCondition([...new Set([...stable, ...exact])].every((field) => Object.hasOwn(assignedWork, field)), "Assigned work omits a stable or required exact field");
  requireCondition(exact.includes(partialField), "Partial control must remove one required exact field");
  requireCondition(exact.includes(incorrectField), "Incorrect control must alter one required exact field");
  requireCondition(assignedWork[incorrectField] !== incorrectValue, "Incorrect control value must differ from assigned work");
  requireCondition(clean(resultIdentityField) && clean(statusField) && clean(completionStatus) && clean(allowedChangedEntityKind) && clean(protectedStateDigest), "Declarative world outcome and protected-state rules are incomplete");
  requireCondition(Number.isFinite(observationTimeMs) && Number.isFinite(staleObservationTimeMs) && staleObservationTimeMs < observationTimeMs, "Declarative world observation times are invalid");
  const contract = {
    schemaVersion: "das.declarative-customer-local-qualification-world.v1",
    packageIdentityHash,
    assignedWork: structuredClone(assignedWork),
    stableIdentityFields: stable,
    requiredExactFields: exact,
    resultIdentityField: clean(resultIdentityField),
    statusField: clean(statusField),
    completionStatus: clean(completionStatus),
    allowedChangedEntityKind: clean(allowedChangedEntityKind),
    partialField: clean(partialField),
    incorrectField: clean(incorrectField),
    incorrectValue: structuredClone(incorrectValue),
    protectedStateDigest: clean(protectedStateDigest),
    observationTimeMs,
    staleObservationTimeMs,
    controls: [...CONTROLS],
    packageSpecificCallbacks: 0,
    generatedExecutableCustomerCode: 0,
    productionAuthorityGranted: false,
    evidenceBoundary: "Declarative disposable qualification world only. Its business truth and fault outcomes are fixture inputs, not generated customer runtime or production evidence.",
  };
  assertNoSecrets(contract, "Declarative qualification world contract");
  contract.contractHash = digest(contract);
  return Object.freeze(contract);
}

export function assertDeclarativeQualificationWorldContract(contract) {
  requireCondition(contract?.schemaVersion === "das.declarative-customer-local-qualification-world.v1" && contract.contractHash === digest(withoutHash(contract, "contractHash")), "Declarative qualification world contract integrity mismatch");
  const expected = createDeclarativeQualificationWorldContract(contract);
  requireCondition(expected.contractHash === contract.contractHash, "Declarative qualification world contract changed");
  return true;
}

function exactAssignedWork(contract, value) {
  return digest(value) === digest(contract.assignedWork);
}

function candidateBoundary(candidate, kind, packageIdentityHash) {
  if (kind === "action") {
    return Object.freeze({
      bindingId: candidate.action.bindingId,
      surfaceId: candidate.action.surfaceId,
      implementationHash: candidate.action.implementationHash,
      sourceHash: candidate.action.sourceHash,
      runtimeSchemaHash: candidate.action.runtimeSchemaHash,
      transportIdentityHash: candidate.action.transportIdentityHash,
      credentialAlias: candidate.action.credentialAliases[0],
      principalId: `action-principal-${packageIdentityHash.slice(0, 16)}`,
      qualificationAuthorityActions: candidate.action.operations.filter((operation) => operation.mode === "write").map((operation) => operation.authorityAction).sort(),
      productionAuthorityGranted: false,
    });
  }
  return Object.freeze({
    observerId: candidate.observer.observerId,
    surfaceId: candidate.observer.surfaceId,
    implementationHash: candidate.observer.implementationHash,
    sourceHash: candidate.observer.sourceHash,
    runtimeSchemaHash: candidate.observer.runtimeSchemaHash,
    transportIdentityHash: candidate.observer.transportIdentityHash,
    credentialAlias: candidate.observer.credentialAliases[0],
    principalId: `observer-principal-${packageIdentityHash.slice(0, 16)}`,
    readOnly: true,
    writeOperations: [],
    productionAuthorityGranted: false,
  });
}

function createDriver({ contract, testCase, candidate, observerContract, harnessContract, packageIdentityHash, bridgeContract, store, processInstanceId }) {
  requireCondition(testCase?.payload?.qualificationPackageIdentityHash === packageIdentityHash && testCase?.id === testCase?.payload?.fault?.kind, "Declarative driver received a cross-package or mismatched control");
  requireCondition(exactAssignedWork(contract, testCase.payload.assignedWork), "Declarative driver assigned work differs from the frozen package");
  requireCondition(CONTROLS.includes(testCase.id), "Declarative driver received an unsupported control");
  const durable = store ?? { records: [], businessWrites: 0, observerWrites: 0, unrelatedStateDigest: contract.protectedStateDigest, additionalChanges: [], restartSequence: 0 };
  const storageIdentityHash = digest({ packageIdentityHash, controlId: testCase.id, durableStore: "declarative-qualification-v1" });
  const action = candidateBoundary(candidate, "action", packageIdentityHash);
  const observer = candidateBoundary(candidate, "observer", packageIdentityHash);

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
    action,
    observer,
    async execute({ assignedWork, fault, controlId }) {
      requireCondition(controlId === testCase.id && fault?.kind === testCase.id && exactAssignedWork(contract, assignedWork), "Declarative driver action input changed after freeze");
      if (["not-started", "unknown", "unavailable"].includes(testCase.id)) return { response: { accepted: true }, responseLost: false };
      const record = {
        ...structuredClone(assignedWork),
        [contract.resultIdentityField]: `${packageIdentityHash.slice(0, 12)}-result-1`,
        [contract.statusField]: contract.completionStatus,
      };
      if (testCase.id === "partial") delete record[contract.partialField];
      if (testCase.id === "incorrect") record[contract.incorrectField] = structuredClone(contract.incorrectValue);
      durable.records.push(record);
      durable.businessWrites += 1;
      if (testCase.id === "duplicate") {
        durable.records.push({ ...structuredClone(record), [contract.resultIdentityField]: `${packageIdentityHash.slice(0, 12)}-result-2` });
        durable.businessWrites += 1;
      }
      if (testCase.id === "collateral") {
        durable.unrelatedStateDigest = `${contract.protectedStateDigest}:mutated`;
        durable.additionalChanges.push({ kind: "protected-unrelated-state", id: `protected-${packageIdentityHash.slice(0, 12)}` });
      }
      if (testCase.id === "lost-response") {
        const error = new Error("simulated response lost after one durable commit");
        error.responseLost = true;
        throw error;
      }
      return { response: { created: true }, responseLost: false };
    },
    async observe({ phase, observerContractHash, controlId }) {
      requireCondition(controlId === testCase.id && observerContractHash === observerContract.contractHash, "Declarative driver observer request changed package or proof contract");
      if (phase === "after" && testCase.id === "unavailable") return { availability: "unavailable", reason: "fictional-read-only-observer-unavailable" };
      if (phase === "after" && testCase.id === "unknown") return { availability: "unknown", reason: "fictional-read-only-observer-could-not-establish-state" };
      const observedAt = phase === "after" && testCase.id === "stale" ? contract.staleObservationTimeMs : contract.observationTimeMs;
      return {
        provenance: "observer-direct-external-state",
        observerContractHash,
        [observerContract.freshness.snapshotGeneratedAtField]: observedAt,
        [observerContract.freshness.caughtUpThroughField]: observedAt,
        matches: phase === "before" ? [] : structuredClone(durable.records),
        [observerContract.collateralRules.changedEntitiesField]: phase === "before" ? [] : [
          ...durable.records.map((row) => ({ kind: contract.allowedChangedEntityKind, id: row[contract.resultIdentityField] })),
          ...structuredClone(durable.additionalChanges),
        ],
        [observerContract.collateralRules.unrelatedStateDigestField]: phase === "before" ? contract.protectedStateDigest : durable.unrelatedStateDigest,
      };
    },
    snapshot() { return { records: structuredClone(durable.records), businessWrites: durable.businessWrites, observerWrites: durable.observerWrites, unrelatedStateDigest: durable.unrelatedStateDigest, additionalChanges: structuredClone(durable.additionalChanges) }; },
    businessWrites() { return durable.businessWrites; },
    observerWrites() { return durable.observerWrites; },
    async restart({ testCase: restartedCase, candidate: restartedCandidate, observerContract: restartedObserver, harnessContract: restartedHarness, packageIdentityHash: restartedPackage, bridgeContract: restartedBridge }) {
      requireCondition(restartedPackage === packageIdentityHash && restartedCase.id === testCase.id && restartedCandidate.candidateHash === candidate.candidateHash && restartedObserver.contractHash === observerContract.contractHash && restartedHarness.contractHash === harnessContract.contractHash && restartedBridge.contractHash === bridgeContract.contractHash, "Declarative driver restart changed a frozen identity");
      durable.restartSequence += 1;
      return createDriver({ contract, testCase: restartedCase, candidate: restartedCandidate, observerContract: restartedObserver, harnessContract: restartedHarness, packageIdentityHash: restartedPackage, bridgeContract: restartedBridge, store: durable, processInstanceId: `${processInstanceId}:fresh-${durable.restartSequence}` });
    },
  };
  return Object.freeze(driver);
}

export function createDeclarativeQualificationDriverFactory({ contract }) {
  assertDeclarativeQualificationWorldContract(contract);
  return async function declarativeQualificationDriverFactory({ testCase, candidate, observerContract, harnessContract, packageIdentityHash, bridgeContract }) {
    requireCondition(packageIdentityHash === contract.packageIdentityHash, "Declarative driver factory received another package");
    return createDriver({ contract, testCase, candidate, observerContract, harnessContract, packageIdentityHash, bridgeContract, store: null, processInstanceId: `${packageIdentityHash.slice(0, 12)}:${testCase.id}:original` });
  };
}

export const DECLARATIVE_CUSTOMER_LOCAL_QUALIFICATION_CONTROLS = CONTROLS;

