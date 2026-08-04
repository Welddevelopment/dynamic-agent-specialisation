import assert from "node:assert/strict";
import test from "node:test";
import { commercialSupportCases } from "../src/worlds/realistic-support-cases.js";
import { CommercialSupportToolHost, CommercialSupportVerifier, createCommercialSupportPack, preflightCommercialSupportPack } from "../src/product/commercial-support-pack.js";

test("commercial support pack is activation-ready without claiming a model result", () => {
  const pack = createCommercialSupportPack();
  assert.equal(pack.readiness.stages.activation.ready, true);
  assert.deepEqual(Object.fromEntries(Object.entries(pack.contract.cases).map(([stage, value]) => [stage, stage === "unseen" ? value.count : value.length])), { development: 5, validation: 2, adversarial: 3, unseen: 2 });
  assert.equal(pack.participants.length, 8);
  assert.deepEqual(new Set(pack.participants.map((item) => item.type)), new Set(["current-agent", "strong-general", "ordinary-manual", "expert-manual", "compiler-candidate"]));
  assert.equal(pack.unseenVault.releaseCount(), 0);
});

test("support driver keeps namespaced tools and independent verifier aligned", async () => {
  const pack = createCommercialSupportPack();
  const task = commercialSupportCases.development[0];
  const host = new CommercialSupportToolHost({ task });
  assert.equal(host.definitions().every((tool) => tool.name.startsWith("support-sandbox:")), true);
  const verifier = new CommercialSupportVerifier({ task, initialState: host.initialState() });
  const result = await verifier.verify({ externalState: host.externalState(), resolution: { kind: "complete" } });
  assert.equal(result.independent, true);
  assert.equal(result.verifierId, pack.contract.driver.verifier.id);
  assert.equal(result.passed, false);
});

test("zero-cost support preflight passes the reference and rejects shortcuts", async () => {
  const { pack, receipt } = await preflightCommercialSupportPack();
  assert.equal(receipt.deterministicReference.passed, 12);
  assert.equal(receipt.shortcutControls.every((item) => item.successRate < 1), true);
  assert.equal(receipt.modelCalls, 0);
  assert.equal(receipt.spendUsd, 0);
  assert.equal(pack.unseenVault.releaseCount(), 0);
});
