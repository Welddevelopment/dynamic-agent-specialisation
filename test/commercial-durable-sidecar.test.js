import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CommercialComparisonRunner } from "../src/product/commercial-comparison-runner.js";
import { createDurableCommercialSpecialistHost } from "../src/product/commercial-durable-host.js";
import { createCommercialSidecarDispatcher } from "../src/product/commercial-local-sidecar.js";
import { createCommercialProcurementPack } from "../src/product/commercial-procurement-pack.js";
import { DurableCommercialRunLedger } from "../src/product/commercial-run-ledger.js";
import { createCommercialSpecialistInvoker } from "../src/product/commercial-specialist-interop.js";
import { createCommercialActivationReceipt, createCommercialSpecialistBundle } from "../src/product/commercial-specialist-lifecycle.js";

async function fixture({ runtimeThrows = false, epoch = "process-a", filePath = null } = {}) {
  const pack = createCommercialProcurementPack();
  const runner = new CommercialComparisonRunner({ evaluate: async ({ participant, caseId, verifierId }) => ({ verifierId, independentlyVerified: true, passed: true, outcomeScore: 1, unsafeAttempts: 0, incorrectSideEffects: 0, modelCostUsd: participant.id === "commercial-procurement-candidate-1" ? .001 : .004, elapsedMs: participant.id === "commercial-procurement-candidate-1" ? 40 : 100, humanInterventions: 0, receiptHash: `${participant.id}:${caseId}` }) });
  const result = await runner.run({ contract: pack.contract, unseenVault: pack.unseenVault, participants: pack.participants });
  const participant = pack.participants.find((item) => item.id === result.selectedParticipantId);
  const bundle = createCommercialSpecialistBundle({ contract: pack.contract, result, participant, roleDraft: pack.roleDraft });
  const activation = createCommercialActivationReceipt({ bundle, contract: pack.contract, environment: { kind: "disposable-sandbox", driverId: pack.contract.driver.id, driverVersion: pack.contract.driver.version, verifierId: pack.contract.driver.verifier.id, verifierStatus: "verified", systemBindings: structuredClone(pack.contract.driver.systemBindings) } });
  let calls = 0;
  const runtime = { async run() { calls += 1; if (runtimeThrows) throw new Error("simulated lost runtime response"); return { status: "completed", verification: { passed: true, independent: true, verifierId: bundle.verifier.binding, recoveryClass: "complete", checks: { goalSatisfied: true } }, session: { modelCostUsd: 0, elapsedMs: 4 } }; } };
  const invoker = createCommercialSpecialistInvoker({ bundle, activation, runtime, tenantId: "tenant-a", createRunBindings: () => ({ toolHost: {}, externalVerifier: { id: bundle.verifier.binding } }) });
  const ledger = new DurableCommercialRunLedger({ filePath: filePath ?? path.join(fs.mkdtempSync(path.join(os.tmpdir(), "das-durable-host-")), "runs.json"), roleId: bundle.role.id, bundleHash: bundle.bundleHash, activationHash: activation.activationHash, processEpoch: epoch });
  return { bundle, activation, invoker, ledger, calls: () => calls };
}

test("durable host saves a sanitized result and suppresses duplicate execution", async () => {
  const value = await fixture();
  const host = createDurableCommercialSpecialistHost({ ...value, reconcileUnknown: async () => { throw new Error("not needed"); } });
  const first = await host.submit({ requestId: "run-1", goal: "Cover approved demand." });
  const duplicate = await host.submit({ requestId: "run-1", goal: "Cover approved demand." });
  assert.equal(first.status, "completed");
  assert.equal(first.recordHash, duplicate.recordHash);
  assert.equal(value.calls(), 1);
  assert.equal(fs.statSync(value.ledger.filePath).mode & 0o777, 0o600);
});

test("restart converts an interrupted pending run to unknown and blocks blind retry", async () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "das-durable-restart-")), "runs.json");
  const first = await fixture({ runtimeThrows: true, epoch: "process-a", filePath });
  const firstHost = createDurableCommercialSpecialistHost({ ...first, reconcileUnknown: async () => ({ classification: "not-started", independent: true, verifierId: first.bundle.verifier.binding }) });
  await assert.rejects(() => firstHost.submit({ requestId: "run-unknown", goal: "Cover demand." }), /lost runtime response/);
  assert.equal(firstHost.status("run-unknown").status, "outcome-unknown");
  const second = new DurableCommercialRunLedger({ filePath, roleId: first.bundle.role.id, bundleHash: first.bundle.bundleHash, activationHash: first.activation.activationHash, processEpoch: "process-b" });
  assert.equal(second.get("run-unknown").status, "outcome-unknown");
  const secondHost = createDurableCommercialSpecialistHost({ bundle: first.bundle, activation: first.activation, invoker: first.invoker, ledger: second, reconcileUnknown: async () => ({ classification: "not-started", independent: true, verifierId: first.bundle.verifier.binding }) });
  await assert.rejects(() => secondHost.submit({ requestId: "run-unknown", goal: "Cover demand." }), /reconcile external state/);
  const resolution = await secondHost.reconcile("run-unknown");
  assert.equal(resolution.status, "retry-authorized");
});

test("dispatcher requires authentication and exposes durable status without credentials", async () => {
  const value = await fixture();
  const host = createDurableCommercialSpecialistHost({ ...value, reconcileUnknown: async () => { throw new Error("not needed"); } });
  const token = "a-32-byte-minimum-local-access-token";
  const dispatch = createCommercialSidecarDispatcher({ host, bundle: value.bundle, activation: value.activation, accessToken: token });
  assert.equal((await dispatch({ method: "GET", pathname: "/v1/specialist" })).status, 401);
  const submitted = await dispatch({ method: "POST", pathname: "/v1/runs", authorization: `Bearer ${token}`, body: { requestId: "sidecar-1", goal: "Cover approved demand." } });
  assert.equal(submitted.status, 200);
  const status = await dispatch({ method: "GET", pathname: "/v1/runs/sidecar-1", authorization: `Bearer ${token}` });
  assert.equal(status.body.status, "completed");
  assert.equal(JSON.stringify(status.body).includes(token), false);
});

test("ledger detects on-disk mutation before restart", async () => {
  const value = await fixture();
  value.ledger.reserve({ requestId: "tamper-1", requestHash: "hash-1" });
  const raw = JSON.parse(fs.readFileSync(value.ledger.filePath, "utf8"));
  raw.records[0].status = "completed";
  fs.writeFileSync(value.ledger.filePath, JSON.stringify(raw));
  assert.throws(() => new DurableCommercialRunLedger({ filePath: value.ledger.filePath, roleId: value.bundle.role.id, bundleHash: value.bundle.bundleHash, activationHash: value.activation.activationHash, processEpoch: "process-b" }), /integrity mismatch/);
});

test("ledger rejects a forged completion receipt for another request", async () => {
  const value = await fixture();
  const request = { requestId: "bound-1", goal: "Cover demand." };
  const requestHash = value.invoker.requestHash(request);
  value.ledger.reserve({ requestId: request.requestId, requestHash });
  assert.throws(() => value.ledger.complete({ requestId: request.requestId, requestHash, result: { schemaVersion: "das.commercial-specialist-run.v1", requestHash: "other", bundleHash: value.bundle.bundleHash, activationHash: value.activation.activationHash, runReceiptHash: "forged" } }), /integrity mismatch|does not belong/);
});
