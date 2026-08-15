import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digest } from "../src/core/canonical.js";
import { runDas020Rehearsal } from "../src/experiments/das020-nonactivating-deployment/rehearsal.js";

test("DAS-020 sealed rehearsal preserves a complete signed but inactive customer-local package", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "das020-sealed-test-"));
  const outputDirectory = path.join(root, "result");
  const result = runDas020Rehearsal({ outputDirectory });
  assert.equal(result.status, "passed-private-fictional-local");
  assert.equal(result.packaging.immutableFiles, 11);
  assert.equal(result.packaging.signedManifestFiles, 11);
  assert.equal(result.packaging.signatureAlgorithm, "Ed25519");
  assert.equal(result.blockers.allResolved, false);
  assert.equal(result.runtime.freshProcessReload, true);
  assert.equal(result.runtime.rollbackStatus, "rolled-back-nonactivating");
  assert.equal(result.runtime.packageIntegrityAfterRollback, true);
  assert.equal(result.runtime.readyForNonactivatingHandoffAfterRollback, false);
  assert.equal(result.runtime.executableCustomerOperations, 0);
  assert.equal(result.runtime.customerExecutionAuthorized, false);
  assert.equal(result.runtime.activationAuthorized, false);
  assert.equal(result.attacks.passed, result.attacks.required);
  assert.equal(result.attacks.required >= 15, true);
  assert.equal(result.modelCalls, 0);
  assert.equal(result.spendUsd, 0);
  assert.equal(result.resultHash, digest(Object.fromEntries(Object.entries(result).filter(([key]) => key !== "resultHash"))));
  assert.equal(fs.statSync(outputDirectory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(outputDirectory, "result.json")).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(path.join(outputDirectory, "bundle", "release-signature.json")), true);
});

