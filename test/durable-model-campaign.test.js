import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DurableBudgetGuard, PersistentModelResponseCache } from "../src/core/durable-model-campaign.js";

test("persistent model cache survives restart and detects mutation", () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "das-model-cache-")), "cache.json");
  const request = { model: "test", input: { goal: "x" } };
  const cache = new PersistentModelResponseCache({ filePath });
  cache.set(request, { output: { kind: "complete" }, actualUsd: .1 });
  const loaded = new PersistentModelResponseCache({ filePath });
  assert.deepEqual(loaded.get(request).output, { kind: "complete" });
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  raw.entries[0].response.output.kind = "tool";
  fs.writeFileSync(filePath, JSON.stringify(raw));
  assert.throws(() => new PersistentModelResponseCache({ filePath }), /integrity mismatch/);
});

test("durable budget preserves an unsettled reservation across restart", () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "das-model-budget-")), "budget.json");
  const first = new DurableBudgetGuard({ filePath, hardLimitUsd: 1, campaignId: "campaign-1" });
  first.reserve({ provider: "test", model: "m", projectedUsd: .4, purpose: "case" });
  const second = new DurableBudgetGuard({ filePath, hardLimitUsd: 1, campaignId: "campaign-1" });
  assert.equal(second.snapshot().calls[0].status, "outcome-unknown");
  assert.equal(second.snapshot().reservedUsd, .4);
  assert.throws(() => second.reserve({ provider: "test", model: "m", projectedUsd: .7, purpose: "too-much" }), /cross hard budget/);
  second.resolveUnknown("reservation-1", { notCharged: true });
  assert.equal(second.snapshot().reservedUsd, 0);
});

test("durable budget settles exact usage and rejects a changed hard limit", () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "das-model-budget-settle-")), "budget.json");
  const budget = new DurableBudgetGuard({ filePath, hardLimitUsd: 1, campaignId: "campaign-2" });
  const reservation = budget.reserve({ provider: "test", model: "m", projectedUsd: .4, purpose: "case" });
  budget.settle(reservation.id, .25, { input_tokens: 10, output_tokens: 5 });
  assert.equal(budget.snapshot().spentUsd, .25);
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  assert.throws(() => new DurableBudgetGuard({ filePath, hardLimitUsd: 2, campaignId: "campaign-2" }), /hard limit changed/);
});

test("durable budget releases a definitively rejected provider call for safe resume", () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "das-model-budget-rejected-")), "budget.json");
  const budget = new DurableBudgetGuard({ filePath, hardLimitUsd: 1, campaignId: "campaign-3" });
  const reservation = budget.reserve({ provider: "test", model: "m", projectedUsd: .7, purpose: "case" });
  budget.reject(reservation.id, { reason: "insufficient quota", retryClass: "funding" });
  const snapshot = budget.snapshot();
  assert.equal(snapshot.spentUsd, 0);
  assert.equal(snapshot.reservedUsd, 0);
  assert.equal(snapshot.calls[0].status, "cancelled");
  assert.equal(snapshot.calls[0].retryClass, "funding");
  const reloaded = new DurableBudgetGuard({ filePath, hardLimitUsd: 1, campaignId: "campaign-3" });
  assert.equal(reloaded.snapshot().reservedUsd, 0);
  assert.doesNotThrow(() => reloaded.reserve({ provider: "test", model: "m", projectedUsd: .7, purpose: "resume-case" }));
});
