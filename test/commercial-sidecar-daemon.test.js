import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CommercialComparisonRunner } from "../src/product/commercial-comparison-runner.js";
import { loadCommercialLocalPackage, prepareCommercialLocalPackage } from "../src/product/commercial-local-package.js";
import { createCommercialSidecarRuntime, validateCommercialCustomerBindings } from "../src/product/commercial-sidecar-daemon.js";
import { createCommercialProcurementPack } from "../src/product/commercial-procurement-pack.js";
import { createCommercialActivationReceipt, createCommercialSpecialistBundle } from "../src/product/commercial-specialist-lifecycle.js";

async function fixture() {
  const pack = createCommercialProcurementPack();
  const runner = new CommercialComparisonRunner({ evaluate: async ({ participant, caseId, verifierId }) => ({ verifierId, independentlyVerified: true, passed: true, outcomeScore: 1, unsafeAttempts: 0, incorrectSideEffects: 0, modelCostUsd: participant.id.endsWith("1") ? .001 : .004, elapsedMs: 40, humanInterventions: 0, receiptHash: `${participant.id}:${caseId}` }) });
  const result = await runner.run({ contract: pack.contract, unseenVault: pack.unseenVault, participants: pack.participants });
  const participant = pack.participants.find((item) => item.id === result.selectedParticipantId);
  const bundle = createCommercialSpecialistBundle({ contract: pack.contract, result, participant, roleDraft: pack.roleDraft });
  const activation = createCommercialActivationReceipt({ bundle, contract: pack.contract, environment: { kind: "disposable-sandbox", driverId: pack.contract.driver.id, driverVersion: pack.contract.driver.version, verifierId: pack.contract.driver.verifier.id, verifierStatus: "verified", systemBindings: structuredClone(pack.contract.driver.systemBindings) } });
  const directory = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "das-sidecar-daemon-")), "package");
  prepareCommercialLocalPackage({ directory, bundle, activation });
  return { pack, bundle, activation, directory };
}

test("customer binding contract fails closed before a sidecar can start", async () => {
  const { bundle } = await fixture();
  assert.throws(() => validateCommercialCustomerBindings({}, { bundle }), /runtime/);
  assert.throws(() => validateCommercialCustomerBindings({ runtime: { run() {} }, createRunBindings() {}, reconcileUnknown() {}, tenantId: "tenant", verifierId: "wrong" }, { bundle }), /does not match/);
});

test("one assembly call reloads package, run ledger, operations and customer bindings without listening", async () => {
  const { bundle, directory } = await fixture();
  const customerBindings = {
    tenantId: "customer-a",
    verifierId: bundle.verifier.binding,
    runtime: { async run() { return { status: "completed", verification: { passed: true, independent: true, verifierId: bundle.verifier.binding, outcomeScore: 1, recoveryClass: "complete", checks: {} }, session: { modelCostUsd: 0, modelElapsedMs: 0, elapsedMs: 0, observations: [] } }; } },
    createRunBindings: async () => ({ toolHost: { requiredAction: () => false }, externalVerifier: { id: bundle.verifier.binding } }),
    reconcileUnknown: async () => ({ classification: "unknown", independent: true, verifierId: bundle.verifier.binding }),
  };
  const assembled = await createCommercialSidecarRuntime({ packageDirectory: directory, customerBindings, processEpoch: "test-process" });
  const submitted = await assembled.dispatch({ method: "POST", pathname: "/v1/runs", authorization: `Bearer ${assembled.localPackage.accessToken}`, body: { requestId: "assembled-1", goal: "Cover approved demand." } });
  assert.equal(submitted.status, 200);
  assert.equal(assembled.operations.status().observationCount, 1);
  assert.equal(loadCommercialLocalPackage({ directory }).diagnostics.ready, true);
});
