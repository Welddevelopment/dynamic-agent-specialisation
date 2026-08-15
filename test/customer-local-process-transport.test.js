import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digest } from "../src/core/canonical.js";
import {
  assertCustomerLocalProcessEndpoint,
  createCustomerLocalProcessEndpoint,
  createCustomerLocalProcessTransportReceipt,
  createCustomerLocalSecretLeaseResolver,
} from "../src/product/customer-local-process-transport.js";
import { runDAS028Rehearsal } from "../src/experiments/das028-local-process-runtime/rehearsal.js";

function endpoint(role, port, pid, processInstanceId) {
  const packageIdentityHash = digest({ package: "das028-test" });
  return createCustomerLocalProcessEndpoint({ role, packageIdentityHash, serverIdentityHash: digest({ role, packageIdentityHash }), processInstanceId, host: "127.0.0.1", port, revision: 1, pid });
}

test("DAS-028 endpoints remain exact loopback HTTP identities", () => {
  const action = endpoint("action", 32101, 801, "action-test-process");
  assert.equal(assertCustomerLocalProcessEndpoint(action, { role: "action", host: "127.0.0.1", protocol: "http:" }), true);
  assert.throws(() => createCustomerLocalProcessEndpoint({ ...action, host: "localhost" }), /127\.0\.0\.1|DNS|host substitution/i);
  assert.throws(() => assertCustomerLocalProcessEndpoint({ ...action, protocol: "https:", tls: true, tlsVerified: true }), /integrity|HTTP-local|TLS|protocol/i);
});

test("DAS-028 receipt requires three processes and disjoint credential aliases", () => {
  const action = endpoint("action", 32111, 811, "action-test-process");
  const observer = endpoint("observer", 32112, 812, "observer-test-process");
  const secret = endpoint("secret", 32113, 813, "vault-test-process");
  const receipt = createCustomerLocalProcessTransportReceipt({ packageIdentityHash: action.packageIdentityHash, actionEndpoint: action, observerEndpoint: observer, secretEndpoint: secret, actionAlias: "TEST_ACTION_LEASE", observerAlias: "TEST_OBSERVER_LEASE", runtimeReceiptHash: digest({ runtime: 1 }) });
  assert.equal(receipt.processCount, 3);
  assert.equal(receipt.credentialValuesPresent, false);
  assert.throws(() => createCustomerLocalProcessTransportReceipt({ packageIdentityHash: action.packageIdentityHash, actionEndpoint: action, observerEndpoint: observer, secretEndpoint: secret, actionAlias: "TEST_ACTION_LEASE", observerAlias: "TEST_ACTION_LEASE", runtimeReceiptHash: digest({ runtime: 1 }) }), /collapsed/i);
});

test("DAS-028 secret resolver returns one-use opaque scoped leases", async () => {
  const packageIdentityHash = digest({ package: "lease-test" });
  let calls = 0;
  const resolver = createCustomerLocalSecretLeaseResolver({
    alias: "TEST_ACTION_LEASE",
    plane: "action",
    packageIdentityHash,
    secretClient: { async issueHandle(request) { calls += 1; assert.deepEqual(request, { alias: "TEST_ACTION_LEASE", plane: "action", packageIdentityHash }); const handle = `daslh_${"a".repeat(64)}`; return { handle, handleHash: digest(handle) }; } },
  });
  const lease = await resolver({ alias: "TEST_ACTION_LEASE", plane: "action", packageIdentityHash });
  assert.equal(await lease.use((handle) => handle.startsWith("daslh_")), true);
  await assert.rejects(() => lease.use(() => true), /single-use/i);
  assert.equal(calls, 1);
});

test("DAS-028 full fresh OpenAPI plus MCP local-process rehearsal remains green", { timeout: 30_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "das028-test-"));
  const outputRoot = path.join(root, "artifacts");
  try {
    const report = await runDAS028Rehearsal({ outputRoot });
    assert.equal(report.verdict, "passed-bounded-customer-shaped-local-process-transport");
    assert.equal(report.aggregate.controlsPassed, 20);
    assert.equal(report.aggregate.controlsRequired, 20);
    assert.equal(report.aggregate.freshProcessLostResponseRecoveries, 2);
    assert.equal(report.aggregate.lostResponseReplays, 0);
    assert.equal(report.aggregate.observerWrites, 0);
    assert.equal(report.aggregate.incorrectEffects, 0);
    assert.equal(report.aggregate.attacksPassed, report.aggregate.attacksRequired);
    assert.equal(report.aggregate.signedNonactivatingBundles, 2);
    assert.equal(report.aggregate.spendUsd, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
