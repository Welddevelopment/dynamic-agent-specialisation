import { digest } from "../core/canonical.js";
import { assertProvisionalObserverContract, classifyObservedOutcome } from "./customer-local-observer-contract.js";

const ALIAS = /^[A-Z][A-Z0-9_]{5,120}$/;
const HASH = /^[a-f0-9]{64}$/;
const SECRET_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\bBasic\s+[A-Za-z0-9+/=]{8,}|\bsk-[A-Za-z0-9_-]{8,}|-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----|\b(?:password|secret|token|api[-_]?key)\s*[:=]\s*["']?[^\s,"'}]{6,})/i;
const CONTROL_EXPECTATIONS = Object.freeze({
  completed: Object.freeze({ classification: "completed", disposition: "accept", maximumBusinessWrites: 1 }),
  "not-started": Object.freeze({ classification: "not-started", disposition: "retry-eligible-after-explicit-gate", maximumBusinessWrites: 0 }),
  partial: Object.freeze({ classification: "partial", disposition: "halt-quarantine", maximumBusinessWrites: 1 }),
  incorrect: Object.freeze({ classification: "incorrect", disposition: "halt-quarantine", maximumBusinessWrites: 1 }),
  duplicate: Object.freeze({ classification: "duplicate", disposition: "halt-quarantine", maximumBusinessWrites: 2 }),
  stale: Object.freeze({ classification: "stale", disposition: "halt-handoff", maximumBusinessWrites: 1 }),
  collateral: Object.freeze({ classification: "collateral", disposition: "halt-quarantine", maximumBusinessWrites: 1 }),
  unknown: Object.freeze({ classification: "unknown", disposition: "halt-handoff", maximumBusinessWrites: 0 }),
  unavailable: Object.freeze({ classification: "unavailable", disposition: "halt-handoff", maximumBusinessWrites: 0 }),
  "lost-response": Object.freeze({ classification: "completed", disposition: "accept", maximumBusinessWrites: 1 }),
});
const REQUIRED_CONTROLS = Object.freeze(Object.keys(CONTROL_EXPECTATIONS));
const RUNNER_IMPLEMENTATION_HASH = digest({
  schemaVersion: "das.customer-local-binding-qualification-runner.v1",
  controls: REQUIRED_CONTROLS,
  evidence: "separate-before-and-after-observer",
  retry: "fresh-not-started-only-after-explicit-gate",
  actionResponse: "excluded-from-proof",
  canonicalControlProfileHash: digest(CONTROL_EXPECTATIONS),
});

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }
function clean(value, maximum = 200) { return String(value ?? "").trim().slice(0, maximum); }
function assertNoSecrets(value, label) { requireCondition(!SECRET_VALUE.test(JSON.stringify(value)), `${label} contains possible credential material`); }
function exactSet(values) { return [...new Set(values)].sort(); }
function sameSet(left, right) { return JSON.stringify(exactSet(left)) === JSON.stringify(exactSet(right)); }

export function createCustomerLocalQualificationHarnessContract({ harnessId, worldImplementationHash, persistentStoreSchemaHash, authenticationAuthorityHash, observerEvidenceSchemaHash, supportsFreshRuntimeReattach = true }) {
  requireCondition(clean(harnessId) && HASH.test(worldImplementationHash) && HASH.test(persistentStoreSchemaHash) && HASH.test(authenticationAuthorityHash) && HASH.test(observerEvidenceSchemaHash), "Qualification harness contract requires exact identities");
  requireCondition(supportsFreshRuntimeReattach === true, "Qualification harness must support fresh-runtime observer reattachment after a lost response");
  const contract = {
    schemaVersion: "das.customer-local-qualification-harness.v1",
    harnessId: clean(harnessId),
    worldImplementationHash,
    persistentStoreSchemaHash,
    authenticationAuthorityHash,
    observerEvidenceSchemaHash,
    supportsFreshRuntimeReattach: true,
    productionAuthorityGranted: false,
    credentialValuesIncluded: false,
    evidenceBoundary: "Disposable local qualification harness identity only. It grants no customer runtime authority.",
  };
  contract.contractHash = digest(contract);
  return Object.freeze(contract);
}

export function assertCustomerLocalQualificationHarnessContract(contract) {
  requireCondition(contract?.schemaVersion === "das.customer-local-qualification-harness.v1" && contract.contractHash === digest(withoutHash(contract, "contractHash")), "Qualification harness contract integrity mismatch");
  const expected = createCustomerLocalQualificationHarnessContract(contract);
  requireCondition(expected.contractHash === contract.contractHash, "Qualification harness contract changed");
  return true;
}

export function createCustomerLocalBindingCandidate({ structuralBinding, workPlan, action, observerContract }) {
  requireCondition(structuralBinding?.artifactHash === digest(withoutHash(structuralBinding, "artifactHash")), "Binding candidate structural receipt integrity mismatch");
  requireCondition(structuralBinding.workPlanHash === workPlan?.workPlanHash, "Binding candidate belongs to another work plan");
  assertProvisionalObserverContract({ contract: observerContract, structuralBinding, workPlan });
  requireCondition(clean(action?.bindingId) && clean(action?.surfaceId), "Action binding requires exact identities");
  requireCondition(HASH.test(action.implementationHash) && HASH.test(action.sourceHash) && HASH.test(action.runtimeSchemaHash) && HASH.test(action.transportIdentityHash), "Action binding requires exact implementation/source/runtime/transport hashes");
  requireCondition(Array.isArray(action.credentialAliases) && action.credentialAliases.length > 0 && action.credentialAliases.every((alias) => ALIAS.test(alias)), "Action binding credentials must be environment-reference aliases only");
  requireCondition(new Set(action.credentialAliases).size === action.credentialAliases.length, "Action credential aliases must be unique");
  requireCondition(Array.isArray(action.operations) && action.operations.length > 0, "Action binding requires reviewed operations");
  const structuralByName = new Map(structuralBinding.operations.map((operation) => [operation.sourceName, operation]));
  requireCondition(action.operations.length === structuralBinding.operations.length, "Action binding must cover every structurally compiled operation exactly once");
  requireCondition(new Set(action.operations.map((operation) => operation.sourceName)).size === action.operations.length, "Action binding cannot duplicate structurally compiled operations");
  const operations = action.operations.map((operation) => {
    const structural = structuralByName.get(operation.sourceName);
    requireCondition(structural?.status === "structurally-compiled-runtime-unprobed", `Action operation ${operation.sourceName} lacks structural compilation`);
    requireCondition(operation.mode === structural.mode && operation.authorityAction === structural.authorityAction && operation.targetExposedName === structural.targetExposedName, `Action operation ${operation.sourceName} changed reviewed mode, target or authority`);
    requireCondition(operation.boundedInputSchemaHash === structural.boundedInputSchemaHash, `Action operation ${operation.sourceName} runtime schema drifted`);
    requireCondition(operation.mode !== "write" || (clean(operation.idempotencyRule) && clean(operation.reconciliationRule) && clean(operation.stableIdentityRule)), `Write ${operation.sourceName} lacks explicit engineer-owned safety rules`);
    return structuredClone(operation);
  });
  requireCondition(structuralBinding.operations.every((operation) => operations.some((candidateOperation) => candidateOperation.sourceName === operation.sourceName)), "Action binding omitted a structurally compiled operation");
  requireCondition(action.surfaceId !== observerContract.surfaceId, "Action and observer surfaces must be distinct");
  requireCondition(action.implementationHash !== observerContract.implementationHash, "Action and observer implementations must be distinct");
  requireCondition(action.transportIdentityHash !== observerContract.transportIdentityHash, "Action and observer transport identities must be distinct");
  requireCondition(action.credentialAliases.every((alias) => !observerContract.credentialAliases.includes(alias)), "Action and observer credential aliases must be disjoint");
  const candidate = {
    schemaVersion: "das.customer-local-binding-candidate.v1",
    sessionId: structuralBinding.sessionId,
    systemId: structuralBinding.systemId,
    roleId: structuralBinding.descriptor?.roleId ?? null,
    workPlanHash: workPlan.workPlanHash,
    structuralBindingHash: structuralBinding.artifactHash,
    action: {
      bindingId: clean(action.bindingId),
      surfaceId: clean(action.surfaceId),
      credentialAliases: [...action.credentialAliases],
      implementationHash: action.implementationHash,
      sourceHash: action.sourceHash,
      runtimeSchemaHash: action.runtimeSchemaHash,
      transportIdentityHash: action.transportIdentityHash,
      operations,
      reviewed: true,
      probed: false,
    },
    observerContractHash: observerContract.contractHash,
    observer: {
      observerId: observerContract.observerId,
      surfaceId: observerContract.surfaceId,
      credentialAliases: [...observerContract.credentialAliases],
      implementationHash: observerContract.implementationHash,
      sourceHash: observerContract.sourceHash,
      runtimeSchemaHash: observerContract.runtimeSchemaHash,
      transportIdentityHash: observerContract.transportIdentityHash,
      readOperations: [...observerContract.readOperations],
      reviewed: true,
      probed: false,
      qualified: false,
    },
    status: "reviewed-candidate-non-executable",
    runtimeAuthorityGranted: false,
    credentialsResolved: false,
    acceptanceComplete: false,
    executableOperations: 0,
    executable: false,
    activationReady: false,
    evidenceBoundary: "Reviewed customer-local action and observer candidate only. Separate implementation identities and credential aliases are declarations, not runtime or qualification proof.",
  };
  assertNoSecrets(candidate, "Customer-local binding candidate");
  candidate.candidateHash = digest(candidate);
  return Object.freeze(candidate);
}

export function assertCustomerLocalBindingCandidate({ candidate, structuralBinding, workPlan, observerContract }) {
  requireCondition(candidate?.schemaVersion === "das.customer-local-binding-candidate.v1" && candidate.candidateHash === digest(withoutHash(candidate, "candidateHash")), "Customer-local binding candidate integrity mismatch");
  const expected = createCustomerLocalBindingCandidate({ structuralBinding, workPlan, action: candidate.action, observerContract });
  requireCondition(expected.candidateHash === candidate.candidateHash, "Customer-local binding candidate no longer matches reviewed inputs");
  requireCondition(candidate.runtimeAuthorityGranted === false && candidate.executable === false && candidate.activationReady === false && candidate.executableOperations === 0, "Customer-local binding candidate widened a protected gate");
  return true;
}

export function createCustomerLocalQualificationCaseContract({ candidate, cases, harnessContract }) {
  requireCondition(candidate?.candidateHash, "Qualification case contract requires a binding candidate");
  assertCustomerLocalQualificationHarnessContract(harnessContract);
  requireCondition(Array.isArray(cases) && cases.length === REQUIRED_CONTROLS.length, `Qualification requires exactly the ${REQUIRED_CONTROLS.length} mandatory controls`);
  const normalized = cases.map((entry) => {
    const id = clean(entry.id);
    const expected = CONTROL_EXPECTATIONS[id];
    requireCondition(expected, `Unknown qualification control ${id}`);
    if (entry.expectedClassification !== undefined) requireCondition(entry.expectedClassification === expected.classification, `Qualification control ${id} changed its canonical classification`);
    if (entry.expectedDisposition !== undefined) requireCondition(entry.expectedDisposition === expected.disposition, `Qualification control ${id} changed its canonical disposition`);
    if (entry.maximumBusinessWrites !== undefined) requireCondition(Number(entry.maximumBusinessWrites) === expected.maximumBusinessWrites, `Qualification control ${id} changed its canonical write bound`);
    requireCondition(entry.payload?.assignedWork && typeof entry.payload.assignedWork === "object", `Qualification control ${id} requires exact assigned work`);
    return { id, expectedClassification: expected.classification, expectedDisposition: expected.disposition, maximumBusinessWrites: expected.maximumBusinessWrites, payloadHash: digest(entry.payload) };
  });
  requireCondition(new Set(normalized.map((entry) => entry.id)).size === normalized.length && REQUIRED_CONTROLS.every((id) => normalized.some((entry) => entry.id === id)), "Qualification controls are missing or duplicated");
  const contract = { schemaVersion: "das.customer-local-qualification-case-contract.v1", candidateHash: candidate.candidateHash, harnessContractHash: harnessContract.contractHash, canonicalControlProfileHash: digest(CONTROL_EXPECTATIONS), cases: normalized, sourceCasesHash: digest(cases), controls: REQUIRED_CONTROLS, evidenceBoundary: "Frozen canonical local negative-control contract only. No control has run." };
  contract.contractHash = digest(contract);
  return Object.freeze(contract);
}

export function assertCustomerLocalQualificationCaseContract({ contract, candidate, cases, harnessContract }) {
  requireCondition(contract?.schemaVersion === "das.customer-local-qualification-case-contract.v1" && contract.contractHash === digest(withoutHash(contract, "contractHash")), "Qualification case contract integrity mismatch");
  requireCondition(contract.candidateHash === candidate.candidateHash && contract.canonicalControlProfileHash === digest(CONTROL_EXPECTATIONS), "Qualification case contract belongs to another candidate or control profile");
  const expected = createCustomerLocalQualificationCaseContract({ candidate, cases, harnessContract });
  requireCondition(expected.contractHash === contract.contractHash, "Qualification case contract changed after freeze");
  return true;
}

function assertWorld(world, harnessContract, label) {
  requireCondition(world?.harnessIdentityHash === harnessContract.worldImplementationHash, `${label} world implementation identity mismatch`);
  requireCondition(world?.persistentStoreSchemaHash === harnessContract.persistentStoreSchemaHash, `${label} persistent-store schema identity mismatch`);
  requireCondition(clean(world?.storageIdentityHash) && clean(world?.processInstanceId), `${label} world needs exact storage and process identities`);
  requireCondition(typeof world.businessWrites === "function" && typeof world.observerWrites === "function" && typeof world.snapshot === "function", `${label} world must expose exact write and state measurements`);
  requireCondition(Number.isInteger(world.businessWrites()) && world.businessWrites() >= 0 && Number.isInteger(world.observerWrites()) && world.observerWrites() >= 0, `${label} world write measurements are invalid`);
}

function exactWriteAuthority(candidate) {
  return candidate.action.operations.filter((operation) => operation.mode === "write").map((operation) => operation.authorityAction).sort();
}

function assertActionRuntime(runtime, candidate, world, label) {
  requireCondition(runtime?.bindingId === candidate.action.bindingId && runtime?.surfaceId === candidate.action.surfaceId, `${label} action runtime binding identity mismatch`);
  for (const key of ["implementationHash", "sourceHash", "runtimeSchemaHash", "transportIdentityHash"]) requireCondition(runtime?.[key] === candidate.action[key], `${label} action runtime ${key} mismatch`);
  requireCondition(candidate.action.credentialAliases.includes(runtime.credentialAlias), `${label} action runtime credential alias was not reviewed`);
  requireCondition(runtime.processInstanceId === world.processInstanceId, `${label} action runtime belongs to another process instance`);
  requireCondition(runtime.productionAuthorityGranted === false && sameSet(runtime.qualificationAuthorityActions ?? [], exactWriteAuthority(candidate)), `${label} action runtime widened its disposable qualification authority`);
  requireCondition(typeof runtime.execute === "function" && typeof runtime.authenticate === "function", `${label} action runtime is incomplete`);
}

function assertObserverRuntime(runtime, candidate, world, label) {
  requireCondition(runtime?.observerId === candidate.observer.observerId && runtime?.surfaceId === candidate.observer.surfaceId, `${label} observer runtime binding identity mismatch`);
  for (const key of ["implementationHash", "sourceHash", "runtimeSchemaHash", "transportIdentityHash"]) requireCondition(runtime?.[key] === candidate.observer[key], `${label} observer runtime ${key} mismatch`);
  requireCondition(candidate.observer.credentialAliases.includes(runtime.credentialAlias), `${label} observer runtime credential alias was not reviewed`);
  requireCondition(runtime.processInstanceId === world.processInstanceId, `${label} observer runtime belongs to another process instance`);
  requireCondition(runtime.readOnly === true && Array.isArray(runtime.writeOperations) && runtime.writeOperations.length === 0 && runtime.productionAuthorityGranted === false, `${label} observer runtime is not an exact read-only boundary`);
  requireCondition(typeof runtime.observe === "function" && typeof runtime.authenticate === "function", `${label} observer runtime is incomplete`);
}

async function authenticateRuntime({ authenticationAuthority, harnessContract, runtime, boundary, testCase, candidate, observerContract }) {
  requireCondition(authenticationAuthority?.authorityHash === harnessContract.authenticationAuthorityHash && typeof authenticationAuthority.issueChallenge === "function" && typeof authenticationAuthority.verify === "function", "Qualification authentication authority identity mismatch");
  const challenge = await authenticationAuthority.issueChallenge({ boundary, controlId: testCase.id, candidateHash: candidate.candidateHash, observerContractHash: observerContract.contractHash });
  requireCondition(challenge?.challengeHash === digest(withoutHash(challenge, "challengeHash")), `${testCase.id} ${boundary} authentication challenge integrity mismatch`);
  const proof = await runtime.authenticate({ challenge: structuredClone(challenge), boundary });
  requireCondition(proof?.challengeHash === challenge.challengeHash && proof?.boundary === boundary && proof?.credentialAlias === runtime.credentialAlias && clean(proof?.principalId), `${testCase.id} ${boundary} authentication proof mismatch`);
  requireCondition(proof.productionAuthorityGranted === false, `${testCase.id} ${boundary} authentication proof widened production authority`);
  if (boundary === "observer") requireCondition(proof.readOnly === true, `${testCase.id} observer authentication did not prove read-only scope`);
  requireCondition(await authenticationAuthority.verify({ boundary, runtime, challenge, proof }) === true, `${testCase.id} ${boundary} authentication challenge failed`);
  assertNoSecrets({ challenge, proof }, `${testCase.id} authentication receipt`);
  return digest({ challengeHash: challenge.challengeHash, proof });
}

async function observeReadOnly({ observerRuntime, world, request, label }) {
  const writesBefore = world.observerWrites();
  const stateBefore = digest(world.snapshot());
  const evidence = await observerRuntime.observe(request);
  requireCondition(world.observerWrites() === writesBefore, `${label} observer performed a write`);
  requireCondition(digest(world.snapshot()) === stateBefore, `${label} observer mutated external state`);
  return evidence;
}

export async function runCustomerLocalBindingQualification({ candidate, observerContract, caseContract, harnessContract, cases, worldFactory, actionRuntimeFactory, observerRuntimeFactory, restartRuntimeFactory, authenticationAuthority, now = () => Date.now() }) {
  assertCustomerLocalQualificationCaseContract({ contract: caseContract, candidate, cases, harnessContract });
  requireCondition(typeof worldFactory === "function" && typeof actionRuntimeFactory === "function" && typeof observerRuntimeFactory === "function" && typeof restartRuntimeFactory === "function", "Qualification requires disposable world, separate action/observer runtimes and fresh-runtime reattachment factories");
  const expectedById = new Map(caseContract.cases.map((entry) => [entry.id, entry]));
  const results = [];
  for (const testCase of cases) {
    const world = await worldFactory({ testCase: structuredClone(testCase) });
    assertWorld(world, harnessContract, testCase.id);
    let activeWorld = world;
    let actionRuntime = await actionRuntimeFactory({ candidate, world, testCase: structuredClone(testCase) });
    let observerRuntime = await observerRuntimeFactory({ candidate, observerContract, world, testCase: structuredClone(testCase) });
    assertActionRuntime(actionRuntime, candidate, world, testCase.id);
    assertObserverRuntime(observerRuntime, candidate, world, testCase.id);
    requireCondition(actionRuntime.surfaceId !== observerRuntime.surfaceId && actionRuntime.credentialAlias !== observerRuntime.credentialAlias, `${testCase.id} action and observer runtime boundaries collapsed`);
    const actionAuthenticationProofHash = await authenticateRuntime({ authenticationAuthority, harnessContract, runtime: actionRuntime, boundary: "action", testCase, candidate, observerContract });
    let observerAuthenticationProofHash = await authenticateRuntime({ authenticationAuthority, harnessContract, runtime: observerRuntime, boundary: "observer", testCase, candidate, observerContract });
    const beforeObservedAt = now();
    const before = await observeReadOnly({ observerRuntime, world: activeWorld, request: { phase: "before", assignedWork: structuredClone(testCase.payload.assignedWork), observerContractHash: observerContract.contractHash }, label: `${testCase.id} pre-action` });
    const observationFence = now();
    requireCondition(beforeObservedAt <= observationFence, `${testCase.id} trusted clock moved backwards before action`);
    let actionResult;
    try { actionResult = await actionRuntime.execute({ assignedWork: structuredClone(testCase.payload.assignedWork), fault: structuredClone(testCase.payload.fault ?? {}) }); }
    catch (error) {
      actionResult = {
        responseLost: error?.responseLost === true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    let restartedAfterLostResponse = false;
    if (actionResult?.responseLost === true) {
      const priorProcessInstanceId = activeWorld.processInstanceId;
      const priorStorageIdentityHash = activeWorld.storageIdentityHash;
      const restarted = await restartRuntimeFactory({ candidate, observerContract, world: activeWorld, testCase: structuredClone(testCase) });
      activeWorld = restarted?.world;
      observerRuntime = restarted?.observerRuntime;
      assertWorld(activeWorld, harnessContract, `${testCase.id} restarted`);
      assertObserverRuntime(observerRuntime, candidate, activeWorld, `${testCase.id} restarted`);
      requireCondition(activeWorld.storageIdentityHash === priorStorageIdentityHash && activeWorld.processInstanceId !== priorProcessInstanceId, `${testCase.id} lost-response recovery did not reattach a fresh runtime to the same durable state`);
      observerAuthenticationProofHash = await authenticateRuntime({ authenticationAuthority, harnessContract, runtime: observerRuntime, boundary: "observer", testCase, candidate, observerContract });
      restartedAfterLostResponse = true;
    }
    const after = await observeReadOnly({ observerRuntime, world: activeWorld, request: { phase: "after", assignedWork: structuredClone(testCase.payload.assignedWork), observerContractHash: observerContract.contractHash, observationNotBeforeMs: observationFence }, label: `${testCase.id} post-action` });
    const classification = classifyObservedOutcome({ contract: observerContract, beforeEvidence: before, afterEvidence: after, assignedWork: testCase.payload.assignedWork, actionTrace: { observationNotBeforeMs: observationFence, responseLost: actionResult?.responseLost === true }, nowMs: now() });
    const expected = expectedById.get(testCase.id);
    const businessWrites = activeWorld.businessWrites();
    const observerWrites = activeWorld.observerWrites();
    const passed = classification.classification === expected.expectedClassification && classification.disposition === expected.expectedDisposition && businessWrites <= expected.maximumBusinessWrites && observerWrites === 0 && (testCase.id !== "lost-response" || restartedAfterLostResponse);
    const receipt = { id: testCase.id, casePayloadHash: expected.payloadHash, expectedClassification: expected.expectedClassification, observedClassification: classification.classification, expectedDisposition: expected.expectedDisposition, observedDisposition: classification.disposition, businessWrites, observerWrites, maximumBusinessWrites: expected.maximumBusinessWrites, actionResponseIgnored: true, actionAuthenticationProofHash, observerAuthenticationProofHash, restartedAfterLostResponse, processInstanceId: activeWorld.processInstanceId, storageIdentityHash: activeWorld.storageIdentityHash, classification, passed, worldStateHash: digest(activeWorld.snapshot()), observerEvidenceHash: digest({ before, after }) };
    receipt.receiptHash = digest(receipt);
    results.push(receipt);
    if (!passed) break;
  }
  const allPassed = results.length === REQUIRED_CONTROLS.length && results.every((entry) => entry.passed);
  const receipt = {
    schemaVersion: "das.customer-local-binding-qualification.v1",
    candidateHash: candidate.candidateHash,
    observerContractHash: observerContract.contractHash,
    caseContractHash: caseContract.contractHash,
    harnessContractHash: harnessContract.contractHash,
    runnerImplementationHash: RUNNER_IMPLEMENTATION_HASH,
    status: allPassed ? "local-action-observer-qualified-non-executable" : "qualification-failed",
    cases: results,
    controlsPassed: results.filter((entry) => entry.passed).length,
    controlsRequired: REQUIRED_CONTROLS.length,
    qualificationPassed: allPassed,
    separatelyAuthenticatedObserverQualifiedLocally: allPassed,
    mandatoryCommercialAcceptanceComplete: false,
    executableOperations: 0,
    executable: false,
    activationReady: false,
    modelCalls: 0,
    spendUsd: 0,
    evidenceBoundary: "Disposable local action/observer qualification only. A pass does not grant credentials, runtime authority, commercial acceptance, execution or activation.",
  };
  receipt.receiptHash = digest(receipt);
  return Object.freeze(receipt);
}

export function assertCustomerLocalBindingQualification({ receipt, candidate, observerContract, caseContract, harnessContract }) {
  requireCondition(receipt?.schemaVersion === "das.customer-local-binding-qualification.v1" && receipt.receiptHash === digest(withoutHash(receipt, "receiptHash")), "Customer-local qualification receipt integrity mismatch");
  assertCustomerLocalQualificationHarnessContract(harnessContract);
  requireCondition(receipt.candidateHash === candidate.candidateHash && receipt.observerContractHash === observerContract.contractHash && receipt.caseContractHash === caseContract.contractHash && receipt.harnessContractHash === harnessContract.contractHash && caseContract.harnessContractHash === harnessContract.contractHash, "Customer-local qualification receipt was reused across another candidate, observer, harness or case contract");
  requireCondition(receipt.runnerImplementationHash === RUNNER_IMPLEMENTATION_HASH, "Customer-local qualification receipt came from another runner contract");
  requireCondition(receipt.executable === false && receipt.activationReady === false && receipt.executableOperations === 0 && receipt.mandatoryCommercialAcceptanceComplete === false, "Customer-local qualification widened execution or activation");
  requireCondition(receipt.cases.every((entry) => entry.receiptHash === digest(withoutHash(entry, "receiptHash"))), "Customer-local qualification case receipt integrity mismatch");
  const contractById = new Map(caseContract.cases.map((entry) => [entry.id, entry]));
  requireCondition(new Set(receipt.cases.map((entry) => entry.id)).size === receipt.cases.length, "Customer-local qualification receipt duplicated a control");
  const inconsistentCases = receipt.cases.filter((entry) => {
    const expected = contractById.get(entry.id);
    return !(expected
      && entry.casePayloadHash === expected.payloadHash
      && entry.expectedClassification === expected.expectedClassification
      && entry.expectedDisposition === expected.expectedDisposition
      && entry.maximumBusinessWrites === expected.maximumBusinessWrites
      && entry.observedClassification === entry.classification?.classification
      && entry.observedDisposition === entry.classification?.disposition
      && entry.actionResponseIgnored === true
      && entry.observerWrites === 0
      && HASH.test(entry.actionAuthenticationProofHash)
      && HASH.test(entry.observerAuthenticationProofHash)
      && entry.businessWrites <= entry.maximumBusinessWrites
      && (entry.id !== "lost-response" || entry.restartedAfterLostResponse === true)
      && entry.passed === (
        entry.observedClassification === entry.expectedClassification
        && entry.observedDisposition === entry.expectedDisposition
        && entry.businessWrites <= entry.maximumBusinessWrites
      ));
  });
  requireCondition(inconsistentCases.length === 0, `Customer-local qualification receipt does not match frozen control semantics: ${inconsistentCases.map((entry) => entry.id).join(",")}`);
  const passed = receipt.cases.filter((entry) => entry.passed).length;
  const allPassed = receipt.cases.length === REQUIRED_CONTROLS.length
    && REQUIRED_CONTROLS.every((id) => receipt.cases.some((entry) => entry.id === id))
    && passed === REQUIRED_CONTROLS.length;
  requireCondition(receipt.controlsRequired === REQUIRED_CONTROLS.length && receipt.controlsPassed === passed, "Customer-local qualification receipt control counts are inconsistent");
  requireCondition(receipt.qualificationPassed === allPassed, "Customer-local qualification receipt pass status is inconsistent");
  requireCondition(receipt.status === (allPassed ? "local-action-observer-qualified-non-executable" : "qualification-failed"), "Customer-local qualification receipt status is inconsistent");
  requireCondition(receipt.separatelyAuthenticatedObserverQualifiedLocally === allPassed, "Customer-local observer qualification status is inconsistent");
  requireCondition(receipt.modelCalls === 0 && receipt.spendUsd === 0, "Customer-local deterministic qualification receipt recorded model spend");
  return true;
}

export function sealCustomerLocalAcceptanceOnly({ qualificationReceipt, candidate, observerContract, caseContract, harnessContract }) {
  assertCustomerLocalBindingQualification({ receipt: qualificationReceipt, candidate, observerContract, caseContract, harnessContract });
  requireCondition(qualificationReceipt.qualificationPassed === true && qualificationReceipt.controlsPassed === qualificationReceipt.controlsRequired, "Local acceptance-only receipt requires every frozen qualification control to pass");
  const receipt = {
    schemaVersion: "das.customer-local-acceptance-only.v1",
    candidateHash: candidate.candidateHash,
    observerContractHash: observerContract.contractHash,
    caseContractHash: caseContract.contractHash,
    harnessContractHash: harnessContract.contractHash,
    qualificationReceiptHash: qualificationReceipt.receiptHash,
    controlsPassed: qualificationReceipt.controlsPassed,
    controlsRequired: qualificationReceipt.controlsRequired,
    status: "local-acceptance-only-passed-non-executable",
    observerQualifiedInDisposableLocalWorld: true,
    mandatoryCommercialAcceptanceComplete: false,
    customerEnvironmentAccepted: false,
    runtimeAuthorityGranted: false,
    credentialsResolved: false,
    executableOperations: 0,
    executable: false,
    activationReady: false,
    evidenceBoundary: "Frozen disposable local acceptance-only evidence. It does not substitute for exact customer-environment acceptance, credentials, authority, execution readiness or activation.",
  };
  receipt.receiptHash = digest(receipt);
  return Object.freeze(receipt);
}

export function assertCustomerLocalAcceptanceOnly({ receipt, qualificationReceipt, candidate, observerContract, caseContract, harnessContract }) {
  requireCondition(receipt?.schemaVersion === "das.customer-local-acceptance-only.v1" && receipt.receiptHash === digest(withoutHash(receipt, "receiptHash")), "Customer-local acceptance-only receipt integrity mismatch");
  const expected = sealCustomerLocalAcceptanceOnly({ qualificationReceipt, candidate, observerContract, caseContract, harnessContract });
  requireCondition(expected.receiptHash === receipt.receiptHash, "Customer-local acceptance-only receipt no longer matches its qualification evidence");
  requireCondition(receipt.executable === false && receipt.activationReady === false && receipt.executableOperations === 0 && receipt.mandatoryCommercialAcceptanceComplete === false, "Customer-local acceptance-only receipt widened a protected gate");
  return true;
}

export const CUSTOMER_LOCAL_QUALIFICATION_CONTROLS = REQUIRED_CONTROLS;
export const CUSTOMER_LOCAL_QUALIFICATION_RUNNER_HASH = RUNNER_IMPLEMENTATION_HASH;
export const CUSTOMER_LOCAL_QUALIFICATION_EXPECTATIONS = CONTROL_EXPECTATIONS;
