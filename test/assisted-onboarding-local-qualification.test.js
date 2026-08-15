import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { digest } from "../src/core/canonical.js";
import { AssistedCommercialOnboardingJourney } from "../src/product/assisted-onboarding-journey.js";
import { proposeOnboardingSystemImport } from "../src/product/onboarding-system-import.js";
import { createReviewedBindingImplementationInput } from "../src/product/reviewed-onboarding-binding-compiler.js";
import { createProvisionalObserverContract } from "../src/product/customer-local-observer-contract.js";
import { createCustomerLocalBindingCandidate, createCustomerLocalQualificationCaseContract, createCustomerLocalQualificationHarnessContract, sealCustomerLocalAcceptanceOnly } from "../src/product/customer-local-binding-qualification.js";

function input() {
  return {
    sessionId: "local-qualification-support",
    company: { name: "Fictional Northbridge", industry: "B2B software", operatingContext: "A disposable assigned support queue." },
    role: { templateId: "support-operations", outcome: "Resolve each assigned support item correctly.", completionRule: "Complete after direct external-state proof.", escalationOwner: "Support owner" },
    systems: [{ id: "support", name: "Support system", kind: "customer system", access: "none", adapterStatus: "missing", contextSources: ["ticket-thread", "support-policy"], tools: [{ name: "read-ticket", mode: "read" }, { name: "write-resolution", mode: "write" }] }],
    knowledgeSources: [{ name: "Support policy", kind: "policy", contentHash: digest("support-policy"), current: true }],
    policies: [{ rule: "Stay inside assigned scope.", kind: "required-check", confirmed: true }, { rule: "Require approval beyond the role.", kind: "approval", confirmed: true }, { rule: "Never change unrelated records.", kind: "forbidden", confirmed: true }],
    authority: { allowedActions: ["write-resolution"], approvalActions: ["refund-large"], forbiddenActions: ["change-unrelated-record"] },
    examples: Array.from({ length: 5 }, (_, index) => ({ situation: `Ticket ${index + 1}`, expected: `Exact result ${index + 1}`, source: "customer-authored", redacted: true })),
    success: { measures: ["all assigned tickets handled", "no unrelated writes", "correct handoff"], verifierMode: "independent-external-state", verifierStatus: "declared", owner: "Support owner" },
    priorities: { quality: 1, cost: .2, speed: .2, maximumCostPerTaskUsd: .5, maximumLatencyMs: 300_000, goal: "Verified quality first." },
    currentAgent: { mode: "none" },
    dataHandling: { localOnly: true, productionDataIncluded: false, redactionConfirmed: true },
  };
}

function source() {
  return { kind: "openapi", document: { openapi: "3.1.0", info: { title: "Northbridge Support", version: "1.0.0" }, servers: [{ url: "https://support.example.test" }], paths: {
    "/tickets/{ticketId}": { get: { operationId: "getTicket", parameters: [{ name: "ticketId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" } } } },
    "/tickets/{ticketId}/resolution": { post: { operationId: "writeResolution", parameters: [{ name: "ticketId", in: "path", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["status", "requestId"], properties: { status: { type: "string" }, requestId: { type: "string" } }, additionalProperties: false } } } }, responses: { "200": { description: "ok" } } } },
  } } };
}

class SupportQualificationWorld {
  constructor(testCase, { store = null, processInstanceId = "support-process-original" } = {}) {
    this.caseId = testCase.id;
    this.store = store ?? { records: [], writes: 0, unrelatedDigest: "protected-v1", extraChanges: [] };
    this.harnessIdentityHash = digest("support-qualification-world");
    this.persistentStoreSchemaHash = digest("support-qualification-store");
    this.storageIdentityHash = digest({ supportCase: this.caseId });
    this.processInstanceId = processInstanceId;
  }

  get records() { return this.store.records; }
  get writes() { return this.store.writes; }
  set writes(value) { this.store.writes = value; }
  get unrelatedDigest() { return this.store.unrelatedDigest; }
  set unrelatedDigest(value) { this.store.unrelatedDigest = value; }
  get extraChanges() { return this.store.extraChanges; }

  execute(work) {
    if (["not-started", "unknown", "unavailable"].includes(this.caseId)) return { accepted: false };
    const record = { ...work, resolutionId: "resolution-1", state: "draft-resolved" };
    if (this.caseId === "partial") delete record.resolutionCode;
    if (this.caseId === "incorrect") record.resolutionCode = "incorrect-code";
    this.records.push(record);
    this.writes += 1;
    if (this.caseId === "duplicate") {
      this.records.push({ ...record, resolutionId: "resolution-2" });
      this.writes += 1;
    }
    if (this.caseId === "collateral") {
      this.unrelatedDigest = "protected-mutated";
      this.extraChanges.push({ kind: "unrelated-ticket", id: "ticket-outside-scope" });
    }
    if (this.caseId === "lost-response") {
      const error = new Error("response lost after commit");
      error.responseLost = true;
      throw error;
    }
    return { accepted: true };
  }

  observe(phase, contractHash) {
    if (phase === "after" && this.caseId === "unavailable") return { availability: "unavailable", reason: "audit service unavailable" };
    if (phase === "after" && this.caseId === "unknown") return { availability: "unknown", reason: "audit state could not be established" };
    const observedAt = phase === "after" && this.caseId === "stale" ? 900 : 1000;
    return {
      provenance: "observer-direct-external-state",
      observerContractHash: contractHash,
      snapshotGeneratedAtMs: observedAt,
      caughtUpThroughMs: observedAt,
      matches: phase === "before" ? [] : structuredClone(this.records),
      changedEntities: phase === "before" ? [] : [...this.records.map((record) => ({ kind: "support-resolution", id: record.resolutionId })), ...this.extraChanges],
      unrelatedStateDigest: phase === "before" ? "protected-v1" : this.unrelatedDigest,
    };
  }

  businessWrites() { return this.writes; }
  observerWrites() { return 0; }
  snapshot() { return { records: this.records, writes: this.writes, unrelatedDigest: this.unrelatedDigest }; }
}

test("action/observer qualification and local acceptance persist through restart without implying execution or commercial acceptance", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "das-local-qualification-journey-"));
  const journey = new AssistedCommercialOnboardingJourney({ stateDirectory: root, now: () => "2026-08-14T00:00:00.000Z" });
  const intake = input();
  journey.saveBusinessIntake(intake);
  const record = journey.record(intake.sessionId);
  const pinnedSource = source();
  const proposal = proposeOnboardingSystemImport({ intake: record.intake, systemId: "support", source: pinnedSource, provenance: { acquisition: "customer-upload", label: "Pinned Northbridge support OpenAPI" } });
  journey.recordSystemImportProposal({ sessionId: intake.sessionId, proposal, source: pinnedSource });
  const confirmed = journey.recordSystemImportConfirmation({ sessionId: intake.sessionId, proposalHash: proposal.proposalHash, source: pinnedSource, confirmedBy: "Fictional support owner", decisions: {
    operationChoices: [
      { sourceName: "getTicket", approved: true, targetExposedName: "support:read-ticket", confirmedMode: "read", authorityAction: null, requiredContextSources: ["ticket-thread"] },
      { sourceName: "writeResolution", approved: true, targetExposedName: "support:write-resolution", confirmedMode: "write", authorityAction: "write-resolution", requiredContextSources: ["ticket-thread", "support-policy"] },
    ],
    contextChoices: proposal.proposedContextSources.map((sourceId) => ({ sourceId, approved: true })),
  } });
  const implementationInput = createReviewedBindingImplementationInput({ workPlan: confirmed.workPlan, writeSafety: [{ sourceName: "writeResolution", idempotencyHeader: "X-Idempotency-Key", verification: { readOperationId: "getTicket", inputMap: [{ targetSection: "path", targetName: "ticketId", writeInputPointer: "/path/ticketId" }], assertions: [{ actualPointer: "/ticketId", equalsWriteInputPointer: "/path/ticketId" }] } }] });
  const compiled = journey.recordSystemImportStructuralCompilation({ sessionId: intake.sessionId, proposalHash: proposal.proposalHash, source: pinnedSource, implementationInput });
  const structural = compiled.structuralBinding;
  const observer = createProvisionalObserverContract({ structuralBinding: structural, workPlan: confirmed.workPlan, observerId: "northbridge-audit", surfaceId: "support-audit", credentialAliases: ["NORTHBRIDGE_SUPPORT_AUDIT_TOKEN"], implementationHash: digest("observer-code"), sourceHash: digest("observer-source"), runtimeSchemaHash: digest("observer-schema"), transportIdentityHash: digest("observer-transport"), readOperations: ["readResolutionObservation", "readProtectedSnapshot"], stableIdentity: { fields: ["ticketId", "requestId"] }, freshness: { snapshotGeneratedAtField: "snapshotGeneratedAtMs", caughtUpThroughField: "caughtUpThroughMs", maximumAgeMs: 1000 }, outcomeRules: { requiredExactFields: ["ticketId", "requestId", "resolutionCode"], statusField: "state", completionStatuses: ["draft-resolved"] }, duplicateRule: { maximumDistinctResults: 1, resultIdentityField: "resolutionId" }, collateralRules: { changedEntitiesField: "changedEntities", unrelatedStateDigestField: "unrelatedStateDigest", allowedChangedEntityKinds: ["support-resolution"] }, proofRuleReview: { responsibility: "engineer-owned-reviewed-unproved", reviewedBy: "Fictional support owner and test engineer", confirmationHash: structural.confirmationHash, successCriteriaHash: structural.successCriteriaHash } });
  const candidate = createCustomerLocalBindingCandidate({ structuralBinding: structural, workPlan: confirmed.workPlan, observerContract: observer, action: { bindingId: "northbridge-command", surfaceId: "support-command", credentialAliases: ["NORTHBRIDGE_SUPPORT_ACTION_TOKEN"], implementationHash: digest("action-code"), sourceHash: structural.source.sourceHash, runtimeSchemaHash: digest(structural.operations.map((operation) => operation.boundedInputSchemaHash)), transportIdentityHash: structural.compilerSegments[0].transportIdentityHash, operations: structural.operations.map((operation) => ({ sourceName: operation.sourceName, targetExposedName: operation.targetExposedName, mode: operation.mode, authorityAction: operation.authorityAction, boundedInputSchemaHash: operation.boundedInputSchemaHash, ...(operation.mode === "write" ? { idempotencyRule: "stable request id", reconciliationRule: "independent observe before retry", stableIdentityRule: "ticketId + requestId" } : {}) })) } });
  const candidateProjection = journey.recordSystemImportBindingCandidate({ sessionId: intake.sessionId, proposalHash: proposal.proposalHash, candidate, observerContract: observer }).projection;
  assert.equal(candidateProjection.stages.localBindingCandidatePrepared, true);
  assert.equal(candidateProjection.stages.independentObserverQualifiedLocally, false);
  const controlExpectations = { completed: ["completed", "accept", 1], "not-started": ["not-started", "retry-eligible-after-explicit-gate", 0], partial: ["partial", "halt-quarantine", 1], incorrect: ["incorrect", "halt-quarantine", 1], duplicate: ["duplicate", "halt-quarantine", 2], stale: ["stale", "halt-handoff", 1], collateral: ["collateral", "halt-quarantine", 1], unavailable: ["unavailable", "halt-handoff", 0], "lost-response": ["completed", "accept", 1] };
  controlExpectations.unknown = ["unknown", "halt-handoff", 0];
  const assignedWork = { ticketId: "ticket-42", requestId: "resolution-request-42", resolutionCode: "answered-with-policy" };
  const controlCases = Object.entries(controlExpectations).map(([id, [expectedClassification, expectedDisposition, maximumBusinessWrites]]) => ({ id, expectedClassification, expectedDisposition, maximumBusinessWrites, payload: { assignedWork, fault: { kind: id } } }));
  const harnessContract = createCustomerLocalQualificationHarnessContract({ harnessId: "support-local-qualification", worldImplementationHash: digest("support-qualification-world"), persistentStoreSchemaHash: digest("support-qualification-store"), authenticationAuthorityHash: digest("support-synthetic-auth"), observerEvidenceSchemaHash: digest("support-observer-evidence") });
  const caseContract = createCustomerLocalQualificationCaseContract({ candidate, cases: controlCases, harnessContract });
  const authenticate = (runtime, boundary) => async ({ challenge }) => { const proof = { boundary, principalId: `${boundary}-support-principal`, credentialAlias: runtime.credentialAlias, challengeHash: challenge.challengeHash, readOnly: boundary === "observer", productionAuthorityGranted: false }; proof.proofHash = digest({ boundary, principalId: proof.principalId, credentialAlias: runtime.credentialAlias, challengeHash: challenge.challengeHash, readOnly: boundary === "observer" }); return proof; };
  const actionRuntimeFactory = async ({ candidate: value, world }) => { const runtime = { bindingId: value.action.bindingId, surfaceId: value.action.surfaceId, implementationHash: value.action.implementationHash, sourceHash: value.action.sourceHash, runtimeSchemaHash: value.action.runtimeSchemaHash, transportIdentityHash: value.action.transportIdentityHash, credentialAlias: value.action.credentialAliases[0], processInstanceId: world.processInstanceId, productionAuthorityGranted: false, qualificationAuthorityActions: value.action.operations.filter((operation) => operation.mode === "write").map((operation) => operation.authorityAction), async execute({ assignedWork: work }) { return world.execute(work); } }; runtime.authenticate = authenticate(runtime, "action"); return runtime; };
  const observerRuntimeFactory = async ({ candidate: value, observerContract: contract, world }) => { const runtime = { observerId: value.observer.observerId, surfaceId: value.observer.surfaceId, implementationHash: value.observer.implementationHash, sourceHash: value.observer.sourceHash, runtimeSchemaHash: value.observer.runtimeSchemaHash, transportIdentityHash: value.observer.transportIdentityHash, credentialAlias: value.observer.credentialAliases[0], processInstanceId: world.processInstanceId, readOnly: true, writeOperations: [], productionAuthorityGranted: false, async observe({ phase }) { return world.observe(phase, contract.contractHash); } }; runtime.authenticate = authenticate(runtime, "observer"); return runtime; };
  const authenticationAuthority = { authorityHash: harnessContract.authenticationAuthorityHash, async issueChallenge({ boundary, controlId, candidateHash, observerContractHash }) { const challenge = { boundary, controlId, candidateHash, observerContractHash, nonce: `${boundary}-${controlId}` }; challenge.challengeHash = digest(challenge); return challenge; }, async verify({ boundary, runtime, challenge, proof }) { return proof.proofHash === digest({ boundary, principalId: proof.principalId, credentialAlias: runtime.credentialAlias, challengeHash: challenge.challengeHash, readOnly: boundary === "observer" }); } };
  const qualificationRun = await journey.runSystemImportLocalQualification({
    sessionId: intake.sessionId,
    proposalHash: proposal.proposalHash,
    caseContract,
    harnessContract,
    cases: controlCases,
    now: () => 1000,
    worldFactory: async ({ testCase }) => new SupportQualificationWorld(testCase),
    actionRuntimeFactory,
    observerRuntimeFactory,
    restartRuntimeFactory: async ({ candidate: value, observerContract: contract, world }) => { const restartedWorld = new SupportQualificationWorld({ id: world.caseId }, { store: world.store, processInstanceId: `${world.processInstanceId}-restarted` }); return { world: restartedWorld, observerRuntime: await observerRuntimeFactory({ candidate: value, observerContract: contract, world: restartedWorld }) }; },
    authenticationAuthority,
  });
  const qualification = qualificationRun.qualification;
  const qualified = qualificationRun.projection;
  assert.equal(qualified.stages.independentObserverQualifiedLocally, true);
  assert.equal(qualified.stages.mandatoryAcceptanceComplete, false);
  const localAcceptance = sealCustomerLocalAcceptanceOnly({ qualificationReceipt: qualification, candidate, observerContract: observer, caseContract, harnessContract });
  const accepted = journey.recordSystemImportLocalAcceptance({ sessionId: intake.sessionId, proposalHash: proposal.proposalHash, acceptanceReceipt: localAcceptance }).projection;
  assert.equal(accepted.stages.localAcceptanceOnlyComplete, true);
  assert.equal(accepted.stages.executableComparisonEnvironmentReady, false);
  assert.equal(accepted.stages.mandatoryAcceptanceComplete, false);
  assert.equal(accepted.stages.controlledActivationReady, false);
  const restored = new AssistedCommercialOnboardingJourney({ stateDirectory: root });
  const restoredProjection = restored.latest(intake.sessionId);
  assert.equal(restoredProjection.generated.localActionObserverCandidates, 1);
  assert.equal(restoredProjection.generated.localObserverQualificationReceipts, 1);
  assert.equal(restoredProjection.generated.localAcceptanceOnlyReceipts, 1);
  const receipt = restored.readinessReceipt(intake.sessionId);
  assert.equal(receipt.readiness.execution.ready, false);
  assert.equal(receipt.provenance.independentProof.localObserverQualification[0].customerEnvironmentAccepted, false);
  assert.equal(receipt.provenance.independentProof.localAcceptanceOnly[0].mandatoryCommercialAcceptanceComplete, false);
  assert.ok(receipt.exactBlockers.includes("mandatory-commercial-acceptance-not-run"));
  assert.ok(receipt.exactBlockers.includes("controlled-activation-blocked"));
  const recompiled = restored.recordSystemImportStructuralCompilation({ sessionId: intake.sessionId, proposalHash: proposal.proposalHash, source: pinnedSource, implementationInput }).projection;
  assert.equal(recompiled.stages.localBindingCandidatePrepared, false);
  assert.equal(recompiled.stages.independentObserverQualifiedLocally, false);
  assert.equal(recompiled.stages.localAcceptanceOnlyComplete, false);
  const restartedAfterRecompile = new AssistedCommercialOnboardingJourney({ stateDirectory: root });
  assert.equal(restartedAfterRecompile.latest(intake.sessionId).generated.localObserverQualificationReceipts, 0);
});
