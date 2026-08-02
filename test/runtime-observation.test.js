import test from "node:test";
import assert from "node:assert/strict";
import { SpecialistAgentRuntime, ScriptedDecisionEngine } from "../src/runtime/agent-runtime.js";
import { TenantRoleMemory } from "../src/runtime/memory.js";
import { EvidenceLedger } from "../src/core/evidence.js";
import { DisposableProcurementSystem, ProcurementExternalVerifier } from "../src/worlds/procurement-system.js";
import { runAndObserveVerifiedOutcome } from "../src/lifecycle/runtime-observation.js";
import { createMonitoringContract, VerifiedPerformanceMonitor } from "../src/lifecycle/verified-monitor.js";

const candidate = {
  id: "runtime-observed-procurement",
  roleId: "procurement",
  version: "1.0.0",
  tools: ["read-inventory", "read-suppliers", "draft-purchase-order"],
  context: { sources: [] },
  strategy: { requireCompleteContext: false },
  authority: { allowedActions: ["draft-order"] },
  escalation: { threshold: 0 },
  limits: { maxCostPerTaskUsd: 1, maxLatencyMs: 60_000 },
  verifier: { kind: "independent-external-state", binding: "procurement-external-v1" },
};
const decisions = [
  { kind: "tool", name: "read-inventory", input: {} },
  { kind: "tool", name: "read-suppliers", input: { sku: "motor-7" } },
  { kind: "tool", name: "draft-purchase-order", input: { sku: "motor-7", quantity: 6, supplierId: "approved-fast", idempotencyKey: "restock:motor-7:today" } },
  { kind: "complete" },
];

test("real runtime external verification becomes a sealed monitor observation", async () => {
  const runtime = new SpecialistAgentRuntime({ decisionEngine: new ScriptedDecisionEngine(decisions), memory: new TenantRoleMemory(), evidence: new EvidenceLedger() });
  const verifier = new ProcurementExternalVerifier();
  verifier.id = candidate.verifier.binding;
  const monitor = new VerifiedPerformanceMonitor();
  const result = await runAndObserveVerifiedOutcome({ runtime, runInput: { tenantId: "fictional-company", candidate, goal: "Restock today's shortages", toolHost: new DisposableProcurementSystem({ loseFirstWriteResponse: true }), externalVerifier: verifier }, caseId: "joined-runtime-case", monitor, monitoringContract: createMonitoringContract({ minimumObservations: 1, windowSize: 1, minimumPassRate: 1 }) });
  assert.equal(result.result.status, "completed");
  assert.equal(result.observation.verificationPassed, true);
  assert.equal(result.observation.unsafeAttempts, 0);
  assert.equal(result.observation.toolCalls, 3);
  assert.equal(result.assessment.action, "continue-current-specialist");
  assert.equal(monitor.observations()[0].evidenceHash, result.observation.evidenceHash);
});

test("runtime bridge refuses an unbound verifier before the task runs", async () => {
  const runtime = new SpecialistAgentRuntime({ decisionEngine: new ScriptedDecisionEngine(decisions), memory: new TenantRoleMemory(), evidence: new EvidenceLedger() });
  const verifier = new ProcurementExternalVerifier();
  verifier.id = "wrong-verifier";
  await assert.rejects(() => runAndObserveVerifiedOutcome({ runtime, runInput: { tenantId: "fictional-company", candidate, goal: "Restock", toolHost: new DisposableProcurementSystem(), externalVerifier: verifier }, caseId: "wrong" }), /verifier binding mismatch/);
});

test("a blocked run without an independent terminal verdict is not converted into performance evidence", async () => {
  const runtime = new SpecialistAgentRuntime({ decisionEngine: new ScriptedDecisionEngine([{ kind: "tool", name: "forbidden", input: {} }]), memory: new TenantRoleMemory(), evidence: new EvidenceLedger() });
  const verifier = new ProcurementExternalVerifier();
  verifier.id = candidate.verifier.binding;
  const result = await runAndObserveVerifiedOutcome({ runtime, runInput: { tenantId: "fictional-company", candidate, goal: "Restock", toolHost: new DisposableProcurementSystem(), externalVerifier: verifier }, caseId: "blocked" });
  assert.equal(result.result.status, "blocked");
  assert.equal(result.observation, null);
  assert.equal(result.reason, "no-independent-terminal-verification");
});

