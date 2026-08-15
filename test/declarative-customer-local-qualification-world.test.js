import test from "node:test";
import assert from "node:assert/strict";
import { digest } from "../src/core/canonical.js";
import {
  assertDeclarativeQualificationWorldContract,
  createDeclarativeQualificationDriverFactory,
  createDeclarativeQualificationWorldContract,
} from "../src/product/declarative-customer-local-qualification-world.js";

function fixture() {
  const assignedWork = { requestId: "req-1", idempotencyKey: "key-00000001", entityId: "entity-1" };
  const contract = createDeclarativeQualificationWorldContract({ packageIdentityHash: digest("package"), assignedWork, stableIdentityFields: ["requestId", "idempotencyKey"], requiredExactFields: ["requestId", "idempotencyKey", "entityId"], resultIdentityField: "resultId", statusField: "status", completionStatus: "draft", allowedChangedEntityKind: "draft-record", partialField: "entityId", incorrectField: "entityId", incorrectValue: "wrong", protectedStateDigest: "protected-v1" });
  const candidate = { candidateHash: digest("candidate"), action: { bindingId: "action", surfaceId: "action-surface", implementationHash: digest("action-code"), sourceHash: digest("action-source"), runtimeSchemaHash: digest("action-schema"), transportIdentityHash: digest("action-transport"), credentialAliases: ["ACTION_TOKEN_ALIAS"], operations: [{ mode: "write", authorityAction: "create-draft" }] }, observer: { observerId: "observer", surfaceId: "observer-surface", implementationHash: digest("observer-code"), sourceHash: digest("observer-source"), runtimeSchemaHash: digest("observer-schema"), transportIdentityHash: digest("observer-transport"), credentialAliases: ["OBSERVER_TOKEN_ALIAS"] } };
  const observerContract = { contractHash: digest("observer-contract"), freshness: { snapshotGeneratedAtField: "snapshotGeneratedAtMs", caughtUpThroughField: "caughtUpThroughMs" }, collateralRules: { changedEntitiesField: "changedEntities", unrelatedStateDigestField: "unrelatedStateDigest" } };
  const harnessContract = { contractHash: digest("harness"), worldImplementationHash: digest("world"), persistentStoreSchemaHash: digest("store") };
  const bridgeContract = { contractHash: digest("bridge") };
  return { assignedWork, contract, candidate, observerContract, harnessContract, bridgeContract };
}

test("declarative qualification world binds exact business facts without callbacks or production authority", () => {
  const { contract } = fixture();
  assert.equal(assertDeclarativeQualificationWorldContract(contract), true);
  assert.equal(contract.packageSpecificCallbacks, 0);
  assert.equal(contract.generatedExecutableCustomerCode, 0);
  assert.equal(contract.productionAuthorityGranted, false);
  const mutated = structuredClone(contract); mutated.completionStatus = "active";
  assert.throws(() => assertDeclarativeQualificationWorldContract(mutated), /integrity mismatch/);
});

test("declarative driver commits once and reattaches a fresh process to the same durable store after lost response", async () => {
  const { assignedWork, contract, candidate, observerContract, harnessContract, bridgeContract } = fixture();
  const factory = createDeclarativeQualificationDriverFactory({ contract });
  const testCase = { id: "lost-response", payload: { assignedWork, fault: { kind: "lost-response" }, qualificationPackageIdentityHash: contract.packageIdentityHash } };
  const driver = await factory({ testCase, candidate, observerContract, harnessContract, packageIdentityHash: contract.packageIdentityHash, bridgeContract });
  await assert.rejects(() => driver.execute({ assignedWork, fault: { kind: "lost-response" }, controlId: "lost-response" }), (error) => error.responseLost === true);
  assert.equal(driver.businessWrites(), 1);
  const restarted = await driver.restart({ testCase, candidate, observerContract, harnessContract, packageIdentityHash: contract.packageIdentityHash, bridgeContract });
  assert.notEqual(restarted.processInstanceId, driver.processInstanceId);
  assert.equal(restarted.storageIdentityHash, driver.storageIdentityHash);
  assert.equal(restarted.businessWrites(), 1);
  const evidence = await restarted.observe({ phase: "after", observerContractHash: observerContract.contractHash, controlId: "lost-response" });
  assert.equal(evidence.matches.length, 1);
  assert.equal(restarted.observerWrites(), 0);
});

