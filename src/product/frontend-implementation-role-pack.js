import { validateCandidate } from "../compiler/candidate.js";
import { createBaselines } from "../evaluation/baselines.js";
import { frontendImplementationBrief } from "../roles/frontend-implementation.js";
import { frontendImplementationCases, createFrontendImplementationHoldoutVault } from "../worlds/frontend-implementation-cases.js";
import { FrontendImplementationVerifier, FrontendImplementationWorld } from "../worlds/frontend-implementation-world.js";

export const FRONTEND_ROLE_PACK_ID = "bounded-frontend-implementation-v1";

export function createFrontendImplementationBaselines() {
  return createBaselines(frontendImplementationBrief).map((candidate) => {
    const validation = validateCandidate(candidate, frontendImplementationBrief);
    if (!validation.valid) throw new Error(`Frontend baseline ${candidate.id} is invalid: ${validation.reasons.join(",")}`);
    return validation.candidate;
  });
}

export function createFrontendImplementationRolePack() {
  const baselines = createFrontendImplementationBaselines();
  const holdoutVault = createFrontendImplementationHoldoutVault();
  return Object.freeze({
    schemaVersion: "das.frontend-role-pack.v1",
    id: FRONTEND_ROLE_PACK_ID,
    status: "local-fictional-bounded-role-pack",
    brief: frontendImplementationBrief,
    cases: frontendImplementationCases,
    holdoutVault,
    baselines,
    createToolHost: (task) => new FrontendImplementationWorld({ task }),
    createVerifier: (task, initialState) => new FrontendImplementationVerifier({ task, initialState }),
    claimBoundary: "Executable local fictional React-repository benchmark. It does not prove arbitrary Figma fidelity, real GitHub/Figma integration, customer readiness or model candidate quality.",
  });
}
