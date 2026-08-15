import { proposeOnboardingSystemImport } from "../product/onboarding-system-import.js";
import { createOnboardingReviewAssistance } from "../product/onboarding-review-assistant.js";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function clean(value, maximum = 240) {
  return String(value ?? "").trim().slice(0, maximum);
}

function localDisplayLabel(value) {
  return clean(value).split(/[\\/]/).filter(Boolean).at(-1) ?? "";
}

function selectedNames(value) {
  if (value == null) return undefined;
  requireCondition(Array.isArray(value), "Selected operation names must be an array");
  const selected = value.map((item) => clean(item)).filter(Boolean);
  requireCondition(selected.length === value.length, "Selected operation names cannot be empty");
  return selected.length ? selected : undefined;
}

function sanitizedProposal({ proposal, system, reviewAssistance }) {
  const suggestions = new Map(reviewAssistance.operationSuggestions.map((item) => [item.sourceName, item]));
  return Object.freeze({
    schemaVersion: "das.console-system-import-result.v1",
    sessionId: proposal.sessionId,
    status: proposal.status,
    system: { id: system.id, name: system.name },
    source: {
      kind: proposal.source.kind,
      label: proposal.source.provenance.label,
      version: proposal.source.version ?? proposal.source.serverVersion ?? null,
    },
    operationCount: proposal.operations.length,
    operations: proposal.operations.map((operation) => ({
      sourceName: operation.sourceName,
      proposedExposedName: operation.proposedExposedName,
      proposedMode: operation.modeProposal.value,
      classificationBasis: operation.modeProposal.basis,
      customerReviewRequired: operation.modeProposal.customerReviewRequired,
      authority: "not-granted",
      credentials: "not-collected",
      adapter: "not-implemented",
      independentVerification: operation.independentVerification.status,
      acceptance: operation.acceptance.status,
      executable: false,
      suggestion: (() => {
        const suggestion = suggestions.get(operation.sourceName);
        return {
          targetExposedName: suggestion.target.proposedExposedName,
          targetStatus: suggestion.target.status,
          targetScore: suggestion.target.score,
          confirmedMode: suggestion.mode.proposed,
          authorityAction: suggestion.authority.proposedAction,
          authorityStatus: suggestion.authority.status,
          requiredContextSources: [...suggestion.context.proposedSourceIds],
          idempotencyStatus: suggestion.writeSafety?.idempotency.status ?? "not-applicable",
          reconciliationStatus: suggestion.writeSafety?.reconciliation.status ?? "not-applicable",
          customerConfirmationRequired: true,
        };
      })(),
    })),
    review: {
      targetOperations: system.tools.map((tool) => ({ exposedName: `${system.id}:${tool.name}`, mode: tool.mode, label: tool.description || tool.name })),
      authorityActions: [],
      contextSources: [...proposal.proposedContextSources],
      assistanceHash: reviewAssistance.assistanceHash,
      unresolved: [...reviewAssistance.unresolved],
    },
    gates: {
      customerReview: proposal.gates.customerReview,
      consequentialAssumptionReview: proposal.gates.consequentialAssumptionReview,
      authority: proposal.gates.authority,
      credentials: proposal.gates.credentials,
      executableAdapter: proposal.gates.executableAdapter,
      independentVerifier: proposal.gates.independentVerifier,
      acceptance: proposal.gates.acceptance,
      comparisonExecution: proposal.gates.comparisonExecution,
      controlledActivation: proposal.gates.controlledActivation,
    },
    authorizations: { modelSpend: false, execution: false, customerWrites: false, activation: false },
    nextActions: [...proposal.nextActions],
    evidenceBoundary: proposal.evidenceBoundary,
  });
}

function exactConsoleImportInputs({ record, input }) {
  const systemId = clean(input?.systemId, 160);
  const sourceKind = clean(input?.sourceKind, 40);
  const sourceLabel = localDisplayLabel(input?.sourceLabel);
  requireCondition(systemId, "Select one declared system for this import");
  requireCondition(["openapi", "mcp-tools-list"].includes(sourceKind), "Choose OpenAPI or pinned MCP tools/list");
  requireCondition(sourceLabel, "Give the local schema material a source label");
  requireCondition(input?.document && typeof input.document === "object" && !Array.isArray(input.document), "System import needs parsed local JSON material");
  const system = record.intake.systems.find((item) => item.id === systemId);
  requireCondition(system, `The selected system does not belong to this saved onboarding session: ${systemId}`);
  const selected = selectedNames(input?.selectedNames);
  const source = sourceKind === "openapi"
    ? { kind: "openapi", document: input.document }
    : { kind: "mcp-tools-list", serverId: clean(input?.serverId, 160), serverVersion: clean(input?.serverVersion, 120), toolsList: input.document };
  if (sourceKind === "mcp-tools-list") requireCondition(source.serverId, "Pinned MCP tools/list import needs a customer-local server id");
  const selection = selected === undefined ? undefined : sourceKind === "openapi" ? { operationIds: selected } : { toolNames: selected };
  const provenance = { acquisition: sourceKind === "openapi" ? "customer-upload" : "customer-local-mcp-tools-list", label: sourceLabel, note: "Imported through the customer-local DAS assisted-onboarding console." };
  const proposal = proposeOnboardingSystemImport({ intake: record.intake, systemId, source, provenance, selection });
  return { system, source, proposal };
}

export function recordConsoleSystemImport({ journey, input }) {
  requireCondition(journey && typeof journey.record === "function" && typeof journey.recordSystemImportProposal === "function", "System import needs the assisted-onboarding journey");
  const sessionId = clean(input?.sessionId, 120);
  requireCondition(sessionId, "Select a saved onboarding session before importing a system schema");
  const record = journey.record(sessionId);
  const { system, source, proposal } = exactConsoleImportInputs({ record, input });
  const reviewAssistance = createOnboardingReviewAssistance({ proposal, intake: record.intake, source });
  const result = sanitizedProposal({ proposal, system, reviewAssistance });
  result.review.authorityActions = [
    ...record.intake.authority.allowedActions.map((action) => ({ action, classification: "already-declared-allowed-action" })),
    ...record.intake.authority.approvalActions.map((action) => ({ action, classification: "already-declared-approval-required-action" })),
  ];
  const projection = journey.recordSystemImportProposal({ sessionId, proposal, source });
  return Object.freeze({ proposal: Object.freeze(result), projection });
}

export function recordConsoleSystemImportReview({ journey, input }) {
  requireCondition(journey && typeof journey.record === "function" && typeof journey.recordSystemImportConfirmation === "function", "System import review needs the assisted-onboarding journey");
  const sessionId = clean(input?.sessionId, 120);
  requireCondition(sessionId, "Select a saved onboarding session before reviewing a system import");
  const record = journey.record(sessionId);
  const { system, source, proposal } = exactConsoleImportInputs({ record, input });
  const reviewed = journey.recordSystemImportConfirmation({
    sessionId,
    proposalHash: proposal.proposalHash,
    source,
    decisions: input?.decisions,
    confirmedBy: clean(input?.confirmedBy, 240),
  });
  const response = {
    schemaVersion: "das.console-system-import-review-result.v1",
    sessionId,
    system: { id: system.id, name: system.name },
    status: reviewed.confirmation.status,
    approvedOperations: reviewed.confirmation.operationChoices.filter((item) => item.approved).map((item) => ({ sourceName: item.sourceName, targetExposedName: item.targetExposedName, mode: item.confirmedMode, authorityClassification: item.authority.classification })),
    setupCoverage: {
      unit: reviewed.workPlan.authoring.unit,
      total: reviewed.workPlan.authoring.total,
      generatedOrCustomerConfirmed: reviewed.workPlan.authoring.generatedOrCustomerConfirmed,
      remainingEngineerOrIndependentProof: reviewed.workPlan.authoring.remainingEngineerOrIndependentProof,
      completionRatio: reviewed.workPlan.authoring.completionRatio,
    },
    exactRemainingWork: reviewed.workPlan.exactRemainingWork.map((item) => ({ owner: item.owner, detail: item.detail })),
    gates: { ...reviewed.workPlan.gates },
    authorizations: { modelSpend: false, execution: false, customerWrites: false, activation: false },
    evidenceBoundary: reviewed.workPlan.evidenceBoundary,
  };
  return Object.freeze({ review: Object.freeze(response), projection: reviewed.projection });
}
