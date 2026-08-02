import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { digest } from "../src/core/canonical.js";
import { DurableSpecialistRegistry } from "../src/compiler/durable-registry.js";
import { createPiece2ModelBaselines } from "../src/evaluation/piece2-baselines.js";
import { createReplacementContract, SafeReplacementController } from "../src/lifecycle/replacement-controller.js";
import { sealVerifiedObservation } from "../src/lifecycle/verified-monitor.js";
import { LifecycleTrafficDispatcher } from "../src/lifecycle/traffic-dispatcher.js";
import { realisticProcurementBrief } from "../src/roles/realistic-procurement.js";

const role = { id: realisticProcurementBrief.id, brief: realisticProcurementBrief };
const [challenger, active] = createPiece2ModelBaselines();
const compatibility = { roleTags: realisticProcurementBrief.environment.tags, environmentTags: realisticProcurementBrief.environment.tags, policyHash: digest(realisticProcurementBrief.policies), authorityHash: digest(realisticProcurementBrief.authority), toolsHash: digest(realisticProcurementBrief.environment.tools), verifierBinding: realisticProcurementBrief.successCriteria.verifierId };

function registry() {
  const registry = new DurableSpecialistRegistry({ clock: () => "2026-08-02T00:00:00.000Z" });
  registry.registerSelection({ role, selectedCandidate: active, alternatives: [{ candidate: challenger, evidence: { candidateId: challenger.id, successRate: 1, unsafeAttempts: 0 } }], decision: "retain-existing-specialist", evidence: { candidateId: active.id, successRate: 1, unsafeAttempts: 0 }, compatibility });
  return registry;
}

function observation(candidate, taskId, mode, fraction = null, overrides = {}) {
  return sealVerifiedObservation({ roleId: role.id, specialistId: candidate.id, specialistVersion: candidate.version, caseId: taskId, verifierKind: "independent-external-state", verificationPassed: true, outcomeScore: 1, unsafeAttempts: 0, modelCostUsd: .01, elapsedMs: 10, toolCalls: 2, humanInterventions: 0, executionMode: mode, businessWritesCommitted: mode === "live" || mode === "canary" ? 1 : 0, canaryFraction: fraction, ...overrides });
}

function setup() {
  const saved = registry();
  const replacement = new SafeReplacementController({ registry: saved, role, compatibility, contract: createReplacementContract({ minimumOfflineObservations: 1, minimumShadowObservations: 2, minimumCanaryObservations: 1, maximumCanaryFraction: .1 }) });
  replacement.stage({ candidate: challenger, offlineObservations: [observation(challenger, "offline", "disposable", null, { businessWritesCommitted: 0 })] });
  replacement.beginShadow(challenger.id);
  let activeCalls = 0;
  let challengerCalls = 0;
  const options = {
    registry: saved,
    replacementController: replacement,
    runActive: async ({ candidate, taskId, executionMode }) => { activeCalls += 1; return observation(candidate, taskId, executionMode); },
    runChallenger: async ({ candidate, taskId, executionMode, canaryFraction }) => { challengerCalls += 1; return observation(candidate, taskId, executionMode, canaryFraction); },
  };
  return { saved, replacement, options, counts: () => ({ activeCalls, challengerCalls }) };
}

test("shadow dispatch runs active work and a zero-authority challenger without changing selection", async () => {
  const { saved, replacement, options } = setup();
  const dispatcher = new LifecycleTrafficDispatcher(options);
  const result = await dispatcher.dispatch({ challengerId: challenger.id, taskId: "shadow-1", task: { goal: "bounded" } });
  assert.equal(result.route, "active-plus-zero-authority-shadow");
  assert.equal(result.activeObservation.businessWritesCommitted, 1);
  assert.equal(result.challengerObservation.businessWritesCommitted, 0);
  assert.equal(replacement.state(challenger.id).shadowObservations.length, 1);
  assert.equal(saved.latest(role.id).selected.candidate.id, active.id);
});

test("stable task IDs are idempotent across dispatcher restart", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "das-traffic-"));
  const file = path.join(directory, "traffic.json");
  const { options, counts } = setup();
  const dispatcher = new LifecycleTrafficDispatcher(options);
  await dispatcher.dispatch({ challengerId: challenger.id, taskId: "same-task", task: { goal: "bounded" } });
  dispatcher.save(file);
  const before = counts();
  const restored = LifecycleTrafficDispatcher.load(file, options);
  const replay = await restored.dispatch({ challengerId: challenger.id, taskId: "same-task", task: { goal: "bounded" } });
  assert.equal(replay.replayed, true);
  assert.deepEqual(counts(), before);
});

test("canary dispatcher never exceeds the exact authorized share", async () => {
  const { replacement, options } = setup();
  const dispatcher = new LifecycleTrafficDispatcher(options);
  await dispatcher.dispatch({ challengerId: challenger.id, taskId: "shadow-1", task: {} });
  await dispatcher.dispatch({ challengerId: challenger.id, taskId: "shadow-2", task: {} });
  replacement.authorizeCanary({ candidateId: challenger.id, fraction: .1, authorizedBy: "company-owner" });
  const results = [];
  for (let index = 1; index <= 20; index += 1) results.push(await dispatcher.dispatch({ challengerId: challenger.id, taskId: `canary-${index}`, task: {} }));
  const canaries = results.filter((item) => item.route === "bounded-canary");
  assert.equal(canaries.length, 2);
  assert.equal(replacement.state(challenger.id).canaryObservations.length, 2);
  for (let index = 1; index <= results.length; index += 1) assert.ok(results.slice(0, index).filter((item) => item.route === "bounded-canary").length <= Math.floor(index * .1));
});

test("shadow evidence with a write is rejected and never counted", async () => {
  const { replacement, options } = setup();
  options.runChallenger = async ({ candidate, taskId, executionMode }) => observation(candidate, taskId, executionMode, null, { businessWritesCommitted: 1 });
  const dispatcher = new LifecycleTrafficDispatcher(options);
  await assert.rejects(() => dispatcher.dispatch({ challengerId: challenger.id, taskId: "unsafe-shadow", task: {} }), /Shadow (runner|observation) committed/);
  assert.equal(replacement.state(challenger.id).shadowObservations.length, 0);
});
