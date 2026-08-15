import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { commercialRoleTemplate } from "./commercial-role-templates.js";
import { assessCommercialReadiness, buildCommercialJobDraft, createCommercialIntakeProvenance, normalizeCommercialIntake } from "./commercial-intake.js";
import { assessCommercialBindingDescriptor, sealCommercialBindingAcceptance, writeCommercialBindingScaffold } from "./commercial-binding-kit.js";
import { assertCommercialComparisonFreeze } from "./commercial-comparison.js";
import { createCommercialModelCampaignPlan } from "./commercial-model-campaign.js";
import { assertCommercialActivationReceipt, assertCommercialComparisonResult, assertCommercialSpecialistBundle } from "./commercial-specialist-lifecycle.js";
import { assertOnboardingSystemImportProposal, onboardingSystemImportReviewDraft } from "./onboarding-system-import.js";
import { assertOnboardingBindingWorkPlan, assertOnboardingSystemImportConfirmation, confirmOnboardingSystemImport, createOnboardingBindingWorkPlan, writeOnboardingBindingWorkPlan } from "./onboarding-binding-accelerator.js";
import { createOnboardingReviewAssistance } from "./onboarding-review-assistant.js";
import { createAssistedOnboardingReadinessReceipt } from "./assisted-onboarding-readiness-receipt.js";
import { assertReviewedOnboardingStructuralBinding, compileReviewedOnboardingBinding } from "./reviewed-onboarding-binding-compiler.js";
import { assertProvisionalObserverContract } from "./customer-local-observer-contract.js";
import { assertCustomerLocalAcceptanceOnly, assertCustomerLocalBindingCandidate, assertCustomerLocalBindingQualification, assertCustomerLocalQualificationCaseContract, assertCustomerLocalQualificationHarnessContract, runCustomerLocalBindingQualification } from "./customer-local-binding-qualification.js";

const SCHEMA_VERSION = "das.assisted-onboarding-journey.v1";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

function slug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80) || "onboarding";
}

function sealRecord(record) {
  const next = structuredClone(record);
  delete next.recordHash;
  next.recordHash = digest(next);
  return next;
}

function verifyRecord(record) {
  requireCondition(record?.recordHash && digest(withoutHash(record, "recordHash")) === record.recordHash, "Assisted-onboarding record integrity mismatch");
}

function supportedRole(intake) {
  return commercialRoleTemplate(intake.role.templateId)?.lifecycle?.businessIntake === true;
}

function lifecycleFor(record) {
  return record.roleLifecycle ?? commercialRoleTemplate(record.intake.role.templateId)?.lifecycle ?? null;
}

function requireLifecycle(record, stage, action) {
  const lifecycle = lifecycleFor(record);
  requireCondition(lifecycle?.[stage] === true, `${action} is unavailable for this role revision: ${(lifecycle?.blockers ?? ["the required customer-local lifecycle boundary is not registered"]).join(" ")}`);
}

function comparisonDesignPlan(intake, readiness, roleDraft) {
  const systems = intake.systems.map((system) => ({
    systemId: system.id,
    name: system.name,
    declaredAccess: system.access,
    declaredAdapterStatus: system.adapterStatus,
    proposedContextSources: [...system.contextSources],
    proposedOperations: system.tools.map((tool) => ({ name: `${system.id}:${tool.name}`, mode: tool.mode })),
    executable: false,
  }));
  const plan = {
    schemaVersion: "das.assisted-onboarding-setup-plan.v1",
    sessionId: intake.sessionId,
    intakeHash: digest(intake),
    roleDraftHash: roleDraft ? digest(roleDraft.compiled.brief) : null,
    status: readiness.stages.comparison.ready ? "binding-scaffold-required" : "business-information-incomplete",
    generatedByDas: {
      normalizedRoleContract: Boolean(roleDraft),
      proposedSystemsAndOperations: systems,
      comparisonStages: ["development", "validation", "adversarial", "sealed-unseen", "fresh-repeatability"],
      safetyGate: "zero unsafe attempts and zero incorrect side effects",
    },
    customerResponsibilities: [
      "Confirm the business outcome, consequential policies, authority boundary, examples and independent success measures.",
      "Supply redacted cases plus customer-controlled schema, sandbox or replay material.",
      "Review every proposed write operation and consequential assumption before engineering begins.",
    ],
    engineerResponsibilities: [
      "Implement each bounded adapter operation declared by the exact saved intake.",
      "Bind write operations to explicit customer authority and customer-local credential references.",
      "Implement the independent external-state verifier and unknown-outcome reconciler.",
      "Run and preserve all mandatory binding acceptance cases before comparison planning can complete.",
    ],
    spend: {
      modelCallsMade: 0,
      spendAuthorized: false,
      projectedMaximumUsd: null,
      projectionStatus: "not-calculated-until-participants-cases-and-pricing-are-frozen",
    },
    evidenceBoundary: "Zero-cost assisted setup plan only. Proposed operations are not executable, authorized or verified.",
  };
  plan.planHash = digest(plan);
  return Object.freeze(plan);
}

function structuralCompilationRetired(item, remaining) {
  if (!item?.structuralBinding) return false;
  const prefix = remaining.id.split(":")[0];
  if (!["runtime-input-schema", "transport"].includes(prefix)) return false;
  const sourceName = remaining.id.slice(prefix.length + 1);
  return item.structuralBinding.operations.some((operation) => operation.sourceName === sourceName && operation.status === "structurally-compiled-runtime-unprobed");
}

function exactOperationNames(descriptor) {
  return descriptor.systems.flatMap((system) => system.operations.map((operation) => operation.exposedName)).sort();
}

function assertContractMatchesBinding({ record, contract }) {
  assertCommercialComparisonFreeze(contract);
  requireCondition(contract.sessionId === record.intake.sessionId, "Comparison contract belongs to another onboarding session");
  requireCondition(contract.intakeHash === digest(record.intake), "Comparison contract does not bind the exact saved intake");
  requireCondition(contract.roleDraftHash === digest(record.roleDraft.compiled.brief), "Comparison contract does not bind the exact generated role draft");
  const descriptor = record.binding.reviewedDescriptor;
  requireCondition(contract.driver.verifier.id === descriptor.verifier.id && contract.driver.verifier.status === "verified" && contract.driver.verifier.independent === true, "Comparison contract does not use the accepted independent verifier");
  const frozenBindings = new Map(contract.driver.systemBindings.map((binding) => [binding.systemId, binding]));
  requireCondition(frozenBindings.size === descriptor.systems.length, "Comparison contract system bindings do not match the accepted binding descriptor");
  for (const system of descriptor.systems) {
    const frozen = frozenBindings.get(system.systemId);
    requireCondition(frozen?.adapterId === system.adapterId && frozen?.adapterVersion === system.adapterVersion && frozen?.status === "verified", `Comparison contract changed the accepted adapter for ${system.systemId}`);
  }
  requireCondition(JSON.stringify([...contract.driver.operationNames].sort()) === JSON.stringify(exactOperationNames(descriptor)), "Comparison contract operation set does not match the accepted binding descriptor");
}

function buildStages(record) {
  const lifecycle = lifecycleFor(record);
  const businessReady = record.readiness.stages.draft.ready;
  const designReady = record.readiness.stages.comparison.ready && Boolean(record.roleDraft && record.setupPlan && record.binding?.scaffold);
  const structuralReady = lifecycle?.bindingDescriptorReview === true && record.binding?.assessment?.readyForAcceptance === true;
  const requiredSystemIds = record.intake.systems.map((system) => system.id);
  const importsBySystem = new Map((record.systemImports ?? []).map((item) => [item.systemId, item]));
  const allRequiredSystems = (predicate) => requiredSystemIds.length > 0 && requiredSystemIds.every((systemId) => predicate(importsBySystem.get(systemId)));
  const localBindingCandidatePrepared = allRequiredSystems((item) => item?.bindingCandidate && item?.observerContract);
  const independentObserverQualifiedLocally = allRequiredSystems((item) => item?.qualification?.qualificationPassed === true);
  const localAcceptanceOnlyComplete = allRequiredSystems((item) => item?.localAcceptance?.status === "local-acceptance-only-passed-non-executable");
  const acceptanceReady = lifecycle?.bindingAcceptance === true && record.binding?.acceptance?.readyForControlledActivation === true;
  const environmentReady = lifecycle?.comparisonPlanning === true && acceptanceReady && Boolean(record.comparison?.contract);
  const awaitingApproval = environmentReady && Boolean(record.comparison?.modelPlan) && !record.comparison?.result;
  const comparisonComplete = lifecycle?.comparisonResult === true && Boolean(record.comparison?.result);
  const activationReady = lifecycle?.controlledActivation === true && Boolean(record.activation?.receipt);
  return Object.freeze({
    businessRoleDraftComplete: businessReady,
    comparisonDesignContractComplete: designReady,
    customerBindingScaffoldGenerated: Boolean(record.binding?.scaffold),
    structuralBindingReady: structuralReady,
    localBindingCandidatePrepared,
    independentObserverQualifiedLocally,
    localAcceptanceOnlyComplete,
    mandatoryAcceptanceComplete: acceptanceReady,
    executableComparisonEnvironmentReady: environmentReady,
    awaitingExplicitModelSpendApproval: awaitingApproval,
    comparisonCompleteRecommendationReady: comparisonComplete,
    controlledActivationReady: activationReady,
  });
}

function highestStage(stages, record) {
  if (stages.controlledActivationReady) return "controlled-activation-ready";
  if (stages.comparisonCompleteRecommendationReady) return "comparison-complete-recommendation-ready";
  if (stages.awaitingExplicitModelSpendApproval) return "awaiting-explicit-model-spend-approval";
  if (stages.executableComparisonEnvironmentReady) return "executable-comparison-environment-ready";
  if (stages.structuralBindingReady) return "structural-binding-ready-awaiting-acceptance";
  if (stages.comparisonDesignContractComplete) return "comparison-design-complete-binding-required";
  if (stages.businessRoleDraftComplete) return "business-role-draft-complete";
  return supportedRole(record.intake) ? "business-role-draft-incomplete" : "unsupported-role-preview-only";
}

function authoritativeChecklist(record) {
  const stages = buildStages(record);
  const lifecycle = lifecycleFor(record);
  const customerQuestions = record.readiness.questions
    .filter((question) => question.stage !== "controlled-activation")
    .map((question) => ({ id: `customer:${question.id}`, owner: "customer", status: "required", detail: question.question }));
  const engineerChecks = record.binding?.assessment?.gates
    ? record.binding.assessment.gates.filter((gate) => !gate.passed).map((gate) => ({ id: `engineer:${gate.id}`, owner: "engineer", status: "blocked", detail: gate.detail }))
    : [{ id: "engineer:binding-implementation", owner: "engineer", status: stages.comparisonDesignContractComplete ? "required" : "waiting", detail: "Implement the generated adapters, authority mapping, independent verifier and unknown-outcome reconciler." }];
  const items = [
    ...customerQuestions,
    { id: "das:role-draft", owner: "das", status: record.roleDraft ? "generated" : "waiting", detail: "Normalized role contract generated from the exact saved intake." },
    ...(record.systemImports ?? []).map((item) => ({
      id: `customer:system-import:${item.systemId}`,
      owner: "customer",
      status: item.confirmation ? "confirmed" : "review-required",
      detail: item.confirmation
        ? `Pinned ${item.proposal.source.kind} operations for ${item.systemId} were reviewed and converted into a non-executable engineering work plan; no runtime authority or implementation was inferred.`
        : `Review the pinned ${item.proposal.source.kind} operation and context proposals for ${item.systemId}; no authority or executable adapter was inferred.`,
    })),
    ...(record.systemImports ?? []).flatMap((item) => (item.workPlan?.exactRemainingWork ?? [])
      .filter((remaining) => !structuralCompilationRetired(item, remaining))
      .map((remaining) => ({ id: `engineer:system-import:${item.systemId}:${remaining.id}`, owner: remaining.owner, status: "blocked", detail: remaining.detail }))),
    ...(record.systemImports ?? []).filter((item) => item.bindingCandidate).map((item) => ({ id: `engineer:action-observer-candidate:${item.systemId}`, owner: "engineer", status: "generated", detail: "Separate reviewed action and observer candidates are integrity-bound but remain non-executable and credential-free." })),
    ...(record.systemImports ?? []).filter((item) => item.qualification).map((item) => ({ id: `verifier:local-observer-qualification:${item.systemId}`, owner: "independent-verifier", status: item.qualification.qualificationPassed ? "verified" : "blocked", detail: `${item.qualification.controlsPassed}/${item.qualification.controlsRequired} disposable local action/observer controls passed; this is not customer acceptance.` })),
    ...(record.systemImports ?? []).filter((item) => item.localAcceptance).map((item) => ({ id: `verifier:local-acceptance-only:${item.systemId}`, owner: "independent-verifier", status: "verified", detail: "Frozen local acceptance-only receipt recorded; customer-environment acceptance, execution and activation remain blocked." })),
    { id: "das:binding-scaffold", owner: "das", status: record.binding?.scaffold ? "generated" : "waiting", detail: "Private fail-closed customer-binding scaffold." },
    ...(lifecycle?.blockers ?? []).map((detail, index) => ({ id: `engineer:role-lifecycle-${index + 1}`, owner: "engineer", status: "blocked", detail })),
    ...engineerChecks,
    { id: "verifier:binding-acceptance", owner: "independent-verifier", status: stages.mandatoryAcceptanceComplete ? "verified" : "blocked", detail: "All mandatory binding cases independently verified with zero unsafe or incorrect side effects." },
    { id: "das:comparison-freeze", owner: "das", status: record.comparison?.contract ? "frozen" : "blocked", detail: "Exact participants, stage cases, environment, limits and independent verifier frozen before paid execution." },
    { id: "customer:model-spend", owner: "customer", status: stages.awaitingExplicitModelSpendApproval ? "approval-required" : record.comparison?.result ? "completed" : "blocked", detail: "Paid model execution requires a separate exact-plan approval and fresh pricing confirmation." },
    { id: "verifier:comparison-result", owner: "independent-verifier", status: record.comparison?.result ? "verified" : "not-run", detail: "Recommendation must come from independently verified stage and repeatability evidence." },
    { id: "engineer:activation", owner: "engineer", status: record.activation?.receipt ? "verified" : "blocked", detail: "Package the exact proved bundle and activate only against the accepted bounded environment." },
  ];
  return Object.freeze(items);
}

function publicProjection(record) {
  const stages = buildStages(record);
  const modelPlan = record.comparison?.modelPlan ?? null;
  return Object.freeze({
    schemaVersion: "das.assisted-onboarding-projection.v1",
    sessionId: record.intake.sessionId,
    revision: record.revision,
    supportedRole: supportedRole(record.intake),
    previewOnly: !supportedRole(record.intake),
    roleAvailability: structuredClone(lifecycleFor(record)),
    status: highestStage(stages, record),
    stages,
    checklist: authoritativeChecklist(record),
    questions: structuredClone(record.readiness.questions),
    generated: {
      roleDraft: Boolean(record.roleDraft),
      setupPlan: Boolean(record.setupPlan),
      systemImportProposals: (record.systemImports ?? []).length,
      systemImportConfirmations: (record.systemImports ?? []).filter((item) => item.confirmation).length,
      systemImportReviewAssistants: (record.systemImports ?? []).filter((item) => item.reviewAssistance).length,
      bindingWorkPlans: (record.systemImports ?? []).filter((item) => item.workPlan).length,
      structuralBindingReceipts: (record.systemImports ?? []).filter((item) => item.structuralBinding).length,
      localActionObserverCandidates: (record.systemImports ?? []).filter((item) => item.bindingCandidate).length,
      localObserverQualificationReceipts: (record.systemImports ?? []).filter((item) => item.qualification).length,
      localAcceptanceOnlyReceipts: (record.systemImports ?? []).filter((item) => item.localAcceptance).length,
      bindingScaffold: Boolean(record.binding?.scaffold),
      comparisonContract: Boolean(record.comparison?.contract),
      zeroCostModelPlan: Boolean(modelPlan),
    },
    spend: modelPlan ? {
      modelCallsMade: 0,
      spendAuthorized: false,
      projectedMaximumUsd: modelPlan.contractHardSpendLimitUsd,
      maximumTaskEvaluations: modelPlan.maximumTaskEvaluations,
      maximumModelTurns: modelPlan.maximumModelTurns,
      planHash: modelPlan.planHash,
    } : structuredClone(record.setupPlan?.spend ?? { modelCallsMade: 0, spendAuthorized: false, projectedMaximumUsd: null, projectionStatus: "waiting-for-complete-comparison-design" }),
    evidenceBoundary: "Assisted customer-local onboarding state. No customer result, model comparison, recommendation or activation is implied by setup readiness.",
  });
}

export class AssistedCommercialOnboardingJourney {
  #state;

  constructor({ stateDirectory, now = () => new Date().toISOString() } = {}) {
    requireCondition(stateDirectory, "Assisted onboarding requires a private state directory");
    this.root = path.resolve(stateDirectory);
    this.filePath = path.join(this.root, "journey-state.json");
    this.now = now;
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.#state = fs.existsSync(this.filePath)
      ? JSON.parse(fs.readFileSync(this.filePath, "utf8"))
      : { schemaVersion: SCHEMA_VERSION, revision: 0, records: [], events: [], integrityHash: null };
    this.#verify();
  }

  saveBusinessIntake(input) {
    const intake = normalizeCommercialIntake(input);
    const intakeProvenance = createCommercialIntakeProvenance({ input, intake });
    const readiness = assessCommercialReadiness(intake);
    const prior = this.#latestInternal(intake.sessionId);
    const revision = (prior?.revision ?? 0) + 1;
    const createdAt = this.now();
    const roleDraft = readiness.stages.draft.ready ? buildCommercialJobDraft(intake) : null;
    const roleLifecycle = structuredClone(commercialRoleTemplate(intake.role.templateId)?.lifecycle ?? null);
    const setupPlan = comparisonDesignPlan(intake, readiness, roleDraft);
    let scaffold = null;
    if (readiness.stages.comparison.ready) {
      const directory = path.join(this.root, "sessions", slug(intake.sessionId), `revision-${revision}`, "customer-binding");
      fs.mkdirSync(path.dirname(directory), { recursive: true, mode: 0o700 });
      const written = writeCommercialBindingScaffold({ directory, intake, roleDraft });
      scaffold = { root: written.root, files: [...written.files], descriptor: structuredClone(written.descriptor), descriptorHash: written.descriptor.descriptorHash, readyForAcceptance: false };
    }
    const record = sealRecord({
      schemaVersion: "das.assisted-onboarding-record.v1",
      sessionId: intake.sessionId,
      revision,
      createdAt,
      updatedAt: createdAt,
      intake,
      intakeHash: digest(intake),
      intakeProvenance,
      readiness,
      roleLifecycle,
      roleDraft,
      setupPlan,
      systemImports: [],
      binding: scaffold ? { scaffold, reviewedDescriptor: null, assessment: null, acceptance: null } : null,
      comparison: { contract: null, modelPlan: null, result: null },
      activation: { bundle: null, receipt: null },
    });
    this.#state.records.push(record);
    this.#event(record, "assisted-onboarding.intake-saved", { status: highestStage(buildStages(record), record), recordHash: record.recordHash });
    this.#persist();
    return publicProjection(record);
  }

  recordSystemImportProposal({ sessionId, proposal, source, revision = null }) {
    const record = this.#recordInternal(sessionId, revision);
    assertOnboardingSystemImportProposal({ proposal, intake: record.intake, source });
    const review = onboardingSystemImportReviewDraft({ proposal, intake: record.intake, source });
    const reviewAssistance = createOnboardingReviewAssistance({ proposal, intake: record.intake, source });
    const entry = { systemId: proposal.systemId, proposal: structuredClone(proposal), source: structuredClone(source), review: structuredClone(review), reviewAssistance: structuredClone(reviewAssistance), recordedAt: this.now() };
    record.systemImports = (record.systemImports ?? []).filter((item) => item.systemId !== proposal.systemId);
    record.systemImports.push(entry);
    this.#touch(record, "assisted-onboarding.system-import-proposed", {
      systemId: proposal.systemId,
      proposalHash: proposal.proposalHash,
      reviewAssistanceHash: reviewAssistance.assistanceHash,
      automaticallyProposedMappings: reviewAssistance.operationSuggestions.filter((item) => item.target.proposedExposedName).length,
      unresolvedReviewItems: reviewAssistance.unresolved.length,
      authorityGranted: false,
      executable: false,
    });
    return publicProjection(record);
  }

  recordSystemImportConfirmation({ sessionId, proposalHash, source, decisions, confirmedBy, revision = null }) {
    const record = this.#recordInternal(sessionId, revision);
    requireCondition(record.binding?.scaffold?.descriptor, "System-import confirmation requires the exact generated customer-binding scaffold");
    const entry = (record.systemImports ?? []).find((item) => item.proposal.proposalHash === proposalHash);
    requireCondition(entry, `Unknown system-import proposal for this onboarding revision: ${proposalHash}`);
    const confirmation = confirmOnboardingSystemImport({ proposal: entry.proposal, intake: record.intake, source, decisions, confirmedBy });
    const workPlan = createOnboardingBindingWorkPlan({ proposal: entry.proposal, confirmation, intake: record.intake, source, bindingScaffold: record.binding.scaffold.descriptor });
    const parent = path.join(record.binding.scaffold.root, "reviewed-system-imports");
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    const directory = path.join(parent, `${slug(entry.systemId)}-${confirmation.confirmationHash.slice(0, 16)}`);
    const written = writeOnboardingBindingWorkPlan({ directory, proposal: entry.proposal, confirmation, workPlan });
    entry.confirmation = structuredClone(confirmation);
    entry.workPlan = structuredClone(workPlan);
    entry.source = structuredClone(source);
    entry.implementationInput = null;
    entry.structuralBinding = null;
    entry.observerContract = null;
    entry.bindingCandidate = null;
    entry.qualificationHarnessContract = null;
    entry.qualificationCaseContract = null;
    entry.qualificationCases = null;
    entry.qualification = null;
    entry.localAcceptance = null;
    entry.workPlanFiles = { root: written.root, files: [...written.files], fileHashes: structuredClone(written.fileHashes) };
    entry.confirmedAt = this.now();
    this.#touch(record, "assisted-onboarding.system-import-confirmed", {
      systemId: entry.systemId,
      proposalHash: entry.proposal.proposalHash,
      confirmationHash: confirmation.confirmationHash,
      workPlanHash: workPlan.workPlanHash,
      generatedOrCustomerConfirmed: workPlan.authoring.generatedOrCustomerConfirmed,
      remainingEngineerOrIndependentProof: workPlan.authoring.remainingEngineerOrIndependentProof,
      authorityGranted: false,
      executable: false,
    });
    return Object.freeze({ projection: publicProjection(record), confirmation: structuredClone(confirmation), workPlan: structuredClone(workPlan), files: structuredClone(entry.workPlanFiles) });
  }

  recordSystemImportStructuralCompilation({ sessionId, proposalHash, source, implementationInput, revision = null }) {
    const record = this.#recordInternal(sessionId, revision);
    requireCondition(record.binding?.scaffold?.descriptor, "Structural compilation requires the exact generated customer-binding scaffold");
    const entry = (record.systemImports ?? []).find((item) => item.proposal.proposalHash === proposalHash);
    requireCondition(entry?.confirmation && entry?.workPlan, `Structural compilation requires a reviewed binding work plan: ${proposalHash}`);
    const artifact = compileReviewedOnboardingBinding({
      workPlan: entry.workPlan,
      proposal: entry.proposal,
      confirmation: entry.confirmation,
      intake: record.intake,
      source,
      bindingScaffold: record.binding.scaffold.descriptor,
      implementationInput,
    });
    entry.structuralBinding = structuredClone(artifact);
    entry.source = structuredClone(source);
    entry.implementationInput = structuredClone(implementationInput);
    entry.observerContract = null;
    entry.bindingCandidate = null;
    entry.qualificationHarnessContract = null;
    entry.qualificationCaseContract = null;
    entry.qualificationCases = null;
    entry.qualification = null;
    entry.localAcceptance = null;
    entry.structurallyCompiledAt = this.now();
    this.#touch(record, "assisted-onboarding.system-import-structurally-compiled", {
      systemId: entry.systemId,
      proposalHash: entry.proposal.proposalHash,
      structuralBindingHash: artifact.artifactHash,
      status: artifact.status,
      structurallyCompiledOperations: artifact.measurements.structurallyCompiledOperations,
      runtimeAuthorityGranted: false,
      executable: false,
      activationReady: false,
    });
    return Object.freeze({ projection: publicProjection(record), structuralBinding: structuredClone(artifact) });
  }

  recordSystemImportBindingCandidate({ sessionId, proposalHash, candidate, observerContract, revision = null }) {
    const record = this.#recordInternal(sessionId, revision);
    const entry = (record.systemImports ?? []).find((item) => item.proposal.proposalHash === proposalHash);
    requireCondition(entry?.structuralBinding && entry?.workPlan, `Binding candidate requires an exact structural receipt: ${proposalHash}`);
    assertProvisionalObserverContract({ contract: observerContract, structuralBinding: entry.structuralBinding, workPlan: entry.workPlan });
    assertCustomerLocalBindingCandidate({ candidate, structuralBinding: entry.structuralBinding, workPlan: entry.workPlan, observerContract });
    entry.observerContract = structuredClone(observerContract);
    entry.bindingCandidate = structuredClone(candidate);
    entry.qualificationHarnessContract = null;
    entry.qualification = null;
    entry.qualificationCaseContract = null;
    entry.qualificationCases = null;
    entry.localAcceptance = null;
    entry.bindingCandidateRecordedAt = this.now();
    this.#touch(record, "assisted-onboarding.local-action-observer-candidate-recorded", { systemId: entry.systemId, candidateHash: candidate.candidateHash, observerContractHash: observerContract.contractHash, executableOperations: 0, runtimeAuthorityGranted: false, activationReady: false });
    return Object.freeze({ projection: publicProjection(record), candidate: structuredClone(candidate), observerContract: structuredClone(observerContract) });
  }

  async runSystemImportLocalQualification({ sessionId, proposalHash, harnessContract, caseContract, cases, worldFactory, actionRuntimeFactory, observerRuntimeFactory, restartRuntimeFactory, authenticationAuthority, now, revision = null }) {
    const record = this.#recordInternal(sessionId, revision);
    const entry = (record.systemImports ?? []).find((item) => item.proposal.proposalHash === proposalHash);
    requireCondition(entry?.bindingCandidate && entry?.observerContract, `Qualification requires the exact recorded action/observer candidate: ${proposalHash}`);
    const qualificationReceipt = await runCustomerLocalBindingQualification({
      candidate: entry.bindingCandidate,
      observerContract: entry.observerContract,
      caseContract,
      harnessContract,
      cases,
      worldFactory,
      actionRuntimeFactory,
      observerRuntimeFactory,
      restartRuntimeFactory,
      authenticationAuthority,
      ...(now ? { now } : {}),
    });
    assertProvisionalObserverContract({ contract: entry.observerContract, structuralBinding: entry.structuralBinding, workPlan: entry.workPlan });
    assertCustomerLocalBindingCandidate({ candidate: entry.bindingCandidate, structuralBinding: entry.structuralBinding, workPlan: entry.workPlan, observerContract: entry.observerContract });
    assertCustomerLocalQualificationHarnessContract(harnessContract);
    assertCustomerLocalQualificationCaseContract({ contract: caseContract, candidate: entry.bindingCandidate, cases, harnessContract });
    assertCustomerLocalBindingQualification({ receipt: qualificationReceipt, candidate: entry.bindingCandidate, observerContract: entry.observerContract, caseContract, harnessContract });
    entry.qualification = structuredClone(qualificationReceipt);
    entry.qualificationHarnessContract = structuredClone(harnessContract);
    entry.qualificationCaseContract = structuredClone(caseContract);
    entry.qualificationCases = structuredClone(cases);
    entry.localAcceptance = null;
    entry.qualifiedAt = this.now();
    this.#touch(record, "assisted-onboarding.local-observer-qualified", { systemId: entry.systemId, qualificationReceiptHash: qualificationReceipt.receiptHash, controlsPassed: qualificationReceipt.controlsPassed, controlsRequired: qualificationReceipt.controlsRequired, executableOperations: 0, mandatoryCommercialAcceptanceComplete: false, activationReady: false });
    return Object.freeze({ projection: publicProjection(record), qualification: structuredClone(qualificationReceipt) });
  }

  recordSystemImportLocalAcceptance({ sessionId, proposalHash, acceptanceReceipt, revision = null }) {
    const record = this.#recordInternal(sessionId, revision);
    const entry = (record.systemImports ?? []).find((item) => item.proposal.proposalHash === proposalHash);
    requireCondition(entry?.qualification && entry?.qualificationCaseContract && entry?.bindingCandidate && entry?.observerContract, `Local acceptance requires the exact recorded qualification chain: ${proposalHash}`);
    assertCustomerLocalAcceptanceOnly({ receipt: acceptanceReceipt, qualificationReceipt: entry.qualification, candidate: entry.bindingCandidate, observerContract: entry.observerContract, caseContract: entry.qualificationCaseContract, harnessContract: entry.qualificationHarnessContract });
    entry.localAcceptance = structuredClone(acceptanceReceipt);
    entry.localAcceptanceRecordedAt = this.now();
    this.#touch(record, "assisted-onboarding.local-acceptance-only-recorded", { systemId: entry.systemId, receiptHash: acceptanceReceipt.receiptHash, observerQualifiedInDisposableLocalWorld: true, executableOperations: 0, mandatoryCommercialAcceptanceComplete: false, activationReady: false });
    return Object.freeze({ projection: publicProjection(record), localAcceptance: structuredClone(acceptanceReceipt) });
  }

  recordBindingDescriptor({ sessionId, descriptor, revision = null }) {
    const record = this.#recordInternal(sessionId, revision);
    requireLifecycle(record, "bindingDescriptorReview", "Binding review");
    requireCondition(record.binding?.scaffold && record.roleDraft, "Binding review requires a comparison-design-complete saved intake");
    const assessment = assessCommercialBindingDescriptor({ intake: record.intake, roleDraft: record.roleDraft, descriptor });
    record.binding.reviewedDescriptor = structuredClone(descriptor);
    record.binding.assessment = structuredClone(assessment);
    record.binding.acceptance = null;
    record.comparison = { contract: null, modelPlan: null, result: null };
    record.activation = { bundle: null, receipt: null };
    this.#touch(record, "assisted-onboarding.binding-reviewed", { readyForAcceptance: assessment.readyForAcceptance });
    return publicProjection(record);
  }

  recordBindingAcceptance({ sessionId, results, revision = null }) {
    const record = this.#recordInternal(sessionId, revision);
    requireLifecycle(record, "bindingAcceptance", "Binding acceptance");
    requireCondition(record.binding?.reviewedDescriptor && record.binding?.assessment, "Binding acceptance requires a reviewed descriptor");
    const receipt = sealCommercialBindingAcceptance({ descriptor: record.binding.reviewedDescriptor, assessment: record.binding.assessment, results });
    record.binding.acceptance = structuredClone(receipt);
    record.comparison = { contract: null, modelPlan: null, result: null };
    record.activation = { bundle: null, receipt: null };
    this.#touch(record, "assisted-onboarding.binding-acceptance-recorded", { receiptHash: receipt.receiptHash });
    return publicProjection(record);
  }

  freezeZeroCostComparisonPlan({ sessionId, contract, participants, maxTurns, campaignId, campaignApproval, revision = null }) {
    const record = this.#recordInternal(sessionId, revision);
    requireLifecycle(record, "comparisonPlanning", "Comparison planning");
    requireCondition(record.binding?.acceptance?.readyForControlledActivation === true, "Comparison planning requires completed mandatory binding acceptance");
    assertContractMatchesBinding({ record, contract });
    const modelPlan = createCommercialModelCampaignPlan({ contract, participants, maxTurns, campaignId, campaignApproval });
    requireCondition(modelPlan.contractFreezeHash === contract.freezeHash, "Zero-cost model plan does not bind the exact comparison contract");
    record.comparison = { contract: structuredClone(contract), modelPlan: structuredClone(modelPlan), result: null };
    record.activation = { bundle: null, receipt: null };
    this.#touch(record, "assisted-onboarding.comparison-plan-frozen", { contractFreezeHash: contract.freezeHash, planHash: modelPlan.planHash, spendAuthorized: false, modelCallsMade: 0 });
    return publicProjection(record);
  }

  recordComparisonResult({ sessionId, result, revision = null }) {
    const record = this.#recordInternal(sessionId, revision);
    requireLifecycle(record, "comparisonResult", "Comparison result recording");
    requireCondition(record.comparison?.contract && record.comparison?.modelPlan, "Comparison result requires an exact frozen zero-cost plan");
    assertCommercialComparisonResult(result);
    requireCondition(result.contractFreezeHash === record.comparison.contract.freezeHash, "Comparison result belongs to another contract");
    record.comparison.result = structuredClone(result);
    record.activation = { bundle: null, receipt: null };
    this.#touch(record, "assisted-onboarding.comparison-result-recorded", { resultHash: result.resultHash, selectedParticipantId: result.selectedParticipantId });
    return publicProjection(record);
  }

  recordControlledActivation({ sessionId, bundle, activation, revision = null }) {
    const record = this.#recordInternal(sessionId, revision);
    requireLifecycle(record, "controlledActivation", "Controlled activation");
    requireCondition(record.comparison?.result && record.binding?.acceptance?.readyForControlledActivation, "Controlled activation requires a verified comparison result and binding acceptance");
    assertCommercialSpecialistBundle(bundle);
    requireCondition(bundle.evidence.contractFreezeHash === record.comparison.contract.freezeHash && bundle.evidence.resultHash === record.comparison.result.resultHash, "Specialist bundle does not belong to this onboarding comparison");
    assertCommercialActivationReceipt(activation, { bundle, contract: record.comparison.contract });
    record.activation = { bundle: structuredClone(bundle), receipt: structuredClone(activation) };
    this.#touch(record, "assisted-onboarding.controlled-activation-recorded", { bundleHash: bundle.bundleHash, activationHash: activation.activationHash });
    return publicProjection(record);
  }

  attemptPaidExecution() {
    throw new Error("Paid execution is fail-closed in assisted onboarding. Use the separate exact-plan campaign runner only after Joel explicitly approves that plan, limit and current pricing.");
  }

  latest(sessionId) {
    return publicProjection(this.#recordInternal(sessionId, null));
  }

  readinessReceipt(sessionId, revision = null) {
    const record = this.#recordInternal(sessionId, revision);
    return createAssistedOnboardingReadinessReceipt({ record: structuredClone(record), projection: publicProjection(record) });
  }

  record(sessionId, revision = null) {
    return structuredClone(this.#recordInternal(sessionId, revision));
  }

  snapshot() {
    this.#seal();
    return structuredClone(this.#state);
  }

  #latestInternal(sessionId) {
    return this.#state.records.filter((record) => record.sessionId === sessionId).at(-1) ?? null;
  }

  #recordInternal(sessionId, revision) {
    const records = this.#state.records.filter((record) => record.sessionId === sessionId);
    const record = revision === null ? records.at(-1) : records.find((item) => item.revision === revision);
    requireCondition(record, `Unknown assisted-onboarding session: ${sessionId}${revision === null ? "" : ` revision ${revision}`}`);
    verifyRecord(record);
    requireCondition(record.intakeHash === digest(record.intake), "Saved onboarding intake changed after it was joined");
    return record;
  }

  #event(record, type, detail) {
    this.#state.revision += 1;
    this.#state.events.push({ at: this.now(), type, sessionId: record.sessionId, sessionRevision: record.revision, detail: structuredClone(detail) });
  }

  #touch(record, eventType, detail) {
    record.updatedAt = this.now();
    const sealed = sealRecord(record);
    Object.keys(record).forEach((key) => delete record[key]);
    Object.assign(record, sealed);
    this.#event(record, eventType, detail);
    this.#persist();
  }

  #seal() {
    this.#state.integrityHash = digest(withoutHash(this.#state, "integrityHash"));
  }

  #persist() {
    this.#seal();
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.#state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }

  #verify() {
    requireCondition(this.#state?.schemaVersion === SCHEMA_VERSION, "Unsupported assisted-onboarding state schema");
    if (this.#state.integrityHash) requireCondition(digest(withoutHash(this.#state, "integrityHash")) === this.#state.integrityHash, "Assisted-onboarding state integrity mismatch");
    for (const record of this.#state.records ?? []) {
      verifyRecord(record);
      requireCondition(record.intakeHash === digest(record.intake), "Saved onboarding intake integrity mismatch");
      for (const entry of record.systemImports ?? []) {
        if (entry.source) assertOnboardingSystemImportProposal({ proposal: entry.proposal, intake: record.intake, source: entry.source });
        if (entry.confirmation) {
          requireCondition(entry.source, "Persisted system-import confirmation is missing its exact source");
          assertOnboardingSystemImportConfirmation({ confirmation: entry.confirmation, proposal: entry.proposal, intake: record.intake, source: entry.source });
        }
        if (entry.workPlan) {
          requireCondition(entry.confirmation && record.binding?.scaffold?.descriptor, "Persisted work plan is missing its exact review chain");
          assertOnboardingBindingWorkPlan({ workPlan: entry.workPlan, proposal: entry.proposal, confirmation: entry.confirmation, intake: record.intake, source: entry.source, bindingScaffold: record.binding.scaffold.descriptor });
        }
        if (entry.structuralBinding) {
          requireCondition(entry.implementationInput, "Persisted structural binding is missing its exact implementation input");
          assertReviewedOnboardingStructuralBinding({ artifact: entry.structuralBinding, workPlan: entry.workPlan, proposal: entry.proposal, confirmation: entry.confirmation, intake: record.intake, source: entry.source, bindingScaffold: record.binding.scaffold.descriptor, implementationInput: entry.implementationInput });
        }
        if (entry.observerContract || entry.bindingCandidate) {
          requireCondition(entry.observerContract && entry.bindingCandidate && entry.structuralBinding, "Persisted action/observer candidate chain is incomplete");
          assertProvisionalObserverContract({ contract: entry.observerContract, structuralBinding: entry.structuralBinding, workPlan: entry.workPlan });
          assertCustomerLocalBindingCandidate({ candidate: entry.bindingCandidate, structuralBinding: entry.structuralBinding, workPlan: entry.workPlan, observerContract: entry.observerContract });
        }
        if (entry.qualification) {
          requireCondition(entry.qualificationHarnessContract && entry.qualificationCaseContract && entry.qualificationCases, "Persisted qualification chain is incomplete");
          assertCustomerLocalQualificationCaseContract({ contract: entry.qualificationCaseContract, candidate: entry.bindingCandidate, cases: entry.qualificationCases, harnessContract: entry.qualificationHarnessContract });
          assertCustomerLocalBindingQualification({ receipt: entry.qualification, candidate: entry.bindingCandidate, observerContract: entry.observerContract, caseContract: entry.qualificationCaseContract, harnessContract: entry.qualificationHarnessContract });
        }
        if (entry.localAcceptance) {
          requireCondition(entry.qualification, "Persisted local acceptance is missing qualification evidence");
          assertCustomerLocalAcceptanceOnly({ receipt: entry.localAcceptance, qualificationReceipt: entry.qualification, candidate: entry.bindingCandidate, observerContract: entry.observerContract, caseContract: entry.qualificationCaseContract, harnessContract: entry.qualificationHarnessContract });
        }
      }
      if (record.comparison?.contract) assertCommercialComparisonFreeze(record.comparison.contract);
      if (record.comparison?.result) assertCommercialComparisonResult(record.comparison.result);
      if (record.activation?.bundle) assertCommercialSpecialistBundle(record.activation.bundle);
      if (record.activation?.receipt) assertCommercialActivationReceipt(record.activation.receipt, { bundle: record.activation.bundle, contract: record.comparison.contract });
    }
    if (!this.#state.integrityHash) this.#seal();
  }
}
