import { digest } from "../core/canonical.js";

export function createCaseVault(roleId, cases) {
  const sealed = structuredClone(cases);
  const caseDigest = digest(sealed);
  const releases = [];
  return Object.freeze({
    digest: caseDigest,
    count: sealed.length,
    release({ freezeHash, role, candidateHashes, baselineHashes }) {
      if (!freezeHash || role !== roleId) throw new Error("Unseen vault requires a matching frozen evaluation");
      if (!candidateHashes || !Object.keys(candidateHashes).length) throw new Error("Candidates must be frozen before unseen release");
      if (!baselineHashes || !Object.keys(baselineHashes).length) throw new Error("Baselines must be frozen before unseen release");
      releases.push({ freezeHash, releasedAt: new Date().toISOString() });
      return structuredClone(sealed);
    },
    releaseCount() { return releases.length; },
  });
}

