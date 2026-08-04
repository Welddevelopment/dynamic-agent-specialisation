import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digest } from "../src/core/canonical.js";
import { DurableBudgetGuard, PersistentModelResponseCache } from "../src/core/durable-model-campaign.js";
import { EvidenceLedger } from "../src/core/evidence.js";
import { inspectCommercialModelCampaignProgress } from "../src/product/model-campaign-progress.js";

test("campaign progress receipt proves cached paid work survives a funding pause without implying a result", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "das-campaign-progress-"));
  const campaignId = "fictional-commercial-campaign";
  const plan = { campaignId, planHash: digest({ campaignId, frozen: true }) };
  const budget = new DurableBudgetGuard({ filePath: path.join(root, "budget.json"), hardLimitUsd: 4, campaignId });
  const reservation = budget.reserve({ provider: "fictional", model: "model", projectedUsd: .2, purpose: "case" });
  budget.settle(reservation.id, .07, { input_tokens: 10, output_tokens: 2 });
  const rejected = budget.reserve({ provider: "fictional", model: "model", projectedUsd: .2, purpose: "case" });
  budget.reject(rejected.id, { reason: "no credits", retryClass: "funding" });
  const cache = new PersistentModelResponseCache({ filePath: path.join(root, "response-cache.json") });
  cache.set({ request: 1 }, { output: "settled" });
  const evidence = new EvidenceLedger(path.join(root, "evidence.jsonl"));
  evidence.append("commercial-comparison.case-verified", { caseId: "case-1", passed: true });
  const pause = {
    schemaVersion: "das.commercial-model-campaign-failure.v1",
    status: "paused-awaiting-funds",
    resumable: true,
    retryClass: "funding",
    campaignId,
    planHash: plan.planHash,
  };
  pause.failureHash = digest(pause);
  fs.writeFileSync(path.join(root, "latest-pause.json"), `${JSON.stringify(pause, null, 2)}\n`);
  const receipt = inspectCommercialModelCampaignProgress({ stateDirectory: root, plan });
  assert.equal(receipt.status, "paused-awaiting-funds");
  assert.equal(receipt.resumable, true);
  assert.equal(receipt.progress.spentUsd, .07);
  assert.equal(receipt.progress.settledCalls, 1);
  assert.equal(receipt.progress.cachedResponses, 1);
  assert.equal(receipt.progress.cancelledUnchargedCalls, 1);
  assert.equal(receipt.progress.unresolvedReservations, 0);
  assert.equal(receipt.progress.independentlyVerifiedCases, 1);
  assert.match(receipt.evidenceBoundary, /No participant ranking/);
  assert.equal(receipt.receiptHash, digest(Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== "receiptHash"))));
});
