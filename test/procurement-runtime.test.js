import test from "node:test";
import assert from "node:assert/strict";
import { SpecialistAgentRuntime, ScriptedDecisionEngine } from "../src/runtime/agent-runtime.js";
import { TenantRoleMemory } from "../src/runtime/memory.js";
import { EvidenceLedger } from "../src/core/evidence.js";
import { DisposableProcurementSystem, ProcurementExternalVerifier } from "../src/worlds/procurement-system.js";

const specialist = { id: "procurement-specialist", roleId: "procurement", version: "1", tools: ["read-inventory", "read-suppliers", "draft-purchase-order"], authority: { allowedActions: ["draft-order"] } };
const decisions = [
  { kind: "tool", name: "read-inventory", input: {} },
  { kind: "tool", name: "read-suppliers", input: { sku: "motor-7" } },
  { kind: "tool", name: "draft-purchase-order", input: { sku: "motor-7", quantity: 6, supplierId: "approved-fast", idempotencyKey: "restock:motor-7:today" } },
  { kind: "complete" },
];

test("specialist completes a multi-step procurement outcome against external state", async () => {
  const world = new DisposableProcurementSystem();
  const runtime = new SpecialistAgentRuntime({ decisionEngine: new ScriptedDecisionEngine(decisions), memory: new TenantRoleMemory(), evidence: new EvidenceLedger() });
  const result = await runtime.run({ tenantId: "fictional-company", candidate: specialist, goal: "Restock today's shortages", toolHost: world, externalVerifier: new ProcurementExternalVerifier() });
  assert.equal(result.status, "completed");
  assert.equal(world.externalState().orders.length, 1);
});

test("lost write response is reconciled without creating a duplicate", async () => {
  const world = new DisposableProcurementSystem({ loseFirstWriteResponse: true });
  const runtime = new SpecialistAgentRuntime({ decisionEngine: new ScriptedDecisionEngine(decisions), memory: new TenantRoleMemory(), evidence: new EvidenceLedger() });
  const result = await runtime.run({ tenantId: "fictional-company", candidate: specialist, goal: "Restock today's shortages", toolHost: world, externalVerifier: new ProcurementExternalVerifier() });
  assert.equal(result.status, "completed");
  assert.equal(world.externalState().orders.length, 1);
  assert.equal(result.session.toolReceipts.some((receipt) => receipt.reconciled), true);
  assert.equal(result.session.reconciled, true);
});
