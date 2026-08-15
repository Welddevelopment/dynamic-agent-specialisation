import { digest } from "../../core/canonical.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }

function provenance(status, suppliedBy, sourceHash) {
  return { status, suppliedBy, sourceHash };
}

function compiledTransport(definition, structuralBinding) {
  const values = [...new Set(structuralBinding.compilerSegments.map((segment) => segment.transportIdentityHash))];
  requireCondition(values.length === 1, `${definition.id} must have one exact action transport identity`);
  return values[0];
}

function sourceIdentity(definition, structuralBinding) {
  const sourceHash = structuralBinding.source.sourceHash;
  const common = { kind: structuralBinding.source.kind, sourceHash, provenance: provenance("reviewed-source-observed", `Reviewed source for ${definition.id}`, sourceHash) };
  if (definition.sourceKind === "openapi") return { ...common, openapi: { documentHash: sourceHash, baseUrl: definition.source.document.servers[0].url, transportIdentityHash: compiledTransport(definition, structuralBinding) } };
  return { ...common, mcp: { serverId: definition.source.serverId, serverVersion: definition.source.serverVersion, toolsListHash: sourceHash, transportIdentityHash: compiledTransport(definition, structuralBinding) } };
}

export function createDAS023PackageDeclarations({ definition, structuralBinding }) {
  const confirmationHash = structuralBinding.confirmationHash;
  const successCriteriaHash = structuralBinding.successCriteriaHash;
  const customer = (label) => provenance("customer-confirmed", `Fictional role owner for ${definition.id}`, confirmationHash);
  const engineer = (label) => provenance("engineer-supplied-unproved", `Fictional implementation engineer for ${definition.id}`, digest({ package: definition.id, label, status: "unproved" }));
  const requiredExactFields = Object.keys(definition.assignedWork);
  const actionSource = sourceIdentity(definition, structuralBinding);
  const actionRuntime = {
    bindingId: definition.action.bindingId,
    surfaceId: definition.action.surfaceId,
    credentialAliases: definition.action.credentialAliases,
    implementationHash: digest(definition.action.implementationLabel),
    runtimeSchemaHash: digest(structuralBinding.operations.map(({ sourceName, boundedInputSchemaHash }) => ({ sourceName, boundedInputSchemaHash }))),
    authenticationIdentityHash: digest({ package: definition.id, boundary: "action-principal" }),
    provenance: engineer("action-runtime"),
  };
  const writeOperation = structuralBinding.operations.find((operation) => operation.mode === "write");
  const readback = definition.sourceKind === "openapi" ? definition.writeSafety.verification.readOperationId : definition.writeSafety.verification.readToolName;
  const conflictKeySource = definition.sourceKind === "openapi" ? "http-idempotency-header" : "mcp-required-input-field";
  const stableFields = requiredExactFields.filter((field) => /(?:Id|Key)$/.test(field)).filter((field) => ["applicationId", "sourceReturnId", "idempotencyKey"].includes(field));
  const writeSafety = [{
    sourceName: writeOperation.sourceName,
    stableIdentity: { fields: stableFields, provenance: customer("stable-identity") },
    idempotency: { conflictKeyFields: ["idempotencyKey"], conflictKeySource, conflictBehavior: "halt-handoff-no-overwrite", provenance: engineer("idempotency") },
    allowedMutation: { entityKinds: [definition.changedEntityKind], scopeFields: stableFields, maximumWritesPerAssignedItem: 1, provenance: customer("allowed-mutation") },
    reconciliation: { readOperation: readback, inputBindings: stableFields.map((field) => `${field}->${field}`), requiredPredicates: ["one exact result for the stable identity", "no protected or unrelated state changed"], proofSource: "separate-independent-observer", provenance: engineer("reconciliation") },
    retryPolicy: { automaticRetries: 0, eligibleClassification: "not-started", requiresExplicitGate: true, maximumGatedRetries: 1, provenance: engineer("retry") },
    terminalBehavior: { unknown: "halt-handoff-no-retry", unavailable: "halt-handoff-no-retry", partial: "halt-quarantine-no-retry", incorrect: "halt-quarantine-no-retry", duplicate: "halt-quarantine-no-retry", collateral: "halt-quarantine-no-retry", provenance: customer("terminal-behavior") },
    review: { responsibility: "customer-local-engineer-and-role-owner-reviewed-unproved", reviewedBy: `Fictional owner and engineer for ${definition.id}`, confirmationHash, successCriteriaHash, provenance: customer("write-review") },
  }];
  const observerSource = definition.observer.sourceIdentity;
  const observerSourceHash = digest(observerSource);
  const observerProof = {
    runtime: {
      observerId: definition.observer.observerId,
      surfaceId: definition.observer.surfaceId,
      credentialAliases: definition.observer.credentialAliases,
      implementationHash: digest(definition.observer.implementationLabel),
      sourceHash: observerSourceHash,
      runtimeSchemaHash: digest({ assignedWorkKeys: requiredExactFields, resultKeys: [...requiredExactFields, definition.resultIdentityField, definition.statusField], source: observerSource }),
      transportIdentityHash: digest({ package: definition.id, boundary: "separate-read-only-observer", source: observerSource }),
      authenticationIdentityHash: digest({ package: definition.id, boundary: "observer-principal", sourceHash: observerSourceHash }),
      readOperations: observerSource.readOperations,
      provenance: engineer("observer-runtime"),
    },
    stableIdentity: { fields: stableFields, provenance: customer("observer-stable-identity") },
    freshness: { snapshotGeneratedAtField: "snapshotGeneratedAtMs", caughtUpThroughField: "caughtUpThroughMs", maximumAgeMs: 50, provenance: engineer("freshness") },
    outcomeRules: { requiredExactFields, statusField: definition.statusField, completionStatuses: [definition.completionStatus], provenance: customer("outcome-rules") },
    duplicateRule: { maximumDistinctResults: 1, resultIdentityField: definition.resultIdentityField, provenance: customer("duplicate-rule") },
    collateralRules: { changedEntitiesField: "changedEntities", unrelatedStateDigestField: "unrelatedStateDigest", allowedChangedEntityKinds: [definition.changedEntityKind], provenance: customer("collateral-rules") },
    predicates: { values: ["observed result matches every exact assigned-work field", `observed ${definition.statusField} is ${definition.completionStatus}`], provenance: engineer("predicates") },
    invariants: { values: ["no unrelated protected state changes", "no second result exists for the stable identity"], provenance: engineer("invariants") },
    evidenceTiming: { beforeActionBaselineRequired: true, afterActionFenceRequired: true, futureEvidenceRejected: true, preExistingMatchRejected: true, provenance: engineer("evidence-timing") },
    proofRuleReview: { responsibility: "engineer-owned-reviewed-unproved", reviewedBy: `Fictional independent-proof engineer for ${definition.id}`, confirmationHash, successCriteriaHash, provenance: engineer("proof-rule-review") },
  };
  return Object.freeze({ sourceIdentity: actionSource, actionRuntime, writeSafety, observerProof });
}
