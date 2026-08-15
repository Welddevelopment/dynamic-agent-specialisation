import { digest } from "../core/canonical.js";
import { compileMcpAdapterPlan } from "./mcp-adapter-kit.js";
import { compileOpenApiAdapterPlan } from "./openapi-adapter-kit.js";
import { assertOnboardingBindingWorkPlan } from "./onboarding-binding-accelerator.js";
import { assessCommercialBindingDescriptor } from "./commercial-binding-kit.js";
import { buildCommercialJobDraft } from "./commercial-intake.js";

const SECRET_REF = /^[A-Z][A-Z0-9_]{5,120}$/;
const SECRET_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\bBasic\s+[A-Za-z0-9+/=]{8,}|\bsk-[A-Za-z0-9_-]{8,}|-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----)/i;

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function stable(value) { return JSON.parse(JSON.stringify(value)); }
function clean(value, maximum = 240) { return String(value ?? "").trim().slice(0, maximum); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }

function validateCredentialReferences(value, location = "credentialRefs") {
  if (value === undefined) return;
  requireCondition(value && typeof value === "object" && !Array.isArray(value), `${location} must contain environment-reference names only`);
  for (const [scheme, reference] of Object.entries(value)) {
    requireCondition(clean(scheme), `${location} contains an empty security scheme`);
    if (typeof reference === "string") requireCondition(SECRET_REF.test(reference) && !SECRET_VALUE.test(reference), `${location}.${scheme} must be an environment-reference name, not a credential value`);
    else {
      requireCondition(reference && typeof reference === "object" && !Array.isArray(reference), `${location}.${scheme} must be one environment reference or basic-auth reference pair`);
      requireCondition(SECRET_REF.test(reference.usernameRef ?? "") && SECRET_REF.test(reference.passwordRef ?? ""), `${location}.${scheme} needs usernameRef and passwordRef environment names`);
    }
  }
}

function normalizeWriteSafety(kind, value) {
  requireCondition(value && typeof value === "object" && !Array.isArray(value), "Write-safety input must be an object");
  const sourceName = clean(value.sourceName);
  requireCondition(sourceName, "Write-safety input needs sourceName");
  if (kind === "openapi") {
    const idempotencyHeader = clean(value.idempotencyHeader, 120);
    requireCondition(idempotencyHeader && !/[\r\n:]/.test(idempotencyHeader), `OpenAPI write ${sourceName} needs one safe idempotency header name`);
    requireCondition(value.verification?.readOperationId, `OpenAPI write ${sourceName} needs an exact readback operation`);
    return stable({ sourceName, idempotencyHeader, verification: value.verification });
  }
  const idempotencyField = clean(value.idempotencyField, 120);
  requireCondition(idempotencyField, `MCP write ${sourceName} needs one exact idempotency input field`);
  requireCondition(value.verification?.readToolName, `MCP write ${sourceName} needs an exact readback tool`);
  return stable({ sourceName, idempotencyField, verification: value.verification });
}

export function createReviewedBindingImplementationInput({ workPlan, adapterVersion = "0.1.0", credentialRefs = {}, writeSafety = [] }) {
  requireCondition(workPlan?.schemaVersion === "das.onboarding-binding-work-plan.v1", "Reviewed binding implementation input needs one work plan");
  requireCondition(/^\d+\.\d+\.\d+$/.test(adapterVersion), "Reviewed binding adapter version must be semantic");
  validateCredentialReferences(credentialRefs);
  requireCondition(Array.isArray(writeSafety), "Reviewed binding writeSafety must be an array");
  const normalized = writeSafety.map((item) => normalizeWriteSafety(workPlan.source.kind, item));
  requireCondition(new Set(normalized.map((item) => item.sourceName)).size === normalized.length, "Reviewed binding writeSafety cannot contain duplicate source operations");
  const approvedWrites = new Set(workPlan.approvedOperations.filter((item) => item.approved && item.confirmedMode === "write").map((item) => item.sourceName));
  requireCondition(normalized.every((item) => approvedWrites.has(item.sourceName)), "Reviewed binding writeSafety contains an unapproved or non-write operation");
  const input = {
    schemaVersion: "das.reviewed-binding-implementation-input.v1",
    workPlanHash: workPlan.workPlanHash,
    responsibility: "customer-local-engineer-supplied-unproved",
    adapterVersion,
    credentialRefs: stable(credentialRefs),
    writeSafety: normalized,
    runtimeAuthorityGranted: false,
    credentialsIncluded: false,
    evidenceBoundary: "Customer-local engineering configuration only. Environment-reference names are not credential values. Write safety remains unproved until direct observation, fault tests and mandatory acceptance pass.",
  };
  input.implementationInputHash = digest(input);
  return Object.freeze(input);
}

function assertImplementationInput(input, workPlan) {
  requireCondition(input?.schemaVersion === "das.reviewed-binding-implementation-input.v1" && input.implementationInputHash === digest(withoutHash(input, "implementationInputHash")), "Reviewed binding implementation input integrity mismatch");
  requireCondition(input.workPlanHash === workPlan.workPlanHash, "Reviewed binding implementation input belongs to another work plan");
  requireCondition(input.runtimeAuthorityGranted === false && input.credentialsIncluded === false, "Reviewed binding implementation input widened authority or included credentials");
  validateCredentialReferences(input.credentialRefs);
  const expected = createReviewedBindingImplementationInput({ workPlan, adapterVersion: input.adapterVersion, credentialRefs: input.credentialRefs, writeSafety: input.writeSafety });
  requireCondition(expected.implementationInputHash === input.implementationInputHash, "Reviewed binding implementation input no longer matches its exact work plan");
  return true;
}

function openApiBinding(operation, safety = null) {
  const common = { operationId: operation.sourceName, exposedName: operation.targetExposedName, mode: operation.confirmedMode, requiredContextSources: operation.requiredContextSources };
  if (operation.confirmedMode === "read") return common;
  return { ...common, authorityAction: operation.authority.action, idempotencyHeader: safety.idempotencyHeader, verification: safety.verification };
}

function mcpBinding(operation, safety = null) {
  const common = { toolName: operation.sourceName, exposedName: operation.targetExposedName, mode: operation.confirmedMode, requiredContextSources: operation.requiredContextSources };
  if (operation.confirmedMode === "read") return common;
  return { ...common, authorityAction: operation.authority.action, idempotencyField: safety.idempotencyField, verification: safety.verification };
}

function compileSegment({ kind, source, workPlan, implementationInput, operations, segmentId }) {
  if (kind === "openapi") {
    return compileOpenApiAdapterPlan({
      spec: source.document,
      adapterId: `${workPlan.adapterConfigurationDraft.adapterId}:${segmentId}`,
      adapterVersion: implementationInput.adapterVersion,
      baseUrl: source.document.servers?.[0]?.url,
      credentialRefs: implementationInput.credentialRefs,
      operationBindings: operations.map(({ operation, safety }) => openApiBinding(operation, safety)),
    });
  }
  return compileMcpAdapterPlan({
    serverId: source.serverId,
    serverVersion: source.serverVersion,
    adapterVersion: implementationInput.adapterVersion,
    toolsList: source.toolsList,
    operationBindings: operations.map(({ operation, safety }) => mcpBinding(operation, safety)),
  });
}

function compileApprovedSegments({ source, workPlan, implementationInput }) {
  const kind = workPlan.source.kind;
  const approved = workPlan.approvedOperations.filter((item) => item.approved);
  const reads = approved.filter((item) => item.confirmedMode === "read");
  const writes = approved.filter((item) => item.confirmedMode === "write");
  const safetyByName = new Map(implementationInput.writeSafety.map((item) => [item.sourceName, item]));
  const compiled = new Map();
  const segments = [];

  function absorb(plan, segmentType, requestedNames) {
    segments.push({ segmentType, requestedNames: [...requestedNames].sort(), privateCompilerPlanHash: plan.planHash, compilerSchemaVersion: plan.schemaVersion, transportIdentityHash: digest(plan.baseUrl ? { baseUrl: plan.baseUrl } : { server: plan.server }) });
    for (const operation of plan.operations) {
      const sourceName = operation.operationId ?? operation.toolName;
      const existing = compiled.get(sourceName);
      if (existing) requireCondition(existing.boundedInputSchemaHash === operation.boundedInputSchemaHash && existing.mode === operation.mode, `Compiler segments disagree about ${sourceName}`);
      else compiled.set(sourceName, { sourceName, mode: operation.mode, boundedInputSchemaHash: operation.boundedInputSchemaHash, compilerPlanHash: plan.planHash });
    }
  }

  if (reads.length) {
    const plan = compileSegment({ kind, source, workPlan, implementationInput, operations: reads.map((operation) => ({ operation, safety: null })), segmentId: "reads" });
    absorb(plan, "approved-read-subset", reads.map((item) => item.sourceName));
  }

  for (const write of writes) {
    const safety = safetyByName.get(write.sourceName);
    if (!safety) continue;
    const readSourceName = kind === "openapi" ? safety.verification.readOperationId : safety.verification.readToolName;
    const read = reads.find((item) => item.sourceName === readSourceName);
    requireCondition(read, `Write ${write.sourceName} readback operation ${readSourceName} was not separately approved as read-only`);
    const plan = compileSegment({ kind, source, workPlan, implementationInput, operations: [{ operation: read, safety: null }, { operation: write, safety }], segmentId: `write-${write.sourceName}` });
    absorb(plan, "one-write-plus-approved-readback", [read.sourceName, write.sourceName]);
  }

  return { approved, reads, writes, safetyByName, compiled, segments };
}

function structuralDescriptor({ bindingScaffold, workPlan, compiled }) {
  const descriptor = structuredClone(bindingScaffold);
  const system = descriptor.systems.find((item) => item.systemId === workPlan.systemId);
  requireCondition(system, `Structural binding descriptor is missing system ${workPlan.systemId}`);
  const byTarget = new Map(workPlan.approvedOperations.filter((item) => item.approved).map((item) => [item.targetExposedName, item]));
  system.adapterVersion = "0.0.0-unprobed";
  system.credentialRefs = [];
  system.operations = system.operations.map((operation) => {
    const approved = byTarget.get(operation.exposedName);
    if (!approved) return operation;
    const structural = compiled.get(approved.sourceName);
    if (!structural) return { ...operation, customerOperation: approved.sourceName, status: "blocked-uncompiled", authorityAction: approved.authority.action ?? "" };
    return {
      ...operation,
      customerOperation: approved.sourceName,
      status: "structurally-compiled-runtime-unprobed",
      authorityAction: approved.authority.action ?? "",
      boundedInputSchemaHash: structural.boundedInputSchemaHash,
      idempotency: approved.confirmedMode === "write" ? "engineer-supplied-unproved" : "not-applicable",
      reconcileUnknown: approved.confirmedMode === "write" ? "engineer-supplied-unproved" : "not-applicable",
    };
  });
  const mapped = system.operations.filter((item) => byTarget.has(item.exposedName));
  system.status = mapped.length > 0 && system.operations.every((item) => item.status === "structurally-compiled-runtime-unprobed")
    ? "structurally-compiled-runtime-unprobed"
    : "partially-compiled-runtime-unprobed";
  descriptor.evidenceBoundary = "Provenance-bound structural compiler receipt only. The source subset passed the existing bounded compiler, but no runtime was started, no credentials were resolved, no customer action occurred, no independent observer was qualified, and no acceptance case ran.";
  delete descriptor.descriptorHash;
  descriptor.descriptorHash = digest(descriptor);
  return descriptor;
}

export function compileReviewedOnboardingBinding({ workPlan, proposal, confirmation, intake, source, bindingScaffold, implementationInput }) {
  assertOnboardingBindingWorkPlan({ workPlan, proposal, confirmation, intake, source, bindingScaffold });
  assertImplementationInput(implementationInput, workPlan);
  const sourceDocument = source.kind === "openapi" ? source.document : source.toolsList;
  requireCondition(source.kind === workPlan.source.kind && digest(sourceDocument) === workPlan.source.sourceHash, "Reviewed binding compiler source digest mismatch");
  const result = compileApprovedSegments({ source, workPlan, implementationInput });
  const descriptor = structuralDescriptor({ bindingScaffold, workPlan, compiled: result.compiled });
  const descriptorAssessment = assessCommercialBindingDescriptor({ intake, roleDraft: buildCommercialJobDraft(intake), descriptor });
  requireCondition(descriptorAssessment.readyForAcceptance === false, "Unprobed structural binding cannot pass commercial descriptor readiness");
  const uncompiled = result.approved.filter((item) => !result.compiled.has(item.sourceName));
  const proofItems = workPlan.exactRemainingWork.filter((item) => item.status === "required-independent-proof" || item.owner === "independent-verifier");
  const otherWorkPlanBlockers = workPlan.exactRemainingWork.filter((item) =>
    !proofItems.includes(item)
    && !item.id.startsWith("runtime-input-schema:")
    && !item.id.startsWith("transport:")
    && !item.id.startsWith("idempotency:")
    && !item.id.startsWith("reconciliation:"),
  );
  const artifact = {
    schemaVersion: "das.reviewed-onboarding-structural-binding.v1",
    sessionId: workPlan.sessionId,
    systemId: workPlan.systemId,
    roleId: intake.role.templateId,
    successCriteriaHash: digest({ success: intake.success, authority: intake.authority, policies: intake.policies }),
    source: stable(workPlan.source),
    proposalHash: proposal.proposalHash,
    confirmationHash: confirmation.confirmationHash,
    workPlanHash: workPlan.workPlanHash,
    bindingScaffoldHash: bindingScaffold.descriptorHash,
    implementationInputHash: implementationInput.implementationInputHash,
    status: uncompiled.length ? "partially-compiled-runtime-unprobed" : "structurally-compiled-runtime-unprobed",
    compilerSegments: result.segments,
    operations: result.approved.map((operation) => {
      const compiled = result.compiled.get(operation.sourceName);
      return {
        sourceName: operation.sourceName,
        targetExposedName: operation.targetExposedName,
        mode: operation.confirmedMode,
        authorityAction: operation.authority.action,
        status: compiled ? "structurally-compiled-runtime-unprobed" : "blocked-missing-write-safety-input",
        sourceInputSchemaHash: operation.sourceInputSchemaHash,
        boundedInputSchemaHash: compiled?.boundedInputSchemaHash ?? null,
        runtimeAuthorityGranted: false,
        credentialsResolved: false,
        probed: false,
      };
    }),
    descriptor,
    descriptorDiagnostics: {
      readyForAcceptance: false,
      failedGates: descriptorAssessment.gates.filter((gate) => !gate.passed).map((gate) => ({ id: gate.id, detail: gate.detail })),
      failedOperationChecks: descriptorAssessment.operationChecks.filter((gate) => !gate.passed).map((gate) => ({ id: gate.id, detail: gate.detail })),
    },
    measurements: {
      approvedOperations: result.approved.length,
      structurallyCompiledOperations: result.compiled.size,
      targetedGenericCompilerFields: result.approved.length * 2,
      retiredGenericCompilerFields: result.compiled.size * 2,
      remainingGenericCompilerFields: uncompiled.length * 2,
      engineerSuppliedWriteSafetyFields: implementationInput.writeSafety.length * 2,
      writeSafetyFieldsStillUnproved: result.writes.length * 2,
      independentProofFieldsStillRequired: proofItems.length,
      credentialValues: 0,
      runtimeAuthorityGrants: 0,
      modelCalls: 0,
      spendUsd: 0,
    },
    exactBlockers: [
      ...uncompiled.map((item) => `write-safety-input-missing:${item.sourceName}`),
      ...result.writes.map((item) => `write-safety-unproved:${item.sourceName}`),
      ...otherWorkPlanBlockers.map((item) => `work-plan:${item.id}`),
      ...proofItems.map((item) => `independent-proof:${item.id}`),
      "customer-local-runtime-not-wired",
      "credentials-not-resolved",
      "compiler-output-not-probed",
      "mandatory-acceptance-not-run",
      "controlled-activation-blocked",
    ],
    gates: {
      exactSourceDigestMatched: true,
      exactRoleOwnerConfirmationMatched: true,
      oneToOneAssignmentPreserved: true,
      credentialValuesPresent: false,
      runtimeAuthorityGranted: false,
      customerLocalRuntimeWired: false,
      compilerOutputProbed: false,
      independentObserverQualified: false,
      mandatoryAcceptanceRun: false,
      executable: false,
      activationReady: false,
    },
    evidenceBoundary: "The reviewed source subset passed existing structural compiler checks. This artifact intentionally omits the executable compiler plan and contains no credential values. Engineer-supplied write safety, direct observation, live wiring, probes, acceptance and activation remain separate evidence gates.",
  };
  artifact.artifactHash = digest(artifact);
  return Object.freeze(artifact);
}

export function assertReviewedOnboardingStructuralBinding({ artifact, workPlan, proposal, confirmation, intake, source, bindingScaffold, implementationInput }) {
  requireCondition(artifact?.schemaVersion === "das.reviewed-onboarding-structural-binding.v1" && artifact.artifactHash === digest(withoutHash(artifact, "artifactHash")), "Reviewed onboarding structural binding integrity mismatch");
  const expected = compileReviewedOnboardingBinding({ workPlan, proposal, confirmation, intake, source, bindingScaffold, implementationInput });
  requireCondition(artifact.artifactHash === expected.artifactHash, "Reviewed onboarding structural binding no longer matches its exact source, review or implementation input");
  requireCondition(artifact.gates.executable === false && artifact.gates.activationReady === false && artifact.gates.runtimeAuthorityGranted === false && artifact.gates.credentialValuesPresent === false, "Reviewed onboarding structural binding widened a protected gate");
  requireCondition(artifact.operations.every((item) => item.probed === false && item.runtimeAuthorityGranted === false && item.credentialsResolved === false), "Reviewed onboarding structural operation fabricated runtime evidence");
  return true;
}
