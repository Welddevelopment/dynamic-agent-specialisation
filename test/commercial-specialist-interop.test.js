import assert from "node:assert/strict";
import test from "node:test";
import { CommercialComparisonRunner } from "../src/product/commercial-comparison-runner.js";
import { createCommercialProcurementPack } from "../src/product/commercial-procurement-pack.js";
import { commercialInteropManifest, createCommercialSpecialistInvoker, createCommercialSpecialistMcpAdapter, createLangGraphSpecialistNode } from "../src/product/commercial-specialist-interop.js";
import { assertCommercialActivationReceipt, createCommercialActivationReceipt, createCommercialSpecialistBundle } from "../src/product/commercial-specialist-lifecycle.js";

async function activatedFixture() {
  const pack = createCommercialProcurementPack();
  const runner = new CommercialComparisonRunner({ evaluate: async ({ participant, caseId, verifierId }) => ({
    verifierId, independentlyVerified: true, passed: true, outcomeScore: 1, unsafeAttempts: 0, incorrectSideEffects: 0,
    modelCostUsd: participant.id === "commercial-procurement-candidate-1" ? .001 : .004,
    elapsedMs: participant.id === "commercial-procurement-candidate-1" ? 40 : 100,
    humanInterventions: 0, receiptHash: `external-${participant.id}-${caseId}`,
  }) });
  const result = await runner.run({ contract: pack.contract, unseenVault: pack.unseenVault, participants: pack.participants });
  const participant = pack.participants.find((item) => item.id === result.selectedParticipantId);
  const bundle = createCommercialSpecialistBundle({ contract: pack.contract, result, participant, roleDraft: pack.roleDraft });
  const activation = createCommercialActivationReceipt({ bundle, contract: pack.contract, environment: {
    kind: "disposable-sandbox", driverId: pack.contract.driver.id, driverVersion: pack.contract.driver.version,
    verifierId: pack.contract.driver.verifier.id, verifierStatus: "verified", systemBindings: structuredClone(pack.contract.driver.systemBindings),
  } });
  return { pack, bundle, activation };
}

function runtimeFixture(verifierId) {
  let calls = 0;
  const runtime = { async run({ tenantId, candidate, goal, externalVerifier }) {
    calls += 1;
    assert.equal(tenantId, "tenant-a");
    assert.equal(externalVerifier.id, verifierId);
    return { status: "completed", verification: { passed: true, independent: true, verifierId, recoveryClass: "complete", checks: { goalSatisfied: true } }, session: { modelCostUsd: .01, elapsedMs: 42 } };
  } };
  const createRunBindings = () => ({ toolHost: { customerLocal: true }, externalVerifier: { id: verifierId } });
  return { runtime, createRunBindings, calls: () => calls };
}

test("activated specialist invokes through a fixed tenant without exposing raw runtime state", async () => {
  const { bundle, activation } = await activatedFixture();
  assert.equal(assertCommercialActivationReceipt(activation, { bundle }), true);
  const fixture = runtimeFixture(bundle.verifier.binding);
  const invoker = createCommercialSpecialistInvoker({ bundle, activation, runtime: fixture.runtime, createRunBindings: fixture.createRunBindings, tenantId: "tenant-a" });
  const first = await invoker.invoke({ requestId: "request-1", goal: "Cover today's approved demand." });
  const duplicate = await invoker.invoke({ requestId: "request-1", goal: "Cover today's approved demand." });
  assert.equal(first.status, "completed");
  assert.equal(first.runReceiptHash, duplicate.runReceiptHash);
  assert.equal(fixture.calls(), 1);
  assert.equal(Object.hasOwn(first, "session"), false);
  assert.equal(Object.hasOwn(first, "observations"), false);
  await assert.rejects(() => invoker.invoke({ requestId: "request-1", goal: "A conflicting goal" }), /different goal/);
});

test("LangGraph node delegates one ordinary goal without taking over authority or verification", async () => {
  const { bundle, activation } = await activatedFixture();
  const fixture = runtimeFixture(bundle.verifier.binding);
  const invoker = createCommercialSpecialistInvoker({ bundle, activation, runtime: fixture.runtime, createRunBindings: fixture.createRunBindings, tenantId: "tenant-a" });
  const node = createLangGraphSpecialistNode({ invoker });
  const update = await node({ requestId: "graph-1", goal: "Cover approved demand." });
  assert.equal(update.specialistResult.bundleHash, bundle.bundleHash);
  assert.equal(update.specialistResult.verification.independent, true);
  assert.equal(fixture.calls(), 1);
});

test("MCP adapter lists and calls only the activated specialist tool", async () => {
  const { bundle, activation } = await activatedFixture();
  const fixture = runtimeFixture(bundle.verifier.binding);
  const invoker = createCommercialSpecialistInvoker({ bundle, activation, runtime: fixture.runtime, createRunBindings: fixture.createRunBindings, tenantId: "tenant-a" });
  const adapter = createCommercialSpecialistMcpAdapter({ bundle, invoker });
  const listed = await adapter.handleJsonRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(listed.result.tools.length, 1);
  assert.equal(listed.result.tools[0].inputSchema.additionalProperties, false);
  const called = await adapter.handleJsonRpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: adapter.tool.name, arguments: { requestId: "mcp-1", goal: "Cover approved demand." } } });
  assert.equal(called.result.isError, false);
  assert.equal(called.result.structuredContent.verification.passed, true);
  const rejected = await adapter.callTool({ name: adapter.tool.name, arguments: { requestId: "mcp-2", goal: "Cover demand.", apiKey: "forbidden" } });
  assert.equal(rejected.isError, true);
  const manifest = commercialInteropManifest({ bundle, activation, mcpAdapter: adapter });
  assert.equal(manifest.supportedHosts.crewAI.status, "requires-customer-wiring");
  assert.equal(manifest.supportedHosts.mcp.transport, "customer-supplied");
});

test("interop rejects a mutated activation before the host can invoke", async () => {
  const { bundle, activation } = await activatedFixture();
  const changed = structuredClone(activation);
  changed.environment.verifierId = "self-grader";
  const fixture = runtimeFixture(bundle.verifier.binding);
  assert.throws(() => createCommercialSpecialistInvoker({ bundle, activation: changed, runtime: fixture.runtime, createRunBindings: fixture.createRunBindings, tenantId: "tenant-a" }), /integrity mismatch/);
});
