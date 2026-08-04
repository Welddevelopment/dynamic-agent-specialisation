import assert from "node:assert/strict";
import test from "node:test";
import { commercialRevopsCases } from "../src/worlds/realistic-revops-cases.js";
import { CommercialRevopsToolHost, CommercialRevopsVerifier, createCommercialRevopsPack, preflightCommercialRevopsPack } from "../src/product/commercial-revops-pack.js";

test("commercial RevOps pack is activation-ready without claiming a model result", () => {
  const pack = createCommercialRevopsPack();
  assert.equal(pack.readiness.stages.activation.ready, true);
  assert.deepEqual(Object.fromEntries(Object.entries(pack.contract.cases).map(([stage, value]) => [stage, stage === "unseen" ? value.count : value.length])), { development: 5, validation: 2, adversarial: 3, unseen: 2 });
  assert.equal(pack.participants.length, 8); assert.equal(pack.unseenVault.releaseCount(), 0);
});
test("RevOps driver keeps namespaced tools and independent verifier aligned", async () => {
  const pack = createCommercialRevopsPack(); const task = commercialRevopsCases.development[0]; const host = new CommercialRevopsToolHost({ task });
  assert.equal(host.definitions().every((tool) => tool.name.startsWith("revops-sandbox:")), true);
  const verifier = new CommercialRevopsVerifier({ task, initialState: host.initialState() }); const result = await verifier.verify({ externalState: host.externalState(), resolution: { kind: "complete" } });
  assert.equal(result.independent, true); assert.equal(result.verifierId, pack.contract.driver.verifier.id); assert.equal(result.passed, false);
});
test("zero-cost RevOps preflight passes the reference and rejects shortcuts", async () => {
  const { pack, receipt } = await preflightCommercialRevopsPack(); assert.equal(receipt.deterministicReference.passed, 12); assert.equal(receipt.shortcutControls.every((item) => item.successRate < 1), true); assert.equal(receipt.modelCalls, 0); assert.equal(receipt.spendUsd, 0); assert.equal(pack.unseenVault.releaseCount(), 0);
});
