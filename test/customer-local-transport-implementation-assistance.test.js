import test from "node:test";
import assert from "node:assert/strict";
import { digest } from "../src/core/canonical.js";
import {
  assertCustomerLocalTransportImplementationWorkPack,
  DAS026_CANONICAL_CONTROLS,
} from "../src/product/customer-local-transport-implementation-assistance.js";
import { DAS026_FRESH_FIXTURES } from "../src/experiments/das026-transport-assistance/fixtures.js";
import { runDAS026Fixture } from "../src/experiments/das026-transport-assistance/rehearsal.js";

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

test("DAS-026 creates distinct source-grounded OpenAPI and MCP work packs", async () => {
  const results = [];
  for (const fixture of DAS026_FRESH_FIXTURES) results.push(await runDAS026Fixture(fixture));
  const [openapi, mcp] = results;

  assert.equal(openapi.workPack.actionTransport.write.transportIdentity.method, "POST");
  assert.equal(openapi.workPack.actionTransport.write.transportIdentity.routeTemplate, "/return-authorizations");
  assert.equal(openapi.workPack.observerTransport.operations.every((operation) => operation.transportIdentity.method === "GET"), true);
  assert.equal(mcp.workPack.actionTransport.write.transportIdentity.serverId, "northlight-catalog-actions");
  assert.equal(mcp.workPack.actionTransport.write.operationName, "draftCatalogCorrection");
  assert.equal(mcp.workPack.observerTransport.operations.every((operation) => operation.transportIdentity.serverId === "northlight-catalog-audit"), true);

  for (const { result, workPack } of results) {
    assert.equal(result.qualification.controlsPassed, 10);
    assert.equal(result.qualification.controlsRequired, 10);
    assert.equal(result.qualification.observerWrites, 0);
    assert.equal(result.qualification.blindRetries, 0);
    assert.equal(result.qualification.lostResponseFreshRuntimeReattachments, 1);
    assert.equal(result.qualification.unexpectedIncorrectEffects, 0);
    assert.equal(workPack.classificationHooks.length, DAS026_CANONICAL_CONTROLS.length);
    assert.equal(workPack.evidenceMappings.actionEvidence.mayProveBusinessOutcome, false);
    assert.equal(workPack.observerTransport.readOnly, true);
    assert.equal(workPack.gates.customerExecutable, false);
    assert.equal(workPack.gates.activationReady, false);
    assert.equal(workPack.measurements.credentialValues, 0);
  }
  assert.notEqual(openapi.workPack.workPackHash, mcp.workPack.workPackHash);
});

test("DAS-026 revalidates protected fields instead of trusting a rehashed receipt", async () => {
  const { workPack, reconstruction } = await runDAS026Fixture(DAS026_FRESH_FIXTURES[0]);
  const weakened = structuredClone(workPack);
  weakened.evidenceMappings.actionEvidence.mayProveBusinessOutcome = true;
  weakened.workPackHash = digest(withoutHash(weakened, "workPackHash"));
  assert.throws(() => assertCustomerLocalTransportImplementationWorkPack({
    workPack: weakened,
    draftSession: reconstruction.completed,
    packageInputDraft: reconstruction.packageInputDraft,
    generatedPackage: reconstruction.generatedPackage,
    scaffoldPlan: reconstruction.scaffold.plan,
    scaffoldReceipt: reconstruction.scaffold.receipt,
  }), /independent observation|weakened/i);
});
