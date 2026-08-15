import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { digest } from "../core/canonical.js";
import { AssistedCommercialOnboardingJourney } from "../product/assisted-onboarding-journey.js";
import {
  assertCustomerLocalAcceptanceOnly,
  assertCustomerLocalBindingCandidate,
  assertCustomerLocalBindingQualification,
  assertCustomerLocalQualificationCaseContract,
  createCustomerLocalBindingCandidate,
  createCustomerLocalQualificationCaseContract,
  createCustomerLocalQualificationHarnessContract,
  sealCustomerLocalAcceptanceOnly,
} from "../product/customer-local-binding-qualification.js";
import {
  assertProvisionalObserverContract,
  createProvisionalObserverContract,
} from "../product/customer-local-observer-contract.js";
import { proposeOnboardingSystemImport } from "../product/onboarding-system-import.js";
import {
  assertReviewedOnboardingStructuralBinding,
  createReviewedBindingImplementationInput,
} from "../product/reviewed-onboarding-binding-compiler.js";

const OUTPUT_ROOT = path.resolve("artifacts/onboarding/customer-local-action-observer-qualification-v1");
const FIXED_JOURNEY_NOW = "2026-08-14T09:00:00.000Z";
const FIXED_OBSERVATION_NOW_MS = 1_000;
const HARNESS_IDENTITIES = Object.freeze({
  worldImplementationHash: digest({ world: "northbridge-facilities-qualification-world-v2" }),
  persistentStoreSchemaHash: digest({ store: "northbridge-facilities-durable-store-v2" }),
  authenticationAuthorityHash: digest({ authority: "northbridge-synthetic-local-challenge-v1" }),
  observerEvidenceSchemaHash: digest({ evidence: "northbridge-facilities-observer-evidence-v2" }),
});

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function writePrivate(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
}

function examples() {
  return Array.from({ length: 5 }, (_, index) => ({
    situation: `Approved maintenance request ${index + 1}`,
    expected: `One exact independently observed draft work order ${index + 1}`,
    source: "fictional-customer-authored",
    redacted: true,
  }));
}

function maintenanceIntake() {
  return {
    sessionId: "northbridge-facilities-maintenance-draft-v1",
    company: {
      name: "Fictional Northbridge Facilities",
      industry: "Facilities operations",
      operatingContext: "Approved preventive-maintenance requests are converted into draft work orders in a disposable local test world.",
    },
    role: {
      templateId: "support-operations",
      title: "Approved maintenance draft coordinator",
      outcome: "Create exactly one draft work order for each assigned approved maintenance request.",
      completionRule: "Complete only after a separate read-only audit surface confirms the exact draft and unchanged unrelated state.",
      escalationOwner: "Facilities operations lead",
    },
    systems: [{
      id: "maintenance",
      name: "Northbridge maintenance service",
      kind: "customer-local facilities API",
      access: "customer-local-test",
      adapterStatus: "missing",
      contextSources: ["approved-maintenance-request", "maintenance-policy"],
      tools: [
        { name: "read-approved-request", mode: "read" },
        { name: "read-draft-observation", mode: "read" },
        { name: "create-draft-work-order", mode: "write" },
      ],
    }],
    knowledgeSources: [{
      name: "Maintenance drafting policy",
      kind: "policy",
      contentHash: digest("northbridge-fictional-maintenance-policy-v1"),
      current: true,
    }],
    policies: [
      { rule: "Read the assigned approved request before preparing its draft.", kind: "required-check", confirmed: true },
      { rule: "Any dispatch, purchase, asset shutdown or schedule change requires separate approval.", kind: "approval", confirmed: true },
      { rule: "Never change asset state, unrelated requests, schedules or live work orders.", kind: "forbidden", confirmed: true },
    ],
    authority: {
      allowedActions: ["create-draft-maintenance-work-order"],
      approvalActions: ["dispatch-technician", "purchase-part", "change-maintenance-window"],
      forbiddenActions: ["change-asset-state", "edit-unrelated-record", "activate-work-order"],
    },
    examples: examples(),
    success: {
      measures: [
        "Every assigned approved request has exactly one matching draft work order.",
        "Every draft matches the request, idempotency key, asset, site, job, window and priority.",
        "No unrelated or protected state changes.",
      ],
      verifierMode: "independent-external-state",
      verifierStatus: "declared",
      owner: "Customer-local facilities audit owner",
    },
    priorities: {
      quality: 1,
      cost: 0.2,
      speed: 0.2,
      maximumCostPerTaskUsd: 0.5,
      maximumLatencyMs: 300_000,
      goal: "Preserve exact, duplicate-free drafts and protected state before optimizing cost or speed.",
    },
    currentAgent: { mode: "none" },
    dataHandling: { localOnly: true, productionDataIncluded: false, redactionConfirmed: true },
  };
}

function maintenanceOpenApiSource() {
  return {
    kind: "openapi",
    document: {
      openapi: "3.1.0",
      info: { title: "Fictional Northbridge Maintenance Actions", version: "1.0.0" },
      servers: [{ url: "https://maintenance-actions.example.test/v1" }],
      paths: {
        "/maintenance/requests/{requestId}": {
          get: {
            operationId: "readApprovedMaintenanceRequest",
            summary: "Read one assigned approved maintenance request",
            parameters: [{ name: "requestId", in: "path", required: true, schema: { type: "string" } }],
            responses: { "200": { description: "Approved request" } },
          },
        },
        "/maintenance/work-orders": {
          post: {
            operationId: "createDraftWorkOrder",
            summary: "Create one bounded draft maintenance work order",
            parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" } }],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["sourceRequestId", "idempotencyKey", "assetId", "siteId", "jobCode", "windowStart", "windowEnd", "priority"],
                    properties: {
                      sourceRequestId: { type: "string" },
                      idempotencyKey: { type: "string" },
                      assetId: { type: "string" },
                      siteId: { type: "string" },
                      jobCode: { type: "string" },
                      windowStart: { type: "string" },
                      windowEnd: { type: "string" },
                      priority: { type: "string", enum: ["routine", "urgent"] },
                    },
                    additionalProperties: false,
                  },
                },
              },
            },
            responses: { "201": { description: "Draft created" } },
          },
        },
        "/maintenance/work-orders/by-request/{requestId}": {
          get: {
            operationId: "readDraftWorkOrderObservation",
            summary: "Read draft work-order state by source request",
            parameters: [{ name: "requestId", in: "path", required: true, schema: { type: "string" } }],
            responses: { "200": { description: "Draft observation" }, "404": { description: "Not found" } },
          },
        },
      },
    },
  };
}

function reviewedDecisions(proposal) {
  const targetBySource = {
    readApprovedMaintenanceRequest: ["maintenance:read-approved-request", "read", null],
    readDraftWorkOrderObservation: ["maintenance:read-draft-observation", "read", null],
    createDraftWorkOrder: ["maintenance:create-draft-work-order", "write", "create-draft-maintenance-work-order"],
  };
  return {
    operationChoices: proposal.operations.map((operation) => {
      const target = targetBySource[operation.sourceName];
      requireCondition(target, `No frozen review decision for ${operation.sourceName}`);
      return {
        sourceName: operation.sourceName,
        approved: true,
        targetExposedName: target[0],
        confirmedMode: target[1],
        authorityAction: target[2],
        requiredContextSources: [...operation.proposedContextSources],
      };
    }),
    contextChoices: proposal.proposedContextSources.map((sourceId) => ({ sourceId, approved: true })),
  };
}

function writeSafety(workPlan) {
  return createReviewedBindingImplementationInput({
    workPlan,
    adapterVersion: "0.1.0",
    credentialRefs: {},
    writeSafety: [{
      sourceName: "createDraftWorkOrder",
      idempotencyHeader: "Idempotency-Key",
      verification: {
        readOperationId: "readDraftWorkOrderObservation",
        inputMap: [{
          targetSection: "path",
          targetName: "requestId",
          writeInputPointer: "/body/sourceRequestId",
        }],
        assertions: [
          { actualPointer: "/sourceRequestId", equalsWriteInputPointer: "/body/sourceRequestId" },
          { actualPointer: "/idempotencyKey", equalsWriteInputPointer: "/body/idempotencyKey" },
          { actualPointer: "/assetId", equalsWriteInputPointer: "/body/assetId" },
          { actualPointer: "/siteId", equalsWriteInputPointer: "/body/siteId" },
          { actualPointer: "/jobCode", equalsWriteInputPointer: "/body/jobCode" },
          { actualPointer: "/windowStart", equalsWriteInputPointer: "/body/windowStart" },
          { actualPointer: "/windowEnd", equalsWriteInputPointer: "/body/windowEnd" },
          { actualPointer: "/priority", equalsWriteInputPointer: "/body/priority" },
        ],
      },
    }],
  });
}

function observerFor(structuralBinding, workPlan) {
  const auditSource = {
    title: "Fictional Northbridge Maintenance Audit",
    version: "1.0.0",
    origin: "https://maintenance-audit.example.test",
    operations: ["readWorkOrderObservations", "readProtectedScopeSnapshot"],
  };
  return createProvisionalObserverContract({
    structuralBinding,
    workPlan,
    observerId: "northbridge-maintenance-audit-v1",
    surfaceId: "northbridge-facilities-read-only-audit",
    credentialAliases: ["NORTHBRIDGE_FACILITIES_AUDIT_TOKEN"],
    implementationHash: digest({ implementation: "northbridge-facilities-audit-adapter-v1" }),
    sourceHash: digest(auditSource),
    runtimeSchemaHash: digest({
      assignedWorkKeys: ["sourceRequestId", "idempotencyKey"],
      resultKeys: ["workOrderId", "sourceRequestId", "idempotencyKey", "assetId", "siteId", "jobCode", "windowStart", "windowEnd", "priority", "status"],
    }),
    transportIdentityHash: digest({ origin: auditSource.origin, protocol: "https-read-only" }),
    readOperations: auditSource.operations,
    stableIdentity: { fields: ["sourceRequestId", "idempotencyKey"] },
    freshness: {
      snapshotGeneratedAtField: "snapshotGeneratedAtMs",
      caughtUpThroughField: "caughtUpThroughMs",
      maximumAgeMs: 50,
    },
    outcomeRules: {
      requiredExactFields: ["sourceRequestId", "idempotencyKey", "assetId", "siteId", "jobCode", "windowStart", "windowEnd", "priority"],
      statusField: "status",
      completionStatuses: ["draft"],
    },
    duplicateRule: { maximumDistinctResults: 1, resultIdentityField: "workOrderId" },
    collateralRules: {
      changedEntitiesField: "changedEntities",
      unrelatedStateDigestField: "unrelatedStateDigest",
      allowedChangedEntityKinds: ["draft-work-order"],
    },
    proofRuleReview: {
      responsibility: "engineer-owned-reviewed-unproved",
      reviewedBy: "Fictional Northbridge facilities owner and local test engineer",
      confirmationHash: structuralBinding.confirmationHash,
      successCriteriaHash: structuralBinding.successCriteriaHash,
    },
  });
}

function actionFor(structuralBinding, observerContract) {
  const transportIdentities = structuralBinding.compilerSegments.map((segment) => segment.transportIdentityHash);
  return {
    bindingId: "northbridge-maintenance-action-v1",
    surfaceId: "northbridge-facilities-action-api",
    credentialAliases: ["NORTHBRIDGE_FACILITIES_ACTION_TOKEN"],
    implementationHash: digest({ implementation: "northbridge-facilities-action-adapter-v1" }),
    sourceHash: structuralBinding.source.sourceHash,
    runtimeSchemaHash: digest(structuralBinding.operations.map((operation) => ({
      sourceName: operation.sourceName,
      boundedInputSchemaHash: operation.boundedInputSchemaHash,
    }))),
    transportIdentityHash: digest({ identities: transportIdentities, boundary: "action-only" }),
    operations: structuralBinding.operations.map((operation) => ({
      sourceName: operation.sourceName,
      targetExposedName: operation.targetExposedName,
      mode: operation.mode,
      authorityAction: operation.authorityAction,
      boundedInputSchemaHash: operation.boundedInputSchemaHash,
      ...(operation.mode === "write" ? {
        idempotencyRule: "Use one stable idempotencyKey for the exact sourceRequestId and never generate a replacement key for retry.",
        reconciliationRule: `Before any retry, query ${observerContract.observerId} by sourceRequestId plus idempotencyKey and accept only its fresh direct external-state classification.`,
        stableIdentityRule: "sourceRequestId + idempotencyKey",
      } : {}),
    })),
  };
}

const ASSIGNED_WORK = Object.freeze({
  sourceRequestId: "pmr-0042",
  idempotencyKey: "maintenance-draft:pmr-0042:v1",
  assetId: "asset-chiller-07",
  siteId: "site-seoul-02",
  jobCode: "PM-FILTER-Q",
  windowStart: "2026-08-17T00:00:00Z",
  windowEnd: "2026-08-17T04:00:00Z",
  priority: "routine",
});

const CONTROL_EXPECTATIONS = Object.freeze({
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
});

function qualificationCases() {
  return Object.entries(CONTROL_EXPECTATIONS).map(([
    id,
    [expectedClassification, expectedDisposition, maximumBusinessWrites],
  ]) => ({
    id,
    expectedClassification,
    expectedDisposition,
    maximumBusinessWrites,
    payload: { assignedWork: ASSIGNED_WORK, fault: { kind: id } },
  }));
}

class FacilitiesQualificationWorld {
  constructor(testCase, {
    store = null,
    processInstanceId = `northbridge-original-${testCase.id}`,
  } = {}) {
    this.caseId = testCase.id;
    this.store = store ?? {
      records: [],
      writeCount: 0,
      observerWriteCount: 0,
      unrelatedDigest: "protected-facilities-state-v1",
      additionalChanges: [],
      disposed: false,
    };
    this.harnessIdentityHash = HARNESS_IDENTITIES.worldImplementationHash;
    this.persistentStoreSchemaHash = HARNESS_IDENTITIES.persistentStoreSchemaHash;
    this.storageIdentityHash = digest({ caseId: this.caseId, store: "northbridge-durable-local-qualification-v1" });
    this.processInstanceId = processInstanceId;
  }

  get records() { return this.store.records; }
  get writeCount() { return this.store.writeCount; }
  set writeCount(value) { this.store.writeCount = value; }
  get unrelatedDigest() { return this.store.unrelatedDigest; }
  set unrelatedDigest(value) { this.store.unrelatedDigest = value; }
  get additionalChanges() { return this.store.additionalChanges; }
  get disposed() { return this.store.disposed; }

  execute(work) {
    requireCondition(!this.disposed, "Disposed qualification world cannot execute");
    if (["not-started", "unknown", "unavailable"].includes(this.caseId)) {
      return { response: { created: true, untrustedClaimOnly: true }, responseLost: false };
    }
    const row = { ...work, workOrderId: "wo-0001", status: "draft" };
    if (this.caseId === "partial") delete row.priority;
    if (this.caseId === "incorrect") row.assetId = "asset-wrong-99";
    this.records.push(row);
    this.writeCount += 1;
    if (this.caseId === "duplicate") {
      this.records.push({ ...row, workOrderId: "wo-0002" });
      this.writeCount += 1;
    }
    if (this.caseId === "collateral") {
      this.unrelatedDigest = "protected-facilities-state-mutated";
      this.additionalChanges.push({ kind: "asset-state", id: work.assetId });
    }
    if (this.caseId === "lost-response") {
      const error = new Error("simulated response loss after committed draft");
      error.responseLost = true;
      throw error;
    }
    return { response: { created: true, workOrderId: row.workOrderId }, responseLost: false };
  }

  observe(phase, observerContractHash) {
    requireCondition(!this.disposed, "Disposed qualification world cannot be observed");
    if (phase === "after" && this.caseId === "unavailable") {
      return { availability: "unavailable", reason: "fictional-audit-timeout" };
    }
    if (phase === "after" && this.caseId === "unknown") {
      return { availability: "unknown", reason: "fictional-audit-could-not-establish-state" };
    }
    const observedAt = phase === "after" && this.caseId === "stale" ? 900 : FIXED_OBSERVATION_NOW_MS;
    return {
      provenance: "observer-direct-external-state",
      observerContractHash,
      snapshotGeneratedAtMs: observedAt,
      caughtUpThroughMs: observedAt,
      matches: phase === "before" ? [] : structuredClone(this.records),
      changedEntities: phase === "before"
        ? []
        : [
            ...this.records.map((row) => ({ kind: "draft-work-order", id: row.workOrderId })),
            ...this.additionalChanges,
          ],
      unrelatedStateDigest: phase === "before" ? "protected-facilities-state-v1" : this.unrelatedDigest,
    };
  }

  businessWrites() {
    return this.writeCount;
  }

  observerWrites() {
    return this.store.observerWriteCount;
  }

  snapshot() {
    return {
      records: structuredClone(this.records),
      writeCount: this.writeCount,
      unrelatedDigest: this.unrelatedDigest,
      additionalChanges: structuredClone(this.additionalChanges),
      disposed: this.disposed,
    };
  }

  dispose() {
    this.store.records = [];
    this.writeCount = 0;
    this.unrelatedDigest = "disposed";
    this.store.additionalChanges = [];
    this.store.observerWriteCount = 0;
    this.store.disposed = true;
  }
}

function qualificationRuntimeFactories(harnessContract, worlds) {
  const authenticationAuthority = {
    authorityHash: harnessContract.authenticationAuthorityHash,
    async issueChallenge({ boundary, controlId, candidateHash, observerContractHash }) {
      const challenge = {
        boundary,
        controlId,
        candidateHash,
        observerContractHash,
        nonce: `northbridge-synthetic-${boundary}-${controlId}`,
      };
      challenge.challengeHash = digest(challenge);
      return challenge;
    },
    async verify({ boundary, runtime, challenge, proof }) {
      return proof.proofHash === digest({
        boundary,
        principalId: proof.principalId,
        credentialAlias: runtime.credentialAlias,
        challengeHash: challenge.challengeHash,
        readOnly: boundary === "observer",
      });
    },
  };

  function authenticate(runtime, boundary) {
    return async ({ challenge }) => {
      const proof = {
        boundary,
        principalId: `${boundary}-northbridge-disposable-principal`,
        credentialAlias: runtime.credentialAlias,
        challengeHash: challenge.challengeHash,
        readOnly: boundary === "observer",
        productionAuthorityGranted: false,
      };
      proof.proofHash = digest({
        boundary,
        principalId: proof.principalId,
        credentialAlias: runtime.credentialAlias,
        challengeHash: challenge.challengeHash,
        readOnly: boundary === "observer",
      });
      return proof;
    };
  }

  const actionRuntimeFactory = async ({ candidate, world }) => {
    const runtime = {
      bindingId: candidate.action.bindingId,
      surfaceId: candidate.action.surfaceId,
      implementationHash: candidate.action.implementationHash,
      sourceHash: candidate.action.sourceHash,
      runtimeSchemaHash: candidate.action.runtimeSchemaHash,
      transportIdentityHash: candidate.action.transportIdentityHash,
      credentialAlias: candidate.action.credentialAliases[0],
      processInstanceId: world.processInstanceId,
      productionAuthorityGranted: false,
      qualificationAuthorityActions: candidate.action.operations
        .filter((operation) => operation.mode === "write")
        .map((operation) => operation.authorityAction),
      async execute({ assignedWork }) { return world.execute(assignedWork); },
    };
    runtime.authenticate = authenticate(runtime, "action");
    return runtime;
  };

  const observerRuntimeFactory = async ({ candidate, observerContract, world }) => {
    const runtime = {
      observerId: candidate.observer.observerId,
      surfaceId: candidate.observer.surfaceId,
      implementationHash: candidate.observer.implementationHash,
      sourceHash: candidate.observer.sourceHash,
      runtimeSchemaHash: candidate.observer.runtimeSchemaHash,
      transportIdentityHash: candidate.observer.transportIdentityHash,
      credentialAlias: candidate.observer.credentialAliases[0],
      processInstanceId: world.processInstanceId,
      readOnly: true,
      writeOperations: [],
      productionAuthorityGranted: false,
      async observe({ phase }) { return world.observe(phase, observerContract.contractHash); },
    };
    runtime.authenticate = authenticate(runtime, "observer");
    return runtime;
  };

  const restartRuntimeFactory = async ({ candidate, observerContract, world }) => {
    const restartedWorld = new FacilitiesQualificationWorld(
      { id: world.caseId },
      {
        store: world.store,
        processInstanceId: `${world.processInstanceId}-fresh-process`,
      },
    );
    worlds.push(restartedWorld);
    return {
      world: restartedWorld,
      observerRuntime: await observerRuntimeFactory({ candidate, observerContract, world: restartedWorld }),
    };
  };

  return {
    authenticationAuthority,
    actionRuntimeFactory,
    observerRuntimeFactory,
    restartRuntimeFactory,
  };
}

function explicitInputMeasurements(structuralBinding, observerContract, candidate) {
  const writeOperations = candidate.action.operations.filter((operation) => operation.mode === "write");
  const observerRuleInputs = {
    stableIdentityFields: observerContract.stableIdentity.fields.length,
    freshnessRules: 3,
    exactOutcomeFields: observerContract.outcomeRules.requiredExactFields.length,
    completionStatuses: observerContract.outcomeRules.completionStatuses.length,
    duplicateRules: 2,
    collateralRules: 3,
    proofRuleReviewBindings: 3,
  };
  return {
    genericCompilerFieldsTargeted: structuralBinding.measurements.targetedGenericCompilerFields,
    genericCompilerFieldsRetiredByDas012: structuralBinding.measurements.retiredGenericCompilerFields,
    genericCompilerFieldsRemainingAfterDas012: structuralBinding.measurements.remainingGenericCompilerFields,
    structurallyCompiledOperations: structuralBinding.measurements.structurallyCompiledOperations,
    customerSpecificWriteSafetyRuleInputs: {
      idempotencyRules: writeOperations.length,
      reconciliationRules: writeOperations.length,
      stableIdentityRules: writeOperations.length,
      total: writeOperations.length * 3,
    },
    observerRuleInputs: {
      ...observerRuleInputs,
      total: Object.values(observerRuleInputs).reduce((total, value) => total + value, 0),
    },
    distinctActionCredentialAliases: candidate.action.credentialAliases.length,
    distinctObserverCredentialAliases: candidate.observer.credentialAliases.length,
    actionObserverSharedCredentialAliases: candidate.action.credentialAliases.filter((alias) => candidate.observer.credentialAliases.includes(alias)).length,
  };
}

async function execute() {
  requireCondition(!fs.existsSync(OUTPUT_ROOT), `Refusing to overwrite preserved DAS-022 evidence: ${OUTPUT_ROOT}`);
  const machineStarted = performance.now();
  const startedAt = new Date().toISOString();
  const journeyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "das022-northbridge-"));
  const worlds = [];
  try {
    const intake = maintenanceIntake();
    const source = maintenanceOpenApiSource();
    const journey = new AssistedCommercialOnboardingJourney({ stateDirectory: journeyRoot, now: () => FIXED_JOURNEY_NOW });
    const saved = journey.saveBusinessIntake(intake);
    requireCondition(saved.generated.bindingScaffold === true, `Fresh DAS-022 intake did not generate a binding scaffold: ${JSON.stringify(saved.questions)}`);
    const record = journey.record(intake.sessionId);
    const proposal = proposeOnboardingSystemImport({
      intake: record.intake,
      systemId: "maintenance",
      source,
      provenance: { acquisition: "engineer-local-fixture", label: "Fresh fictional Northbridge maintenance OpenAPI" },
    });
    journey.recordSystemImportProposal({ sessionId: record.sessionId, proposal, source });
    const confirmed = journey.recordSystemImportConfirmation({
      sessionId: record.sessionId,
      proposalHash: proposal.proposalHash,
      source,
      decisions: reviewedDecisions(proposal),
      confirmedBy: "Fictional Northbridge facilities role owner",
    });
    const implementationInput = writeSafety(confirmed.workPlan);
    const compiled = journey.recordSystemImportStructuralCompilation({
      sessionId: record.sessionId,
      proposalHash: proposal.proposalHash,
      source,
      implementationInput,
    });
    const structuralBinding = compiled.structuralBinding;
    assertReviewedOnboardingStructuralBinding({
      artifact: structuralBinding,
      workPlan: confirmed.workPlan,
      proposal,
      confirmation: confirmed.confirmation,
      intake: record.intake,
      source,
      bindingScaffold: journey.record(record.sessionId).binding.scaffold.descriptor,
      implementationInput,
    });
    requireCondition(structuralBinding.status === "structurally-compiled-runtime-unprobed", "Fresh DAS-012 input did not fully structurally compile");

    const observerContract = observerFor(structuralBinding, confirmed.workPlan);
    assertProvisionalObserverContract({ contract: observerContract, structuralBinding, workPlan: confirmed.workPlan });
    const candidate = createCustomerLocalBindingCandidate({
      structuralBinding,
      workPlan: confirmed.workPlan,
      action: actionFor(structuralBinding, observerContract),
      observerContract,
    });
    assertCustomerLocalBindingCandidate({ candidate, structuralBinding, workPlan: confirmed.workPlan, observerContract });
    journey.recordSystemImportBindingCandidate({
      sessionId: record.sessionId,
      proposalHash: proposal.proposalHash,
      candidate,
      observerContract,
    });

    const cases = qualificationCases();
    const harnessContract = createCustomerLocalQualificationHarnessContract({
      harnessId: "northbridge-facilities-local-qualification-v1",
      ...HARNESS_IDENTITIES,
    });
    const caseContract = createCustomerLocalQualificationCaseContract({ candidate, cases, harnessContract });
    assertCustomerLocalQualificationCaseContract({ contract: caseContract, candidate, cases, harnessContract });
    const runtimeFactories = qualificationRuntimeFactories(harnessContract, worlds);
    const qualificationRun = await journey.runSystemImportLocalQualification({
      sessionId: record.sessionId,
      proposalHash: proposal.proposalHash,
      caseContract,
      harnessContract,
      cases,
      now: () => FIXED_OBSERVATION_NOW_MS,
      worldFactory: async ({ testCase }) => {
        const world = new FacilitiesQualificationWorld(testCase);
        worlds.push(world);
        return world;
      },
      actionRuntimeFactory: runtimeFactories.actionRuntimeFactory,
      observerRuntimeFactory: runtimeFactories.observerRuntimeFactory,
      restartRuntimeFactory: runtimeFactories.restartRuntimeFactory,
      authenticationAuthority: runtimeFactories.authenticationAuthority,
    });
    const qualificationReceipt = qualificationRun.qualification;
    assertCustomerLocalBindingQualification({ receipt: qualificationReceipt, candidate, observerContract, caseContract, harnessContract });
    requireCondition(qualificationReceipt.qualificationPassed && qualificationReceipt.controlsPassed === 10, "Fresh DAS-022 qualification did not pass all ten controls");
    requireCondition(qualificationRun.projection.stages.localBindingCandidatePrepared === true, "Not every required system retained an exact action/observer candidate");
    requireCondition(qualificationRun.projection.stages.independentObserverQualifiedLocally === true, "Not every required system reached local observer qualification");
    const acceptanceReceipt = sealCustomerLocalAcceptanceOnly({
      qualificationReceipt,
      candidate,
      observerContract,
      caseContract,
      harnessContract,
    });
    assertCustomerLocalAcceptanceOnly({ receipt: acceptanceReceipt, qualificationReceipt, candidate, observerContract, caseContract, harnessContract });
    const accepted = journey.recordSystemImportLocalAcceptance({
      sessionId: record.sessionId,
      proposalHash: proposal.proposalHash,
      acceptanceReceipt,
    });
    requireCondition(accepted.projection.stages.localAcceptanceOnlyComplete === true, "Local acceptance-only stage was not recorded");
    requireCondition(accepted.projection.stages.executableComparisonEnvironmentReady === false, "Disposable qualification falsely became executable comparison-ready");
    requireCondition(accepted.projection.stages.mandatoryAcceptanceComplete === false, "Disposable qualification falsely became mandatory commercial acceptance");
    requireCondition(accepted.projection.stages.controlledActivationReady === false, "Disposable qualification falsely became activation-ready");

    const restored = new AssistedCommercialOnboardingJourney({ stateDirectory: journeyRoot });
    const restoredProjection = restored.latest(record.sessionId);
    const readinessReceipt = restored.readinessReceipt(record.sessionId);
    requireCondition(restoredProjection.generated.localActionObserverCandidates === 1, "Fresh-process reload lost the action/observer candidate");
    requireCondition(restoredProjection.generated.localObserverQualificationReceipts === 1, "Fresh-process reload lost the qualification receipt");
    requireCondition(restoredProjection.generated.localAcceptanceOnlyReceipts === 1, "Fresh-process reload lost local acceptance-only evidence");
    requireCondition(readinessReceipt.readiness.execution.ready === false && readinessReceipt.readiness.activation.ready === false, "Fresh-process reload widened readiness");
    requireCondition(readinessReceipt.exactBlockers.includes("mandatory-commercial-acceptance-not-run"), "Fresh-process receipt omitted mandatory commercial acceptance blocker");
    requireCondition(readinessReceipt.exactBlockers.includes("controlled-activation-blocked"), "Fresh-process receipt omitted controlled activation blocker");

    const totalBusinessWrites = qualificationReceipt.cases.reduce((total, entry) => total + entry.businessWrites, 0);
    const caughtProblemControls = qualificationReceipt.cases.filter((entry) => ["partial", "incorrect", "duplicate", "stale", "collateral", "unknown", "unavailable"].includes(entry.id));
    requireCondition(caughtProblemControls.every((entry) => entry.passed && entry.classification.retryEligible === false), "A failed or ambiguous outcome became retry-eligible");
    requireCondition(qualificationReceipt.cases.find((entry) => entry.id === "not-started")?.classification.retryEligible === true, "Fresh independently observed not-started outcome was not explicitly retry-eligible");
    requireCondition(qualificationReceipt.cases.find((entry) => entry.id === "lost-response")?.classification.reconciledAfterLostResponse === true, "Lost response was not reconciled through independent observation");
    requireCondition(qualificationReceipt.cases.find((entry) => entry.id === "lost-response")?.businessWrites === 1, "Lost-response reconciliation repeated the write");
    requireCondition(qualificationReceipt.cases.find((entry) => entry.id === "lost-response")?.restartedAfterLostResponse === true, "Lost-response evidence did not cross a fresh process boundary");

    for (const world of worlds) world.dispose();
    const survivingIncorrectEffectsAfterWorldDisposal = worlds.reduce((total, world) => total + world.businessWrites(), 0);
    requireCondition(survivingIncorrectEffectsAfterWorldDisposal === 0, "Disposable qualification cleanup left local business effects");

    const completedAt = new Date().toISOString();
    const summary = {
      schemaVersion: "das.customer-local-action-observer-qualification-rehearsal.v1",
      experimentId: "das-022-northbridge-facilities-v1",
      startedAt,
      completedAt,
      source: {
        kind: source.kind,
        sourceHash: proposal.source.sourceHash,
        reviewedProposalHash: proposal.proposalHash,
        workPlanHash: confirmed.workPlan.workPlanHash,
        das012StructuralBindingHash: structuralBinding.artifactHash,
      },
      boundary: {
        fictionalLocalWorld: true,
        actionSurfaceId: candidate.action.surfaceId,
        observerSurfaceId: candidate.observer.surfaceId,
        actionObserverSurfacesDistinct: candidate.action.surfaceId !== candidate.observer.surfaceId,
        actionObserverImplementationsDistinct: candidate.action.implementationHash !== candidate.observer.implementationHash,
        actionObserverCredentialsDisjoint: candidate.action.credentialAliases.every((alias) => !candidate.observer.credentialAliases.includes(alias)),
        credentialValuesPresent: false,
      },
      measurements: {
        ...explicitInputMeasurements(structuralBinding, observerContract, candidate),
        implementationLaborBoundary: {
          dasGeneratedStructuralReceipts: 1,
          dasGeneratedCustomerSpecificExecutableSourceFiles: 0,
          engineerAuthoredActionRuntimeFactories: 1,
          engineerAuthoredObserverRuntimeFactories: 1,
          engineerAuthoredDisposableWorldClasses: 1,
          evidence: "Counts software boundaries in this one-file fictional rehearsal; they are not elapsed human setup time or a customer onboarding measurement.",
        },
        controlsRequired: qualificationReceipt.controlsRequired,
        controlsPassed: qualificationReceipt.controlsPassed,
        totalBusinessWritesAcrossDisposableControls: totalBusinessWrites,
        totalObserverWritesAcrossDisposableControls: qualificationReceipt.cases.reduce((total, entry) => total + entry.observerWrites, 0),
        actionResponseIgnoredInEveryControl: qualificationReceipt.cases.every((entry) => entry.actionResponseIgnored),
        problemControlsCaughtWithoutRetryEligibility: caughtProblemControls.length,
        lostResponseBusinessWrites: qualificationReceipt.cases.find((entry) => entry.id === "lost-response").businessWrites,
        lostResponseReconciledByObserver: qualificationReceipt.cases.find((entry) => entry.id === "lost-response").classification.reconciledAfterLostResponse,
        lostResponseRecoveredAcrossFreshProcess: qualificationReceipt.cases.find((entry) => entry.id === "lost-response").restartedAfterLostResponse,
        survivingIncorrectEffectsAfterWorldDisposal,
        freshProcessJourneyReloadPassed: true,
        allRequiredSystemsLocallyQualified: restoredProjection.stages.independentObserverQualifiedLocally,
        allRequiredSystemsLocalAcceptanceOnlyComplete: restoredProjection.stages.localAcceptanceOnlyComplete,
        executableOperations: acceptanceReceipt.executableOperations,
        mandatoryCommercialAcceptanceComplete: acceptanceReceipt.mandatoryCommercialAcceptanceComplete,
        customerEnvironmentAccepted: acceptanceReceipt.customerEnvironmentAccepted,
        executionReady: readinessReceipt.readiness.execution.ready,
        activationReady: readinessReceipt.readiness.activation.ready,
        modelCalls: qualificationReceipt.modelCalls,
        spendUsd: qualificationReceipt.spendUsd,
        activeMachineTimeMs: Number((performance.now() - machineStarted).toFixed(3)),
        humanSetupTimeMeasured: false,
      },
      controls: qualificationReceipt.cases.map((entry) => ({
        id: entry.id,
        expectedClassification: entry.expectedClassification,
        observedClassification: entry.observedClassification,
        expectedDisposition: entry.expectedDisposition,
        observedDisposition: entry.observedDisposition,
        businessWrites: entry.businessWrites,
        maximumBusinessWrites: entry.maximumBusinessWrites,
        passed: entry.passed,
      })),
      integrity: {
        observerContractHash: observerContract.contractHash,
        observerProofRuleReviewHash: observerContract.proofRuleReview.reviewedRuleHash,
        bindingCandidateHash: candidate.candidateHash,
        harnessContractHash: harnessContract.contractHash,
        caseContractHash: caseContract.contractHash,
        qualificationReceiptHash: qualificationReceipt.receiptHash,
        localAcceptanceReceiptHash: acceptanceReceipt.receiptHash,
        freshProcessReadinessReceiptHash: readinessReceipt.receiptHash,
      },
      exactRemainingBlockers: readinessReceipt.exactBlockers,
      evidenceBoundary: "Private fictional deterministic local DAS-022 evidence. It demonstrates one fresh OpenAPI-reviewed structural binding entering separate disposable action/observer qualification, ten canonical controls, fresh-process lost-response observation, local acceptance-only sealing and restart-safe blocker persistence. It does not establish customer-environment acceptance, credentials, runtime authority, executable operations, comparison readiness, activation, customer use, production reliability or human setup time.",
    };
    summary.summaryHash = digest(summary);

    const chain = {
      schemaVersion: "das.customer-local-action-observer-chain.v1",
      proposal,
      confirmation: confirmed.confirmation,
      workPlan: confirmed.workPlan,
      implementationInput,
      structuralBinding,
      observerContract,
      candidate,
      harnessContract,
      caseContract,
      qualificationReceipt,
      acceptanceReceipt,
      readinessReceipt,
    };
    chain.chainHash = digest(chain);

    const outputParent = path.dirname(OUTPUT_ROOT);
    fs.mkdirSync(outputParent, { recursive: true, mode: 0o700 });
    const staging = fs.mkdtempSync(path.join(outputParent, ".das022-staging-"));
    try {
      writePrivate(path.join(staging, "fictional-customer-packet.json"), { intake, source, reviewedDecisions: reviewedDecisions(proposal) });
      writePrivate(path.join(staging, "qualification-chain.json"), chain);
      writePrivate(path.join(staging, "summary.json"), summary);
      fs.renameSync(staging, OUTPUT_ROOT);
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw error;
    }
    console.log(JSON.stringify({
      outputRoot: OUTPUT_ROOT,
      summaryHash: summary.summaryHash,
      controls: `${summary.measurements.controlsPassed}/${summary.measurements.controlsRequired}`,
      executionReady: summary.measurements.executionReady,
      activationReady: summary.measurements.activationReady,
      modelCalls: summary.measurements.modelCalls,
      spendUsd: summary.measurements.spendUsd,
    }, null, 2));
  } finally {
    fs.rmSync(journeyRoot, { recursive: true, force: true });
  }
}

execute();
