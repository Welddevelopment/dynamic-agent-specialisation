import { digest } from "../../core/canonical.js";

const STAGES = Object.freeze({ viability: 2, development: 5, validation: 2, adversarial: 3, holdout: 2, repeat: 6 });

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function withoutHash(value) {
  const copy = structuredClone(value);
  delete copy.integrityHash;
  return copy;
}

export function assertCandidateScaleLiveCasePack(pack, { roleId, verifierId } = {}) {
  requireCondition(pack?.schemaVersion === "das.candidate-scale-private-case-pack.v1", "Unsupported candidate-scale private case pack");
  requireCondition(pack.integrityHash && digest(withoutHash(pack)) === pack.integrityHash, "Candidate-scale private case pack integrity mismatch");
  requireCondition(pack.roleId === roleId && pack.verifierId === verifierId, "Candidate-scale private case pack does not match the executable role/verifier");
  requireCondition(pack.freshAndUnexposed === true, "Candidate-scale live cases must be prospectively confirmed fresh and unexposed to candidates");
  const ids = new Set();
  for (const [stage, expected] of Object.entries(STAGES)) {
    const records = pack.cases?.[stage];
    requireCondition(Array.isArray(records) && records.length === expected, `Candidate-scale private ${stage} stage needs exactly ${expected} cases`);
    for (const record of records) {
      requireCondition(record && typeof record === "object" && record.id && !ids.has(record.id), `Candidate-scale ${stage} cases need globally unique ids`);
      ids.add(record.id);
    }
  }
  requireCondition(pack.baselineHashes && Object.keys(pack.baselineHashes).length >= 3, "Candidate-scale live pack must bind the current/ordinary/expert comparison baselines");
  requireCondition(pack.independentReferenceReceipt?.passed === true && pack.independentReferenceReceipt?.unsafeAttempts === 0 && pack.independentReferenceReceipt?.incorrectSideEffects === 0, "Candidate-scale live pack needs a clean independent deterministic reference receipt");
  requireCondition(pack.shortcutControlReceipt?.allShortcutsRejected === true, "Candidate-scale live pack needs rejected shortcut controls before model execution");
  return true;
}

export function candidateScaleCasePackHash(pack) {
  return digest(pack);
}

