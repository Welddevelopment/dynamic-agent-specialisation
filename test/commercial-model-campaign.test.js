import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digest } from "../src/core/canonical.js";
import { COMMERCIAL_CAMPAIGN_APPROVAL, createCommercialModelCampaignPlan, createCommercialModelCampaignRuntime } from "../src/product/commercial-model-campaign.js";
import { createCommercialProcurementPack } from "../src/product/commercial-procurement-pack.js";
import { CURRENT_MODEL_PRICING_USD } from "../src/providers/model-pricing.js";

test("commercial model plan freezes structural ceilings without authorizing spend", () => {
  const pack = createCommercialProcurementPack();
  const plan = createCommercialModelCampaignPlan({ contract: pack.contract, participants: pack.participants });
  assert.equal(plan.participantCount, 8);
  assert.equal(plan.maximumTaskEvaluations, 102);
  assert.equal(plan.maximumModelTurns, 2448);
  assert.equal(plan.contractHardSpendLimitUsd, 10);
  assert.equal(plan.gates.paidCallsDefault, "disabled");
  assert.match(plan.planHash, /^[a-f0-9]{64}$/);
});

test("commercial runtime requires all independent approval, limit, key and fresh-pricing gates", () => {
  const pack = createCommercialProcurementPack();
  const stateDirectory = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "das-commercial-model-")), "state");
  const date = new Date().toISOString().slice(0, 10);
  const complete = { DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED", DAS_COMMERCIAL_MODEL_CAMPAIGN_APPROVAL: COMMERCIAL_CAMPAIGN_APPROVAL, DAS_COMMERCIAL_MODEL_CAMPAIGN_LIMIT_USD: "2", DAS_COMMERCIAL_PRICING_VERIFIED_ON: date, DAS_COMMERCIAL_PRICING_TABLE_HASH: digest(CURRENT_MODEL_PRICING_USD), OPENAI_API_KEY: "test-key" };
  for (const key of Object.keys(complete)) {
    const environment = { ...complete };
    delete environment[key];
    assert.throws(() => createCommercialModelCampaignRuntime({ environment, contract: pack.contract, stateDirectory, fetchImpl: async () => { throw new Error("must not call network"); } }));
  }
  assert.throws(() => createCommercialModelCampaignRuntime({ environment: { ...complete, DAS_COMMERCIAL_MODEL_CAMPAIGN_LIMIT_USD: "11" }, contract: pack.contract, stateDirectory }), /within the frozen contract ceiling/);
  const runtime = createCommercialModelCampaignRuntime({ environment: complete, contract: pack.contract, stateDirectory, fetchImpl: async () => { throw new Error("must not call network"); } });
  assert.equal(runtime.budget.snapshot().hardLimitUsd, 2);
  assert.equal(runtime.cache.size(), 0);
  assert.equal(runtime.provider.enabled, true);
});
