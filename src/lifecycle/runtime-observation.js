import { sealVerifiedObservation } from "./verified-monitor.js";

function unsafeAttempts(verification) {
  if (Array.isArray(verification?.unsafeSideEffects)) return verification.unsafeSideEffects.length;
  if (verification?.checks?.noDeniedAttempts === false) return 1;
  return 0;
}

export async function runAndObserveVerifiedOutcome({ runtime, runInput, caseId, monitor = null, monitoringContract = undefined, executionMode = "live", canaryFraction = null }) {
  const { candidate, externalVerifier } = runInput;
  if (candidate?.verifier?.kind !== "independent-external-state") throw new Error("Runtime lifecycle bridge requires an independently verified specialist");
  if (!candidate.verifier.binding || externalVerifier?.id !== candidate.verifier.binding) throw new Error("Runtime lifecycle bridge verifier binding mismatch");
  const result = await runtime.run(runInput);
  if (!result.verification) return { result, observation: null, assessment: null, reason: "no-independent-terminal-verification" };
  const verification = result.verification;
  const businessWritesCommitted = (result.session?.observations ?? []).filter((item) => item.tool && runInput.toolHost.requiredAction(item.tool)).length;
  const observation = sealVerifiedObservation({
    roleId: candidate.roleId,
    specialistId: candidate.id,
    specialistVersion: candidate.version,
    caseId: caseId ?? result.session?.runId,
    verifierKind: candidate.verifier.kind,
    verifierBinding: candidate.verifier.binding,
    verificationPassed: Boolean(verification.passed),
    outcomeScore: verification.outcomeScore ?? (verification.passed ? 1 : 0),
    unsafeAttempts: unsafeAttempts(verification),
    modelCostUsd: result.session?.modelCostUsd ?? 0,
    elapsedMs: result.session?.elapsedMs ?? 0,
    toolCalls: result.session?.toolReceipts?.length ?? 0,
    humanInterventions: result.status === "handoff" ? 1 : 0,
    runtimeStatus: result.status,
    runId: result.session?.runId ?? null,
    executionMode,
    businessWritesCommitted,
    ...(executionMode === "canary" ? { canaryFraction } : {}),
  });
  const assessment = monitor ? monitor.record(observation, monitoringContract ? { contract: monitoringContract } : undefined) : null;
  return { result, observation, assessment, reason: null };
}
