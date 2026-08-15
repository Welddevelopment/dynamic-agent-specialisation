import test from "node:test";
import assert from "node:assert/strict";
import { digest } from "../src/core/canonical.js";
import {
  CUSTOMER_LOCAL_BINDING_PACKAGE_CLASSIFICATIONS,
  assertCustomerLocalBindingPackage,
  createCustomerLocalBindingPackage,
} from "../src/product/customer-local-binding-package-factory.js";

function reviewedInputs(kind = "openapi") {
  const sourceKind = kind === "openapi" ? "openapi" : "mcp-tools-list";
  const sourceHash = digest({ source: `${kind}-fresh-role-source-v1` });
  const confirmationHash = digest({ confirmation: `${kind}-role-owner-v1` });
  const successCriteriaHash = digest({ success: `${kind}-exact-draft-no-collateral` });
  const baseUrl = "https://warranty.example.test";
  const server = { id: "warranty-mcp", version: "2026-08-14", toolsListHash: sourceHash };
  const transportIdentityHash = kind === "openapi" ? digest({ baseUrl }) : digest({ server });
  const workPlan = {
    schemaVersion: "das.onboarding-binding-work-plan.v1",
    sessionId: `${kind}-warranty-session`,
    systemId: "warranty",
    confirmationHash,
    source: { kind: sourceKind, sourceHash },
    adapterConfigurationDraft: kind === "openapi"
      ? { schemaVersion: "das.openapi-adapter-config-draft.v1", sourceHash, baseUrl }
      : { schemaVersion: "das.mcp-adapter-config-draft.v1", sourceHash, serverId: server.id, serverVersion: server.version },
    approvedOperations: [],
    status: "reviewed-scaffold-engineering-required-non-executable",
  };
  workPlan.workPlanHash = digest(workPlan);
  const structuralBinding = {
    schemaVersion: "das.reviewed-onboarding-structural-binding.v1",
    sessionId: workPlan.sessionId,
    systemId: workPlan.systemId,
    roleId: "warranty-review-coordinator",
    workPlanHash: workPlan.workPlanHash,
    confirmationHash,
    successCriteriaHash,
    source: { kind: sourceKind, sourceHash },
    status: "structurally-compiled-runtime-unprobed",
    compilerSegments: [{ segmentType: "approved-read-subset", transportIdentityHash }, { segmentType: "one-write-plus-approved-readback", transportIdentityHash }],
    operations: [
      { sourceName: "readApprovedInspection", targetExposedName: "warranty:read-inspection", mode: "read", authorityAction: null, status: "structurally-compiled-runtime-unprobed", boundedInputSchemaHash: digest({ kind, operation: "read" }) },
      { sourceName: "createDraftWarrantyReview", targetExposedName: "warranty:create-draft-review", mode: "write", authorityAction: "create-draft-warranty-review", status: "structurally-compiled-runtime-unprobed", boundedInputSchemaHash: digest({ kind, operation: "write" }) },
    ],
    descriptor: { roleId: "warranty-review-coordinator" },
  };
  structuralBinding.artifactHash = digest(structuralBinding);

  const observed = () => ({ status: "reviewed-source-observed", suppliedBy: `${kind} source review`, sourceHash });
  const customer = () => ({ status: "customer-confirmed", suppliedBy: "Fictional warranty operations owner", sourceHash: confirmationHash });
  const engineer = (label) => ({ status: "engineer-supplied-unproved", suppliedBy: "Fictional customer-local implementation engineer", sourceHash: digest({ label, kind, status: "unproved" }) });
  const sourceIdentity = kind === "openapi"
    ? { kind: sourceKind, sourceHash, provenance: observed("source"), openapi: { documentHash: sourceHash, baseUrl, transportIdentityHash } }
    : { kind: sourceKind, sourceHash, provenance: observed("source"), mcp: { serverId: server.id, serverVersion: server.version, toolsListHash: sourceHash, transportIdentityHash } };
  const actionRuntime = {
    bindingId: `${kind}-warranty-action-v1`,
    surfaceId: `${kind}-warranty-command-surface`,
    credentialAliases: [`${kind.toUpperCase()}_WARRANTY_ACTION_REF`],
    implementationHash: digest({ kind, implementation: "action" }),
    runtimeSchemaHash: digest(structuralBinding.operations.map((operation) => operation.boundedInputSchemaHash)),
    authenticationIdentityHash: digest({ kind, authentication: "action-principal" }),
    provenance: engineer("action-runtime"),
  };
  const conflictKeySource = kind === "openapi" ? "http-idempotency-header" : "mcp-required-input-field";
  const writeSafety = [{
    sourceName: "createDraftWarrantyReview",
    stableIdentity: { fields: ["inspectionId", "requestId"], provenance: customer("stable-identity") },
    idempotency: { conflictKeyFields: ["requestId"], conflictKeySource, conflictBehavior: "halt-handoff-no-overwrite", provenance: engineer("idempotency") },
    allowedMutation: { entityKinds: ["draft-warranty-review"], scopeFields: ["inspectionId", "equipmentId", "requestId"], maximumWritesPerAssignedItem: 1, provenance: customer("allowed-mutation") },
    reconciliation: { readOperation: "readApprovedInspection", inputBindings: ["inspectionId -> inspectionId"], requiredPredicates: ["one draft review has the exact requestId"], proofSource: "separate-independent-observer", provenance: engineer("reconciliation") },
    retryPolicy: { automaticRetries: 0, eligibleClassification: "not-started", requiresExplicitGate: true, maximumGatedRetries: 1, provenance: engineer("retry") },
    terminalBehavior: { unknown: "halt-handoff-no-retry", unavailable: "halt-handoff-no-retry", partial: "halt-quarantine-no-retry", incorrect: "halt-quarantine-no-retry", duplicate: "halt-quarantine-no-retry", collateral: "halt-quarantine-no-retry", provenance: customer("terminal") },
    review: { responsibility: "customer-local-engineer-and-role-owner-reviewed-unproved", reviewedBy: "Fictional warranty owner and implementation engineer", confirmationHash, successCriteriaHash, provenance: customer("write-review") },
  }];
  const observerProof = {
    runtime: {
      observerId: `${kind}-warranty-audit-v1`,
      surfaceId: `${kind}-warranty-independent-audit`,
      credentialAliases: [`${kind.toUpperCase()}_WARRANTY_OBSERVER_REF`],
      implementationHash: digest({ kind, implementation: "observer" }),
      sourceHash: digest({ kind, source: "separate-audit-system" }),
      runtimeSchemaHash: digest({ kind, schema: "observer" }),
      transportIdentityHash: digest({ kind, transport: "observer" }),
      authenticationIdentityHash: digest({ kind, authentication: "observer-principal" }),
      readOperations: ["readWarrantyReviewObservations", "readProtectedWarrantyScope"],
      provenance: engineer("observer-runtime"),
    },
    stableIdentity: { fields: ["inspectionId", "requestId"], provenance: customer("observer-identity") },
    freshness: { snapshotGeneratedAtField: "snapshotGeneratedAtMs", caughtUpThroughField: "caughtUpThroughMs", maximumAgeMs: 1000, provenance: engineer("freshness") },
    outcomeRules: { requiredExactFields: ["inspectionId", "requestId", "equipmentId", "findingCode", "severity"], statusField: "status", completionStatuses: ["draft-review"], provenance: customer("outcome") },
    duplicateRule: { maximumDistinctResults: 1, resultIdentityField: "reviewId", provenance: customer("duplicate") },
    collateralRules: { changedEntitiesField: "changedEntities", unrelatedStateDigestField: "unrelatedStateDigest", allowedChangedEntityKinds: ["draft-warranty-review"], provenance: customer("collateral") },
    predicates: { values: ["the observed review matches every required assigned-work field", "the observed state is draft-review"], provenance: engineer("predicates") },
    invariants: { values: ["no unrelated entity changes", "no second review exists for the stable identity"], provenance: engineer("invariants") },
    evidenceTiming: { beforeActionBaselineRequired: true, afterActionFenceRequired: true, futureEvidenceRejected: true, preExistingMatchRejected: true, provenance: engineer("timing") },
    proofRuleReview: { responsibility: "engineer-owned-reviewed-unproved", reviewedBy: "Fictional independent-proof engineer", confirmationHash, successCriteriaHash, provenance: engineer("proof-review") },
  };
  return { structuralBinding, workPlan, sourceIdentity, actionRuntime, writeSafety, observerProof };
}

test("OpenAPI package binds a full compiled base URL to the separately reviewed safe origin", () => {
  const inputs = reviewedInputs("openapi");
  const origin = inputs.workPlan.adapterConfigurationDraft.baseUrl;
  const baseUrl = `${origin}/v1`;
  const transportIdentityHash = digest({ baseUrl });
  inputs.sourceIdentity.openapi.baseUrl = baseUrl;
  inputs.sourceIdentity.openapi.transportIdentityHash = transportIdentityHash;
  inputs.structuralBinding.compilerSegments = inputs.structuralBinding.compilerSegments.map((segment) => ({ ...segment, transportIdentityHash }));
  delete inputs.structuralBinding.artifactHash;
  inputs.structuralBinding.artifactHash = digest(inputs.structuralBinding);
  const output = createCustomerLocalBindingPackage(inputs);
  assert.equal(output.sourceIdentity.openapi.baseUrl, baseUrl);
  assert.equal(assertCustomerLocalBindingPackage({ package: output, ...inputs }), true);
});

test("factory emits one integrity-bound OpenAPI package with explicit non-executable write and proof contracts", () => {
  const inputs = reviewedInputs("openapi");
  const output = createCustomerLocalBindingPackage(inputs);
  assert.equal(assertCustomerLocalBindingPackage({ package: output, ...inputs }), true);
  assert.equal(output.sourceIdentity.openapi.documentHash, inputs.structuralBinding.source.sourceHash);
  assert.equal(output.sourceIdentity.openapi.transportIdentityHash, inputs.structuralBinding.compilerSegments[0].transportIdentityHash);
  assert.equal(output.writeSafetyContracts.length, 1);
  assert.equal(output.writeSafetyContracts[0].idempotency.conflictKeySource, "http-idempotency-header");
  assert.equal(output.proofContractInput.runtime.sourceHash === output.candidate.action.sourceHash, false);
  assert.equal(Object.keys(output.proofContractInput.canonicalClassifications).length, 10);
  assert.deepEqual(Object.keys(output.proofContractInput.canonicalClassifications).sort(), Object.keys(CUSTOMER_LOCAL_BINDING_PACKAGE_CLASSIFICATIONS).sort());
  assert.equal(output.runtimeWorkPack.measurements.packageSpecificExecutableCodeGenerated, 0);
  assert.equal(output.receipt.executableOperations, 0);
  assert.equal(output.receipt.comparisonReady, false);
  assert.equal(output.receipt.qualified, false);
  assert.equal(output.receipt.activated, false);
});

test("factory accepts the exact session-qualified role identity emitted by the onboarding scaffold", () => {
  const inputs = reviewedInputs("openapi");
  inputs.structuralBinding.descriptor.roleId = `${inputs.structuralBinding.sessionId}:${inputs.structuralBinding.roleId}`;
  delete inputs.structuralBinding.artifactHash;
  inputs.structuralBinding.artifactHash = digest(inputs.structuralBinding);
  const output = createCustomerLocalBindingPackage(inputs);
  assert.equal(assertCustomerLocalBindingPackage({ package: output, ...inputs }), true);
});

test("the same provider-neutral factory preserves pinned MCP server, version, tools/list, and transport identities", () => {
  const inputs = reviewedInputs("mcp");
  const output = createCustomerLocalBindingPackage(inputs);
  assert.equal(assertCustomerLocalBindingPackage({ package: output, ...inputs }), true);
  assert.equal(output.sourceIdentity.kind, "mcp-tools-list");
  assert.equal(output.sourceIdentity.mcp.serverId, "warranty-mcp");
  assert.equal(output.sourceIdentity.mcp.serverVersion, "2026-08-14");
  assert.equal(output.sourceIdentity.mcp.toolsListHash, inputs.structuralBinding.source.sourceHash);
  assert.equal(output.writeSafetyContracts[0].idempotency.conflictKeySource, "mcp-required-input-field");
  assert.equal(output.candidate.status, "reviewed-candidate-non-executable");
});

test("cross-source, cross-role, and cross-confirmation substitutions fail closed", () => {
  const inputs = reviewedInputs("openapi");
  const output = createCustomerLocalBindingPackage(inputs);
  const sourceIdentity = structuredClone(inputs.sourceIdentity);
  sourceIdentity.sourceHash = digest("another-source");
  sourceIdentity.openapi.documentHash = sourceIdentity.sourceHash;
  assert.throws(() => createCustomerLocalBindingPackage({ ...inputs, sourceIdentity }), /source identity was substituted/i);

  const structuralBinding = structuredClone(inputs.structuralBinding);
  structuralBinding.roleId = "another-role";
  structuralBinding.descriptor.roleId = "another-role";
  delete structuralBinding.artifactHash;
  structuralBinding.artifactHash = digest(structuralBinding);
  assert.throws(() => assertCustomerLocalBindingPackage({ package: output, ...inputs, structuralBinding }), /no longer matches|different review chains/i);

  const writeSafety = structuredClone(inputs.writeSafety);
  writeSafety[0].review.confirmationHash = digest("another-confirmation");
  assert.throws(() => createCustomerLocalBindingPackage({ ...inputs, writeSafety }), /another confirmation/i);
});

test("credential values and shared action-observer identity boundaries are rejected", () => {
  const secret = reviewedInputs("openapi");
  secret.observerProof.proofRuleReview.reviewedBy = "password=plaintext-value";
  assert.throws(() => createCustomerLocalBindingPackage(secret), /credential material/i);

  const sharedAlias = reviewedInputs("openapi");
  sharedAlias.observerProof.runtime.credentialAliases = [...sharedAlias.actionRuntime.credentialAliases];
  assert.throws(() => createCustomerLocalBindingPackage(sharedAlias), /disjoint/i);

  const sharedTransport = reviewedInputs("openapi");
  sharedTransport.observerProof.runtime.transportIdentityHash = sharedTransport.sourceIdentity.openapi.transportIdentityHash;
  assert.throws(() => createCustomerLocalBindingPackage(sharedTransport), /transport identities must be distinct/i);

  const sharedAuthentication = reviewedInputs("openapi");
  sharedAuthentication.observerProof.runtime.authenticationIdentityHash = sharedAuthentication.actionRuntime.authenticationIdentityHash;
  assert.throws(() => createCustomerLocalBindingPackage(sharedAuthentication), /authentication identities must be distinct/i);

  const sharedSource = reviewedInputs("openapi");
  sharedSource.observerProof.runtime.sourceHash = sharedSource.sourceIdentity.sourceHash;
  assert.throws(() => createCustomerLocalBindingPackage(sharedSource), /proof source must be distinct/i);
});

test("write, retry, reconciliation, observer timing, and canonical safety semantics cannot be weakened", () => {
  const tooManyWrites = reviewedInputs("openapi");
  tooManyWrites.writeSafety[0].allowedMutation.maximumWritesPerAssignedItem = 2;
  assert.throws(() => createCustomerLocalBindingPackage(tooManyWrites), /at most one business write/i);

  const blindRetry = reviewedInputs("openapi");
  blindRetry.writeSafety[0].retryPolicy.automaticRetries = 1;
  assert.throws(() => createCustomerLocalBindingPackage(blindRetry), /prohibit blind retry/i);

  const actionProof = reviewedInputs("openapi");
  actionProof.writeSafety[0].reconciliation.proofSource = "action-response";
  assert.throws(() => createCustomerLocalBindingPackage(actionProof), /cannot use the action response/i);

  const unknownRetry = reviewedInputs("openapi");
  unknownRetry.writeSafety[0].terminalBehavior.unknown = "retry";
  assert.throws(() => createCustomerLocalBindingPackage(unknownRetry), /cannot be weakened/i);

  const weakTiming = reviewedInputs("openapi");
  weakTiming.observerProof.evidenceTiming.preExistingMatchRejected = false;
  assert.throws(() => createCustomerLocalBindingPackage(weakTiming), /cannot weaken/i);

  const wrongMcpKey = reviewedInputs("mcp");
  wrongMcpKey.writeSafety[0].idempotency.conflictKeySource = "http-idempotency-header";
  assert.throws(() => createCustomerLocalBindingPackage(wrongMcpKey), /source-incompatible/i);
});

test("factory refuses incomplete write coverage, observer omissions, and post-generation gate fabrication", () => {
  const missingWrite = reviewedInputs("openapi");
  missingWrite.writeSafety = [];
  assert.throws(() => createCustomerLocalBindingPackage(missingWrite), /cover every/i);

  const missingIdentity = reviewedInputs("openapi");
  missingIdentity.observerProof.stableIdentity.fields = ["inspectionId"];
  assert.throws(() => createCustomerLocalBindingPackage(missingIdentity), /omits confirmed write identity/i);

  const inputs = reviewedInputs("openapi");
  const output = createCustomerLocalBindingPackage(inputs);
  const fabricated = structuredClone(output);
  fabricated.receipt.executableOperations = 1;
  delete fabricated.receipt.receiptHash;
  fabricated.receipt.receiptHash = digest(fabricated.receipt);
  assert.throws(() => assertCustomerLocalBindingPackage({ package: fabricated, ...inputs }), /no longer matches|widened a protected gate/i);
});
