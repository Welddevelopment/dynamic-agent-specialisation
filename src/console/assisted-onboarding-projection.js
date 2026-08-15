const asArray = (value) => Array.isArray(value) ? value : [];
const isPassed = (value) => value === true || value === "passed" || value === "verified" || value === "ready";

function stage({ id, label, complete, available, owner, summary, evidence = [], blockers = [], nextAction }) {
  return {
    id,
    label,
    status: complete ? "complete" : available ? "current" : "blocked",
    owner,
    summary,
    evidence: evidence.filter(Boolean),
    blockers: blockers.filter(Boolean),
    nextAction: complete ? null : nextAction,
  };
}

function setupMatchesSavedIntake(selected, setup) {
  if (!selected || !setup) return false;
  if (setup.sessionId !== selected.intake?.sessionId) return false;
  if (setup.sessionRevision !== selected.revision) return false;
  if (setup.savedRecordHash && setup.savedRecordHash !== selected.recordHash) return false;
  return setup.mutationDetected !== true;
}

function buildFromAuthoritativeProjection({ selected, draft, setup }) {
  const intake = selected?.intake ?? draft ?? {};
  const sourceStages = setup.stages ?? {};
  const checklist = asArray(setup.checklist);
  const done = new Set(["generated", "verified", "completed", "frozen"]);
  const unresolved = (owners) => checklist.filter((item) => owners.includes(item.owner) && !done.has(item.status));
  const detail = (owners) => unresolved(owners).map((item) => item.detail).filter(Boolean);
  const detailById = (...prefixes) => checklist
    .filter((item) => prefixes.some((prefix) => item.id.startsWith(prefix)) && !done.has(item.status))
    .map((item) => item.detail)
    .filter(Boolean);
  const businessReady = sourceStages.businessRoleDraftComplete === true;
  const designReady = sourceStages.comparisonDesignContractComplete === true;
  const scaffoldReady = sourceStages.customerBindingScaffoldGenerated === true;
  const structuralReady = sourceStages.structuralBindingReady === true;
  const acceptanceReady = sourceStages.mandatoryAcceptanceComplete === true;
  const environmentReady = sourceStages.executableComparisonEnvironmentReady === true;
  const awaitingApproval = sourceStages.awaitingExplicitModelSpendApproval === true;
  const comparisonReady = sourceStages.comparisonCompleteRecommendationReady === true;
  const activationReady = sourceStages.controlledActivationReady === true;
  const planFrozen = setup.generated?.comparisonContract === true && setup.generated?.zeroCostModelPlan === true;
  const projectedSpend = Number(setup.spend?.projectedMaximumUsd);
  const spendKnown = planFrozen && Number.isFinite(projectedSpend) && projectedSpend >= 0;
  const roleBlockers = asArray(setup.roleAvailability?.blockers);
  const roleSupportLevel = setup.previewOnly
    ? "unsupported-preview"
    : setup.roleAvailability?.comparisonPlanning === false
      ? "design-and-scaffold-only"
      : "full-assisted-lifecycle";

  const stages = [
    stage({
      id: "business-draft",
      label: "Business role draft complete",
      complete: businessReady,
      available: true,
      owner: "Customer",
      summary: "The role, desired outcome, boundaries, examples and success criteria are recorded.",
      evidence: businessReady ? ["Versioned saved intake", setup.supportedRole && "Supported role family"] : [],
      blockers: businessReady ? [] : detail(["customer"]),
      nextAction: setup.previewOnly ? "Choose a supported role family or keep this as a non-executable preview." : "Answer the consequential role questions and save the draft.",
    }),
    stage({
      id: "comparison-design",
      label: "Comparison design complete",
      complete: designReady,
      available: businessReady,
      owner: "Customer + DAS",
      summary: "The comparison contract information and fail-closed binding scaffold are prepared. This is not executable readiness.",
      evidence: [setup.generated?.roleDraft && "Role draft generated from exact saved intake", setup.generated?.setupPlan && "Zero-cost setup plan generated", scaffoldReady && "Private fail-closed binding scaffold generated"],
      blockers: designReady ? [] : detail(["customer", "das"]),
      nextAction: "Resolve the remaining design questions and review consequential assumptions.",
    }),
    stage({
      id: "executable-environment",
      label: "Executable comparison environment ready",
      complete: environmentReady,
      available: designReady,
      owner: "DAS engineer + independent verifier",
      summary: "Every bounded operation is implemented, structurally checked and exercised by mandatory acceptance cases.",
      evidence: [scaffoldReady && "Binding scaffold generated", structuralReady && "Structural binding checks passed", acceptanceReady && "Mandatory acceptance completed", environmentReady && "Exact comparison environment frozen"],
      blockers: environmentReady ? [] : [...detailById("engineer:binding", "engineer:role-lifecycle", "verifier:binding-acceptance", "das:binding-scaffold"), ...roleBlockers],
      nextAction: "Implement the generated bindings, connect the independent verifier and pass mandatory acceptance.",
    }),
    stage({
      id: "spend-approval",
      label: "Awaiting explicit model-spend approval",
      complete: comparisonReady,
      available: awaitingApproval || comparisonReady,
      owner: "Accountable customer approver",
      summary: "A frozen zero-cost plan shows the exact ceiling. No paid run starts without a separate exact-plan approval.",
      evidence: [planFrozen && "Comparison plan frozen after zero-cost preparation", spendKnown && `Projected maximum model spend: $${projectedSpend.toFixed(2)}`, awaitingApproval && "Explicit model-spend approval remains outstanding", comparisonReady && "Approved comparison completed"],
      blockers: awaitingApproval ? detailById("customer:model-spend") : planFrozen || comparisonReady ? [] : ["Zero-cost comparison plan is not frozen"],
      nextAction: "Review the exact plan, current pricing and spend ceiling, then use the separate controlled approval gate.",
    }),
    stage({
      id: "recommendation",
      label: "Comparison complete · recommendation ready",
      complete: comparisonReady,
      available: comparisonReady,
      owner: "DAS + independent verifier",
      summary: "Candidates and serious baselines have completed the frozen comparison and a recommendation is supported by receipts.",
      evidence: comparisonReady ? ["Frozen comparison result independently verified", "Recommendation receipt ready"] : [],
      blockers: comparisonReady ? [] : detailById("verifier:comparison-result"),
      nextAction: "After exact approval, run the frozen comparison and preserve every result and failure.",
    }),
    stage({
      id: "controlled-activation",
      label: "Controlled activation ready",
      complete: activationReady,
      available: comparisonReady,
      owner: "Customer + DAS operator",
      summary: "The selected package is ready for a separately authorized controlled activation. Setup readiness alone never activates it.",
      evidence: activationReady ? ["Exact proved bundle packaged", "Controlled activation receipt verified"] : [],
      blockers: activationReady ? [] : detailById("engineer:activation"),
      nextAction: "Review the package, rollback path and activation boundary before authorizing any live work.",
    }),
  ];

  const responsibility = (owner, fallback) => {
    const rows = checklist.filter((item) => item.owner === owner).map((item) => ({ label: item.detail, status: item.status }));
    return rows.length ? rows : fallback;
  };
  const blockers = stages.flatMap((item) => item.blockers.map((text) => ({ stageId: item.id, text })));
  const firstOpen = stages.find((item) => item.status !== "complete");
  return {
    schemaVersion: "assisted-onboarding-console/v1",
    mode: "assisted-pilot",
    boundary: setup.evidenceBoundary || "Assisted setup state only. No model comparison, recommendation or activation is implied.",
    session: { id: setup.sessionId, revision: setup.revision, roleSupported: setup.supportedRole === true, roleMode: setup.previewOnly ? "unsupported-preview" : "supported", roleSupportLevel, current: true },
    summary: {
      company: intake.company?.name || "Unnamed company",
      role: intake.role?.title || "Role not yet named",
      systemsDeclared: asArray(intake.systems).length,
      currentStageId: firstOpen?.id ?? "controlled-activation",
      currentStageLabel: firstOpen?.label ?? "Controlled activation ready",
      completeStages: stages.filter((item) => item.status === "complete").length,
      totalStages: stages.length,
    },
    stages,
    responsibilities: {
      customer: [
        { label: "Business outcome, boundaries and representative cases", status: businessReady ? "recorded" : "required" },
        ...responsibility("customer", []),
      ],
      das: responsibility("das", [{ label: "Role, scaffold and comparison artifacts", status: designReady ? "generated" : "waiting" }]),
      engineer: responsibility("engineer", [{ label: "Customer-local bindings and packaging", status: environmentReady ? "verified" : "required" }]),
      independentlyVerified: responsibility("independent-verifier", [{ label: "Acceptance and external outcomes", status: acceptanceReady ? "acceptance passed" : "not passed" }]),
    },
    blockers,
    spend: {
      approvalRequired: true,
      approved: comparisonReady,
      status: awaitingApproval ? "awaiting-explicit-approval" : comparisonReady ? "comparison-complete" : "not-ready",
      projectedMaximumUsd: spendKnown ? projectedSpend : null,
      boundary: "This console cannot authorize or start paid execution. Approval belongs to the separate exact-plan campaign gate.",
    },
  };
}

export function buildAssistedOnboardingProjection({ selected = null, draft = null, setup = null, supportedRoleTemplateIds = [] } = {}) {
  if (setup?.schemaVersion === "das.assisted-onboarding-projection.v1") return buildFromAuthoritativeProjection({ selected, draft, setup });
  const intake = selected?.intake ?? draft ?? {};
  const readiness = selected?.readiness ?? null;
  const backendSupportCheck = readiness?.stages?.draft?.checks?.find((check) => check.id === "supported-role")?.passed;
  const supportedRole = typeof backendSupportCheck === "boolean"
    ? backendSupportCheck
    : supportedRoleTemplateIds.includes(intake.role?.templateId);
  const setupCurrent = setupMatchesSavedIntake(selected, setup);
  const mutationBlocked = Boolean(setup && !setupCurrent);

  const businessDraftComplete = supportedRole && readiness?.stages?.draft?.ready === true;
  const comparisonDesignComplete = businessDraftComplete && readiness?.stages?.comparison?.ready === true;

  const scaffoldGenerated = setupCurrent && setup?.binding?.scaffoldStatus === "generated";
  const bindingStructurallyReady = scaffoldGenerated && isPassed(setup?.binding?.structuralReadiness);
  const verifierExecutable = setupCurrent && setup?.environment?.verifierStatus === "executable-verified";
  const acceptance = setupCurrent ? setup?.environment?.mandatoryAcceptance : null;
  const acceptanceComplete = Boolean(
    acceptance
    && acceptance.status === "passed"
    && Number(acceptance.required) > 0
    && Number(acceptance.passed) === Number(acceptance.required)
    && Number(acceptance.unsafeAttempts ?? 0) === 0
    && Number(acceptance.incorrectSideEffects ?? 0) === 0,
  );
  const executableEnvironmentReady = comparisonDesignComplete
    && bindingStructurallyReady
    && verifierExecutable
    && acceptanceComplete;

  const comparisonPlanFrozen = executableEnvironmentReady
    && setupCurrent
    && setup?.comparisonPlan?.status === "frozen"
    && setup?.comparisonPlan?.zeroCostDryRunStatus === "passed";
  const spendApproved = comparisonPlanFrozen && setup?.spendApproval?.status === "approved";
  const awaitingSpendApproval = comparisonPlanFrozen
    && !spendApproved
    && setup?.spendApproval?.status === "awaiting-explicit-approval";
  const comparisonComplete = spendApproved
    && setup?.comparison?.status === "complete"
    && setup?.comparison?.recommendationStatus === "ready";
  const controlledActivationReady = comparisonComplete
    && setup?.package?.status === "ready"
    && setup?.activation?.status === "ready-for-controlled-activation"
    && setup?.activation?.authorized !== true;

  const projectedSpend = Number(setup?.comparisonPlan?.projectedMaximumSpendUsd);
  const spendKnown = comparisonPlanFrozen && Number.isFinite(projectedSpend) && projectedSpend >= 0;

  const stages = [
    stage({
      id: "business-draft",
      label: "Business role draft complete",
      complete: businessDraftComplete,
      available: true,
      owner: "Customer",
      summary: "The role, desired outcome, boundaries, examples and success criteria are recorded.",
      evidence: businessDraftComplete ? ["Versioned saved intake", "Supported role family"] : [],
      blockers: supportedRole ? [] : ["Role is outside the supported families and remains a preview"],
      nextAction: "Answer the consequential role questions and save a supported role draft.",
    }),
    stage({
      id: "comparison-design",
      label: "Comparison design complete",
      complete: comparisonDesignComplete,
      available: businessDraftComplete,
      owner: "Customer + DAS",
      summary: "The information needed to design a fair comparison is present. This is not an executable environment.",
      evidence: comparisonDesignComplete ? ["Role contract information complete", "Independent outcome measures declared"] : [],
      blockers: mutationBlocked ? ["Saved intake changed after setup artifacts were generated"] : [],
      nextAction: "Resolve the remaining design questions and review consequential assumptions.",
    }),
    stage({
      id: "executable-environment",
      label: "Executable comparison environment ready",
      complete: executableEnvironmentReady,
      available: comparisonDesignComplete,
      owner: "DAS engineer + independent verifier",
      summary: "Every bounded operation is implemented, structurally checked and exercised by mandatory acceptance cases.",
      evidence: [
        scaffoldGenerated && "Binding scaffold generated from this exact intake",
        bindingStructurallyReady && "Binding structure passed",
        verifierExecutable && "Independent external-state verifier executable",
        acceptanceComplete && `${acceptance.passed}/${acceptance.required} mandatory acceptance cases passed`,
      ],
      blockers: [
        comparisonDesignComplete && !scaffoldGenerated && "Binding scaffold has not been generated",
        scaffoldGenerated && !bindingStructurallyReady && "Customer-system bindings still require engineering",
        !verifierExecutable && "Independent verifier is declared but not executable and verified",
        !acceptanceComplete && "Mandatory acceptance evidence is incomplete",
        mutationBlocked && "Setup artifacts no longer match the saved intake revision",
      ],
      nextAction: "Import bounded schemas, generate the scaffold, implement bindings and pass mandatory acceptance.",
    }),
    stage({
      id: "spend-approval",
      label: "Awaiting explicit model-spend approval",
      complete: spendApproved,
      available: comparisonPlanFrozen,
      owner: "Accountable customer approver",
      summary: "A frozen zero-cost plan shows the exact ceiling. No paid run starts without separate approval.",
      evidence: [
        comparisonPlanFrozen && "Comparison plan frozen after a zero-cost dry run",
        spendKnown && `Projected maximum model spend: $${projectedSpend.toFixed(2)}`,
        awaitingSpendApproval && "Explicit approval has not been granted",
      ],
      blockers: [
        executableEnvironmentReady && !comparisonPlanFrozen && "Zero-cost comparison plan is not frozen",
        comparisonPlanFrozen && !spendApproved && "Explicit model-spend approval is required",
      ],
      nextAction: "Review the exact plan and spend ceiling, then approve it through the separate controlled gate.",
    }),
    stage({
      id: "recommendation",
      label: "Comparison complete · recommendation ready",
      complete: comparisonComplete,
      available: spendApproved,
      owner: "DAS + independent verifier",
      summary: "Candidates and serious baselines have completed the frozen comparison and a recommendation is supported by receipts.",
      evidence: comparisonComplete ? ["Frozen comparison complete", "Recommendation receipt ready"] : [],
      blockers: spendApproved && !comparisonComplete ? ["Frozen comparison has not completed cleanly"] : [],
      nextAction: "Run the approved frozen comparison and preserve every result and failure.",
    }),
    stage({
      id: "controlled-activation",
      label: "Controlled activation ready",
      complete: controlledActivationReady,
      available: comparisonComplete,
      owner: "Customer + DAS operator",
      summary: "The selected package is ready for a separately authorized controlled activation. It is not active yet.",
      evidence: controlledActivationReady ? ["Package readiness passed", "Controlled activation gates ready"] : [],
      blockers: comparisonComplete && !controlledActivationReady ? ["Packaging or controlled-activation gates remain open"] : [],
      nextAction: "Review the package, rollback path and activation boundary before authorizing any live work.",
    }),
  ];

  const blockers = stages.flatMap((item) => item.blockers.map((text) => ({ stageId: item.id, text })));
  const firstOpen = stages.find((item) => item.status !== "complete");
  const systemCount = asArray(intake.systems).length;
  const operationCount = asArray(setup?.binding?.proposedOperations).length;

  return {
    schemaVersion: "assisted-onboarding-console/v1",
    mode: "assisted-pilot",
    boundary: "DAS prepares and verifies the setup with the customer. This does not claim self-serve activation, model spend approval, or a completed comparison.",
    session: {
      id: intake.sessionId ?? null,
      revision: selected?.revision ?? null,
      roleSupported: supportedRole,
      roleMode: supportedRole ? "supported" : "unsupported-preview",
      current: !mutationBlocked,
    },
    summary: {
      company: intake.company?.name || "Unnamed company",
      role: intake.role?.title || "Role not yet named",
      systemsDeclared: systemCount,
      currentStageId: firstOpen?.id ?? "controlled-activation",
      currentStageLabel: firstOpen?.label ?? "Controlled activation ready",
      completeStages: stages.filter((item) => item.status === "complete").length,
      totalStages: stages.length,
    },
    stages,
    responsibilities: {
      customer: [
        { label: "Business truth and representative cases", status: businessDraftComplete ? "provided" : "needed" },
        { label: "Consequential assumptions and authority", status: comparisonDesignComplete ? "reviewed" : "needed" },
        { label: "Sandbox or schema material", status: setupCurrent && setup?.imports?.status === "reviewed" ? "provided" : "needed" },
        { label: "Credentials", status: "configured later customer-side; never stored in intake" },
      ],
      das: [
        { label: "Role and comparison draft", status: comparisonDesignComplete ? "generated" : "waiting for business truth" },
        { label: "Bounded operation proposals", status: operationCount ? `${operationCount} proposed; zero authority granted` : "not generated" },
        { label: "Binding scaffold", status: scaffoldGenerated ? "generated" : "not generated" },
        { label: "Zero-cost comparison plan", status: comparisonPlanFrozen ? "frozen" : "not frozen" },
      ],
      engineer: [
        { label: "Implement customer-local adapters", status: bindingStructurallyReady ? "structurally ready" : "required" },
        { label: "Connect independent external-state verifier", status: verifierExecutable ? "verified" : "required" },
        { label: "Run mandatory acceptance", status: acceptanceComplete ? "passed" : "required" },
      ],
      independentlyVerified: [
        { label: "Binding structure", status: bindingStructurallyReady ? "passed" : "not passed" },
        { label: "Mandatory acceptance", status: acceptanceComplete ? "passed" : "not passed" },
        { label: "Comparison outcome", status: comparisonComplete ? "verified" : "not run" },
      ],
    },
    blockers,
    spend: {
      approvalRequired: true,
      approved: spendApproved,
      status: awaitingSpendApproval ? "awaiting-explicit-approval" : spendApproved ? "approved" : "not-ready",
      projectedMaximumUsd: spendKnown ? projectedSpend : null,
      boundary: "This console projection cannot authorize or start paid execution.",
    },
  };
}
