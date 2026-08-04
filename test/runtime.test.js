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

test("runtime preserves model-reported latency separately from local replay wall time", async () => {
  const decisionEngine = { next: async () => ({ kind: "complete", confidence: 1, metering: { actualUsd: .01, elapsedMs: 321 } }) };
  const runtime = new SpecialistAgentRuntime({ decisionEngine, memory: new TenantRoleMemory() });
  const result = await runtime.run({ tenantId: "a", candidate: candidate(), goal: "already complete", toolHost: host(), externalVerifier: { verify: async () => ({ passed: true }) } });
  assert.equal(result.status, "completed");
  assert.equal(result.session.modelCostUsd, .01);
  assert.equal(result.session.modelElapsedMs, 321);
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

test("runtime refuses a verifier that is not the candidate's bound independent checker", async () => {
  let decided = false;
  const decisionEngine = { next: async () => { decided = true; return { kind: "complete", confidence: 1 }; } };
  const specialist = candidate({ verifier: { kind: "independent-external-state", binding: "expected-verifier" } });
  const runtime = new SpecialistAgentRuntime({ decisionEngine, memory: new TenantRoleMemory(), evidence: new EvidenceLedger() });
  const result = await runtime.run({ tenantId: "a", candidate: specialist, goal: "set value", toolHost: host(), externalVerifier: { id: "wrong-verifier", verify: async () => ({ passed: true }) } });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "verifier-binding-mismatch:expected-verifier");
  assert.equal(decided, false);
});

test("runtime hides tools whose required context source is absent", async () => {
  const specialist = candidate({ context: { sources: ["safe-read"] }, tools: ["write"], authority: { allowedActions: ["write-record"] } });
  const toolHost = host();
  toolHost.definitions = () => [{ name: "write", requiredContextSources: ["write-policy"] }];
  const runtime = new SpecialistAgentRuntime({ decisionEngine: new ScriptedDecisionEngine([{ kind: "tool", name: "write", input: { value: 7 } }]), memory: new TenantRoleMemory(), evidence: new EvidenceLedger() });
  const result = await runtime.run({ tenantId: "a", candidate: specialist, goal: "set value", toolHost, externalVerifier: { verify: async () => ({ passed: false }) } });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "tool-not-allowed-or-context-missing:write");
  assert.equal(toolHost.externalState().value, 0);
});

test("runtime fail-closes below the candidate's confidence threshold before acting", async () => {
  const specialist = candidate({ escalation: { enabled: true, threshold: .8, mode: "fail closed" } });
  const decisionEngine = { next: async () => ({ kind: "tool", name: "write", input: { value: 7 }, confidence: .6, metering: { actualUsd: .001, elapsedMs: 1 } }) };
  const toolHost = host();
  const runtime = new SpecialistAgentRuntime({ decisionEngine, memory: new TenantRoleMemory(), evidence: new EvidenceLedger() });
  const result = await runtime.run({ tenantId: "a", candidate: specialist, goal: "set value", toolHost, externalVerifier: { verify: async () => ({ passed: false }) } });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "confidence-below-candidate-threshold");
  assert.equal(toolHost.externalState().value, 0);
});

test("task-scoped memory does not leak into a later run while tenant-scoped memory can be reused", () => {
  const memory = new TenantRoleMemory();
  const base = { tenantId: "tenant", roleId: "role", specialistVersion: "1" };
  memory.append({ ...base, runId: "run-1", memoryPolicy: { kind: "task-scoped" }, record: { fact: "first" } });
  assert.equal(memory.read({ ...base, runId: "run-2", memoryPolicy: { kind: "task-scoped" } }).length, 0);
  memory.append({ ...base, runId: "run-1", memoryPolicy: { kind: "tenant-scoped outcome ledger" }, record: { fact: "reusable" } });
  assert.equal(memory.read({ ...base, runId: "run-2", memoryPolicy: { kind: "tenant-scoped outcome ledger" } })[0].fact, "reusable");
});

test("runtime permits one bounded repair for independently verified missing outcomes", async () => {
  const specialist = candidate(); const world = host();
  const verifier = { verify: async ({ externalState }) => externalState.value === 7 ? { passed: true, recoveryClass: "complete", observed: externalState } : { passed: false, recoveryClass: "missing-outcome", checks: { safe: true }, itemChecks: [{ missingOutcomes: ["value:7"], incorrectOutcomes: [] }] } };
  const runtime = new SpecialistAgentRuntime({ decisionEngine: new ScriptedDecisionEngine([{ kind: "complete" }, { kind: "tool", name: "write", input: { value: 7 } }, { kind: "complete" }]), memory: new TenantRoleMemory(), evidence: new EvidenceLedger(), maxVerificationRepairRounds: 1 });
  const result = await runtime.run({ tenantId: "repair", candidate: specialist, goal: "set value", toolHost: world, externalVerifier: verifier });
  assert.equal(result.status, "completed");
  assert.equal(result.session.verificationRepairRounds, 1);
  assert.equal(result.session.observations[0].tool, "independent-verifier-feedback");
});

test("runtime never retries after an independently detected incorrect side effect", async () => {
  let decisions = 0; const world = host();
  const runtime = new SpecialistAgentRuntime({ decisionEngine: { next: async () => { decisions += 1; return { kind: "complete", confidence: 1, metering: { actualUsd: 0 } }; } }, memory: new TenantRoleMemory(), evidence: new EvidenceLedger() });
  const result = await runtime.run({ tenantId: "wrong", candidate: candidate(), goal: "safe", toolHost: world, externalVerifier: { verify: async () => ({ passed: false, recoveryClass: "incorrect-side-effect", checks: { safe: false }, itemChecks: [{ incorrectOutcomes: ["wrong-owner"] }] }) } });
  assert.equal(result.status, "verification-failed");
  assert.equal(decisions, 1);
  assert.equal(result.session.verificationRepairRounds, 0);
});

test("runtime can close a fully correct outcome through the independent verifier at a hard cost stop", async () => {
  let decisions = 0;
  const decisionEngine = { next: async () => {
    decisions += 1;
    if (decisions === 1) return { kind: "tool", name: "write", input: { value: 7 }, confidence: 1, metering: { actualUsd: .49 } };
    throw new Error("candidate-task-cost-limit-before-call");
  } };
  const verifier = { verify: async ({ externalState, resolution }) => ({ passed: externalState.value === 7 && resolution.kind === "complete", recoveryClass: externalState.value === 7 ? "complete" : "missing-outcome" }) };
  const runtime = new SpecialistAgentRuntime({ decisionEngine, memory: new TenantRoleMemory(), evidence: new EvidenceLedger() });
  const result = await runtime.run({ tenantId: "limit-complete", candidate: candidate({ limits: { maxCostPerTaskUsd: .5 } }), goal: "set value", toolHost: host(), externalVerifier: verifier });
  assert.equal(result.status, "completed");
  assert.equal(result.completionSource, "independent-limit-state-check");
  assert.equal(result.limitReason, "candidate-task-cost-limit-before-call");
});

test("runtime remains blocked at a hard limit when independent external state is incomplete", async () => {
  const decisionEngine = { next: async () => { throw new Error("candidate-task-cost-limit-before-call"); } };
  const runtime = new SpecialistAgentRuntime({ decisionEngine, memory: new TenantRoleMemory(), evidence: new EvidenceLedger() });
  const result = await runtime.run({ tenantId: "limit-blocked", candidate: candidate({ limits: { maxCostPerTaskUsd: .01 } }), goal: "set value", toolHost: host(), externalVerifier: { verify: async () => ({ passed: false, recoveryClass: "missing-outcome" }) } });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "candidate-task-cost-limit-before-call");
  assert.equal(result.verification.passed, false);
});
