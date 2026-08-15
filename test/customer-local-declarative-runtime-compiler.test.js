import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digest } from "../src/core/canonical.js";
import { runDAS027Rehearsal } from "../src/experiments/das027-declarative-runtime/rehearsal.js";

test("DAS-027 compiles fresh OpenAPI and pinned-MCP packages through unchanged qualification into inactive bundles", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "das027-test-"));
  const outputRoot = path.join(root, "result");
  try {
    const report = await runDAS027Rehearsal({ outputRoot });

    assert.equal(report.verdict, "passed-bounded-declarative-disposable-runtime-compilation");
    assert.equal(report.aggregate.packages, 2);
    assert.deepEqual(report.aggregate.sourceFamilies, ["openapi", "mcp-tools-list"]);
    assert.equal(report.aggregate.generatedExecutableFiles, 4);
    assert.equal(report.aggregate.generatedExecutableOperations, 10);
    assert.equal(report.aggregate.manualPackageSpecificExecutableFiles, 0);
    assert.equal(report.aggregate.manualPackageSpecificExecutableLines, 0);
    assert.equal(report.aggregate.controlsPassed, 20);
    assert.equal(report.aggregate.controlsRequired, 20);
    assert.equal(report.aggregate.freshProcessLostResponseRecoveries, 2);
    assert.equal(report.aggregate.lostResponseReplays, 0);
    assert.equal(report.aggregate.observerWrites, 0);
    assert.equal(report.aggregate.unexpectedIncorrectEffects, 0);
    assert.equal(report.aggregate.attacksPassed, report.aggregate.attacksRequired);
    assert.equal(report.aggregate.nonactivatingBundles, 2);
    assert.equal(report.aggregate.customerExecutableOperations, 0);
    assert.equal(report.aggregate.modelCalls, 0);
    assert.equal(report.aggregate.spendUsd, 0);

    for (const run of report.runs) {
      assert.equal(run.qualification.controlsPassed, 10);
      assert.equal(run.qualification.controlsRequired, 10);
      assert.equal(run.qualification.lostResponseFreshRuntimeReattachments, 1);
      assert.equal(run.qualification.lostResponseReplays, 0);
      assert.equal(run.packaging.packageIntegrityValid, true);
      assert.equal(run.packaging.readyForNonactivatingHandoff, true);
      assert.equal(run.packaging.customerExecutionReady, false);
      assert.equal(run.packaging.activationReady, false);
      assert.equal(run.unsupported.blocked, true);
      assert.match(run.unsupported.exactWork, /unsupported type object/);
      assert.equal(run.attacks.every((attack) => attack.passed), true);
      assert.notEqual(run.identities.actionImplementationContentHash, run.identities.observerImplementationContentHash);
      assert.equal(fs.existsSync(path.join(outputRoot, run.fixtureId, "compiled-runtime", "action-plugin", "index.js")), true);
      assert.equal(fs.existsSync(path.join(outputRoot, run.fixtureId, "compiled-runtime", "observer-plugin", "index.js")), true);
      assert.equal(fs.existsSync(path.join(outputRoot, run.fixtureId, "nonactivating-bundle", "release-signature.json")), true);
    }

    assert.notEqual(report.runs[0].identities.das027RuntimeReceiptHash, report.runs[1].identities.das027RuntimeReceiptHash);
    assert.equal(report.resultHash, digest(Object.fromEntries(Object.entries(report).filter(([key]) => key !== "resultHash"))));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
