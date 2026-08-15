import { digest } from "../core/canonical.js";

const CREDENTIAL_ALIAS = /^[A-Z][A-Z0-9_]{5,120}$/;
const HEX_HASH = /^[a-f0-9]{64}$/;
const SECRET_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\bBasic\s+[A-Za-z0-9+/=]{8,}|\bsk-[A-Za-z0-9_-]{8,}|-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----|\b(?:password|secret|token|api[-_]?key)\s*[:=]\s*["']?[^\s,"'}]{6,})/i;

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function stable(value) { return JSON.parse(JSON.stringify(value)); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }
function clean(value, maximum = 240) { return String(value ?? "").trim().slice(0, maximum); }
function uniqueNonEmpty(values, label) {
  requireCondition(Array.isArray(values) && values.length > 0, `${label} must be a non-empty array`);
  const result = values.map((value) => clean(value, 160));
  requireCondition(result.every(Boolean) && new Set(result).size === result.length, `${label} must contain unique non-empty values`);
  return result;
}
function assertNoSecrets(value, label) {
  requireCondition(!SECRET_VALUE.test(JSON.stringify(value)), `${label} contains possible credential material`);
}
function exactFields(object, fields) { return fields.every((field) => object?.[field] !== undefined && object?.[field] !== null); }
function assertNoResponseDerivedEvidence(value, location = "observer evidence") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    requireCondition(!/(?:action|write|execution)[-_ ]?response/i.test(key), `${location} contains response-derived field ${key}`);
    assertNoResponseDerivedEvidence(child, `${location}.${key}`);
  }
}
function exactKeySet(object, allowed, label) {
  requireCondition(object && typeof object === "object" && !Array.isArray(object), `${label} must be an object`);
  const extras = Object.keys(object).filter((key) => !allowed.has(key));
  requireCondition(extras.length === 0, `${label} contains unapproved fields: ${extras.join(",")}`);
}

export function createProvisionalObserverContract({
  structuralBinding,
  workPlan,
  observerId,
  surfaceId,
  credentialAliases,
  implementationHash,
  sourceHash,
  runtimeSchemaHash,
  transportIdentityHash,
  readOperations,
  stableIdentity,
  freshness,
  outcomeRules,
  duplicateRule,
  collateralRules,
  proofRuleReview,
}) {
  requireCondition(structuralBinding?.schemaVersion === "das.reviewed-onboarding-structural-binding.v1", "Observer contract requires a DAS-012 structural receipt");
  requireCondition(structuralBinding.artifactHash === digest(withoutHash(structuralBinding, "artifactHash")), "Observer contract structural receipt integrity mismatch");
  requireCondition(structuralBinding.workPlanHash === workPlan?.workPlanHash, "Observer contract belongs to another reviewed work plan");
  requireCondition(["structurally-compiled-runtime-unprobed", "partially-compiled-runtime-unprobed"].includes(structuralBinding.status), "Observer contract requires an unprobed structural receipt");
  const aliases = uniqueNonEmpty(credentialAliases, "Observer credential aliases");
  requireCondition(aliases.every((alias) => CREDENTIAL_ALIAS.test(alias)), "Observer credentials must be environment-reference aliases only");
  requireCondition(HEX_HASH.test(implementationHash), "Observer implementation hash must be exact");
  requireCondition(HEX_HASH.test(sourceHash) && HEX_HASH.test(runtimeSchemaHash) && HEX_HASH.test(transportIdentityHash), "Observer source/runtime/transport identities must be exact hashes");
  const reads = uniqueNonEmpty(readOperations, "Observer read operations");
  const identity = uniqueNonEmpty(stableIdentity?.fields, "Observer stable identity fields");
  const requiredExact = uniqueNonEmpty(outcomeRules?.requiredExactFields, "Observer exact outcome fields");
  const completionStatuses = uniqueNonEmpty(outcomeRules?.completionStatuses, "Observer completion statuses");
  requireCondition(clean(freshness?.snapshotGeneratedAtField) && clean(freshness?.caughtUpThroughField) && Number.isFinite(freshness?.maximumAgeMs) && freshness.maximumAgeMs >= 0, "Observer freshness rule is incomplete");
  requireCondition(Number.isInteger(duplicateRule?.maximumDistinctResults) && duplicateRule.maximumDistinctResults === 1, "Observer duplicate rule must require exactly one distinct result maximum");
  requireCondition(clean(duplicateRule?.resultIdentityField), "Observer duplicate rule needs the stable result identity field");
  requireCondition(clean(collateralRules?.changedEntitiesField) && clean(collateralRules?.unrelatedStateDigestField), "Observer collateral rules are incomplete");
  requireCondition(proofRuleReview?.responsibility === "engineer-owned-reviewed-unproved", "Observer proof rules must remain explicitly engineer-owned and unproved");
  requireCondition(proofRuleReview?.confirmationHash === structuralBinding.confirmationHash, "Observer proof-rule review belongs to another role-owner confirmation");
  requireCondition(proofRuleReview?.successCriteriaHash === structuralBinding.successCriteriaHash, "Observer proof-rule review belongs to another success contract");
  requireCondition(clean(proofRuleReview?.reviewedBy), "Observer proof rules require an exact reviewer identity");
  const contract = {
    schemaVersion: "das.customer-local-observer-contract.v1",
    sessionId: structuralBinding.sessionId,
    systemId: structuralBinding.systemId,
    workPlanHash: workPlan.workPlanHash,
    structuralBindingHash: structuralBinding.artifactHash,
    observerId: clean(observerId),
    surfaceId: clean(surfaceId),
    credentialAliases: aliases,
    implementationHash,
    sourceHash,
    runtimeSchemaHash,
    transportIdentityHash,
    readOperations: reads,
    writeOperations: [],
    evidenceProvenance: "observer-direct-external-state",
    stableIdentity: { fields: identity },
    freshness: {
      snapshotGeneratedAtField: clean(freshness.snapshotGeneratedAtField),
      caughtUpThroughField: clean(freshness.caughtUpThroughField),
      maximumAgeMs: freshness.maximumAgeMs,
    },
    outcomeRules: {
      requiredExactFields: requiredExact,
      statusField: clean(outcomeRules.statusField),
      completionStatuses,
    },
    duplicateRule: { maximumDistinctResults: 1, resultIdentityField: clean(duplicateRule.resultIdentityField) },
    collateralRules: {
      changedEntitiesField: clean(collateralRules.changedEntitiesField),
      unrelatedStateDigestField: clean(collateralRules.unrelatedStateDigestField),
      allowedChangedEntityKinds: uniqueNonEmpty(collateralRules.allowedChangedEntityKinds, "Observer allowed changed-entity kinds"),
    },
    proofRuleReview: {
      responsibility: "engineer-owned-reviewed-unproved",
      reviewedBy: clean(proofRuleReview.reviewedBy),
      confirmationHash: proofRuleReview.confirmationHash,
      successCriteriaHash: proofRuleReview.successCriteriaHash,
      reviewedRuleHash: digest({ stableIdentity: identity, freshness, requiredExact, statusField: clean(outcomeRules.statusField), completionStatuses, duplicateRule, collateralRules }),
    },
    status: "provisional-observer-contract-non-executable",
    independentlyAuthenticated: "unproved",
    qualified: false,
    executable: false,
    activationReady: false,
    evidenceBoundary: "Provisional customer-local observer declaration. Separate identities and rules are declared but no observer was authenticated, probed or qualified.",
  };
  requireCondition(contract.observerId && contract.surfaceId && contract.outcomeRules.statusField, "Observer contract identifiers and status rule are required");
  assertNoSecrets(contract, "Observer contract");
  contract.contractHash = digest(contract);
  return Object.freeze(contract);
}

export function assertProvisionalObserverContract({ contract, structuralBinding, workPlan }) {
  requireCondition(contract?.schemaVersion === "das.customer-local-observer-contract.v1", "Unsupported provisional observer contract");
  requireCondition(contract.contractHash === digest(withoutHash(contract, "contractHash")), "Provisional observer contract integrity mismatch");
  const expected = createProvisionalObserverContract({
    structuralBinding,
    workPlan,
    observerId: contract.observerId,
    surfaceId: contract.surfaceId,
    credentialAliases: contract.credentialAliases,
    implementationHash: contract.implementationHash,
    sourceHash: contract.sourceHash,
    runtimeSchemaHash: contract.runtimeSchemaHash,
    transportIdentityHash: contract.transportIdentityHash,
    readOperations: contract.readOperations,
    stableIdentity: contract.stableIdentity,
    freshness: contract.freshness,
    outcomeRules: contract.outcomeRules,
    duplicateRule: contract.duplicateRule,
    collateralRules: contract.collateralRules,
    proofRuleReview: contract.proofRuleReview,
  });
  requireCondition(expected.contractHash === contract.contractHash, "Observer contract no longer matches its structural receipt and work plan");
  requireCondition(contract.writeOperations.length === 0 && contract.executable === false && contract.activationReady === false, "Observer contract widened a protected gate");
  return true;
}

export function assertStrictObserverEvidence({ contract, evidence, phase, actionFenceMs = null, nowMs }) {
  assertNoResponseDerivedEvidence(evidence);
  requireCondition(Number.isFinite(nowMs), "Observer evidence validation requires trusted current time");
  if (["unknown", "unavailable"].includes(evidence?.availability)) {
    exactKeySet(evidence, new Set(["availability", "reason"]), `${phase} observer availability evidence`);
    requireCondition(clean(evidence.reason), `${phase} observer availability evidence needs a reason`);
    return true;
  }
  const baseKeys = new Set([
    "provenance",
    "observerContractHash",
    contract.freshness.snapshotGeneratedAtField,
    contract.freshness.caughtUpThroughField,
    "matches",
    contract.collateralRules.changedEntitiesField,
    contract.collateralRules.unrelatedStateDigestField,
  ]);
  exactKeySet(evidence, baseKeys, `${phase} observer evidence`);
  requireCondition(evidence.provenance === contract.evidenceProvenance && evidence.observerContractHash === contract.contractHash, `${phase} observer evidence provenance is invalid`);
  const generatedAt = Number(evidence[contract.freshness.snapshotGeneratedAtField]);
  const caughtUpThrough = Number(evidence[contract.freshness.caughtUpThroughField]);
  requireCondition(Number.isFinite(generatedAt) && Number.isFinite(caughtUpThrough), `${phase} observer freshness evidence is incomplete`);
  requireCondition(generatedAt <= nowMs && caughtUpThrough <= nowMs, `${phase} observer evidence is future-dated`);
  if (phase === "before") {
    requireCondition(actionFenceMs === null || (generatedAt <= actionFenceMs && caughtUpThrough <= actionFenceMs), "Pre-action observer evidence crossed the action fence");
  } else requireCondition(Number.isFinite(actionFenceMs), "Post-action observer evidence needs an action fence");
  requireCondition(Array.isArray(evidence.matches), `${phase} observer match set is missing`);
  const matchKeys = new Set([...contract.stableIdentity.fields, ...contract.outcomeRules.requiredExactFields, contract.outcomeRules.statusField, contract.duplicateRule.resultIdentityField]);
  for (const [index, match] of evidence.matches.entries()) exactKeySet(match, matchKeys, `${phase} observer match ${index}`);
  const changed = evidence[contract.collateralRules.changedEntitiesField];
  requireCondition(Array.isArray(changed), `${phase} changed-entity evidence is missing`);
  for (const [index, entry] of changed.entries()) exactKeySet(entry, new Set(["kind", "id"]), `${phase} changed entity ${index}`);
  requireCondition(typeof evidence[contract.collateralRules.unrelatedStateDigestField] === "string" && evidence[contract.collateralRules.unrelatedStateDigestField], `${phase} unrelated-state digest is missing`);
  return true;
}

function result(classification, reason, retryEligible = false, additions = {}) {
  const halt = ["partial", "incorrect", "duplicate", "collateral"].includes(classification) ? "halt-quarantine" : ["stale", "unknown", "unavailable"].includes(classification) ? "halt-handoff" : classification === "not-started" ? "retry-eligible-after-explicit-gate" : "accept";
  return Object.freeze({ classification, reason, disposition: halt, retryEligible, ...additions });
}

export function classifyObservedOutcome({ contract, beforeEvidence, afterEvidence, assignedWork, actionTrace, nowMs }) {
  requireCondition(contract?.schemaVersion === "das.customer-local-observer-contract.v1" && contract.contractHash === digest(withoutHash(contract, "contractHash")), "Outcome classification requires an integrity-valid observer contract");
  requireCondition(actionTrace && Number.isFinite(actionTrace.observationNotBeforeMs), "Outcome classification requires an exact observation fence");
  requireCondition(Number.isFinite(nowMs), "Outcome classification requires a trusted current time");
  assertStrictObserverEvidence({ contract, evidence: beforeEvidence, phase: "before", actionFenceMs: actionTrace.observationNotBeforeMs, nowMs });
  assertStrictObserverEvidence({ contract, evidence: afterEvidence, phase: "after", actionFenceMs: actionTrace.observationNotBeforeMs, nowMs });
  if (afterEvidence?.availability === "unavailable") return result("unavailable", clean(afterEvidence.reason) || "observer-unavailable", false, { reconciledAfterLostResponse: false });
  if (afterEvidence?.availability === "unknown") return result("unknown", clean(afterEvidence.reason) || "observer-state-unknown", false, { reconciledAfterLostResponse: false });
  const beforeGeneratedAt = Number(beforeEvidence[contract.freshness.snapshotGeneratedAtField]);
  const beforeCaughtUpThrough = Number(beforeEvidence[contract.freshness.caughtUpThroughField]);
  if (nowMs - beforeGeneratedAt > contract.freshness.maximumAgeMs || nowMs - beforeCaughtUpThrough > contract.freshness.maximumAgeMs) return result("unknown", "pre-action-observer-baseline-stale");
  const generatedAt = Number(afterEvidence[contract.freshness.snapshotGeneratedAtField]);
  const caughtUpThrough = Number(afterEvidence[contract.freshness.caughtUpThroughField]);
  if (generatedAt < actionTrace.observationNotBeforeMs || caughtUpThrough < actionTrace.observationNotBeforeMs || nowMs - generatedAt > contract.freshness.maximumAgeMs) return result("stale", "observer-stale");
  const unrelatedField = contract.collateralRules.unrelatedStateDigestField;
  const changedField = contract.collateralRules.changedEntitiesField;
  if (!beforeEvidence || beforeEvidence.provenance !== contract.evidenceProvenance || beforeEvidence.observerContractHash !== contract.contractHash || !beforeEvidence[unrelatedField] || !afterEvidence[unrelatedField]) return result("unknown", "collateral-baseline-missing");
  const allowedKinds = new Set(contract.collateralRules.allowedChangedEntityKinds);
  const changed = Array.isArray(afterEvidence[changedField]) ? afterEvidence[changedField] : null;
  if (!changed) return result("unknown", "changed-entity-evidence-missing");
  if (beforeEvidence[unrelatedField] !== afterEvidence[unrelatedField] || changed.some((entry) => !allowedKinds.has(entry.kind))) return result("collateral", "collateral-effect", false, { reconciledAfterLostResponse: false });
  requireCondition(exactFields(assignedWork, contract.stableIdentity.fields), "Assigned work lacks the confirmed stable identity");
  const beforeMatches = Array.isArray(beforeEvidence.matches) ? beforeEvidence.matches : [];
  requireCondition(!beforeMatches.some((match) => contract.stableIdentity.fields.every((field) => match?.[field] === assignedWork[field])), "Qualification case began with a pre-existing matching outcome");
  const matches = Array.isArray(afterEvidence.matches) ? afterEvidence.matches : null;
  if (!matches) return result("unknown", "observer-match-set-missing");
  const identityMatches = matches.filter((match) => contract.stableIdentity.fields.every((field) => match?.[field] === assignedWork[field]));
  const identities = new Set(identityMatches.map((match) => match?.[contract.duplicateRule.resultIdentityField]).filter(Boolean));
  if (identityMatches.length > contract.duplicateRule.maximumDistinctResults || identities.size > contract.duplicateRule.maximumDistinctResults) return result("duplicate", "duplicate-external-effect");
  if (identityMatches.length === 0) return result("not-started", "fresh-independent-observer-found-no-effect", true, { reconciledAfterLostResponse: false });
  const observed = identityMatches[0];
  if (!exactFields(observed, [...contract.outcomeRules.requiredExactFields, contract.outcomeRules.statusField, contract.duplicateRule.resultIdentityField])) return result("partial", "required-observed-outcome-missing");
  const mismatched = contract.outcomeRules.requiredExactFields.filter((field) => observed[field] !== assignedWork[field]);
  if (mismatched.length || !contract.outcomeRules.completionStatuses.includes(observed[contract.outcomeRules.statusField])) return result("incorrect", mismatched.length ? `mismatched:${mismatched.join(",")}` : "unexpected-completion-status");
  return result("completed", "fresh-independent-observer-confirmed-exact-outcome", false, { reconciledAfterLostResponse: actionTrace.responseLost === true, observedResultIdentity: observed[contract.duplicateRule.resultIdentityField] });
}
