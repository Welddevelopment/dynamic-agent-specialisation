import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadCommercialLifecycleConsoleState } from "../src/console/lifecycle-state.js";

const source = path.resolve("artifacts/commercial/level15-rehearsal-v1/summary.json");

test("console exposes a sanitized integrity-checked joined commercial lifecycle", () => {
  const state = loadCommercialLifecycleConsoleState(source);
  assert.equal(state.status, "completed");
  assert.equal(state.integrity, "valid");
  assert.equal(state.roles.length, 3);
  assert.equal(state.roles.every((role) => role.shadowCustomerWrites === 0 && role.requestSpendLimitUsd === 0), true);
  assert.equal(JSON.stringify(state).includes("activationHash"), false);
});

test("console refuses a mutated joined lifecycle artifact", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "das-lifecycle-console-"));
  const target = path.join(directory, "summary.json");
  const value = JSON.parse(fs.readFileSync(source, "utf8"));
  value.roles[0].canary.challengerDispatches = 99;
  fs.writeFileSync(target, JSON.stringify(value));
  const state = loadCommercialLifecycleConsoleState(target);
  assert.equal(state.status, "invalid");
  assert.match(state.error, /integrity mismatch/);
});

