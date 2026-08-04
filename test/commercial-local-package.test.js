import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CommercialComparisonRunner } from "../src/product/commercial-comparison-runner.js";
import { createCommercialProcurementPack } from "../src/product/commercial-procurement-pack.js";
import { diagnoseCommercialLocalPackage, loadCommercialLocalPackage, prepareCommercialLocalPackage } from "../src/product/commercial-local-package.js";
import { createCommercialActivationReceipt, createCommercialSpecialistBundle } from "../src/product/commercial-specialist-lifecycle.js";

async function activatedFixture() {
  const pack = createCommercialProcurementPack();
  const runner = new CommercialComparisonRunner({ evaluate: async ({ participant, caseId, verifierId }) => ({ verifierId, independentlyVerified: true, passed: true, outcomeScore: 1, unsafeAttempts: 0, incorrectSideEffects: 0, modelCostUsd: participant.id === "commercial-procurement-candidate-1" ? .001 : .004, elapsedMs: participant.id === "commercial-procurement-candidate-1" ? 40 : 100, humanInterventions: 0, receiptHash: `${participant.id}:${caseId}` }) });
  const result = await runner.run({ contract: pack.contract, unseenVault: pack.unseenVault, participants: pack.participants });
  const participant = pack.participants.find((item) => item.id === result.selectedParticipantId);
  const bundle = createCommercialSpecialistBundle({ contract: pack.contract, result, participant, roleDraft: pack.roleDraft });
  const activation = createCommercialActivationReceipt({ bundle, contract: pack.contract, environment: { kind: "disposable-sandbox", driverId: pack.contract.driver.id, driverVersion: pack.contract.driver.version, verifierId: pack.contract.driver.verifier.id, verifierStatus: "verified", systemBindings: structuredClone(pack.contract.driver.systemBindings) } });
  return { bundle, activation };
}

test("commercial package is private, exact-bound, ready and credential-redacted", async () => {
  const { bundle, activation } = await activatedFixture();
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "das-package-"));
  const directory = path.join(parent, "customer-local");
  const token = "this-is-a-32-byte-private-package-token";
  const prepared = prepareCommercialLocalPackage({ directory, bundle, activation, accessToken: token });
  const diagnostics = diagnoseCommercialLocalPackage({ directory });
  const loaded = loadCommercialLocalPackage({ directory });
  assert.equal(diagnostics.ready, true);
  assert.equal(loaded.bundle.bundleHash, bundle.bundleHash);
  assert.equal(loaded.accessToken, token);
  assert.equal(JSON.stringify(prepared.receipt).includes(token), false);
  assert.equal(fs.statSync(path.join(directory, "access-token")).mode & 0o777, 0o600);
});

test("commercial package refuses overwrite and detects changed bundle", async () => {
  const { bundle, activation } = await activatedFixture();
  const directory = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "das-package-tamper-")), "customer-local");
  prepareCommercialLocalPackage({ directory, bundle, activation });
  assert.throws(() => prepareCommercialLocalPackage({ directory, bundle, activation }), /refuse to overwrite/);
  const bundlePath = path.join(directory, "specialist-bundle.json");
  const changed = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  changed.role.title = "Changed after activation";
  fs.writeFileSync(bundlePath, JSON.stringify(changed), { mode: 0o600 });
  const diagnostics = diagnoseCommercialLocalPackage({ directory });
  assert.equal(diagnostics.ready, false);
  assert.equal(diagnostics.gates.find((item) => item.id === "bundle-integrity").passed, false);
  assert.throws(() => loadCommercialLocalPackage({ directory }), /not ready/);
});
