import { digest } from "../core/canonical.js";

export function freezeEvaluation({ role, candidates, baselines }) {
  const record = {
    schemaVersion: 1, roleId: role.id,
    cases: { development: digest(role.cases.development), validation: digest(role.cases.validation), unseen: role.unseen.digest },
    candidates: Object.fromEntries(candidates.map((candidate) => [candidate.id, digest(candidate)])),
    baselines: Object.fromEntries(baselines.map((baseline) => [baseline.id, digest(baseline)])),
    verifier: digest(role.verify.toString()), compilerCoreVersion: "0.1.0",
  };
  return { ...record, freezeHash: digest(record) };
}

export function assertFreezeIntact(freeze, { role, candidates, baselines }) {
  const current = freezeEvaluation({ role, candidates, baselines });
  if (current.freezeHash !== freeze.freezeHash) throw new Error("Evaluation boundary changed after freeze");
  return true;
}
