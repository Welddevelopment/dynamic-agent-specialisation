import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { TenantRoleMemory } from "../runtime/memory.js";
import { ScriptedDecisionEngine, SpecialistAgentRuntime } from "../runtime/agent-runtime.js";
import { CommercialComparisonRunner } from "../product/commercial-comparison-runner.js";
import { createDurableCommercialSpecialistHost } from "../product/commercial-durable-host.js";
import { createCommercialLocalSidecar, createCommercialSidecarDispatcher } from "../product/commercial-local-sidecar.js";
import { loadCommercialLocalPackage, prepareCommercialLocalPackage } from "../product/commercial-local-package.js";
import { CommercialSpecialistOperations } from "../product/commercial-operations.js";
import { commercialProcurementCases } from "../product/commercial-procurement-cases.js";
import { CommercialProcurementToolHost, CommercialProcurementVerifier, createCommercialProcurementPack } from "../product/commercial-procurement-pack.js";
import { DurableCommercialRunLedger } from "../product/commercial-run-ledger.js";
import { createCommercialSpecialistInvoker } from "../product/commercial-specialist-interop.js";
import { createCommercialActivationReceipt, createCommercialSpecialistBundle } from "../product/commercial-specialist-lifecycle.js";

const pack = createCommercialProcurementPack();
const comparison = new CommercialComparisonRunner({ evaluate: async ({ participant, caseId, verifierId }) => ({
  verifierId,
  independentlyVerified: true,
  passed: true,
  outcomeScore: 1,
  unsafeAttempts: 0,
  incorrectSideEffects: 0,
  modelCostUsd: participant.id === "commercial-procurement-candidate-1" ? .001 : .004,
  elapsedMs: participant.id === "commercial-procurement-candidate-1" ? 40 : 100,
  humanInterventions: 0,
  receiptHash: `deterministic-lifecycle:${participant.id}:${caseId}`,
}) });
const comparisonResult = await comparison.run({ contract: pack.contract, unseenVault: pack.unseenVault, participants: pack.participants });
const participant = pack.participants.find((item) => item.id === comparisonResult.selectedParticipantId);
const bundle = createCommercialSpecialistBundle({ contract: pack.contract, result: comparisonResult, participant, roleDraft: pack.roleDraft });
const activation = createCommercialActivationReceipt({ bundle, contract: pack.contract, environment: {
  kind: "disposable-sandbox",
  driverId: pack.contract.driver.id,
  driverVersion: pack.contract.driver.version,
  verifierId: pack.contract.driver.verifier.id,
  verifierStatus: "verified",
  systemBindings: structuredClone(pack.contract.driver.systemBindings),
} });

const packageDirectory = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "das-network-rehearsal-")), "customer-local");
prepareCommercialLocalPackage({ directory: packageDirectory, bundle, activation });
const localPackage = loadCommercialLocalPackage({ directory: packageDirectory });
const task = commercialProcurementCases.development[0];
const decisions = [
  { kind: "tool", name: "procurement-sandbox:list-demands", input: { warehouseId: "wh-london", dueOnOrBefore: "2026-08-05" } },
  { kind: "tool", name: "procurement-sandbox:read-inventory", input: { warehouseId: null, sku: "sku-021" } },
  { kind: "tool", name: "procurement-sandbox:list-open-purchase-orders", input: { warehouseId: "wh-london", sku: "sku-021" } },
  { kind: "tool", name: "procurement-sandbox:list-stock-transfers", input: { sku: "sku-021" } },
  { kind: "tool", name: "procurement-sandbox:read-purchasing-policy", input: {} },
  { kind: "tool", name: "procurement-sandbox:list-supplier-offers", input: { sku: "sku-021" } },
  { kind: "tool", name: "procurement-sandbox:draft-purchase-order", input: { warehouseId: "wh-london", sku: "sku-021", quantity: 6, offerId: "commercial-offer-21", idempotencyKey: "network-rehearsal:sku-021" } },
  { kind: "complete" },
];
const runtime = new SpecialistAgentRuntime({ decisionEngine: new ScriptedDecisionEngine(decisions), memory: new TenantRoleMemory() });
let activeHost = null;
let activeVerifier = null;
const invoker = createCommercialSpecialistInvoker({
  bundle: localPackage.bundle,
  activation: localPackage.activation,
  runtime,
  tenantId: "fictional-distributor",
  createRunBindings: () => {
    activeHost = new CommercialProcurementToolHost({ task });
    activeVerifier = new CommercialProcurementVerifier({ task, initialState: activeHost.initialState() });
    return { toolHost: activeHost, externalVerifier: activeVerifier };
  },
});
const ledger = new DurableCommercialRunLedger({ filePath: localPackage.ledgerPath, roleId: bundle.role.id, bundleHash: bundle.bundleHash, activationHash: activation.activationHash, processEpoch: "network-rehearsal-v1" });
const operations = new CommercialSpecialistOperations({ bundle, activation, filePath: localPackage.operationsPath });
const durableHost = createDurableCommercialSpecialistHost({ bundle, activation, invoker, ledger, operations, reconcileUnknown: async () => ({ classification: "unknown", independent: true, verifierId: bundle.verifier.binding }) });
const dispatch = createCommercialSidecarDispatcher({ host: durableHost, bundle, activation, accessToken: localPackage.accessToken });
const sidecar = createCommercialLocalSidecar({ dispatch });
const address = await sidecar.listen({ hostname: "127.0.0.1", port: 0 });

let firstResponse;
let statusResponse;
let duplicateResponse;
let operationsResponse;
try {
  const url = `http://127.0.0.1:${address.port}`;
  const headers = { authorization: `Bearer ${localPackage.accessToken}`, "content-type": "application/json" };
  firstResponse = await fetch(`${url}/v1/runs`, { method: "POST", headers, body: JSON.stringify({ requestId: "procurement-network-rehearsal-1", goal: task.goal }) });
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 200, JSON.stringify(first));
  assert.equal(first.status, "completed");
  assert.equal(first.result.verification.passed, true);
  statusResponse = await fetch(`${url}/v1/runs/procurement-network-rehearsal-1`, { headers });
  const status = await statusResponse.json();
  duplicateResponse = await fetch(`${url}/v1/runs`, { method: "POST", headers, body: JSON.stringify({ requestId: "procurement-network-rehearsal-1", goal: task.goal }) });
  const duplicate = await duplicateResponse.json();
  operationsResponse = await fetch(`${url}/v1/operations`, { headers });
  const operationsStatus = await operationsResponse.json();
  assert.equal(statusResponse.status, 200);
  assert.equal(duplicateResponse.status, 200);
  assert.equal(operationsResponse.status, 200);
  assert.equal(operationsStatus.state, "operating");
  assert.equal(operationsStatus.observationCount, 1);
  assert.equal(status.recordHash, first.recordHash);
  assert.equal(duplicate.recordHash, first.recordHash);
  assert.equal(first.attempt, 1);

  const receipt = {
    schemaVersion: "das.commercial-procurement-network-rehearsal.v1",
    roleId: bundle.role.id,
    contractFreezeHash: pack.contract.freezeHash,
    bundleHash: bundle.bundleHash,
    activationHash: activation.activationHash,
    packageReady: localPackage.diagnostics.ready,
    packageGateCount: localPackage.diagnostics.gates.length,
    loopbackOnly: address.address === "127.0.0.1",
    dynamicPort: true,
    httpStatuses: { submit: firstResponse.status, status: statusResponse.status, duplicate: duplicateResponse.status, operations: operationsResponse.status },
    run: { status: first.status, attempt: first.attempt, verificationPassed: first.result.verification.passed, recoveryClass: first.result.verification.recoveryClass, modelCostUsd: first.result.metering.modelCostUsd, duplicateSuppressed: duplicate.recordHash === first.recordHash },
    operations: { state: operationsStatus.state, observationCount: operationsStatus.observationCount, spendAuthorized: operationsStatus.optimizationRequest?.spendAuthorized ?? false },
    intendedBusinessWrites: activeHost.externalState().purchaseOrders.filter((item) => item.idempotencyKey === "network-rehearsal:sku-021").length,
    incorrectSideEffects: first.result.verification.recoveryClass === "incorrect-side-effect" ? 1 : 0,
    modelCalls: 0,
    spendUsd: 0,
    evidenceBoundary: "Disposable fictional end-to-end network rehearsal using a deterministic scripted decision path. It validates packaging, activation, runtime, independent external-state verification, durable status and duplicate suppression; it is not a fresh model comparison or customer evidence.",
  };
  receipt.receiptHash = digest(receipt);
  const output = path.resolve("artifacts/commercial/procurement-v1/network-activation-rehearsal.json");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} finally {
  await sidecar.close();
}
