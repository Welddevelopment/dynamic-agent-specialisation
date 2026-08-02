import test from "node:test";
import assert from "node:assert/strict";
import { SpecialistAgentRuntime, ScriptedDecisionEngine } from "../src/runtime/agent-runtime.js";
import { TenantRoleMemory } from "../src/runtime/memory.js";
import { EvidenceLedger } from "../src/core/evidence.js";

function candidate(overrides = {}) {
  return { id: "specialist", roleId: "role", version: "1", tools: ["read", "write"], authority: { allowedActions: ["write-record"] }, ...overrides };
}
function host() {
  const state = { value: 0 };
  return {
    definitions: () => [{ name: "read" }, { name: "write" }, { name: "admin-delete" }],
    requiredAction: (name) => name === "write" ? "write-record" : name === "admin-delete" ? "admin-delete" : null,
    execute: async (name, input) => { if (name === "write") state.value = input.value; return { id: `receipt-${name}`, output: structuredClone(state) }; },
    externalState: () => structuredClone(state),
  };
}

test("generic runtime executes allowed tools then requires external verification", async () => {
  const runtime = new SpecialistAgentRuntime({ decisionEngine: new ScriptedDecisionEngine([{ kind: "tool", name: "read", input: {} }, { kind: "tool", name: "write", input: { value: 7 } }, { kind: "complete" }]), memory: new TenantRoleMemory(), evidence: new EvidenceLedger() });
  const result = await runtime.run({ tenantId: "a", candidate: candidate(), goal: "set value", toolHost: host(), externalVerifier: { verify: async ({ externalState }) => ({ passed: externalState.value === 7, observed: externalState }) } });
  assert.equal(result.status, "completed");
  assert.equal(result.verification.observed.value, 7);
});

test("generic runtime blocks a tool absent from the candidate before host execution", async () => {
  let executed = false;
  const toolHost = host();
  const original = toolHost.execute;
  toolHost.execute = async (...args) => { executed = true; return original(...args); };
  const runtime = new SpecialistAgentRuntime({ decisionEngine: new ScriptedDecisionEngine([{ kind: "tool", name: "admin-delete", input: {} }]), memory: new TenantRoleMemory(), evidence: new EvidenceLedger() });
  const result = await runtime.run({ tenantId: "a", candidate: candidate(), goal: "unsafe", toolHost, externalVerifier: { verify: async () => ({ passed: true }) } });
  assert.equal(result.status, "blocked");
  assert.equal(executed, false);
});

test("generic runtime gives escalations to the independent verifier", async () => {
  const specialist = candidate();
  const world = host();
  const verifier = { verify: async ({ resolution }) => ({ passed: resolution.kind === "handoff" && resolution.blocker === "approval-required" }) };
  const runtime = new SpecialistAgentRuntime({ decisionEngine: new ScriptedDecisionEngine([{ kind: "escalate", blocker: "approval-required", reason: "Delegated authority is insufficient." }]), memory: new TenantRoleMemory(), evidence: new EvidenceLedger() });
  const result = await runtime.run({ tenantId: "tenant-a", candidate: specialist, goal: "procure", toolHost: world, externalVerifier: verifier });
  assert.equal(result.status, "handoff");
  assert.equal(result.verification.passed, true);
});

test("generic runtime stops repeated identical reads instead of spending forever", async () => {
  const candidate = { roleId: "loop-test", version: "1", id: "looping", tools: ["read"], authority: { allowedActions: [] } };
  const decisions = Array.from({ length: 6 }, () => ({ kind: "tool", name: "read", input: {} }));
  const toolHost = { definitions: () => [{ name: "read", inputSchema: {} }], requiredAction: () => null, execute: async () => ({ id: "read", output: { unchanged: true } }), externalState: () => ({}) };
  const verifier = { verify: async () => ({ passed: false }) };
  const runtime = new SpecialistAgentRuntime({ decisionEngine: new ScriptedDecisionEngine(decisions), memory: new TenantRoleMemory(), evidence: new EvidenceLedger(), maxTurns: 8, maxRepeatedIdenticalRead: 2 });
  const result = await runtime.run({ tenantId: "tenant", candidate, goal: "Read once", toolHost, externalVerifier: verifier });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "repeated-identical-read:read");
  assert.equal(result.session.toolReceipts.length, 2);
});

test("memory remains isolated by tenant, role, and specialist version", () => {
  const memory = new TenantRoleMemory();
  memory.append({ tenantId: "a", roleId: "r", specialistVersion: "1", record: { secret: "a-only" } });
  assert.equal(memory.read({ tenantId: "b", roleId: "r", specialistVersion: "1" }).length, 0);
  assert.equal(memory.read({ tenantId: "a", roleId: "r", specialistVersion: "2" }).length, 0);
  assert.equal(memory.read({ tenantId: "a", roleId: "r", specialistVersion: "1" })[0].secret, "a-only");
});
