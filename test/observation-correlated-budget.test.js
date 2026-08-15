import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DurableBudgetGuard } from "../src/core/durable-model-campaign.js";
import { ObservationCorrelatedBudget, reconcileCorrelatedObservation } from "../src/experiments/candidate-scale/parallel-evaluation-correlation.js";

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

test("parallel observations retain exact reservation and spend attribution", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "das-correlated-budget-"));
  const base = new DurableBudgetGuard({ filePath: path.join(directory, "budget.json"), hardLimitUsd: 1, campaignId: "parallel-test" });
  const budget = new ObservationCorrelatedBudget({ budget: base });
  const costs = [[.011, .012], [.021, .022], [.031, .032], [.041, .042]];

  const rows = await Promise.all(costs.map((observationCosts, index) => budget.runObservation({ participantId: `p${index}` }, async () => {
    const first = budget.reserve({ provider: "fake", model: "fake", projectedUsd: .05, purpose: `p${index}:first` });
    await delay(8 - index);
    budget.settle(first.id, observationCosts[0], { outputTokens: 1 });
    const second = budget.reserve({ provider: "fake", model: "fake", projectedUsd: .05, purpose: `p${index}:second` });
    await delay(index + 1);
    budget.settle(second.id, observationCosts[1], { outputTokens: 1 });
    return { modelCostUsd: observationCosts[0] + observationCosts[1] };
  })));

  for (const [index, row] of rows.entries()) {
    assert.equal(row.callReceipts.length, 2);
    assert.deepEqual(row.callReceipts.map((call) => call.purpose), [`p${index}:first`, `p${index}:second`]);
    assert.equal(row.campaignSpendUsd, costs[index][0] + costs[index][1]);
    const observation = reconcileCorrelatedObservation(row.value, row);
    assert.equal(observation.modelCalls, 2);
    assert.equal(observation.campaignSpendUsd, observation.modelCostUsd);
  }
  assert.equal(base.calls.length, 8);
  assert.equal(base.reservedUsd, 0);
  assert.equal(base.spentUsd, costs.flat().reduce((sum, value) => sum + value, 0));
});

test("a paid reservation outside a correlation scope fails closed", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "das-correlated-budget-"));
  const base = new DurableBudgetGuard({ filePath: path.join(directory, "budget.json"), hardLimitUsd: 1, campaignId: "scope-test" });
  const budget = new ObservationCorrelatedBudget({ budget: base });
  assert.throws(() => budget.reserve({ provider: "fake", model: "fake", projectedUsd: .01, purpose: "unscoped" }), /outside an observation/);
  assert.equal(base.calls.length, 0);
});

test("an observation cannot seal while a correlated call remains active", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "das-correlated-budget-"));
  const base = new DurableBudgetGuard({ filePath: path.join(directory, "budget.json"), hardLimitUsd: 1, campaignId: "active-test" });
  const budget = new ObservationCorrelatedBudget({ budget: base });
  await assert.rejects(() => budget.runObservation({ participantId: "p1" }, async () => {
    budget.reserve({ provider: "fake", model: "fake", projectedUsd: .01, purpose: "active" });
    return { modelCostUsd: 0 };
  }), /still active/);
});

test("reconciliation rejects a participant-local cost mismatch", () => {
  assert.throws(() => reconcileCorrelatedObservation(
    { modelCostUsd: .1 },
    { campaignSpendUsd: .2, callReceipts: [{ id: "reservation-1", status: "settled", actualUsd: .2 }] },
  ), /does not reconcile/);
});
