import { digest } from "../../core/canonical.js";
import { AssistedCommercialOnboardingJourney } from "../../product/assisted-onboarding-journey.js";
import { proposeOnboardingSystemImport } from "../../product/onboarding-system-import.js";
import {
  assertReviewedOnboardingStructuralBinding,
  createReviewedBindingImplementationInput,
} from "../../product/reviewed-onboarding-binding-compiler.js";

const FIXED_NOW = "2026-08-14T16:00:00.000Z";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function selectedActionOperations(fixture, proposal) {
  const approved = new Set([
    fixture.answers.actionOperation,
    fixture.answers.reconciliationOperation,
    ...(fixture.answers.actionReadOperations ?? []),
  ]);
  return proposal.operations.map((operation) => {
    if (!approved.has(operation.sourceName)) {
      return {
        sourceName: operation.sourceName,
        approved: false,
        rejectionReason: "Outside the completed DAS-024 draft-only role.",
      };
    }
    const isWrite = operation.sourceName === fixture.answers.actionOperation;
    return {
      sourceName: operation.sourceName,
      approved: true,
      targetExposedName: `action-system:${operation.sourceName}`,
      confirmedMode: isWrite ? "write" : "read",
      authorityAction: isWrite ? fixture.answers.authority[0] : null,
      requiredContextSources: [...operation.proposedContextSources],
    };
  });
}

function qualificationIntake(fixture) {
  const actionReads = fixture.answers.actionReadOperations.map((name) => ({ name, mode: "read" }));
  return {
    sessionId: `das024-qualification:${fixture.id}`,
    company: {
      name: `Fictional qualification company for ${fixture.id}`,
      industry: "Disposable local qualification fixture",
      operatingContext: "This structured intake exists only to exercise the unchanged DAS-012/DAS-023 qualification chain after the separate DAS-024 authoring receipt completed.",
    },
    role: {
      templateId: fixture.sourceKind === "openapi" ? "procurement-coverage" : "support-operations",
      title: fixture.businessIntake.roleLabel,
      outcome: fixture.businessIntake.roleOutcome,
      completionRule: fixture.businessIntake.desiredExternallyObservableOutcome,
      escalationOwner: fixture.businessIntake.escalationOwner,
    },
    systems: [{
      id: "action-system",
      name: `Fictional action source for ${fixture.id}`,
      kind: fixture.sourceKind,
      access: "customer-local-test",
      adapterStatus: "missing",
      contextSources: ["assigned-work", "role-policy"],
      tools: [
        ...actionReads,
        { name: fixture.answers.actionOperation, mode: "write" },
      ],
    }],
    knowledgeSources: [{
      name: "Qualification-only role policy",
      kind: "policy",
      contentHash: digest({ fixture: fixture.id, policy: "qualification-only-v1" }),
      current: true,
    }],
    policies: [
      { rule: fixture.businessIntake.limits, kind: "required-check", confirmed: true },
      { rule: `Escalate unknown state to ${fixture.businessIntake.escalationOwner}.`, kind: "approval", confirmed: true },
      { rule: `Never perform: ${fixture.answers.forbiddenActions.join(", ")}.`, kind: "forbidden", confirmed: true },
    ],
    authority: {
      allowedActions: [...fixture.answers.authority],
      approvalActions: [...fixture.answers.approvals],
      forbiddenActions: [...fixture.answers.forbiddenActions],
    },
    examples: Array.from({ length: 5 }, (_, index) => ({
      situation: `Qualification-only synthetic example ${index + 1} for ${fixture.id}`,
      expected: `Exactly one bounded draft or an explicit safe handoff ${index + 1}`,
      source: "das024-qualification-harness",
      redacted: true,
    })),
    success: {
      measures: [
        fixture.businessIntake.desiredExternallyObservableOutcome,
        `At most ${fixture.answers.maximumWritesPerAssignedItem} allowed draft write per assigned item.`,
        "No protected or unrelated state changes.",
      ],
      verifierMode: "independent-external-state",
      verifierStatus: "declared",
      owner: fixture.answers.ownerReviewer,
    },
    priorities: {
      quality: 1,
      cost: 0.2,
      speed: 0.2,
      maximumCostPerTaskUsd: 0.5,
      maximumLatencyMs: 300000,
      goal: "Exercise the unchanged local qualification machinery without changing the authoring result.",
    },
    currentAgent: { mode: "none" },
    dataHandling: { localOnly: true, productionDataIncluded: false, redactionConfirmed: true },
  };
}

function structuralWriteSafety(fixture) {
  function openApiOperation(operationId) {
    for (const [route, item] of Object.entries(fixture.actionSource.document.paths ?? {})) {
      for (const [method, operation] of Object.entries(item ?? {})) {
        if (operation?.operationId === operationId) return { route, method, operation, pathParameters: item.parameters ?? [] };
      }
    }
    throw new Error(`DAS-024 qualification source omits ${operationId}`);
  }
  function sectionFor(parameter) {
    return parameter.in === "header" ? "headers" : parameter.in;
  }
  function inputPointer(operation, field) {
    const parameter = [...operation.pathParameters, ...(operation.operation.parameters ?? [])].find((item) => item.name === field);
    if (parameter) return `/${sectionFor(parameter)}/${field}`;
    const bodyProperties = operation.operation.requestBody?.content?.["application/json"]?.schema?.properties ?? {};
    requireCondition(Object.hasOwn(bodyProperties, field), `DAS-024 qualification cannot ground write input ${field}`);
    return `/body/${field}`;
  }
  const verification = fixture.sourceKind === "openapi"
    ? (() => {
        const write = openApiOperation(fixture.answers.actionOperation);
        const read = openApiOperation(fixture.answers.reconciliationOperation);
        const readParameters = [...read.pathParameters, ...(read.operation.parameters ?? [])];
        return {
          readOperationId: fixture.answers.reconciliationOperation,
          inputMap: fixture.answers.reconciliationInputBindings.map((binding) => {
            const [from, to] = binding.split("->");
            const target = readParameters.find((parameter) => parameter.name === to);
            requireCondition(target, `DAS-024 qualification cannot ground reconciliation input ${to}`);
            return { targetSection: sectionFor(target), targetName: to, writeInputPointer: inputPointer(write, from) };
          }),
          assertions: fixture.answers.requiredExactFields.map((field) => ({ actualPointer: `/${field}`, equalsWriteInputPointer: inputPointer(write, field) })),
        };
      })()
    : {
        readToolName: fixture.answers.reconciliationOperation,
        inputMap: fixture.answers.reconciliationInputBindings.map((binding) => {
          const [from, to] = binding.split("->");
          return { targetName: to, writeInputPointer: `/${from}` };
        }),
        assertions: fixture.answers.requiredExactFields.map((field) => ({ actualPointer: `/${field}`, equalsWriteInputPointer: `/${field}` })),
      };
  return fixture.sourceKind === "openapi"
    ? [{ sourceName: fixture.answers.actionOperation, idempotencyHeader: "Idempotency-Key", verification }]
    : [{ sourceName: fixture.answers.actionOperation, idempotencyField: "deduplicationKey", verification }];
}

export function prepareDAS024QualificationBinding({ fixture, stateDirectory, credentialRefs = {} }) {
  requireCondition(fixture?.answers?.actionOperation, "DAS-024 qualification requires one completed valid fixture");
  const intake = qualificationIntake(fixture);
  const journey = new AssistedCommercialOnboardingJourney({ stateDirectory, now: () => FIXED_NOW });
  journey.saveBusinessIntake(structuredClone(intake));
  const record = journey.record(intake.sessionId);
  const proposal = proposeOnboardingSystemImport({
    intake: record.intake,
    systemId: "action-system",
    source: structuredClone(fixture.actionSource),
    provenance: { acquisition: "engineer-local-fixture", label: `DAS-024 qualification-only source for ${fixture.id}` },
  });
  journey.recordSystemImportProposal({ sessionId: record.sessionId, proposal, source: structuredClone(fixture.actionSource) });
  const confirmed = journey.recordSystemImportConfirmation({
    sessionId: record.sessionId,
    proposalHash: proposal.proposalHash,
    source: structuredClone(fixture.actionSource),
    decisions: {
      operationChoices: selectedActionOperations(fixture, proposal),
      contextChoices: proposal.proposedContextSources.map((sourceId) => ({ sourceId, approved: true })),
    },
    confirmedBy: fixture.answers.ownerReviewer,
  });
  const implementationInput = createReviewedBindingImplementationInput({
    workPlan: confirmed.workPlan,
    adapterVersion: "0.1.0",
    credentialRefs,
    writeSafety: structuralWriteSafety(fixture),
  });
  const compiled = journey.recordSystemImportStructuralCompilation({
    sessionId: record.sessionId,
    proposalHash: proposal.proposalHash,
    source: structuredClone(fixture.actionSource),
    implementationInput,
  });
  assertReviewedOnboardingStructuralBinding({
    artifact: compiled.structuralBinding,
    workPlan: confirmed.workPlan,
    proposal,
    confirmation: confirmed.confirmation,
    intake: record.intake,
    source: structuredClone(fixture.actionSource),
    bindingScaffold: journey.record(record.sessionId).binding.scaffold.descriptor,
    implementationInput,
  });
  requireCondition(compiled.structuralBinding.status === "structurally-compiled-runtime-unprobed", `${fixture.id} did not reach qualification-only structural compilation`);
  return Object.freeze({
    evidenceBoundary: "Synthetic qualification harness only. Extra examples and commercial-intake structure are not DAS-024 authoring inputs or evidence of customer setup automation.",
    intake: record.intake,
    journey,
    proposal,
    confirmation: confirmed.confirmation,
    workPlan: confirmed.workPlan,
    implementationInput,
    structuralBinding: compiled.structuralBinding,
  });
}
