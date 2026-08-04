import { digest } from "../core/canonical.js";
import { validateCandidate } from "../compiler/candidate.js";
import { assertCommercialComparisonFreeze } from "./commercial-comparison.js";

const SECRET_KEYS = /(^|[-_])(api[-_]?key|password|secret|token|credential|private[-_]?key)($|[-_])/i;
const SAFE_ENVIRONMENTS = new Set(["disposable-sandbox", "customer-local-test", "approved-live"]);

function requireCondition(condition, message) { if (!condition) throw new Error(message); }

function assertNoSecrets(value, path = "specialist") {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEYS.test(key) && String(child ?? "").trim()) throw new Error(`Credentials cannot be stored in a specialist bundle: ${path}.${key}`);
    assertNoSecrets(child, `${path}.${key}`);
  }
}

function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }

export function assertCommercialComparisonResult(result) {
  requireCondition(result?.schemaVersion === "das.commercial-comparison-result.v1", "Unsupported commercial comparison result");
  requireCondition(result.resultHash && digest(withoutHash(result, "resultHash")) === result.resultHash, "Commercial comparison result integrity mismatch");
  requireCondition(result.contractFreezeHash && result.selectedParticipantId, "Commercial comparison result is incomplete");
  requireCondition(result.repeatability?.runs >= 3 && result.repeatability.summaries?.length === result.repeatability.runs, "Commercial selection needs at least three fresh repeat runs");
  requireCondition(result.repeatability.summaries.every((item) => item.passRate === 1 && item.unsafeAttempts === 0 && item.incorrectSideEffects === 0), "Commercial selection failed repeatability or safety");
  return true;
}

export function importCommercialCurrentAgent({ candidate: rawCandidate, brief, source = {} }) {
  assertNoSecrets(rawCandidate, "currentAgent");
  const candidate = structuredClone(rawCandidate);
  delete candidate.fingerprint;
  candidate.provenance = {
    kind: "customer-import",
    sourceSystem: String(source.system ?? "customer-supplied"),
    sourceVersion: String(source.version ?? candidate.version ?? "unknown"),
    sourceConfigurationHash: String(source.configurationHash ?? digest(rawCandidate)),
    importedAt: String(source.importedAt ?? "not-recorded"),
  };
  const validation = validateCandidate(candidate, brief);
  requireCondition(validation.valid, `Imported current agent is incompatible with the frozen role: ${validation.reasons.join(",")}`);
  return Object.freeze({ schemaVersion: "das.commercial-agent-import.v1", sourceHash: digest(rawCandidate), candidate: validation.candidate, credentialsIncluded: false, importHash: digest({ sourceHash: digest(rawCandidate), candidate: validation.candidate }) });
}

export function createCommercialSpecialistBundle({ contract, result, participant, roleDraft }) {
  assertCommercialComparisonFreeze(contract);
  assertCommercialComparisonResult(result);
  requireCondition(result.contractFreezeHash === contract.freezeHash, "Comparison result does not belong to the supplied contract");
  requireCondition(participant?.id === result.selectedParticipantId, "Selected participant does not match the comparison decision");
  const frozenParticipant = contract.participants.find((item) => item.id === participant.id);
  requireCondition(frozenParticipant && frozenParticipant.configurationHash === participant.configurationHash && frozenParticipant.runnerId === participant.runnerId, "Selected participant does not match the frozen participant");
  requireCondition(participant.candidate?.fingerprint === participant.configurationHash, "Selected candidate fingerprint does not match the frozen configuration");
  requireCondition(roleDraft?.compiled?.brief?.id === participant.candidate.roleId, "Selected candidate does not belong to the commercial role draft");
  assertNoSecrets(participant.candidate);
  const record = {
    schemaVersion: "das.commercial-specialist-bundle.v1",
    status: "recommended-not-active",
    role: {
      id: roleDraft.compiled.brief.id,
      title: roleDraft.compiled.brief.role,
      outcome: structuredClone(roleDraft.compiled.brief.outcome),
      roleDraftHash: digest(roleDraft.compiled.brief),
    },
    selected: { participantId: participant.id, type: participant.type, label: participant.label, candidate: structuredClone(participant.candidate) },
    authority: structuredClone(participant.candidate.authority),
    verifier: structuredClone(participant.candidate.verifier),
    runtime: { runnerId: participant.runnerId, candidateVersion: participant.candidate.version },
    evidence: {
      contractFreezeHash: contract.freezeHash,
      resultHash: result.resultHash,
      decision: result.decision,
      improvementAssessment: structuredClone(result.improvementAssessment),
      repeatability: structuredClone(result.repeatability),
      spendUsd: result.spendUsd,
    },
    credentialPolicy: "Credentials remain customer-side and are not part of this bundle.",
  };
  record.bundleHash = digest(record);
  return Object.freeze(record);
}

export function assertCommercialSpecialistBundle(bundle) {
  requireCondition(bundle?.schemaVersion === "das.commercial-specialist-bundle.v1", "Unsupported commercial specialist bundle");
  requireCondition(bundle.bundleHash && digest(withoutHash(bundle, "bundleHash")) === bundle.bundleHash, "Commercial specialist bundle integrity mismatch");
  requireCondition(bundle.selected?.candidate?.fingerprint === digest(withoutHash(bundle.selected.candidate, "fingerprint")), "Bundled candidate integrity mismatch");
  assertNoSecrets(bundle);
  return true;
}

export function createCommercialActivationReceipt({ bundle, contract, environment, previousActivation = null }) {
  assertCommercialSpecialistBundle(bundle);
  assertCommercialComparisonFreeze(contract);
  requireCondition(bundle.evidence.contractFreezeHash === contract.freezeHash, "Specialist bundle was not selected under this activation contract");
  requireCondition(environment?.driverId === contract.driver.id && environment.driverVersion === contract.driver.version, "Activation driver does not match the frozen comparison driver");
  requireCondition(SAFE_ENVIRONMENTS.has(environment.kind), "Activation requires a bounded approved environment");
  requireCondition(environment.verifierId === contract.driver.verifier.id && environment.verifierStatus === "verified", "Activation requires the frozen verified independent verifier");
  requireCondition(Array.isArray(environment.systemBindings) && environment.systemBindings.length === contract.driver.systemBindings.length, "Activation system bindings are incomplete");
  const suppliedBindings = new Map(environment.systemBindings.map((item) => [item.systemId, item]));
  for (const frozen of contract.driver.systemBindings) {
    const supplied = suppliedBindings.get(frozen.systemId);
    requireCondition(supplied?.adapterId === frozen.adapterId && supplied?.adapterVersion === frozen.adapterVersion && supplied.status === "verified", `Activation binding changed for ${frozen.systemId}`);
  }
  const receipt = {
    schemaVersion: "das.commercial-activation-receipt.v1",
    status: "controlled-active",
    bundleHash: bundle.bundleHash,
    participantId: bundle.selected.participantId,
    roleId: bundle.role.id,
    environment: structuredClone(environment),
    previousActivationHash: previousActivation?.activationHash ?? null,
    rollbackTargetHash: previousActivation?.bundleHash ?? null,
    evidenceBoundary: "Controlled activation record. Continued safety and performance require independently verified runtime observations.",
  };
  receipt.activationHash = digest(receipt);
  return Object.freeze(receipt);
}

export function createCommercialRollbackReceipt({ active, target }) {
  requireCondition(active?.status === "controlled-active" && active.activationHash === digest(withoutHash(active, "activationHash")), "Active deployment receipt is invalid");
  assertCommercialSpecialistBundle(target);
  requireCondition(active.roleId === target.role.id, "Rollback target belongs to a different role");
  const receipt = {
    schemaVersion: "das.commercial-rollback-receipt.v1",
    status: "rollback-authorized",
    fromActivationHash: active.activationHash,
    fromBundleHash: active.bundleHash,
    toBundleHash: target.bundleHash,
    roleId: active.roleId,
    reason: "Explicit rollback to an integrity-checked prior specialist bundle.",
  };
  receipt.rollbackHash = digest(receipt);
  return Object.freeze(receipt);
}

export function exportCommercialSpecialistBundle(bundle) {
  assertCommercialSpecialistBundle(bundle);
  return `${JSON.stringify(bundle, null, 2)}\n`;
}
