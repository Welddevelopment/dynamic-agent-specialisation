import { digest } from "../core/canonical.js";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

function present(value) {
  return value !== undefined && value !== null && value !== "";
}

function customerFacts(record) {
  const intake = record.intake;
  const provenance = new Map((record.intakeProvenance?.facts ?? []).map((item) => [item.path, item.status]));
  const groupedStatus = (paths) => {
    const statuses = paths.map((path) => provenance.get(path) ?? "unknown");
    return statuses.every((status) => status === "customer-supplied") ? "customer-supplied" : statuses.some((status) => status === "customer-supplied") ? "mixed-customer-and-generated-defaults" : statuses[0] ?? "unknown";
  };
  return Object.freeze([
    { id: "company", status: groupedStatus(["company.name", "company.industry", "company.operatingContext"]), value: { name: intake.company?.name || null, industry: intake.company?.industry || null, operatingContextSupplied: present(intake.company?.operatingContext) } },
    { id: "role", status: groupedStatus(["role.templateId", "role.title", "role.outcome", "role.completionRule", "role.escalationOwner"]), value: { templateId: intake.role?.templateId || null, title: intake.role?.title || null, outcomeSupplied: present(intake.role?.outcome), completionRuleSupplied: present(intake.role?.completionRule), escalationOwnerSupplied: present(intake.role?.escalationOwner) } },
    { id: "systems", status: provenance.get("systems") ?? "unknown", value: (intake.systems ?? []).map((system) => ({ id: system.id, name: system.name, kind: system.kind, declaredAccess: system.access, declaredAdapterStatus: system.adapterStatus, declaredOperations: system.tools.map((tool) => ({ name: tool.name, mode: tool.mode })) })) },
    { id: "policies", status: provenance.get("policies") ?? "unknown", value: { supplied: intake.policies?.length ?? 0, explicitlyConfirmed: intake.policies?.filter((item) => item.confirmed).length ?? 0 } },
    { id: "authority", status: groupedStatus(["authority.allowedActions", "authority.approvalActions", "authority.forbiddenActions"]), value: { allowedActions: [...(intake.authority?.allowedActions ?? [])], approvalActions: [...(intake.authority?.approvalActions ?? [])], forbiddenActions: [...(intake.authority?.forbiddenActions ?? [])] } },
    { id: "representative-cases", status: provenance.get("examples") ?? "unknown", value: { count: intake.examples?.length ?? 0, sources: [...new Set((intake.examples ?? []).map((item) => item.source))].sort(), redactionConfirmed: (intake.examples ?? []).every((item) => item.redacted) } },
    { id: "success", status: groupedStatus(["success.measures", "success.verifierMode", "success.verifierStatus", "success.owner"]), value: { measures: [...(intake.success?.measures ?? [])], verifierModeDeclared: intake.success?.verifierMode ?? "not-defined", verifierStatusDeclared: intake.success?.verifierStatus ?? "missing", owner: intake.success?.owner || null } },
    { id: "priorities", status: groupedStatus(["priorities.quality", "priorities.cost", "priorities.speed", "priorities.maximumCostPerTaskUsd", "priorities.maximumLatencyMs", "priorities.goal"]), value: structuredClone(intake.priorities ?? {}) },
    { id: "data-handling", status: groupedStatus(["dataHandling.localOnly", "dataHandling.productionDataIncluded", "dataHandling.redactionConfirmed"]), value: structuredClone(intake.dataHandling ?? {}) },
  ]);
}

function reviewedSystemImportFacts(record) {
  return (record.systemImports ?? []).filter((item) => item.confirmation).map((item, index) => ({
    id: `system-import-review-${index + 1}`,
    status: "customer-confirmed-non-executable",
    value: {
      systemId: item.systemId,
      sourceKind: item.proposal.source.kind,
      sourceHash: item.proposal.source.sourceHash,
      confirmationHash: item.confirmation.confirmationHash,
      approvedOperations: item.confirmation.operationChoices.filter((choice) => choice.approved).map((choice) => ({ sourceName: choice.sourceName, targetExposedName: choice.targetExposedName, confirmedMode: choice.confirmedMode, authorityClassification: choice.authority.classification })),
      runtimeAuthorityGranted: false,
    },
  }));
}

function dasArtifacts(record) {
  return Object.freeze([
    { id: "normalized-role-draft", status: record.roleDraft ? "generated-proposal-not-execution-evidence" : "not-generated", artifactHash: record.roleDraft ? digest(record.roleDraft) : null },
    { id: "comparison-design-plan", status: record.setupPlan ? "generated-proposal-not-execution-evidence" : "not-generated", artifactHash: record.setupPlan?.planHash ?? null },
    { id: "customer-binding-scaffold", status: record.binding?.scaffold ? "generated-non-executable" : "not-generated", artifactHash: record.binding?.scaffold?.descriptorHash ?? null },
    ...(record.systemImports ?? []).map((item, index) => ({ id: `system-import-proposal-${index + 1}`, status: "generated-awaiting-customer-review-and-engineering", systemId: item.systemId, sourceKind: item.proposal.source.kind, artifactHash: item.proposal.proposalHash })),
    ...(record.systemImports ?? []).filter((item) => item.reviewAssistance).map((item, index) => ({
      id: `system-import-review-assistance-${index + 1}`,
      status: "generated-proposals-awaiting-customer-confirmation",
      systemId: item.systemId,
      sourceKind: item.proposal.source.kind,
      artifactHash: item.reviewAssistance.assistanceHash,
      proposedMappings: item.reviewAssistance.operationSuggestions.filter((operation) => operation.target.proposedExposedName).length,
      unresolvedItems: item.reviewAssistance.unresolved.length,
      runtimeAuthorityGranted: false,
    })),
    ...(record.systemImports ?? []).filter((item) => item.workPlan).map((item, index) => ({
      id: `binding-work-plan-${index + 1}`,
      status: "generated-reviewed-scaffold-non-executable",
      systemId: item.systemId,
      sourceKind: item.proposal.source.kind,
      artifactHash: item.workPlan.workPlanHash,
      setupCoverage: structuredClone(item.workPlan.authoring),
    })),
    ...(record.systemImports ?? []).filter((item) => item.structuralBinding).map((item, index) => ({
      id: `structural-binding-receipt-${index + 1}`,
      status: item.structuralBinding.status,
      systemId: item.systemId,
      sourceKind: item.proposal.source.kind,
      artifactHash: item.structuralBinding.artifactHash,
      structurallyCompiledOperations: item.structuralBinding.measurements.structurallyCompiledOperations,
      executable: false,
      activationReady: false,
    })),
    ...(record.systemImports ?? []).filter((item) => item.bindingCandidate).map((item, index) => ({
      id: `local-action-observer-candidate-${index + 1}`,
      status: item.bindingCandidate.status,
      systemId: item.systemId,
      artifactHash: item.bindingCandidate.candidateHash,
      separateSurfaceIdentities: item.bindingCandidate.action.surfaceId !== item.bindingCandidate.observer.surfaceId,
      executableOperations: 0,
      executable: false,
      activationReady: false,
    })),
    ...(record.systemImports ?? []).filter((item) => item.qualification).map((item, index) => ({
      id: `local-observer-qualification-${index + 1}`,
      status: item.qualification.status,
      systemId: item.systemId,
      artifactHash: item.qualification.receiptHash,
      controlsPassed: item.qualification.controlsPassed,
      controlsRequired: item.qualification.controlsRequired,
      customerEnvironmentAccepted: false,
      executable: false,
    })),
    ...(record.systemImports ?? []).filter((item) => item.localAcceptance).map((item, index) => ({
      id: `local-acceptance-only-${index + 1}`,
      status: item.localAcceptance.status,
      systemId: item.systemId,
      artifactHash: item.localAcceptance.receiptHash,
      mandatoryCommercialAcceptanceComplete: false,
      executable: false,
      activationReady: false,
    })),
  ]);
}

function engineerBindings(record) {
  const assessment = record.binding?.assessment ?? null;
  const lifecycleBlockers = record.roleLifecycle?.blockers ?? [];
  return Object.freeze({
    status: assessment?.readyForAcceptance === true ? "structurally-ready-awaiting-independent-acceptance" : "engineering-required",
    reviewedDescriptorPresent: Boolean(record.binding?.reviewedDescriptor),
    structuralAssessmentPresent: Boolean(assessment),
    structuralAssessmentReady: assessment?.readyForAcceptance === true,
    failedStructuralGates: (assessment?.gates ?? []).filter((gate) => !gate.passed).map((gate) => ({ id: gate.id, detail: gate.detail })),
    roleSpecificMissingBindings: [...lifecycleBlockers],
    reviewedWorkPlans: (record.systemImports ?? []).filter((item) => item.workPlan).map((item) => ({
      systemId: item.systemId,
      workPlanHash: item.workPlan.workPlanHash,
      generatedOrCustomerConfirmed: item.workPlan.authoring.generatedOrCustomerConfirmed,
      remainingEngineerOrIndependentProof: item.workPlan.authoring.remainingEngineerOrIndependentProof,
      exactRemainingWork: structuredClone(item.workPlan.exactRemainingWork),
      executable: false,
    })),
    structuralBindingReceipts: (record.systemImports ?? []).filter((item) => item.structuralBinding).map((item) => ({
      systemId: item.systemId,
      artifactHash: item.structuralBinding.artifactHash,
      status: item.structuralBinding.status,
      compiledOperations: item.structuralBinding.measurements.structurallyCompiledOperations,
      runtimeWired: false,
      independentlyProved: false,
      executable: false,
    })),
    customerLocalBindingCandidates: (record.systemImports ?? []).filter((item) => item.bindingCandidate).map((item) => ({
      systemId: item.systemId,
      candidateHash: item.bindingCandidate.candidateHash,
      actionSurfaceId: item.bindingCandidate.action.surfaceId,
      observerSurfaceId: item.bindingCandidate.observer.surfaceId,
      writeSafetySuppliedNotCustomerProved: item.bindingCandidate.action.operations.filter((operation) => operation.mode === "write").length,
      executableOperations: 0,
      executable: false,
    })),
    customerDeclarationsAreProof: false,
    boundary: "Customer-declared adapter or verifier status is business input, not engineer implementation evidence. Only a reviewed exact descriptor and independent acceptance can advance execution readiness.",
  });
}

function independentProof(record) {
  return Object.freeze({
    localObserverQualification: (record.systemImports ?? []).filter((item) => item.qualification).map((item) => ({ systemId: item.systemId, status: item.qualification.status, receiptHash: item.qualification.receiptHash, controlsPassed: item.qualification.controlsPassed, controlsRequired: item.qualification.controlsRequired, customerEnvironmentAccepted: false })),
    localAcceptanceOnly: (record.systemImports ?? []).filter((item) => item.localAcceptance).map((item) => ({ systemId: item.systemId, status: item.localAcceptance.status, receiptHash: item.localAcceptance.receiptHash, mandatoryCommercialAcceptanceComplete: false })),
    bindingAcceptance: record.binding?.acceptance ? { status: "independently-verified", receiptHash: record.binding.acceptance.receiptHash } : { status: "not-run", receiptHash: null },
    comparisonResult: record.comparison?.result ? { status: "independently-verified-result-recorded", resultHash: record.comparison.result.resultHash } : { status: "not-run", resultHash: null },
    controlledActivation: record.activation?.receipt ? { status: "verified-readiness-receipt-recorded-not-active", activationHash: record.activation.receipt.activationHash } : { status: "not-ready", activationHash: null },
    candidateSelfReportsAcceptedAsProof: false,
  });
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function createAssistedOnboardingReadinessReceipt({ record, projection }) {
  requireCondition(record?.recordHash && digest(withoutHash(record, "recordHash")) === record.recordHash, "Readiness receipt requires an integrity-valid onboarding record");
  requireCondition(projection?.schemaVersion === "das.assisted-onboarding-projection.v1", "Readiness receipt requires the authoritative onboarding projection");
  requireCondition(projection.sessionId === record.sessionId && projection.revision === record.revision, "Readiness receipt projection belongs to another onboarding revision");
  const stages = projection.stages;
  const roleSpecificBlockers = record.roleLifecycle?.blockers ?? [];
  const currentChecklistBlockers = (projection.checklist ?? []).filter((item) => !["generated", "verified", "completed", "frozen"].includes(item.status)).map((item) => item.detail);
  const workPlanBlockers = (record.systemImports ?? []).flatMap((item) => {
    if (item.localAcceptance) return [
      "customer-local-credentials-not-resolved",
      "runtime-authority-not-granted",
      "customer-environment-action-binding-not-probed",
      "customer-environment-independent-observer-not-qualified",
      "mandatory-commercial-acceptance-not-run",
      "executable-comparison-environment-not-ready",
      "controlled-activation-blocked",
    ];
    if (item.qualification) return [
      "local-qualification-passed-customer-environment-unproved",
      "customer-local-credentials-not-resolved",
      "runtime-authority-not-granted",
      "mandatory-commercial-acceptance-not-run",
      "controlled-activation-blocked",
    ];
    if (item.bindingCandidate) return [
      "action-binding-candidate-unprobed",
      "independent-observer-candidate-unqualified",
      "customer-local-credentials-not-resolved",
      "runtime-authority-not-granted",
      "mandatory-commercial-acceptance-not-run",
      "controlled-activation-blocked",
    ];
    if (item.structuralBinding) return item.structuralBinding.exactBlockers;
    return (item.workPlan?.exactRemainingWork ?? []).map((remaining) => remaining.detail);
  });
  const exactBlockers = unique([
    ...roleSpecificBlockers,
    ...workPlanBlockers,
    ...((roleSpecificBlockers.length || workPlanBlockers.length) ? [] : currentChecklistBlockers),
  ]);
  const receipt = {
    schemaVersion: "das.assisted-onboarding-readiness-receipt.v1",
    session: {
      id: record.sessionId,
      revision: record.revision,
      recordHash: record.recordHash,
      intakeHash: record.intakeHash,
      roleTemplateId: record.intake.role.templateId,
      roleLifecycleHash: digest(record.roleLifecycle),
    },
    provenance: {
      intakeFieldProvenance: structuredClone(record.intakeProvenance ?? null),
      customerSuppliedFacts: [...customerFacts(record), ...reviewedSystemImportFacts(record)],
      dasProposalsAndInferences: dasArtifacts(record),
      engineerOwnedBindings: engineerBindings(record),
      independentProof: independentProof(record),
    },
    readiness: {
      comparisonDesign: {
        complete: stages.comparisonDesignContractComplete === true,
        evidence: [record.roleDraft && "exact normalized role draft", record.setupPlan && "zero-cost setup plan", record.binding?.scaffold && "private non-executable binding scaffold"].filter(Boolean),
      },
      execution: {
        ready: stages.executableComparisonEnvironmentReady === true,
        structuralBindingReady: stages.structuralBindingReady === true,
        mandatoryAcceptanceComplete: stages.mandatoryAcceptanceComplete === true,
      },
      activation: {
        ready: stages.controlledActivationReady === true,
        comparisonComplete: stages.comparisonCompleteRecommendationReady === true,
        authorizationGranted: false,
      },
    },
    exactBlockers,
    boundary: "Integrity-bound assisted-onboarding readiness only. It separates declarations and proposals from engineer implementation and independent proof; it grants no authority, spend, execution or activation.",
  };
  receipt.receiptHash = digest(receipt);
  return Object.freeze(receipt);
}

export function assertAssistedOnboardingReadinessReceipt({ receipt, record, projection }) {
  requireCondition(receipt?.schemaVersion === "das.assisted-onboarding-readiness-receipt.v1", "Unsupported assisted-onboarding readiness receipt");
  requireCondition(receipt.receiptHash === digest(withoutHash(receipt, "receiptHash")), "Assisted-onboarding readiness receipt integrity mismatch");
  const expected = createAssistedOnboardingReadinessReceipt({ record, projection });
  requireCondition(receipt.receiptHash === expected.receiptHash, "Assisted-onboarding readiness receipt no longer matches the exact source revision");
  return true;
}
