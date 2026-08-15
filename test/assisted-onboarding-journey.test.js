import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digest } from "../src/core/canonical.js";
import { createCommercialComparisonFreeze } from "../src/product/commercial-comparison.js";
import { createCommercialSupportPack } from "../src/product/commercial-support-pack.js";
import { createCommercialActivationReceipt, createCommercialSpecialistBundle } from "../src/product/commercial-specialist-lifecycle.js";
import { AssistedCommercialOnboardingJourney } from "../src/product/assisted-onboarding-journey.js";
import { proposeOnboardingSystemImport } from "../src/product/onboarding-system-import.js";
import { createReviewedBindingImplementationInput } from "../src/product/reviewed-onboarding-binding-compiler.js";
import { allCommercialSupportCases } from "../src/worlds/realistic-support-cases.js";

function temporaryRoot(label = "das-assisted-onboarding-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), label));
}

function formCompleteUnboundInput() {
  return {
    sessionId: "ordinary-acme-support",
    company: { name: "Acme", industry: "B2B software", operatingContext: "An assigned support queue is resolved under a bounded billing and security policy." },
    role: { templateId: "support-operations", outcome: "Resolve every assigned in-scope ticket correctly.", completionRule: "Complete only after the independent checker confirms every assigned outcome.", escalationOwner: "Head of Support" },
    systems: [{ id: "acme-support", name: "Acme support system", kind: "customer system", access: "none", adapterStatus: "missing", contextSources: ["assigned queue", "support policy"], tools: [{ name: "read-ticket", mode: "read" }, { name: "write-resolution", mode: "write" }] }],
    knowledgeSources: [{ name: "Current support policy", kind: "policy", contentHash: digest("acme-support-policy"), current: true }],
    policies: [
      { rule: "Check assigned scope before action.", kind: "required-check", confirmed: true },
      { rule: "Require approval above the delegated limit.", kind: "approval", confirmed: true },
      { rule: "Never change unrelated records.", kind: "forbidden", confirmed: true },
    ],
    authority: { allowedActions: ["write-resolution"], approvalActions: ["large-resolution"], forbiddenActions: ["change-unrelated-record"] },
    examples: Array.from({ length: 5 }, (_, index) => ({ situation: `Representative ticket ${index + 1}`, expected: `Externally verified support outcome ${index + 1}`, source: "customer-authored", redacted: true })),
    success: { measures: ["all assigned work handled", "no unrelated writes", "correct approval handoff"], verifierMode: "independent-external-state", verifierStatus: "declared", owner: "Customer test owner" },
    priorities: { quality: 1, cost: .25, speed: .2, maximumCostPerTaskUsd: .5, maximumLatencyMs: 300_000, goal: "Preserve verified quality, then reduce cost and speed." },
    currentAgent: { mode: "none" },
    dataHandling: { localOnly: true, productionDataIncluded: false, redactionConfirmed: true },
  };
}

function frontendCompleteUnboundInput() {
  const input = formCompleteUnboundInput();
  input.sessionId = "ordinary-acme-frontend";
  input.company.operatingContext = "Approved design tasks are implemented in an existing React repository and end at a reviewable draft pull request.";
  input.role = {
    templateId: "frontend-implementation",
    title: "Frontend implementation specialist",
    outcome: "Turn approved designs into responsive React source using the existing component library.",
    completionRule: "Complete only after independent repository-state checks pass and one draft pull request is open without merge or deployment.",
    escalationOwner: "Frontend lead",
  };
  input.systems = [
    { id: "approved-designs", name: "Approved Figma handoff", kind: "customer system", access: "none", adapterStatus: "missing", contextSources: ["approved design task"], tools: [{ name: "read-approved-design", mode: "read" }] },
    { id: "react-repository", name: "React repository", kind: "customer system", access: "none", adapterStatus: "missing", contextSources: ["repository source", "component library", "repository policy"], tools: [{ name: "read-repository", mode: "read" }, { name: "write-assigned-frontend-source", mode: "write" }, { name: "open-draft-pull-request", mode: "write" }] },
  ];
  input.policies = [
    { rule: "Check the approved design version and assigned source-file boundary before action.", kind: "required-check", confirmed: true },
    { rule: "Require review when an approved component is genuinely missing.", kind: "approval", confirmed: true },
    { rule: "Never merge, deploy, change protected files or write outside assigned frontend source.", kind: "forbidden", confirmed: true },
  ];
  input.authority = {
    allowedActions: ["write-assigned-frontend-source", "open-draft-pull-request"],
    approvalActions: ["propose-new-component"],
    forbiddenActions: ["merge-pull-request", "deploy-application", "write-unassigned-source"],
  };
  input.examples = Array.from({ length: 5 }, (_, index) => ({
    situation: `Representative approved frontend task ${index + 1}`,
    expected: `Independently verified bounded repository outcome ${index + 1}`,
    source: "customer-authored",
    redacted: true,
  }));
  input.success = {
    measures: ["assigned source satisfies the approved design contract", "only approved files changed", "one draft pull request exists with no merge or deployment"],
    verifierMode: "independent-external-state",
    verifierStatus: "declared",
    owner: "Customer test owner",
  };
  return input;
}

function completeDescriptor(record) {
  const descriptor = structuredClone(record.binding.scaffold.descriptor);
  delete descriptor.descriptorHash;
  for (const system of descriptor.systems) {
    system.adapterVersion = "1.0.0";
    system.status = "verified";
    system.credentialRefs = ["DAS_CUSTOMER_LOCAL_TEST_TOKEN"];
    for (const operation of system.operations) {
      operation.status = "verified";
      operation.authorityAction = operation.mode === "write" ? record.intake.authority.allowedActions[0] : "";
      operation.boundedInputSchemaHash = digest({ operation: operation.exposedName });
      if (operation.mode === "write") {
        operation.idempotency = "implemented";
        operation.reconcileUnknown = "implemented";
      }
    }
  }
  descriptor.verifier.status = "verified";
  descriptor.verifier.implementationHash = digest("assisted-onboarding-independent-verifier");
  descriptor.verifier.readsExternalStateDirectly = true;
  descriptor.verifier.independentFromCandidate = true;
  descriptor.verifier.candidateCannotWriteVerifierInputs = true;
  descriptor.unknownOutcomeReconciler.status = "verified";
  descriptor.unknownOutcomeReconciler.implementationHash = digest("assisted-onboarding-unknown-outcome-reconciler");
  descriptor.descriptorHash = digest(descriptor);
  return descriptor;
}

function acceptanceResults(descriptor) {
  return descriptor.acceptanceCases.map((item) => ({
    id: item.id,
    passed: true,
    independentlyVerified: true,
    verifierId: descriptor.verifier.id,
    incorrectSideEffects: 0,
    unsafeAttempts: 0,
    artifactHash: digest({ acceptanceCase: item.id }),
  }));
}

function exactContract(pack, descriptor) {
  const driver = {
    ...structuredClone(pack.driver),
    operationNames: descriptor.systems.flatMap((system) => system.operations.map((operation) => operation.exposedName)),
    systemBindings: descriptor.systems.map((system) => ({ systemId: system.systemId, adapterId: system.adapterId, adapterVersion: system.adapterVersion, status: "verified" })),
  };
  return createCommercialComparisonFreeze({
    intake: pack.intake,
    driver,
    cases: allCommercialSupportCases(),
    participants: pack.participants.map(({ candidate, ...participant }) => participant),
    thresholds: { minimumOutcomeImprovement: 0, minimumCostReduction: .1, minimumSpeedReduction: .1, minimumRepeatRuns: 3 },
    budget: { maximumModelSpendUsd: 10, maximumWallClockMs: 3_600_000, maximumCandidates: 8 },
  });
}

function advanceSupportRehearsalToApproval() {
  const root = temporaryRoot();
  const pack = createCommercialSupportPack();
  const journey = new AssistedCommercialOnboardingJourney({ stateDirectory: root, now: () => "2026-08-12T00:00:00.000Z" });
  journey.saveBusinessIntake(pack.intake);
  const saved = journey.record(pack.intake.sessionId);
  const descriptor = completeDescriptor(saved);
  journey.recordBindingDescriptor({ sessionId: pack.intake.sessionId, descriptor });
  journey.recordBindingAcceptance({ sessionId: pack.intake.sessionId, results: acceptanceResults(descriptor) });
  const frozen = exactContract(pack, descriptor);
  const projection = journey.freezeZeroCostComparisonPlan({
    sessionId: pack.intake.sessionId,
    contract: frozen.contract,
    participants: pack.participants,
    maxTurns: 48,
    campaignId: "assisted-support-comparison-v1",
    campaignApproval: "JOEL_APPROVED_ASSISTED_SUPPORT_V1",
  });
  return { root, pack, journey, descriptor, frozen, projection };
}

test("an ordinary incomplete description produces precise customer questions and no false progress", () => {
  const journey = new AssistedCommercialOnboardingJourney({ stateDirectory: temporaryRoot() });
  const projection = journey.saveBusinessIntake({ company: { name: "Acme" }, role: { templateId: "support-operations", outcome: "Handle support" } });
  assert.equal(projection.status, "business-role-draft-incomplete");
  assert.equal(projection.generated.bindingScaffold, false);
  assert.equal(projection.stages.executableComparisonEnvironmentReady, false);
  assert.ok(projection.questions.some((item) => item.id === "escalation-owner"));
  assert.ok(projection.questions.some((item) => item.id === "representative-cases"));
});

test("an unsupported role remains a clearly labelled preview", () => {
  const input = formCompleteUnboundInput();
  input.sessionId = "unsupported-finance-role";
  input.role.templateId = "autonomous-finance-controller";
  const journey = new AssistedCommercialOnboardingJourney({ stateDirectory: temporaryRoot() });
  const projection = journey.saveBusinessIntake(input);
  assert.equal(projection.supportedRole, false);
  assert.equal(projection.previewOnly, true);
  assert.equal(projection.status, "unsupported-role-preview-only");
  assert.equal(projection.generated.bindingScaffold, false);
  assert.ok(projection.questions.some((item) => item.id === "supported-role"));
});

test("a form-complete but unbound system receives its exact scaffold and never appears executable", () => {
  const journey = new AssistedCommercialOnboardingJourney({ stateDirectory: temporaryRoot() });
  const projection = journey.saveBusinessIntake(formCompleteUnboundInput());
  const record = journey.record("ordinary-acme-support");
  assert.equal(projection.status, "comparison-design-complete-binding-required");
  assert.equal(projection.stages.comparisonDesignContractComplete, true);
  assert.equal(projection.stages.executableComparisonEnvironmentReady, false);
  assert.equal(record.binding.scaffold.descriptor.intakeHash, digest(record.intake));
  assert.equal(record.binding.scaffold.descriptor.systems[0].status, "not-implemented");
  assert.equal(record.binding.scaffold.descriptor.verifier.status, "not-implemented");
  assert.ok(fs.existsSync(path.join(record.binding.scaffold.root, "binding.json")));
});

test("a complete frontend intake joins assisted onboarding but keeps Figma and repository bindings non-executable", () => {
  const journey = new AssistedCommercialOnboardingJourney({ stateDirectory: temporaryRoot("das-assisted-frontend-") });
  const projection = journey.saveBusinessIntake(frontendCompleteUnboundInput());
  const record = journey.record("ordinary-acme-frontend");
  assert.equal(projection.supportedRole, true);
  assert.equal(projection.previewOnly, false);
  assert.equal(projection.status, "comparison-design-complete-binding-required");
  assert.equal(projection.stages.comparisonDesignContractComplete, true);
  assert.equal(projection.generated.bindingScaffold, true);
  assert.equal(projection.stages.executableComparisonEnvironmentReady, false);
  assert.equal(projection.stages.awaitingExplicitModelSpendApproval, false);
  assert.equal(projection.stages.comparisonCompleteRecommendationReady, false);
  assert.equal(projection.stages.controlledActivationReady, false);
  assert.deepEqual(record.binding.scaffold.descriptor.systems.map((system) => system.status), ["not-implemented", "not-implemented"]);
  assert.equal(record.binding.scaffold.descriptor.verifier.status, "not-implemented");
  assert.equal(record.intake.systems.every((system) => system.access === "none" && system.adapterStatus === "missing"), true);
  assert.equal(record.roleLifecycle.bindingScaffold, true);
  assert.equal(record.roleLifecycle.bindingDescriptorReview, false);
  assert.ok(projection.roleAvailability.blockers.some((item) => /Figma/i.test(item)));
  assert.throws(() => journey.recordBindingDescriptor({ sessionId: record.sessionId, descriptor: {} }), /Binding review is unavailable.*Figma/s);
  assert.throws(() => journey.recordBindingAcceptance({ sessionId: record.sessionId, results: [] }), /Binding acceptance is unavailable.*repository/s);
  assert.throws(() => journey.freezeZeroCostComparisonPlan({ sessionId: record.sessionId }), /Comparison planning is unavailable/);
  assert.throws(() => journey.recordComparisonResult({ sessionId: record.sessionId, result: {} }), /Comparison result recording is unavailable/);
  assert.throws(() => journey.recordControlledActivation({ sessionId: record.sessionId, bundle: {}, activation: {} }), /Controlled activation is unavailable/);
  const restored = new AssistedCommercialOnboardingJourney({ stateDirectory: journey.root });
  assert.equal(restored.latest(record.sessionId).roleAvailability.bindingAcceptance, false);
});

test("credentials are rejected before a journey or scaffold can be saved", () => {
  const input = formCompleteUnboundInput();
  input.systems[0].credentials = { apiKey: "must-not-be-stored" };
  const journey = new AssistedCommercialOnboardingJourney({ stateDirectory: temporaryRoot() });
  assert.throws(() => journey.saveBusinessIntake(input), /Credentials must not be stored/);
  assert.equal(journey.snapshot().records.length, 0);
});

test("a pinned system import joins the exact session as a review proposal without widening readiness", () => {
  const root = temporaryRoot();
  const journey = new AssistedCommercialOnboardingJourney({ stateDirectory: root });
  journey.saveBusinessIntake(formCompleteUnboundInput());
  const record = journey.record("ordinary-acme-support");
  const source = {
    kind: "openapi",
    document: {
      openapi: "3.1.0",
      info: { title: "Acme Support", version: "1" },
      servers: [{ url: "https://support.example.test" }],
      paths: { "/tickets/{id}": { get: { operationId: "getTicket", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" } } } } },
    },
  };
  const proposal = proposeOnboardingSystemImport({
    intake: record.intake,
    systemId: record.intake.systems[0].id,
    source,
    provenance: { acquisition: "customer-upload", label: "Acme support OpenAPI" },
  });
  const projection = journey.recordSystemImportProposal({ sessionId: record.sessionId, proposal, source });
  assert.equal(projection.generated.systemImportProposals, 1);
  assert.equal(projection.status, "comparison-design-complete-binding-required");
  assert.equal(projection.stages.executableComparisonEnvironmentReady, false);
  assert.ok(projection.checklist.some((item) => item.id.startsWith("customer:system-import:") && item.status === "review-required"));
  const joined = journey.record(record.sessionId);
  assert.equal(joined.systemImports[0].proposal.authorizations.execution, false);
  assert.equal(joined.systemImports[0].review.blocksExecutableComparison, true);
});

test("a customer-reviewed import creates an exact persistent work plan without advancing execution", () => {
  const root = temporaryRoot();
  const journey = new AssistedCommercialOnboardingJourney({ stateDirectory: root });
  journey.saveBusinessIntake(formCompleteUnboundInput());
  const record = journey.record("ordinary-acme-support");
  const source = {
    kind: "openapi",
    document: {
      openapi: "3.1.0",
      info: { title: "Acme Support", version: "1" },
      servers: [{ url: "https://support.example.test" }],
      paths: { "/tickets/{id}": { get: { operationId: "getTicket", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" } } } } },
    },
  };
  const proposal = proposeOnboardingSystemImport({ intake: record.intake, systemId: record.intake.systems[0].id, source, provenance: { acquisition: "customer-upload", label: "Acme support OpenAPI" } });
  journey.recordSystemImportProposal({ sessionId: record.sessionId, proposal, source });
  const result = journey.recordSystemImportConfirmation({
    sessionId: record.sessionId,
    proposalHash: proposal.proposalHash,
    source,
    confirmedBy: "Acme support owner",
    decisions: {
      operationChoices: [{ sourceName: "getTicket", approved: true, targetExposedName: "acme-support:read-ticket", confirmedMode: "read", authorityAction: null, requiredContextSources: ["support policy"] }],
      contextChoices: proposal.proposedContextSources.map((sourceId) => ({ sourceId, approved: true })),
    },
  });
  assert.equal(result.projection.generated.systemImportConfirmations, 1);
  assert.equal(result.projection.generated.bindingWorkPlans, 1);
  assert.equal(result.projection.stages.executableComparisonEnvironmentReady, false);
  assert.equal(result.workPlan.gates.executable, false);
  assert.ok(result.workPlan.exactRemainingWork.some((item) => item.id.includes("write-resolution")));
  assert.equal(fs.existsSync(path.join(result.files.root, "binding-work-plan.json")), true);
  const receipt = journey.readinessReceipt(record.sessionId);
  assert.ok(receipt.provenance.customerSuppliedFacts.some((item) => item.id.startsWith("system-import-review-")));
  assert.ok(receipt.provenance.dasProposalsAndInferences.some((item) => item.id.startsWith("binding-work-plan-")));
  assert.ok(receipt.exactBlockers.some((item) => /write-resolution/.test(item)));
  const restored = new AssistedCommercialOnboardingJourney({ stateDirectory: root });
  const restoredRecord = restored.record(record.sessionId);
  assert.equal(restoredRecord.systemImports[0].workPlan.workPlanHash, result.workPlan.workPlanHash);
  assert.equal(restored.latest(record.sessionId).stages.executableComparisonEnvironmentReady, false);
});

test("a reviewed import can persist structural compilation without becoming executable", () => {
  const root = temporaryRoot();
  const journey = new AssistedCommercialOnboardingJourney({ stateDirectory: root });
  journey.saveBusinessIntake(formCompleteUnboundInput());
  const record = journey.record("ordinary-acme-support");
  const source = {
    kind: "openapi",
    document: {
      openapi: "3.1.0",
      info: { title: "Acme Support", version: "1" },
      servers: [{ url: "https://support.example.test" }],
      paths: { "/tickets/{id}": { get: { operationId: "getTicket", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" } } } } },
    },
  };
  const proposal = proposeOnboardingSystemImport({ intake: record.intake, systemId: record.intake.systems[0].id, source, provenance: { acquisition: "customer-upload", label: "Acme support OpenAPI" } });
  journey.recordSystemImportProposal({ sessionId: record.sessionId, proposal, source });
  const confirmation = journey.recordSystemImportConfirmation({
    sessionId: record.sessionId,
    proposalHash: proposal.proposalHash,
    source,
    confirmedBy: "Acme support owner",
    decisions: {
      operationChoices: [{ sourceName: "getTicket", approved: true, targetExposedName: "acme-support:read-ticket", confirmedMode: "read", authorityAction: null, requiredContextSources: ["support policy"] }],
      contextChoices: proposal.proposedContextSources.map((sourceId) => ({ sourceId, approved: true })),
    },
  });
  const implementationInput = createReviewedBindingImplementationInput({ workPlan: confirmation.workPlan });
  const compiled = journey.recordSystemImportStructuralCompilation({ sessionId: record.sessionId, proposalHash: proposal.proposalHash, source, implementationInput });

  assert.equal(compiled.projection.generated.structuralBindingReceipts, 1);
  assert.equal(compiled.projection.stages.executableComparisonEnvironmentReady, false);
  assert.equal(compiled.projection.stages.controlledActivationReady, false);
  assert.equal(compiled.structuralBinding.operations[0].status, "structurally-compiled-runtime-unprobed");
  assert.equal(compiled.structuralBinding.gates.executable, false);
  const receipt = journey.readinessReceipt(record.sessionId);
  assert.ok(receipt.provenance.dasProposalsAndInferences.some((item) => item.id.startsWith("structural-binding-receipt-")));
  assert.equal(receipt.provenance.engineerOwnedBindings.structuralBindingReceipts[0].executable, false);
  assert.ok(receipt.exactBlockers.some((item) => /coverage:acme-support:write-resolution/.test(item)));
  const restored = new AssistedCommercialOnboardingJourney({ stateDirectory: root });
  assert.equal(restored.record(record.sessionId).systemImports[0].structuralBinding.artifactHash, compiled.structuralBinding.artifactHash);
  assert.equal(restored.latest(record.sessionId).stages.executableComparisonEnvironmentReady, false);
});

test("readiness survives restart and mutation of persisted state fails closed", () => {
  const root = temporaryRoot();
  const journey = new AssistedCommercialOnboardingJourney({ stateDirectory: root, now: () => "2026-08-12T00:00:00.000Z" });
  const before = journey.saveBusinessIntake(formCompleteUnboundInput());
  const restored = new AssistedCommercialOnboardingJourney({ stateDirectory: root });
  assert.deepEqual(restored.latest("ordinary-acme-support").stages, before.stages);
  const file = path.join(root, "journey-state.json");
  const changed = JSON.parse(fs.readFileSync(file, "utf8"));
  changed.records[0].intake.company.name = "Mutated after save";
  fs.writeFileSync(file, JSON.stringify(changed));
  assert.throws(() => new AssistedCommercialOnboardingJourney({ stateDirectory: root }), /integrity mismatch/);
});

test("the joined assisted rehearsal stops at exact-plan spend approval with zero calls", () => {
  const { root, pack, journey, projection } = advanceSupportRehearsalToApproval();
  assert.equal(projection.status, "awaiting-explicit-model-spend-approval");
  assert.equal(projection.stages.executableComparisonEnvironmentReady, true);
  assert.equal(projection.stages.awaitingExplicitModelSpendApproval, true);
  assert.equal(projection.stages.comparisonCompleteRecommendationReady, false);
  assert.equal(projection.stages.controlledActivationReady, false);
  assert.equal(projection.spend.modelCallsMade, 0);
  assert.equal(projection.spend.spendAuthorized, false);
  assert.equal(projection.spend.projectedMaximumUsd, 10);
  assert.ok(projection.spend.maximumTaskEvaluations > 0);
  assert.throws(() => journey.attemptPaidExecution(), /fail-closed/);
  const restored = new AssistedCommercialOnboardingJourney({ stateDirectory: root });
  assert.equal(restored.latest(pack.intake.sessionId).status, "awaiting-explicit-model-spend-approval");
});

test("only exact integrity-checked downstream evidence can advance recommendation and activation stages", () => {
  const { pack, journey, frozen } = advanceSupportRehearsalToApproval();
  const selected = pack.participants.find((participant) => participant.type === "current-agent");
  const repeatSummary = { participantId: selected.id, passRate: 1, unsafeAttempts: 0, incorrectSideEffects: 0 };
  const result = {
    schemaVersion: "das.commercial-comparison-result.v1",
    contractFreezeHash: frozen.contract.freezeHash,
    selectedParticipantId: selected.id,
    decision: "retain-existing",
    rankedUnseen: [],
    improvementAssessment: null,
    preUnseenReceipt: {},
    stageHistory: [],
    repeatability: { runs: 3, summaries: [repeatSummary, repeatSummary, repeatSummary] },
    spendUsd: 0,
    operationalEvaluationCostUsd: 0,
    evidenceBoundary: "Deterministic test receipt only.",
  };
  result.resultHash = digest(result);
  const afterResult = journey.recordComparisonResult({ sessionId: pack.intake.sessionId, result });
  assert.equal(afterResult.status, "comparison-complete-recommendation-ready");
  const record = journey.record(pack.intake.sessionId);
  const bundle = createCommercialSpecialistBundle({ contract: frozen.contract, result, participant: selected, roleDraft: record.roleDraft });
  const environment = {
    kind: "disposable-sandbox",
    driverId: frozen.contract.driver.id,
    driverVersion: frozen.contract.driver.version,
    verifierId: frozen.contract.driver.verifier.id,
    verifierStatus: "verified",
    systemBindings: structuredClone(frozen.contract.driver.systemBindings),
  };
  const activation = createCommercialActivationReceipt({ bundle, contract: frozen.contract, environment });
  const afterActivation = journey.recordControlledActivation({ sessionId: pack.intake.sessionId, bundle, activation });
  assert.equal(afterActivation.status, "controlled-activation-ready");
  assert.equal(afterActivation.stages.controlledActivationReady, true);
});
