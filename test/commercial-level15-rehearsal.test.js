import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCommercialLevel15Rehearsal } from "../src/product/commercial-level15-rehearsal.js";

test("all three commercial roles run the joined zero-cost replacement lifecycle against real disposable verifiers", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "das-commercial-level15-"));
  const summary = await runCommercialLevel15Rehearsal({ outputDirectory: directory });
  assert.equal(summary.roles.length, 3);
  assert.ok(Object.values(summary.checks).every(Boolean));
  assert.equal(summary.roles.every((role) => role.offline.allPassed), true);
  assert.equal(summary.roles.every((role) => role.shadow.customerWritesCommitted === 0), true);
  assert.equal(summary.roles.every((role) => role.rollback.restoredCandidateId === role.activeCandidateId), true);
  assert.equal(fs.existsSync(path.join(directory, "summary.json")), true);
  for (const role of ["procurement", "support", "revops"]) {
    for (const file of ["continuous-state.json", "replacement-state.json", "traffic-state.json", "registry-after-rollback.json", "activation-chain.json"]) assert.equal(fs.existsSync(path.join(directory, role, file)), true);
  }
});

