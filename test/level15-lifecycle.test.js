import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { digest } from "../src/core/canonical.js";
import { DurableSpecialistRegistry } from "../src/compiler/durable-registry.js";
import { createPiece2ModelBaselines } from "../src/evaluation/piece2-baselines.js";
import { realisticProcurementBrief } from "../src/roles/realistic-procurement.js";
import { createMonitoringContract, sealVerifiedObservation, VerifiedPerformanceMonitor } from "../src/lifecycle/verified-monitor.js";
import { createReplacementContract, SafeReplacementController } from "../src/lifecycle/replacement-controller.js";
import { ContinuousSpecializationCoordinator } from "../src/lifecycle/continuous-coordinator.js";
import { tenPercentCostAndSpeedContract } from "../src/optimization/improvement-contract.js";

const role = { id: realisticProcurementBrief.id, brief: realisticProcurementBrief };
const [strong, ordinary] = createPiece2ModelBaselines();
const compatibility = {
  roleTags: realisticProcurementBrief.environment.tags,
  environmentTags: realisticProcurementBrief.environment.tags,
  policyHash: digest(realisticProcurementBrief.policies),
  authorityHash: digest(realisticProcurementBrief.authority),
  toolsHash: digest(realisticProcurementBrief.environment.tools),
  verifierBinding: realisticProcurementBrief.successCriteria.verifierId,
};

function observation(candidate, caseId, overrides = {}) {
  return sealVerifiedObservation({
    roleId: role.id,
    specialistId: candidate.id,
    specialistVersion: candidate.version,
    caseId,
    verifierKind: "independent-external-state",
    verificationPassed: true,
    outcomeScore: 1,
    unsafeAttempts: 0,
    modelCostUsd: .01,
    elapsedMs: 1_000,
    toolCalls: 4,
    humanInterventions: 0,
    executionMode: "live",
    businessWritesCommitted: 0,
    ...overrides,
  });
}
const offlineObservation = (candidate, caseId, overrides = {}) => observation(candidate, caseId, { executionMode: "disposable", ...overrides });
const shadowObservation = (candidate, caseId, overrides = {}) => observation(candidate, caseId, { executionMode: "shadow-no-authority", businessWritesCommitted: 0, ...overrides });
const canaryObservation = (candidate, caseId, fraction = .1, overrides = {}) => observation(candidate, caseId, { executionMode: "canary", canaryFraction: fraction, ...overrides });

function registry() {
  const instance = new DurableSpecialistRegistry({ clock: () => "2026-08-02T00:00:00.000Z" });
  instance.registerSelection({ role, selectedCandidate: ordinary, alternatives: [{ candidate: strong, evidence: { candidateId: strong.id, successRate: 1, unsafeAttempts: 0 } }], decision: "retain-existing-specialist", evidence: { candidateId: ordinary.id, successRate: 1, unsafeAttempts: 0 }, compatibility });
  return instance;
}

test("monitor waits for enough independent evidence and then detects measured drift", () => {
  const monitor = new VerifiedPerformanceMonitor();
  const contract = createMonitoringContract({ minimumObservations: 3, windowSize: 3, minimumPassRate: 1, minimumOutcomeScore: .95, maximumMeanModelCostUsd: .02 });
  assert.equal(monitor.record(observation(ordinary, "m-1"), { contract }).action, "collect-more-evidence");
  monitor.record(observation(ordinary, "m-2"), { contract });
  const assessment = monitor.record(observation(ordinary, "m-3", { verificationPassed: false, outcomeScore: .5 }), { contract });
  assert.equal(assessment.action, "recommend-bounded-optimization");
  assert.ok(assessment.reasons.includes("pass-rate-drift"));
  assert.ok(assessment.reasons.includes("outcome-quality-drift"));
});

test("one independently observed unsafe attempt requests immediate quarantine", () => {
  const monitor = new VerifiedPerformanceMonitor();
  const assessment = monitor.record(observation(ordinary, "unsafe", { verificationPassed: false, outcomeScore: 0, unsafeAttempts: 1 }));
  assert.equal(assessment.action, "quarantine-active-specialist");
  assert.equal(assessment.ready, true);
});

test("replacement cannot skip offline, shadow, or explicit canary gates", () => {
  const controller = new SafeReplacementController({ registry: registry(), role, compatibility, contract: createReplacementContract({ minimumOfflineObservations: 2, minimumShadowObservations: 2, minimumCanaryObservations: 2 }) });
  assert.throws(() => controller.stage({ candidate: strong, offlineObservations: [offlineObservation(strong, "o-1")] }), /at least 2/);
  controller.stage({ candidate: strong, offlineObservations: [offlineObservation(strong, "o-1"), offlineObservation(strong, "o-2")] });
  assert.throws(() => controller.promote(strong.id), /canary-running/);
  controller.beginShadow(strong.id);
  controller.recordShadow(strong.id, shadowObservation(strong, "s-1"));
  controller.recordShadow(strong.id, shadowObservation(strong, "s-2"));
  assert.throws(() => controller.authorizeCanary({ candidateId: strong.id, fraction: .1 }), /accountable human/);
  assert.throws(() => controller.authorizeCanary({ candidateId: strong.id, fraction: .5, authorizedBy: "owner" }), /exceeds/);
});

test("proved challenger promotes through bounded canary and can roll back to the prior specialist", () => {
  const saved = registry();
  const controller = new SafeReplacementController({ registry: saved, role, compatibility, contract: createReplacementContract({ minimumOfflineObservations: 2, minimumShadowObservations: 2, minimumCanaryObservations: 2, maximumCanaryFraction: .1 }), now: () => "2026-08-02T01:00:00.000Z" });
  controller.stage({ candidate: strong, offlineObservations: [offlineObservation(strong, "o-1"), offlineObservation(strong, "o-2")] });
  controller.beginShadow(strong.id);
  controller.recordShadow(strong.id, shadowObservation(strong, "s-1"));
  controller.recordShadow(strong.id, shadowObservation(strong, "s-2"));
  controller.authorizeCanary({ candidateId: strong.id, fraction: .1, authorizedBy: "company-owner" });
  controller.recordCanary(strong.id, canaryObservation(strong, "c-1"));
  controller.recordCanary(strong.id, canaryObservation(strong, "c-2"));
  const promoted = controller.promote(strong.id);
  assert.equal(promoted.selection.selected.candidate.id, strong.id);
  assert.equal(saved.latest(role.id).selectionVersion, 2);
  assert.equal(saved.latest(role.id).alternatives.some((entry) => entry.candidate.id === ordinary.id), true);

  const monitor = new VerifiedPerformanceMonitor();
  const regression = monitor.record(observation(strong, "live-unsafe", { verificationPassed: false, outcomeScore: 0, unsafeAttempts: 1 }));
  const rolledBack = controller.rollback({ candidateId: strong.id, monitoringAssessment: regression, requestedBy: "verified-performance-monitor" });
  assert.equal(rolledBack.selection.decision, "rollback-to-proven-specialist");
  assert.equal(saved.latest(role.id).selected.candidate.id, ordinary.id);
  assert.equal(saved.latest(role.id).selectionVersion, 3);
});

test("unsafe shadow evidence quarantines a challenger before live traffic", () => {
  const controller = new SafeReplacementController({ registry: registry(), role, compatibility, contract: createReplacementContract({ minimumOfflineObservations: 2, minimumShadowObservations: 2 }) });
  controller.stage({ candidate: strong, offlineObservations: [offlineObservation(strong, "o-1"), offlineObservation(strong, "o-2")] });
  controller.beginShadow(strong.id);
  const state = controller.recordShadow(strong.id, shadowObservation(strong, "s-unsafe", { verificationPassed: false, outcomeScore: 0, unsafeAttempts: 1 }));
  assert.equal(state.stage, "quarantined");
  assert.throws(() => controller.authorizeCanary({ candidateId: strong.id, fraction: .05, authorizedBy: "owner" }), /shadow-running/);
});

test("shadow evidence cannot hide a committed write and canary evidence cannot exceed authorization", () => {
  const controller = new SafeReplacementController({ registry: registry(), role, compatibility, contract: createReplacementContract({ minimumOfflineObservations: 2, minimumShadowObservations: 1, minimumCanaryObservations: 1, maximumCanaryFraction: .1 }) });
  controller.stage({ candidate: strong, offlineObservations: [offlineObservation(strong, "o-1"), offlineObservation(strong, "o-2")] });
  controller.beginShadow(strong.id);
  assert.throws(() => controller.recordShadow(strong.id, shadowObservation(strong, "shadow-write", { businessWritesCommitted: 1 })), /Shadow observation committed/);
  controller.recordShadow(strong.id, shadowObservation(strong, "shadow-clean"));
  controller.authorizeCanary({ candidateId: strong.id, fraction: .05, authorizedBy: "owner" });
  assert.throws(() => controller.recordCanary(strong.id, canaryObservation(strong, "canary-too-large", .1)), /exceeds the authorized/);
});

test("verified monitoring evidence survives restart and rejects tampering", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "das-monitor-"));
  const file = path.join(directory, "monitor.json");
  const monitor = new VerifiedPerformanceMonitor();
  monitor.record(observation(ordinary, "persisted"));
  monitor.save(file);
  assert.equal(VerifiedPerformanceMonitor.load(file).observations().length, 1);
  const changed = JSON.parse(fs.readFileSync(file, "utf8"));
  changed.observations[0].outcomeScore = 0;
  fs.writeFileSync(file, JSON.stringify(changed));
  assert.throws(() => VerifiedPerformanceMonitor.load(file), /integrity mismatch/);
});

test("a canary resumes at the exact saved stage after restart", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "das-lifecycle-"));
  const file = path.join(directory, "lifecycle.json");
  const saved = registry();
  const contract = createReplacementContract({ minimumOfflineObservations: 2, minimumShadowObservations: 2, minimumCanaryObservations: 2, maximumCanaryFraction: .1 });
  const controller = new SafeReplacementController({ registry: saved, role, compatibility, contract, now: () => "2026-08-02T01:00:00.000Z" });
  controller.stage({ candidate: strong, offlineObservations: [offlineObservation(strong, "o-1"), offlineObservation(strong, "o-2")] });
  controller.beginShadow(strong.id);
  controller.recordShadow(strong.id, shadowObservation(strong, "s-1"));
  controller.recordShadow(strong.id, shadowObservation(strong, "s-2"));
  controller.authorizeCanary({ candidateId: strong.id, fraction: .1, authorizedBy: "company-owner" });
  controller.recordCanary(strong.id, canaryObservation(strong, "c-1"));
  controller.save(file);

  const restored = SafeReplacementController.load(file, { registry: saved, role, compatibility, contract, now: () => "2026-08-02T01:05:00.000Z" });
  assert.equal(restored.state(strong.id).stage, "canary-running");
  assert.equal(restored.state(strong.id).canaryObservations.length, 1);
  restored.recordCanary(strong.id, canaryObservation(strong, "c-2"));
  assert.equal(restored.promote(strong.id).selection.selected.candidate.id, strong.id);
});

test("performance drift creates no spending request while optional optimization is disabled", () => {
  const saved = registry();
  const coordinator = new ContinuousSpecializationCoordinator({ registry: saved });
  coordinator.configureRole({ roleId: role.id, enabled: false, monitoringContract: createMonitoringContract({ minimumObservations: 2, windowSize: 2, minimumPassRate: 1 }), improvementContract: tenPercentCostAndSpeedContract({ id: "disabled", baselineId: ordinary.id, maximumModelSpendUsd: 1 }) });
  coordinator.ingest(observation(ordinary, "d-1"));
  const result = coordinator.ingest(observation(ordinary, "d-2", { verificationPassed: false, outcomeScore: .5 }));
  assert.equal(result.assessment.action, "recommend-bounded-optimization");
  assert.equal(result.request, null);
  assert.equal(coordinator.requests().length, 0);
});

test("enabled drift creates one bounded request but cannot spend without explicit start", async () => {
  const saved = registry();
  const runner = async ({ request }) => ({ provisionalWinner: { candidate: strong }, stopReason: "target-achieved-on-development", hardBudgetUsd: request.improvementContract.limits.maximumModelSpendUsd });
  const coordinator = new ContinuousSpecializationCoordinator({ registry: saved, runner });
  coordinator.configureRole({ roleId: role.id, enabled: true, monitoringContract: createMonitoringContract({ minimumObservations: 2, windowSize: 2, minimumPassRate: 1 }), improvementContract: tenPercentCostAndSpeedContract({ id: "bounded", baselineId: ordinary.id, maximumModelSpendUsd: 1 }) });
  coordinator.ingest(observation(ordinary, "d-1"));
  const request = coordinator.ingest(observation(ordinary, "d-2", { verificationPassed: false, outcomeScore: .5 })).request;
  assert.equal(request.status, "awaiting-explicit-start");
  assert.equal(request.improvementContract.limits.maximumModelSpendUsd, 1);
  await assert.rejects(() => coordinator.start(request.id, { confirmation: "yes" }), /Explicit optimization confirmation/);
  const completed = await coordinator.start(request.id, { confirmation: "START_BOUNDED_OPTIMIZATION" });
  assert.equal(completed.status, "challenger-awaiting-offline-gate");
  assert.equal(saved.latest(role.id).selected.candidate.id, ordinary.id, "development winner must not auto-promote");
});

test("unsafe active observation halts the role until a different proven registry record exists", () => {
  const saved = registry();
  const coordinator = new ContinuousSpecializationCoordinator({ registry: saved });
  const result = coordinator.ingest(observation(ordinary, "live-unsafe", { verificationPassed: false, outcomeScore: 0, unsafeAttempts: 1 }));
  assert.equal(result.halt.specialistId, ordinary.id);
  assert.throws(() => coordinator.ingest(observation(ordinary, "after-halt")), /halted/);
  assert.throws(() => coordinator.resumeRole({ roleId: role.id, authorizedBy: "owner" }), /different proven record/);
  saved.registerSelection({ role, selectedCandidate: strong, alternatives: [{ candidate: ordinary, evidence: { candidateId: ordinary.id, successRate: 1, unsafeAttempts: 0 } }], decision: "activate-compiler-specialist", evidence: { candidateId: strong.id, successRate: 1, unsafeAttempts: 0 }, compatibility });
  assert.equal(coordinator.resumeRole({ roleId: role.id, authorizedBy: "owner" }).candidateId, strong.id);
});

test("continuous lifecycle requests, halts, events, and monitoring evidence survive restart", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "das-continuous-"));
  const file = path.join(directory, "continuous.json");
  const saved = registry();
  const coordinator = new ContinuousSpecializationCoordinator({ registry: saved });
  coordinator.configureRole({ roleId: role.id, enabled: true, monitoringContract: createMonitoringContract({ minimumObservations: 2, windowSize: 2, minimumPassRate: 1 }), improvementContract: tenPercentCostAndSpeedContract({ id: "persistent", baselineId: ordinary.id, maximumModelSpendUsd: 1 }) });
  coordinator.ingest(observation(ordinary, "p-1"));
  coordinator.ingest(observation(ordinary, "p-2", { verificationPassed: false, outcomeScore: .5 }));
  coordinator.save(file);
  const restored = ContinuousSpecializationCoordinator.load(file, { registry: saved });
  assert.equal(restored.requests().length, 1);
  assert.equal(restored.monitor.observations().length, 2);
  const changed = JSON.parse(fs.readFileSync(file, "utf8"));
  changed.requests[0].improvementContract.limits.maximumModelSpendUsd = 100;
  fs.writeFileSync(file, JSON.stringify(changed));
  assert.throws(() => ContinuousSpecializationCoordinator.load(file, { registry: saved }), /integrity mismatch/);
});
