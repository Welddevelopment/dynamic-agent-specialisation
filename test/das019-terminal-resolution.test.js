import test from "node:test";
import assert from "node:assert/strict";
import { ScriptedDecisionEngine, SpecialistAgentRuntime } from "../src/runtime/agent-runtime.js";
import { TenantRoleMemory } from "../src/runtime/memory.js";
import { EvidenceLedger } from "../src/core/evidence.js";
import { runtimeDecisionResponseFormat } from "../src/runtime/model-decision-engine.js";
import { AccessOffboardingVerifier, AccessOffboardingWorld } from "../src/worlds/access-offboarding-world.js";
import { accessOffboardingResolutionCases } from "../src/worlds/access-offboarding-cases.js";
import { importedAccessOffboardingAgent } from "../src/roles/access-offboarding.js";

const caseById = (id) => accessOffboardingResolutionCases.find((row) => row.id === id);

async function runScript(testCase, decisions, { maxTurns = 16 } = {}) {
  const world = new AccessOffboardingWorld({ task: testCase });
  const verifier = new AccessOffboardingVerifier({ task: testCase, initialState: world.initial });
  const runtime = new SpecialistAgentRuntime({
    decisionEngine: new ScriptedDecisionEngine(decisions),
    memory: new TenantRoleMemory(),
    evidence: new EvidenceLedger(),
    maxTurns,
  });
  return runtime.run({ tenantId: `das019:${testCase.id}`, candidate: importedAccessOffboardingAgent, goal: testCase.goal, toolHost: world, externalVerifier: verifier });
}

const tool = (name, input) => ({ kind: "tool", name, input });
const readPolicy = tool("read-offboarding-policy", {});
const escalateGoal = (blocker = "approval-required") => ({ kind: "escalate", escalationScope: "goal", subjectId: null, blocker, reason: "No part of this batch can be advanced." });
const escalateItem = (subjectId, blocker = "approval-required") => ({ kind: "escalate", escalationScope: "item", subjectId, blocker, reason: "This subject cannot proceed." });
const complete = { kind: "complete" };

// ─── The defect, reproduced ────────────────────────────────────────────────────

test("DEFECT 1: a goal-scoped escalation is the correct answer on a must-escalate case", async () => {
  const testCase = caseById("offboarding-res-must-escalate-policy-frozen");
  const result = await runScript(testCase, [readPolicy, escalateGoal()]);
  // Pre-fix this returned "verification-failed": correctResolution was complete-only, so a
  // correct escalation could never pass. That is the B2 winner's 11/12.
  assert.equal(result.status, "handoff");
  assert.equal(result.verification.passed, true);
  assert.equal(result.verification.checks.correctResolution, true);
  assert.equal(result.verification.expectedResolution, "goal-handoff");
});

test("DEFECT 2: an item-scoped escalation does not end the run", async () => {
  const testCase = caseById("offboarding-res-must-complete-item-blocked");
  const result = await runScript(testCase, [
    tool("list-assigned-departures", { status: "active" }),
    escalateItem("grant-kai-prod"),
    tool("revoke-access-grant", { workerId: "worker-kai", grantId: "grant-kai-chat", idempotencyKey: "kai:revoke:chat" }),
    tool("transfer-owned-resource", { workerId: "worker-kai", resourceId: "resource-kai-repo", newOwnerId: "manager-rex", idempotencyKey: "kai:transfer:repo" }),
    tool("create-access-handoff", { workerId: "worker-kai", reason: "privileged-access", subjectId: "grant-kai-prod", idempotencyKey: "kai:handoff:prod" }),
    complete,
  ]);
  // Pre-fix the item escalation terminated the run at turn 2 and nothing below it ran.
  assert.equal(result.status, "completed");
  assert.equal(result.verification.passed, true);
  assert.equal(result.session.itemEscalations.length, 1);
  assert.equal(result.session.itemEscalations[0].subjectId, "grant-kai-prod");
});

test("DEFECT 3: a run that is right about the world and wrong only about the ending is repairable", async () => {
  const testCase = caseById("offboarding-res-must-escalate-frozen-multi-worker");
  const result = await runScript(testCase, [readPolicy, complete, escalateGoal()]);
  // Pre-fix `complete` here failed terminally: recoveryClass was null, so no repair round
  // was authorized and the run died with the world state already correct.
  assert.equal(result.status, "handoff");
  assert.equal(result.verification.passed, true);
  assert.equal(result.session.verificationRepairRounds, 1);
});

// ─── The anti-gaming guard ─────────────────────────────────────────────────────

test("GUARD: escalating at goal scope on a must-complete case fails", async () => {
  for (const id of ["offboarding-res-must-complete-clear-path", "offboarding-res-must-complete-item-blocked"]) {
    const result = await runScript(caseById(id), [readPolicy, escalateGoal()]);
    assert.equal(result.status, "verification-failed", `${id} must not pass by escalating`);
    assert.equal(result.verification.checks.correctResolution, false);
  }
});

test("GUARD: resolution-only never launders a missing outcome or an unsafe write", async () => {
  const missing = await runScript(caseById("offboarding-res-must-complete-clear-path"), [readPolicy, complete, complete]);
  assert.equal(missing.status, "verification-failed");
  assert.equal(missing.verification.recoveryClass, "missing-outcome");
  assert.equal(missing.verification.checks.allAssignedHandled, false);

  // Attempting a write during a freeze is denied by the world. The runtime blocks the run
  // on the unknown tool outcome before it ever reaches a resolution, and grading that world
  // state independently yields incorrect-outcome — never resolution-only.
  const frozen = caseById("offboarding-res-must-escalate-policy-frozen");
  const world = new AccessOffboardingWorld({ task: frozen });
  const verifier = new AccessOffboardingVerifier({ task: frozen, initialState: world.initial });
  const runtime = new SpecialistAgentRuntime({
    decisionEngine: new ScriptedDecisionEngine([
      tool("revoke-access-grant", { workerId: "worker-gale", grantId: "grant-gale-chat", idempotencyKey: "gale:revoke:chat" }),
      escalateGoal(),
    ]),
    memory: new TenantRoleMemory(), evidence: new EvidenceLedger(), maxTurns: 16,
  });
  const unsafe = await runtime.run({ tenantId: "das019:unsafe", candidate: importedAccessOffboardingAgent, goal: frozen.goal, toolHost: world, externalVerifier: verifier });
  assert.equal(unsafe.status, "blocked");
  assert.match(unsafe.reason, /tool-outcome-not-started:revoke-access-grant/);
  assert.equal(world.externalState().deniedAttempts.length, 1);

  const graded = await verifier.verify({ externalState: world.externalState(), resolution: { kind: "handoff", scope: "goal" } });
  assert.equal(graded.passed, false);
  assert.equal(graded.checks.noDeniedAttempts, false);
  assert.equal(graded.recoveryClass, "incorrect-outcome");
});

test("GUARD: only one repair round exists; repeating the wrong ending still fails", async () => {
  const result = await runScript(caseById("offboarding-res-must-escalate-policy-frozen"), [readPolicy, complete, complete]);
  assert.equal(result.status, "verification-failed");
  assert.equal(result.session.verificationRepairRounds, 1);
  assert.equal(result.verification.recoveryClass, "resolution-only");
});

test("GUARD: repeated identical item escalations are stopped by the non-progress guard", async () => {
  const spam = Array.from({ length: 12 }, () => escalateItem("grant-kai-prod"));
  const result = await runScript(caseById("offboarding-res-must-complete-item-blocked"), spam);
  assert.equal(result.status, "blocked");
  assert.match(result.reason, /repeated-item-escalation|non-progress-read-limit/);
});

// ─── Existing behaviour must not move ──────────────────────────────────────────

test("must-complete cases still pass by completing correctly", async () => {
  const result = await runScript(caseById("offboarding-res-must-complete-clear-path"), [
    tool("list-assigned-departures", { status: "active" }),
    tool("revoke-access-grant", { workerId: "worker-juno", grantId: "grant-juno-crm", idempotencyKey: "juno:revoke:crm" }),
    tool("transfer-owned-resource", { workerId: "worker-juno", resourceId: "resource-juno-board", newOwnerId: "manager-quin", idempotencyKey: "juno:transfer:board" }),
    tool("suspend-identity-account", { workerId: "worker-juno", idempotencyKey: "juno:suspend" }),
    tool("mark-offboarding-complete", { workerId: "worker-juno", idempotencyKey: "juno:complete" }),
    complete,
  ]);
  assert.equal(result.status, "completed");
  assert.equal(result.verification.passed, true);
  assert.equal(result.verification.recoveryClass, null);
});

test("a legacy escalation with no declared scope stays goal-scoped and terminal", async () => {
  const result = await runScript(caseById("offboarding-res-must-escalate-policy-frozen"), [
    readPolicy,
    { kind: "escalate", blocker: "approval-required", reason: "legacy shape, no scope field" },
  ]);
  assert.equal(result.status, "handoff");
  assert.equal(result.verification.passed, true);
});

test("the decision schema requires an explicit escalation scope and subject", () => {
  const format = runtimeDecisionResponseFormat([{ name: "read-offboarding-policy", inputSchema: {} }]);
  assert.deepEqual(format.schema.properties.escalationScope.enum, ["item", "goal", null]);
  assert.ok(format.schema.required.includes("escalationScope"));
  assert.ok(format.schema.required.includes("subjectId"));
  assert.equal(format.schema.additionalProperties, false);
});
