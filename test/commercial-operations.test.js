import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digest } from "../src/core/canonical.js";
import { CommercialComparisonRunner } from "../src/product/commercial-comparison-runner.js";
import { CommercialSpecialistOperations, createCommercialOperationsContract } from "../src/product/commercial-operations.js";
import { createCommercialProcurementPack } from "../src/product/commercial-procurement-pack.js";
import { createCommercialActivationReceipt, createCommercialSpecialistBundle } from "../src/product/commercial-specialist-lifecycle.js";

async function activationFixture() {
  const pack = createCommercialProcurementPack();
  const runner = new CommercialComparisonRunner({ evaluate: async ({ participant, caseId, verifierId }) => ({ verifierId, independentlyVerified: true, passed: true, outcomeScore: 1, unsafeAttempts: 0, incorrectSideEffects: 0, modelCostUsd: participant.id.endsWith("1") ? .001 : .004, elapsedMs: 40, humanInterventions: 0, receiptHash: `${participant.id}:${caseId}` }) });
  const result = await runner.run({ contract: pack.contract, unseenVault: pack.unseenVault, participants: pack.participants });
  const participant = pack.participants.find((item) => item.id === result.selectedParticipantId);
  const bundle = createCommercialSpecialistBundle({ contract: pack.contract, result, participant, roleDraft: pack.roleDraft });
  const activation = createCommercialActivationReceipt({ bundle, contract: pack.contract, environment: { kind: "disposable-sandbox", driverId: pack.contract.driver.id, driverVersion: pack.contract.driver.version, verifierId: pack.contract.driver.verifier.id, verifierStatus: "verified", systemBindings: structuredClone(pack.contract.driver.systemBindings) } });
  return { bundle, activation };
}

function receipt({ bundle, activation, id, passed = true, cost = .01, unsafe = 0, incorrect = 0 }) {
  const value = {
    schemaVersion: "das.commercial-specialist-run.v1", requestId: id, requestHash: digest(id), roleId: bundle.role.id, bundleHash: bundle.bundleHash, activationHash: activation.activationHash,
    status: passed ? "completed" : "blocked", reason: null, blocker: null,
    verification: { passed, verifierId: bundle.verifier.binding, independent: true, recoveryClass: incorrect ? "incorrect-side-effect" : passed ? "complete" : "missing-outcome", outcomeScore: passed ? 1 : 0, unsafeAttempts: unsafe, incorrectSideEffects: incorrect, checks: {} },
    execution: { businessWritesCommitted: passed ? 1 : 0 }, metering: { modelCostUsd: cost, elapsedMs: 100, modelElapsedMs: 80 }, evidenceBoundary: "test",
  };
  value.runReceiptHash = digest(value);
  return value;
}

test("verified commercial runs persist and request bounded recomparison without authorizing spend", async () => {
  const { bundle, activation } = await activationFixture();
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "das-commercial-ops-")), "operations.json");
  const contract = createCommercialOperationsContract({ minimumObservations: 2, windowSize: 2, maximumMeanModelCostUsd: .005 });
  const operations = new CommercialSpecialistOperations({ bundle, activation, filePath, contract });
  operations.ingestRun(receipt({ bundle, activation, id: "run-1" }));
  operations.ingestRun(receipt({ bundle, activation, id: "run-2" }));
  assert.equal(operations.status().state, "recomparison-recommended");
  assert.equal(operations.status().optimizationRequest.spendAuthorized, false);
  const reloaded = new CommercialSpecialistOperations({ bundle, activation, filePath, contract });
  assert.equal(reloaded.status().observationCount, 2);
  assert.equal(reloaded.reconcileLedger([{ status: "completed", result: receipt({ bundle, activation, id: "run-1" }) }]).length, 1);
  assert.equal(reloaded.status().observationCount, 2);
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
});

test("one independently verified incorrect side effect halts the active specialist immediately", async () => {
  const { bundle, activation } = await activationFixture();
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "das-commercial-halt-")), "operations.json");
  const operations = new CommercialSpecialistOperations({ bundle, activation, filePath });
  operations.ingestRun(receipt({ bundle, activation, id: "unsafe-1", passed: false, incorrect: 1 }));
  assert.equal(operations.status().state, "halted");
  assert.throws(() => operations.assertMayRun(), /halted/);
});

test("commercial operations rejects mutation and receipts from another activation", async () => {
  const { bundle, activation } = await activationFixture();
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "das-commercial-integrity-")), "operations.json");
  const operations = new CommercialSpecialistOperations({ bundle, activation, filePath });
  const changed = receipt({ bundle, activation, id: "changed" });
  changed.metering.modelCostUsd = 99;
  assert.throws(() => operations.ingestRun(changed), /integrity mismatch/);
  operations.save();
  const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
  state.events.push({ forged: true });
  fs.writeFileSync(filePath, JSON.stringify(state));
  assert.throws(() => new CommercialSpecialistOperations({ bundle, activation, filePath }), /integrity mismatch/);
});
