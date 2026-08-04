import test from "node:test";
import assert from "node:assert/strict";
import { assertCommercialComparisonFreeze } from "../src/product/commercial-comparison.js";
import { CommercialProcurementToolHost, CommercialProcurementVerifier, createCommercialProcurementPack, preflightCommercialProcurementPack } from "../src/product/commercial-procurement-pack.js";
import { commercialProcurementCases } from "../src/product/commercial-procurement-cases.js";

test("commercial procurement pack is activation-ready without pretending a model comparison ran", () => {
  const pack = createCommercialProcurementPack();
  assert.equal(pack.readiness.stages.activation.ready, true);
  assert.equal(assertCommercialComparisonFreeze(pack.contract), true);
  assert.equal(pack.unseenVault.releaseCount(), 0);
  assert.deepEqual(Object.fromEntries(Object.entries(commercialProcurementCases).map(([stage, cases]) => [stage, cases.length])), { development: 5, validation: 2, adversarial: 3, unseen: 2 });
  assert.equal(pack.participants.filter((item) => item.type === "compiler-candidate").length, 4);
  assert.ok(pack.participants.some((item) => item.type === "current-agent"));
  assert.ok(pack.participants.some((item) => item.type === "strong-general"));
  assert.ok(pack.participants.some((item) => item.type === "ordinary-manual"));
  assert.ok(pack.participants.some((item) => item.type === "expert-manual"));
  assert.equal(pack.contract.thresholds.minimumCostReduction, .1);
  assert.equal(pack.contract.thresholds.minimumSpeedReduction, .1);
});

test("commercial procurement tools are namespaced and translated only through the verified driver", async () => {
  const task = commercialProcurementCases.development[0];
  const host = new CommercialProcurementToolHost({ task });
  assert.ok(host.definitions().every((tool) => tool.name.startsWith("procurement-sandbox:")));
  const policy = await host.execute("procurement-sandbox:read-purchasing-policy", {});
  assert.equal(policy.output.task.demandBatchId, task.id);
  assert.throws(() => host.execute("other-system:read-purchasing-policy", {}), /outside the procurement driver/);
});

test("commercial procurement verifier separates missing work from incorrect side effects", async () => {
  const task = commercialProcurementCases.development[0];
  const host = new CommercialProcurementToolHost({ task });
  const verifier = new CommercialProcurementVerifier({ task, initialState: host.initialState() });
  const missing = await verifier.verify({ externalState: host.externalState(), resolution: { kind: "complete", blocker: null } });
  assert.equal(missing.passed, false);
  assert.equal(missing.recoveryClass, "missing-outcome");
  const incorrectState = host.externalState();
  incorrectState.deniedAttempts.push({ tool: "protected-write" });
  const incorrect = await verifier.verify({ externalState: incorrectState, resolution: { kind: "complete", blocker: null } });
  assert.equal(incorrect.passed, false);
  assert.equal(incorrect.recoveryClass, "incorrect-side-effect");
});

test("zero-cost commercial procurement preflight passes the reference and rejects shortcuts", async () => {
  const { receipt } = await preflightCommercialProcurementPack();
  assert.equal(receipt.deterministicReference.passed, 12);
  assert.equal(receipt.deterministicReference.successRate, 1);
  assert.ok(receipt.shortcutControls.every((item) => item.successRate < 1));
  assert.equal(receipt.unseenReleaseCount, 0);
  assert.equal(receipt.modelCalls, 0);
  assert.equal(receipt.spendUsd, 0);
  assert.match(receipt.receiptHash, /^[a-f0-9]{64}$/);
});
