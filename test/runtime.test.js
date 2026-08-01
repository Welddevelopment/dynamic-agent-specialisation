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

test("memory remains isolated by tenant, role, and specialist version", () => {
  const memory = new TenantRoleMemory();
  memory.append({ tenantId: "a", roleId: "r", specialistVersion: "1", record: { secret: "a-only" } });
  assert.equal(memory.read({ tenantId: "b", roleId: "r", specialistVersion: "1" }).length, 0);
  assert.equal(memory.read({ tenantId: "a", roleId: "r", specialistVersion: "2" }).length, 0);
  assert.equal(memory.read({ tenantId: "a", roleId: "r", specialistVersion: "1" })[0].secret, "a-only");
});

