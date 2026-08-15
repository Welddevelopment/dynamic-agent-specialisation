import test from "node:test";
import assert from "node:assert/strict";
import { digest } from "../src/core/canonical.js";
import { createProvisionalObserverContract, classifyObservedOutcome } from "../src/product/customer-local-observer-contract.js";
import {
  CUSTOMER_LOCAL_QUALIFICATION_RUNNER_HASH,
  assertCustomerLocalBindingCandidate,
  assertCustomerLocalBindingQualification,
  assertCustomerLocalAcceptanceOnly,
  createCustomerLocalQualificationHarnessContract,
  createCustomerLocalBindingCandidate,
  createCustomerLocalQualificationCaseContract,
  runCustomerLocalBindingQualification,
  sealCustomerLocalAcceptanceOnly,
} from "../src/product/customer-local-binding-qualification.js";

function frozenInputs() {
  const workPlan = {
    schemaVersion: "das.onboarding-binding-work-plan.v1",
    sessionId: "northbridge-facilities",
    systemId: "maintenance",
    approvedOperations: [],
    workPlanHash: digest({ id: "northbridge-reviewed-work-plan-v1" }),
  };
  const structuralBinding = {
    schemaVersion: "das.reviewed-onboarding-structural-binding.v1",
    sessionId: workPlan.sessionId,
    systemId: workPlan.systemId,
    workPlanHash: workPlan.workPlanHash,
    status: "structurally-compiled-runtime-unprobed",
    confirmationHash: digest({ confirmation: "northbridge-role-owner-v1" }),
    successCriteriaHash: digest({ success: "one exact draft and no collateral change" }),
    descriptor: { roleId: "northbridge-approved-maintenance-draft-coordinator" },
    operations: [
      { sourceName: "readApprovedMaintenanceRequest", targetExposedName: "maintenance:read-request", mode: "read", authorityAction: null, status: "structurally-compiled-runtime-unprobed", boundedInputSchemaHash: digest({ operation: "read" }) },
      { sourceName: "createDraftWorkOrder", targetExposedName: "maintenance:create-draft", mode: "write", authorityAction: "create-draft-maintenance-work-order", status: "structurally-compiled-runtime-unprobed", boundedInputSchemaHash: digest({ operation: "write" }) },
    ],
  };
  structuralBinding.artifactHash = digest(structuralBinding);
  const observerContract = createProvisionalObserverContract({
    structuralBinding,
    workPlan,
    observerId: "northbridge-maintenance-audit-v1",
    surfaceId: "facilities-audit",
    credentialAliases: ["NORTHBRIDGE_MAINTENANCE_AUDIT_TOKEN"],
    implementationHash: digest({ implementation: "observer-v1" }),
    sourceHash: digest({ source: "observer-openapi-v1" }),
    runtimeSchemaHash: digest({ schema: "observer-runtime-v1" }),
    transportIdentityHash: digest({ transport: "observer-service-v1" }),
    readOperations: ["readWorkOrderObservations", "readProtectedScopeSnapshot"],
    stableIdentity: { fields: ["sourceRequestId", "idempotencyKey"] },
    freshness: { snapshotGeneratedAtField: "snapshotGeneratedAtMs", caughtUpThroughField: "caughtUpThroughMs", maximumAgeMs: 50 },
    outcomeRules: { requiredExactFields: ["sourceRequestId", "idempotencyKey", "assetId", "siteId", "jobCode", "windowStart", "windowEnd", "priority"], statusField: "status", completionStatuses: ["draft"] },
    duplicateRule: { maximumDistinctResults: 1, resultIdentityField: "workOrderId" },
    collateralRules: { changedEntitiesField: "changedEntities", unrelatedStateDigestField: "unrelatedStateDigest", allowedChangedEntityKinds: ["draft-work-order"] },
    proofRuleReview: { responsibility: "engineer-owned-reviewed-unproved", reviewedBy: "Fictional facilities owner and test engineer", confirmationHash: structuralBinding.confirmationHash, successCriteriaHash: structuralBinding.successCriteriaHash },
  });
  const candidate = createCustomerLocalBindingCandidate({
    structuralBinding,
    workPlan,
    action: {
      bindingId: "northbridge-maintenance-command-v1",
      surfaceId: "facilities-action",
      credentialAliases: ["NORTHBRIDGE_MAINTENANCE_ACTION_TOKEN"],
      implementationHash: digest({ implementation: "action-v1" }),
      sourceHash: digest({ source: "action-openapi-v1" }),
      runtimeSchemaHash: digest({ schema: "action-runtime-v1" }),
      transportIdentityHash: digest({ transport: "action-service-v1" }),
      operations: [
        { sourceName: "readApprovedMaintenanceRequest", targetExposedName: "maintenance:read-request", mode: "read", authorityAction: null, boundedInputSchemaHash: structuralBinding.operations[0].boundedInputSchemaHash },
        { sourceName: "createDraftWorkOrder", targetExposedName: "maintenance:create-draft", mode: "write", authorityAction: "create-draft-maintenance-work-order", boundedInputSchemaHash: structuralBinding.operations[1].boundedInputSchemaHash, idempotencyRule: "one stable key per approved request", reconciliationRule: "observe by request and key before any retry", stableIdentityRule: "sourceRequestId + idempotencyKey" },
      ],
    },
    observerContract,
  });
  const harnessContract = createCustomerLocalQualificationHarnessContract({ harnessId: "northbridge-facilities-v1", worldImplementationHash: digest({ world: "facilities-world-v1" }), persistentStoreSchemaHash: digest({ store: "facilities-store-v1" }), authenticationAuthorityHash: digest({ authority: "synthetic-local-auth-v1" }), observerEvidenceSchemaHash: digest({ evidence: "facilities-observer-evidence-v1" }) });
  return { workPlan, structuralBinding, observerContract, candidate, harnessContract };
}

const assignedWork = Object.freeze({
  sourceRequestId: "pmr-0042",
  idempotencyKey: "maintenance-draft:pmr-0042:v1",
  assetId: "asset-chiller-07",
  siteId: "site-seoul-02",
  jobCode: "PM-FILTER-Q",
  windowStart: "2026-08-17T00:00:00Z",
  windowEnd: "2026-08-17T04:00:00Z",
  priority: "routine",
});

const expected = {
  completed: ["completed", "accept", 1],
  "not-started": ["not-started", "retry-eligible-after-explicit-gate", 0],
  partial: ["partial", "halt-quarantine", 1],
  incorrect: ["incorrect", "halt-quarantine", 1],
  duplicate: ["duplicate", "halt-quarantine", 2],
  stale: ["stale", "halt-handoff", 1],
  collateral: ["collateral", "halt-quarantine", 1],
  unknown: ["unknown", "halt-handoff", 0],
  unavailable: ["unavailable", "halt-handoff", 0],
  "lost-response": ["completed", "accept", 1],
};

function cases() {
  return Object.entries(expected).map(([id, [expectedClassification, expectedDisposition, maximumBusinessWrites]]) => ({ id, expectedClassification, expectedDisposition, maximumBusinessWrites, payload: { assignedWork, fault: { kind: id } } }));
}

class FacilitiesWorld {
  constructor(testCase, { store = null, processInstanceId = "process-original" } = {}) {
    this.case = testCase.id;
    this.store = store ?? { records: [], writes: 0, unrelatedDigest: "protected-v1", extraChanges: [] };
    this.harnessIdentityHash = digest({ world: "facilities-world-v1" });
    this.persistentStoreSchemaHash = digest({ store: "facilities-store-v1" });
    this.storageIdentityHash = digest({ caseId: this.case, storage: "durable-local-store" });
    this.processInstanceId = processInstanceId;
    this.readWrites = 0;
  }
  get records() { return this.store.records; }
  get writes() { return this.store.writes; }
  set writes(value) { this.store.writes = value; }
  get unrelatedDigest() { return this.store.unrelatedDigest; }
  set unrelatedDigest(value) { this.store.unrelatedDigest = value; }
  get extraChanges() { return this.store.extraChanges; }
  execute(work) {
    if (["not-started", "unknown", "unavailable"].includes(this.case)) return { response: { created: true }, responseLost: false };
    const base = { ...work, workOrderId: "wo-1", status: "draft" };
    if (this.case === "partial") delete base.priority;
    if (this.case === "incorrect") base.assetId = "wrong-asset";
    this.records.push(base); this.writes += 1;
    if (this.case === "duplicate") { this.records.push({ ...base, workOrderId: "wo-2" }); this.writes += 1; }
    if (this.case === "collateral") { this.unrelatedDigest = "protected-mutated"; this.extraChanges.push({ kind: "asset-state", id: "asset-chiller-07" }); }
    if (this.case === "lost-response") {
      const error = new Error("simulated response lost after commit");
      error.responseLost = true;
      throw error;
    }
    return { response: { created: true }, responseLost: false };
  }
  observe(phase, contractHash) {
    if (phase === "after" && this.case === "unavailable") return { availability: "unavailable", reason: "observer-timeout" };
    if (phase === "after" && this.case === "unknown") return { availability: "unknown", reason: "observer-could-not-establish-state" };
    const time = phase === "after" && this.case === "stale" ? 900 : 1000;
    return {
      provenance: "observer-direct-external-state",
      observerContractHash: contractHash,
      snapshotGeneratedAtMs: time,
      caughtUpThroughMs: time,
      matches: phase === "before" ? [] : structuredClone(this.records),
      changedEntities: phase === "before" ? [] : [...this.records.map((row) => ({ kind: "draft-work-order", id: row.workOrderId })), ...this.extraChanges],
      unrelatedStateDigest: phase === "before" ? "protected-v1" : this.unrelatedDigest,
    };
  }
  businessWrites() { return this.writes; }
  observerWrites() { return this.readWrites; }
  snapshot() { return { records: this.records, writes: this.writes, unrelatedDigest: this.unrelatedDigest }; }
}

function runtimeFactories() {
  function authenticationAuthority(harnessContract) {
    return {
      authorityHash: harnessContract.authenticationAuthorityHash,
      async issueChallenge({ boundary, controlId, candidateHash, observerContractHash }) {
        const challenge = { boundary, controlId, candidateHash, observerContractHash, nonce: `nonce-${boundary}-${controlId}` };
        challenge.challengeHash = digest(challenge);
        return challenge;
      },
      async verify({ boundary, runtime, challenge, proof }) {
        return proof.proofHash === digest({ boundary, principalId: proof.principalId, credentialAlias: runtime.credentialAlias, challengeHash: challenge.challengeHash, readOnly: boundary === "observer" });
      },
    };
  }
  function authenticate(runtime, boundary) {
    return async ({ challenge }) => {
      const proof = { boundary, principalId: `${boundary}-principal`, credentialAlias: runtime.credentialAlias, challengeHash: challenge.challengeHash, readOnly: boundary === "observer", productionAuthorityGranted: false };
      proof.proofHash = digest({ boundary, principalId: proof.principalId, credentialAlias: runtime.credentialAlias, challengeHash: challenge.challengeHash, readOnly: boundary === "observer" });
      return proof;
    };
  }
  const actionRuntimeFactory = async ({ candidate, world }) => {
    const runtime = { bindingId: candidate.action.bindingId, surfaceId: candidate.action.surfaceId, implementationHash: candidate.action.implementationHash, sourceHash: candidate.action.sourceHash, runtimeSchemaHash: candidate.action.runtimeSchemaHash, transportIdentityHash: candidate.action.transportIdentityHash, credentialAlias: candidate.action.credentialAliases[0], processInstanceId: world.processInstanceId, productionAuthorityGranted: false, qualificationAuthorityActions: candidate.action.operations.filter((operation) => operation.mode === "write").map((operation) => operation.authorityAction), async execute({ assignedWork: work }) { return world.execute(work); } };
    runtime.authenticate = authenticate(runtime, "action");
    return runtime;
  };
  const observerRuntimeFactory = async ({ candidate, observerContract, world }) => {
    const runtime = { observerId: candidate.observer.observerId, surfaceId: candidate.observer.surfaceId, implementationHash: candidate.observer.implementationHash, sourceHash: candidate.observer.sourceHash, runtimeSchemaHash: candidate.observer.runtimeSchemaHash, transportIdentityHash: candidate.observer.transportIdentityHash, credentialAlias: candidate.observer.credentialAliases[0], processInstanceId: world.processInstanceId, readOnly: true, writeOperations: [], productionAuthorityGranted: false, async observe({ phase }) { return world.observe(phase, observerContract.contractHash); } };
    runtime.authenticate = authenticate(runtime, "observer");
    return runtime;
  };
  const restartRuntimeFactory = async ({ candidate, observerContract, world }) => {
    const restartedWorld = new FacilitiesWorld({ id: world.case }, { store: world.store, processInstanceId: `${world.processInstanceId}-restarted` });
    return { world: restartedWorld, observerRuntime: await observerRuntimeFactory({ candidate, observerContract, world: restartedWorld }) };
  };
  return { authenticationAuthority, actionRuntimeFactory, observerRuntimeFactory, restartRuntimeFactory };
}

test("provisional action and observer candidate remains separate, secret-free, unprobed, and non-executable", () => {
  const { workPlan, structuralBinding, observerContract, candidate } = frozenInputs();
  assert.equal(assertCustomerLocalBindingCandidate({ candidate, structuralBinding, workPlan, observerContract }), true);
  assert.notEqual(candidate.action.surfaceId, candidate.observer.surfaceId);
  assert.notEqual(candidate.action.implementationHash, candidate.observer.implementationHash);
  assert.deepEqual(candidate.action.credentialAliases.filter((alias) => candidate.observer.credentialAliases.includes(alias)), []);
  assert.equal(candidate.executableOperations, 0);
  assert.equal(candidate.runtimeAuthorityGranted, false);
  assert.equal(candidate.executable, false);
  assert.equal(candidate.activationReady, false);
});

test("qualification executes all ten canonical local controls with authenticated observer proof and no blind retry", async () => {
  const { observerContract, candidate, harnessContract } = frozenInputs();
  const testCases = cases();
  const caseContract = createCustomerLocalQualificationCaseContract({ candidate, cases: testCases, harnessContract });
  const factories = runtimeFactories();
  const receipt = await runCustomerLocalBindingQualification({
    candidate,
    observerContract,
    caseContract,
    harnessContract,
    cases: testCases,
    now: () => 1000,
    worldFactory: async ({ testCase }) => new FacilitiesWorld(testCase),
    actionRuntimeFactory: factories.actionRuntimeFactory,
    observerRuntimeFactory: factories.observerRuntimeFactory,
    restartRuntimeFactory: factories.restartRuntimeFactory,
    authenticationAuthority: factories.authenticationAuthority(harnessContract),
  });
  assert.equal(assertCustomerLocalBindingQualification({ receipt, candidate, observerContract, caseContract, harnessContract }), true);
  assert.equal(receipt.controlsPassed, 10);
  assert.equal(receipt.qualificationPassed, true);
  assert.equal(receipt.cases.every((entry) => entry.actionResponseIgnored && entry.businessWrites <= entry.maximumBusinessWrites), true);
  assert.equal(receipt.cases.find((entry) => entry.id === "lost-response").classification.reconciledAfterLostResponse, true);
  assert.equal(receipt.cases.find((entry) => entry.id === "lost-response").businessWrites, 1);
  assert.equal(receipt.cases.find((entry) => entry.id === "lost-response").restartedAfterLostResponse, true);
  assert.equal(receipt.cases.find((entry) => entry.id === "not-started").classification.retryEligible, true);
  assert.equal(receipt.cases.filter((entry) => !["completed", "not-started", "lost-response"].includes(entry.id)).every((entry) => entry.classification.retryEligible === false), true);
  assert.equal(receipt.executableOperations, 0);
  assert.equal(receipt.mandatoryCommercialAcceptanceComplete, false);
  const acceptance = sealCustomerLocalAcceptanceOnly({ qualificationReceipt: receipt, candidate, observerContract, caseContract, harnessContract });
  assert.equal(assertCustomerLocalAcceptanceOnly({ receipt: acceptance, qualificationReceipt: receipt, candidate, observerContract, caseContract, harnessContract }), true);
  assert.equal(acceptance.observerQualifiedInDisposableLocalWorld, true);
  assert.equal(acceptance.mandatoryCommercialAcceptanceComplete, false);
  assert.equal(acceptance.executableOperations, 0);
});

test("action response cannot be accepted as independent proof", () => {
  const { observerContract } = frozenInputs();
  const before = { provenance: observerContract.evidenceProvenance, observerContractHash: observerContract.contractHash, snapshotGeneratedAtMs: 1000, caughtUpThroughMs: 1000, matches: [], changedEntities: [], unrelatedStateDigest: "protected-v1" };
  assert.throws(() => classifyObservedOutcome({ contract: observerContract, beforeEvidence: before, afterEvidence: { ...before, actionResponse: { created: true } }, assignedWork, actionTrace: { observationNotBeforeMs: 1000 }, nowMs: 1000 }), /response-derived|unapproved fields/);
});

test("future, pre-existing, and nested response-derived observer evidence fail closed", () => {
  const { observerContract } = frozenInputs();
  const before = { provenance: observerContract.evidenceProvenance, observerContractHash: observerContract.contractHash, snapshotGeneratedAtMs: 1000, caughtUpThroughMs: 1000, matches: [], changedEntities: [], unrelatedStateDigest: "protected-v1" };
  const completed = { ...assignedWork, workOrderId: "wo-1", status: "draft" };
  const after = { ...before, matches: [completed], changedEntities: [{ kind: "draft-work-order", id: "wo-1" }] };
  assert.throws(() => classifyObservedOutcome({ contract: observerContract, beforeEvidence: before, afterEvidence: { ...after, snapshotGeneratedAtMs: 1001, caughtUpThroughMs: 1001 }, assignedWork, actionTrace: { observationNotBeforeMs: 1000 }, nowMs: 1000 }), /future-dated/);
  assert.throws(() => classifyObservedOutcome({ contract: observerContract, beforeEvidence: { ...before, matches: [completed] }, afterEvidence: after, assignedWork, actionTrace: { observationNotBeforeMs: 1000 }, nowMs: 1000 }), /pre-existing/);
  assert.throws(() => classifyObservedOutcome({ contract: observerContract, beforeEvidence: before, afterEvidence: { ...after, matches: [{ ...completed, metadata: { writeResponse: "derived" } }] }, assignedWork, actionTrace: { observationNotBeforeMs: 1000 }, nowMs: 1000 }), /response-derived|unapproved fields/);
});

test("canonical controls cannot be weakened and exact action coverage cannot be reduced", () => {
  const { workPlan, structuralBinding, observerContract, candidate, harnessContract } = frozenInputs();
  const weakened = cases();
  weakened[0] = { ...weakened[0], expectedClassification: "unknown" };
  assert.throws(() => createCustomerLocalQualificationCaseContract({ candidate, cases: weakened, harnessContract }), /canonical classification/);
  const action = structuredClone(candidate.action);
  delete action.reviewed; delete action.probed;
  action.operations.pop();
  assert.throws(() => createCustomerLocalBindingCandidate({ structuralBinding, workPlan, action, observerContract }), /cover every/);
});

test("runtime identity substitution, authentication failure, and observer mutation fail before qualification", async () => {
  const { observerContract, candidate, harnessContract } = frozenInputs();
  const testCases = cases();
  const caseContract = createCustomerLocalQualificationCaseContract({ candidate, cases: testCases, harnessContract });
  const factories = runtimeFactories();
  const common = { candidate, observerContract, caseContract, harnessContract, cases: testCases, now: () => 1000, worldFactory: async ({ testCase }) => new FacilitiesWorld(testCase), observerRuntimeFactory: factories.observerRuntimeFactory, restartRuntimeFactory: factories.restartRuntimeFactory, authenticationAuthority: factories.authenticationAuthority(harnessContract) };
  await assert.rejects(() => runCustomerLocalBindingQualification({ ...common, actionRuntimeFactory: async (input) => ({ ...(await factories.actionRuntimeFactory(input)), runtimeSchemaHash: digest("substituted-runtime") }) }), /runtimeSchemaHash mismatch/);
  await assert.rejects(() => runCustomerLocalBindingQualification({ ...common, actionRuntimeFactory: async (input) => ({ ...(await factories.actionRuntimeFactory(input)), qualificationAuthorityActions: ["create-draft-maintenance-work-order", "dispatch-technician"] }) }), /widened its disposable qualification authority/);
  await assert.rejects(() => runCustomerLocalBindingQualification({ ...common, actionRuntimeFactory: factories.actionRuntimeFactory, authenticationAuthority: { ...factories.authenticationAuthority(harnessContract), async verify() { return false; } } }), /authentication challenge failed/);
  await assert.rejects(() => runCustomerLocalBindingQualification({ ...common, actionRuntimeFactory: factories.actionRuntimeFactory, worldFactory: async ({ testCase }) => { const world = new FacilitiesWorld(testCase); const original = world.observe.bind(world); world.observe = (...args) => { world.readWrites += 1; return original(...args); }; return world; } }), /observer performed a write/);
});

test("a generic action error is not relabelled as a lost response from the case name", async () => {
  const { observerContract, candidate, harnessContract } = frozenInputs();
  const testCases = cases();
  const caseContract = createCustomerLocalQualificationCaseContract({ candidate, cases: testCases, harnessContract });
  const factories = runtimeFactories();
  const receipt = await runCustomerLocalBindingQualification({
    candidate,
    observerContract,
    caseContract,
    harnessContract,
    cases: testCases,
    now: () => 1000,
    worldFactory: async ({ testCase }) => {
      const world = new FacilitiesWorld(testCase);
      if (testCase.id === "lost-response") world.execute = () => { throw new Error("ordinary transport failure before commit"); };
      return world;
    },
    actionRuntimeFactory: factories.actionRuntimeFactory,
    observerRuntimeFactory: factories.observerRuntimeFactory,
    restartRuntimeFactory: factories.restartRuntimeFactory,
    authenticationAuthority: factories.authenticationAuthority(harnessContract),
  });
  assert.equal(receipt.qualificationPassed, false);
  assert.equal(receipt.cases.at(-1).id, "lost-response");
  assert.equal(receipt.cases.at(-1).observedClassification, "not-started");
});

test("surface collapse, credential overlap, authority widening, schema drift, and literal credentials fail closed", () => {
  const { workPlan, structuralBinding, observerContract, candidate } = frozenInputs();
  const baseAction = candidate.action;
  for (const mutate of [
    (action) => { action.surfaceId = observerContract.surfaceId; },
    (action) => { action.credentialAliases = [...observerContract.credentialAliases]; },
    (action) => { action.operations[1].authorityAction = "dispatch-technician"; },
    (action) => { action.operations[1].boundedInputSchemaHash = digest({ drift: true }); },
    (action) => { action.credentialAliases = ["sk-literal-secret-123456789"]; },
  ]) {
    const action = structuredClone(baseAction);
    delete action.reviewed; delete action.probed;
    mutate(action);
    assert.throws(() => createCustomerLocalBindingCandidate({ structuralBinding, workPlan, action, observerContract }), /distinct|disjoint|changed|drifted|environment-reference|credential/i);
  }
});

test("qualification receipt cannot be reused across a mutated candidate, observer, or case contract", async () => {
  const { observerContract, candidate, harnessContract } = frozenInputs();
  const testCases = cases();
  const caseContract = createCustomerLocalQualificationCaseContract({ candidate, cases: testCases, harnessContract });
  const receipt = { schemaVersion: "das.customer-local-binding-qualification.v1", candidateHash: candidate.candidateHash, observerContractHash: observerContract.contractHash, caseContractHash: caseContract.contractHash, harnessContractHash: harnessContract.contractHash, runnerImplementationHash: CUSTOMER_LOCAL_QUALIFICATION_RUNNER_HASH, status: "qualification-failed", cases: [], controlsPassed: 0, controlsRequired: 10, qualificationPassed: false, separatelyAuthenticatedObserverQualifiedLocally: false, mandatoryCommercialAcceptanceComplete: false, executableOperations: 0, executable: false, activationReady: false, modelCalls: 0, spendUsd: 0, evidenceBoundary: "control" };
  receipt.receiptHash = digest(receipt);
  const changed = structuredClone(candidate); changed.candidateHash = digest({ changed: true });
  assert.throws(() => assertCustomerLocalBindingQualification({ receipt, candidate: changed, observerContract, caseContract, harnessContract }), /reused across/);
});
