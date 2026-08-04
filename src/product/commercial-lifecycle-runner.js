import { digest } from "../core/canonical.js";
import { sealVerifiedObservation } from "../lifecycle/verified-monitor.js";

const MODES = new Set(["disposable", "shadow-no-authority", "canary", "live"]);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function countArrayEntries(state, keys) {
  return keys.reduce((total, key) => total + (Array.isArray(state?.[key]) ? state[key].length : 0), 0);
}

/**
 * Adapts a real disposable business-world strategy and its independent verifier
 * to the generic Level 1.5 lifecycle contract. Shadow runs execute only inside
 * a fresh isolated world: their hypothetical sandbox writes are recorded for
 * audit, while committed customer/business writes remain hard-zero.
 */
export function createCommercialLifecycleRunner({
  roleId,
  verifierId,
  evaluate,
  strategyFor,
  actionCollections,
  countSandboxWrites = null,
  unsafeCheckNames = [],
  now = () => Date.now(),
}) {
  requireCondition(roleId && verifierId, "Commercial lifecycle runner requires a role and verifier binding");
  requireCondition(typeof evaluate === "function" && typeof strategyFor === "function", "Commercial lifecycle runner requires executable strategy and verifier bindings");
  requireCondition((Array.isArray(actionCollections) && actionCollections.length > 0) || typeof countSandboxWrites === "function", "Commercial lifecycle runner requires explicit business-write accounting");

  return async ({ candidate, taskId, task, executionMode, canaryFraction = null }) => {
    requireCondition(candidate?.roleId === roleId, "Commercial lifecycle candidate belongs to another role");
    requireCondition(task?.id === taskId, "Commercial lifecycle task ID must match the frozen case payload");
    requireCondition(MODES.has(executionMode), "Commercial lifecycle execution mode is unsupported");
    if (executionMode === "canary") requireCondition(canaryFraction > 0 && canaryFraction <= .25, "Commercial lifecycle canary fraction is invalid");

    const strategy = strategyFor(candidate);
    requireCondition(strategy?.id && typeof strategy.run === "function", `No executable strategy is bound to ${candidate.id}`);
    const startedAt = now();
    const result = await evaluate(strategy, structuredClone(task));
    const elapsedMs = Math.max(0, now() - startedAt);
    const verification = result?.verification;
    requireCondition(verification && typeof verification.passed === "boolean", "Commercial lifecycle execution lacks independent verification");
    requireCondition(result.caseId === taskId, "Commercial lifecycle verifier returned the wrong case");

    const state = result.externalState ?? {};
    const deniedAttempts = Array.isArray(state.deniedAttempts) ? state.deniedAttempts.length : 0;
    const incorrectSideEffect = verification.recoveryClass === "incorrect-side-effect"
      || unsafeCheckNames.some((name) => verification.checks?.[name] === false);
    const sandboxWritesExecuted = countSandboxWrites
      ? Number(countSandboxWrites({ state: structuredClone(state), result: structuredClone(result), task: structuredClone(task) }))
      : countArrayEntries(state, actionCollections);
    requireCondition(Number.isInteger(sandboxWritesExecuted) && sandboxWritesExecuted >= 0, "Commercial lifecycle write accounting returned an invalid count");
    const businessWritesCommitted = executionMode === "shadow-no-authority" ? 0 : sandboxWritesExecuted;
    const verificationReceiptHash = digest({
      roleId,
      verifierId,
      taskId,
      strategyId: strategy.id,
      resolution: result.resolution,
      verification,
      externalStateHash: digest(state),
    });

    return sealVerifiedObservation({
      roleId,
      specialistId: candidate.id,
      specialistVersion: candidate.version,
      caseId: taskId,
      verifierKind: "independent-external-state",
      verifierBinding: verifierId,
      verificationReceiptHash,
      verificationPassed: verification.passed,
      outcomeScore: Number(verification.outcomeScore ?? (verification.passed ? 1 : 0)),
      unsafeAttempts: deniedAttempts + (incorrectSideEffect ? 1 : 0),
      modelCostUsd: 0,
      elapsedMs,
      toolCalls: sandboxWritesExecuted,
      humanInterventions: result.resolution?.kind === "handoff" ? 1 : 0,
      executionMode,
      businessWritesCommitted,
      sandboxWritesExecuted,
      canaryFraction: executionMode === "canary" ? canaryFraction : null,
      deterministicStrategyId: strategy.id,
      evidenceBoundary: executionMode === "shadow-no-authority"
        ? "The challenger ran in a fresh isolated disposable world. It received no customer-write authority; sandbox writes are audit-only counterfactual evidence."
        : "The strategy ran against a fresh disposable synthetic business world and was checked by its independent external-state verifier.",
    });
  };
}
