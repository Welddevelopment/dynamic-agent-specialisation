import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }

export function assertCommercialLifecycleSummary(summary) {
  requireCondition(summary?.schemaVersion === "das.commercial-level15-rehearsal.v1", "Unsupported commercial lifecycle summary");
  const payload = structuredClone(summary);
  const expected = payload.summaryHash;
  delete payload.summaryHash;
  requireCondition(expected && digest(payload) === expected, "Commercial lifecycle summary integrity mismatch");
  requireCondition(summary.status === "completed" && Array.isArray(summary.roles) && summary.roles.length === 3, "Commercial lifecycle rehearsal is incomplete");
  requireCondition(Object.values(summary.checks ?? {}).every(Boolean), "Commercial lifecycle aggregate checks did not all pass");
  for (const role of summary.roles) {
    requireCondition(role.role && role.roleId && role.requestId, "Commercial lifecycle role identity is incomplete");
    requireCondition(role.requestSpendLimitUsd === 0, "Commercial lifecycle rehearsal unexpectedly authorized spend");
    requireCondition(role.offline?.allPassed === true && role.offline.observations >= 2, "Commercial lifecycle offline gate is incomplete");
    requireCondition(role.shadow?.customerWritesCommitted === 0 && role.shadow.observations >= 2, "Commercial lifecycle shadow gate is unsafe or incomplete");
    requireCondition(role.canary?.maximumShareRespected === true && role.canary.challengerDispatches >= 2, "Commercial lifecycle canary gate is incomplete");
    requireCondition(role.rollback?.restoredCandidateId === role.activeCandidateId, "Commercial lifecycle rollback did not restore the prior specialist");
  }
  return true;
}

export function loadCommercialLifecycleConsoleState(filePath = "artifacts/commercial/level15-rehearsal-v1/summary.json") {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return null;
  try {
    const summary = JSON.parse(fs.readFileSync(resolved, "utf8"));
    assertCommercialLifecycleSummary(summary);
    return {
      status: "completed",
      integrity: "valid",
      summaryHash: summary.summaryHash,
      roles: summary.roles.map((role) => ({
        role: role.role,
        roleId: role.roleId,
        branch: role.branch,
        requestSpendLimitUsd: role.requestSpendLimitUsd,
        offlineObservations: role.offline.observations,
        shadowObservations: role.shadow.observations,
        shadowCustomerWrites: role.shadow.customerWritesCommitted,
        canaryFraction: role.canary.authorizedFraction,
        canaryDispatches: role.canary.challengerDispatches,
        canaryTotal: role.canary.totalDispatches,
        regressionAction: role.regression.action,
        restoredCandidateId: role.rollback.restoredCandidateId,
      })),
      boundary: "Executable local lifecycle mechanics in disposable fictional worlds. Challengers were prepared deterministic fixtures, not fresh model-generated improvements or customer traffic.",
      nextGate: "Run a separately approved fresh model-backed drift campaign, then send that exact challenger through these gates.",
    };
  } catch (error) {
    return { status: "invalid", integrity: "invalid", error: error instanceof Error ? error.message : String(error), roles: [] };
  }
}

