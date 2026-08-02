import { digest } from "../core/canonical.js";
import { validateCandidate } from "../compiler/candidate.js";
import { TargetDrivenImprovementController } from "../optimization/improvement-controller.js";

function assertFiniteNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a finite non-negative number`);
}

function validateMeasurements({ rows, candidate, binding, contract }) {
  if (!Array.isArray(rows)) throw new Error("Role evaluator must return an array of measurements");
  const expected = [...binding.developmentCaseIds].sort();
  const observed = rows.map((row) => row.caseId).sort();
  if (new Set(observed).size !== observed.length) throw new Error("Development evaluator returned duplicate case IDs");
  if (digest(expected) !== digest(observed)) throw new Error("Development evaluator crossed the frozen case boundary");
  if (rows.length < contract.limits.minimumRepeatedObservations) throw new Error("Development evaluator returned too few repeated observations");
  for (const row of rows) {
    if (row.candidateId !== candidate.id || row.candidateFingerprint !== candidate.fingerprint) throw new Error("Measurement does not belong to the evaluated candidate");
    if (row.verifierId !== binding.verifierId || row.verifierKind !== "independent-external-state") throw new Error("Measurement lacks the bound independent verifier receipt");
    if (typeof row.verification?.passed !== "boolean" || row.passed !== row.verification.passed) throw new Error("Measurement and independent verifier disagree");
    if (typeof row.passed !== "boolean") throw new Error("Measurement pass result is missing");
    for (const [label, value] of [["unsafe attempts", row.unsafeAttempts], ["outcome score", row.outcomeScore], ["model cost", row.modelCostUsd], ["elapsed time", row.elapsedMs]]) assertFiniteNonNegative(value, label);
    if (row.outcomeScore > 1) throw new Error("Outcome score cannot exceed one");
  }
  return rows;
}

function validateBoundedCandidate(candidate, brief) {
  const payload = structuredClone(candidate);
  delete payload.fingerprint;
  return validateCandidate(payload, brief);
}

function validatePortfolio(candidates, binding, baseline) {
  if (!Array.isArray(candidates) || candidates.length === 0) throw new Error("No bounded challenger candidates were supplied");
  const fingerprints = new Set();
  return candidates.map((candidate) => {
    const validation = validateBoundedCandidate(candidate, binding.role.brief);
    if (!validation.valid) throw new Error(`Challenger failed role contract: ${validation.reasons.join(",")}`);
    if (validation.candidate.fingerprint === baseline.fingerprint) throw new Error("Active specialist cannot challenge itself");
    if (fingerprints.has(validation.candidate.fingerprint)) throw new Error("Duplicate challenger fingerprint");
    fingerprints.add(validation.candidate.fingerprint);
    return validation.candidate;
  });
}

function assertBudget(binding, contract, startedSpendUsd) {
  const snapshot = binding.budgetSnapshot();
  assertFiniteNonNegative(snapshot.hardLimitUsd, "Runner hard budget");
  assertFiniteNonNegative(snapshot.spentUsd, "Runner spend");
  assertFiniteNonNegative(snapshot.reservedUsd ?? 0, "Runner reserved spend");
  if (snapshot.hardLimitUsd > contract.limits.maximumModelSpendUsd) throw new Error("Role runner hard budget exceeds the approved optimization contract");
  const campaignSpend = snapshot.spentUsd - startedSpendUsd;
  if (campaignSpend < 0 || campaignSpend + (snapshot.reservedUsd ?? 0) > contract.limits.maximumModelSpendUsd) throw new Error("Role runner crossed the approved optimization budget");
  return snapshot;
}

/**
 * Joins a drift-triggered coordinator request to the existing bounded optimizer.
 * A role binding owns only development cases, an independent verifier, and a
 * budget guard. It receives no validation/adversarial/unseen case material.
 */
export function createJoinedOptimizationRunner({ registry, roleBindings, evidence = null, now = () => Date.now() }) {
  const bindings = roleBindings instanceof Map ? roleBindings : new Map(Object.entries(roleBindings ?? {}));
  return async ({ request, baselineSelection }) => {
    const binding = bindings.get(request.roleId);
    if (!binding) throw new Error(`No optimization binding exists for role: ${request.roleId}`);
    if (binding.role?.id !== request.roleId || binding.role?.brief?.id !== request.roleId) throw new Error("Role binding does not match optimization request");
    if (!Array.isArray(binding.developmentCaseIds) || binding.developmentCaseIds.length === 0) throw new Error("Role binding requires a frozen development case list");
    if (new Set(binding.developmentCaseIds).size !== binding.developmentCaseIds.length) throw new Error("Development case boundary contains duplicates");
    if (binding.verifierId !== binding.role.brief.successCriteria.verifierId) throw new Error("Role binding uses the wrong independent verifier");
    for (const method of ["sourceInitialCandidates", "evaluateDevelopment", "refine", "budgetSnapshot"]) if (typeof binding[method] !== "function") throw new Error(`Role binding is missing ${method}`);

    const current = registry.latest(request.roleId);
    if (!current || current.recordHash !== request.activeRecordHash || baselineSelection.recordHash !== request.activeRecordHash) throw new Error("Optimization request is stale relative to the active specialist");
    const baseline = current.selected.candidate;
    if (baseline.id !== request.baselineCandidateId || request.improvementContract.baselineId !== baseline.id) throw new Error("Optimization baseline does not match the active specialist");

    const initialBudget = binding.budgetSnapshot();
    assertFiniteNonNegative(initialBudget.spentUsd, "Runner starting spend");
    assertBudget(binding, request.improvementContract, initialBudget.spentUsd);
    const sourced = await binding.sourceInitialCandidates({ request: structuredClone(request), baseline: structuredClone(baseline), remainingBudgetUsd: request.improvementContract.limits.maximumModelSpendUsd });
    assertBudget(binding, request.improvementContract, initialBudget.spentUsd);
    const initialCandidates = validatePortfolio(sourced, binding, baseline);
    evidence?.append("lifecycle.optimizer-bound", { requestId: request.id, roleId: request.roleId, baselineCandidateId: baseline.id, developmentCaseDigest: digest(binding.developmentCaseIds), challengerIds: initialCandidates.map((candidate) => candidate.id), hardBudgetUsd: request.improvementContract.limits.maximumModelSpendUsd });

    const controller = new TargetDrivenImprovementController({
      contract: request.improvementContract,
      now,
      evidence,
      spentUsd: () => binding.budgetSnapshot().spentUsd,
      estimatePotential: binding.estimatePotential ?? null,
      evaluate: async (candidate, stage) => {
        const before = assertBudget(binding, request.improvementContract, initialBudget.spentUsd);
        const rows = await binding.evaluateDevelopment({ candidate: structuredClone(candidate), stage: structuredClone(stage), request: structuredClone(request), caseIds: [...binding.developmentCaseIds], remainingBudgetUsd: request.improvementContract.limits.maximumModelSpendUsd - (before.spentUsd - initialBudget.spentUsd) - (before.reservedUsd ?? 0) });
        assertBudget(binding, request.improvementContract, initialBudget.spentUsd);
        return validateMeasurements({ rows, candidate, binding, contract: request.improvementContract });
      },
      refine: async (input) => {
        const before = assertBudget(binding, request.improvementContract, initialBudget.spentUsd);
        const candidate = await binding.refine({ ...structuredClone(input), request: structuredClone(request), remainingBudgetUsd: request.improvementContract.limits.maximumModelSpendUsd - (before.spentUsd - initialBudget.spentUsd) - (before.reservedUsd ?? 0) });
        assertBudget(binding, request.improvementContract, initialBudget.spentUsd);
        if (!candidate) return null;
        const validation = validateBoundedCandidate(candidate, binding.role.brief);
        if (!validation.valid) throw new Error(`Refined challenger failed role contract: ${validation.reasons.join(",")}`);
        if (validation.candidate.fingerprint === baseline.fingerprint) throw new Error("Refinement recreated the active specialist");
        return validation.candidate;
      },
    });
    const result = await controller.run({ baseline, initialCandidates });
    const finalBudget = assertBudget(binding, request.improvementContract, initialBudget.spentUsd);
    return {
      ...result,
      lifecycleReceipt: {
        schemaVersion: "das.joined-optimization-receipt.v1",
        requestId: request.id,
        roleId: request.roleId,
        activeRecordHash: request.activeRecordHash,
        baselineCandidateId: baseline.id,
        improvementContractHash: digest(request.improvementContract),
        developmentCaseDigest: digest(binding.developmentCaseIds),
        verifierId: binding.verifierId,
        spentUsd: finalBudget.spentUsd - initialBudget.spentUsd,
        unseenCasesReleased: false,
        automaticPromotion: false,
      },
    };
  };
}
