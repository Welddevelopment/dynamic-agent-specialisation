import test from "node:test";
import assert from "node:assert/strict";
import { digest } from "../src/core/canonical.js";
import { DurableSpecialistRegistry } from "../src/compiler/durable-registry.js";
import { createPiece2ModelBaselines } from "../src/evaluation/piece2-baselines.js";
import { ContinuousSpecializationCoordinator } from "../src/lifecycle/continuous-coordinator.js";
import { createJoinedOptimizationRunner } from "../src/lifecycle/optimization-runner.js";
import { createMonitoringContract, sealVerifiedObservation } from "../src/lifecycle/verified-monitor.js";
import { tenPercentCostAndSpeedContract } from "../src/optimization/improvement-contract.js";
import { realisticProcurementBrief } from "../src/roles/realistic-procurement.js";

const role = { id: realisticProcurementBrief.id, brief: realisticProcurementBrief };
const [challenger, active] = createPiece2ModelBaselines();
const compatibility = {
  roleTags: realisticProcurementBrief.environment.tags,
  environmentTags: realisticProcurementBrief.environment.tags,
  policyHash: digest(realisticProcurementBrief.policies),
  authorityHash: digest(realisticProcurementBrief.authority),
  toolsHash: digest(realisticProcurementBrief.environment.tools),
  verifierBinding: realisticProcurementBrief.successCriteria.verifierId,
};
const caseIds = ["development-a", "development-b", "development-c"];

function makeRegistry() {
  const registry = new DurableSpecialistRegistry({ clock: () => "2026-08-02T00:00:00.000Z" });
  registry.registerSelection({ role, selectedCandidate: active, alternatives: [{ candidate: challenger, evidence: { candidateId: challenger.id, successRate: 1, unsafeAttempts: 0 } }], decision: "retain-existing-specialist", evidence: { candidateId: active.id, successRate: 1, unsafeAttempts: 0 }, compatibility });
  return registry;
}

function liveObservation(candidate, caseId, overrides = {}) {
  return sealVerifiedObservation({ roleId: role.id, specialistId: candidate.id, specialistVersion: candidate.version, caseId, verifierKind: "independent-external-state", verificationPassed: true, outcomeScore: 1, unsafeAttempts: 0, modelCostUsd: .1, elapsedMs: 100, toolCalls: 5, humanInterventions: 0, executionMode: "live", businessWritesCommitted: 0, ...overrides });
}

function measurement(candidate, caseId, { cost = .08, elapsed = 80, verifierId = realisticProcurementBrief.successCriteria.verifierId } = {}) {
  return { candidateId: candidate.id, candidateFingerprint: candidate.fingerprint, caseId, passed: true, unsafeAttempts: 0, outcomeScore: 1, modelCostUsd: cost, elapsedMs: elapsed, toolCalls: 4, verifierId, verifierKind: "independent-external-state", verification: { passed: true, checks: { noDeniedAttempts: true } } };
}

function fixture({ hardLimitUsd = .5, evaluate = null } = {}) {
  const registry = makeRegistry();
  const budget = { hardLimitUsd, spentUsd: 0, reservedUsd: 0 };
  const binding = {
    role,
    developmentCaseIds: caseIds,
    verifierId: realisticProcurementBrief.successCriteria.verifierId,
    budgetSnapshot: () => ({ ...budget }),
    sourceInitialCandidates: async () => [challenger],
    evaluateDevelopment: evaluate ?? (async ({ candidate, caseIds: supplied }) => supplied.map((caseId) => measurement(candidate, caseId, candidate.id === active.id ? { cost: .1, elapsed: 100 } : {}))),
    refine: async () => null,
  };
  const runner = createJoinedOptimizationRunner({ registry, roleBindings: new Map([[role.id, binding]]) });
  return { registry, budget, binding, runner };
}

async function createRequest({ registry, runner, maximumModelSpendUsd = .5 }) {
  const coordinator = new ContinuousSpecializationCoordinator({ registry, runner });
  coordinator.configureRole({ roleId: role.id, enabled: true, monitoringContract: createMonitoringContract({ minimumObservations: 2, windowSize: 2, minimumPassRate: 1 }), improvementContract: tenPercentCostAndSpeedContract({ id: "joined", baselineId: active.id, maximumRounds: 2, maximumModelSpendUsd }) });
  coordinator.ingest(liveObservation(active, "live-a"));
  const request = coordinator.ingest(liveObservation(active, "live-b", { verificationPassed: false, outcomeScore: .5 })).request;
  return { coordinator, request };
}

test("drift request runs the real bounded optimizer but cannot auto-promote its development winner", async () => {
  const { registry, runner } = fixture();
  const { coordinator, request } = await createRequest({ registry, runner });
  const completed = await coordinator.start(request.id, { confirmation: "START_BOUNDED_OPTIMIZATION" });
  assert.equal(completed.status, "challenger-awaiting-offline-gate");
  assert.equal(completed.result.provisionalWinner.candidate.id, challenger.id);
  assert.equal(completed.result.lifecycleReceipt.unseenCasesReleased, false);
  assert.equal(completed.result.lifecycleReceipt.automaticPromotion, false);
  assert.equal(registry.latest(role.id).selected.candidate.id, active.id);
  const winner = completed.result.provisionalWinner.candidate;
  const payload = structuredClone(winner);
  delete payload.fingerprint;
  assert.equal(winner.fingerprint, digest(payload), "development winner must remain eligible for the durable replacement gate");
});

test("joined runner refuses a role budget broader than the approved optimization request", async () => {
  const { registry, runner } = fixture({ hardLimitUsd: 1 });
  const { coordinator, request } = await createRequest({ registry, runner, maximumModelSpendUsd: .5 });
  await assert.rejects(() => coordinator.start(request.id, { confirmation: "START_BOUNDED_OPTIMIZATION" }), /hard budget exceeds/);
});

test("joined runner rejects development-case leakage", async () => {
  const { registry, runner } = fixture({ evaluate: async ({ candidate }) => [...caseIds.slice(0, 2).map((caseId) => measurement(candidate, caseId)), measurement(candidate, "secret-unseen")] });
  const { coordinator, request } = await createRequest({ registry, runner });
  await assert.rejects(() => coordinator.start(request.id, { confirmation: "START_BOUNDED_OPTIMIZATION" }), /crossed the frozen case boundary/);
});

test("joined runner rejects measurements without the bound independent verifier", async () => {
  const { registry, runner } = fixture({ evaluate: async ({ candidate }) => caseIds.map((caseId) => measurement(candidate, caseId, { verifierId: "self-report" })) });
  const { coordinator, request } = await createRequest({ registry, runner });
  await assert.rejects(() => coordinator.start(request.id, { confirmation: "START_BOUNDED_OPTIMIZATION" }), /bound independent verifier/);
});
