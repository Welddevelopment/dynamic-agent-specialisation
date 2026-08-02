import test from "node:test";
import assert from "node:assert/strict";
import { digest } from "../src/core/canonical.js";
import { runRealisticProcurementCampaign } from "../src/evaluation/realistic-procurement-campaign.js";
import { realisticProcurementStrategies } from "../src/evaluation/realistic-procurement-strategies.js";
import { createRealisticProcurementUnseenVault, realisticProcurementCases } from "../src/worlds/realistic-procurement-cases.js";

function releaseFrozenUnseen(vault) {
  const candidateHashes = Object.fromEntries(realisticProcurementStrategies.map((strategy) => [strategy.id, digest(strategy.run.toString())]));
  return vault.release({
    freezeHash: digest({ cases: realisticProcurementCases, candidateHashes }),
    role: "realistic-procurement-specialist",
    candidateHashes,
    baselineHashes: { "shortcut-do-nothing": digest("shortcut-do-nothing") },
  });
}

test("unseen procurement cases cannot be released before a frozen evaluation", () => {
  const vault = createRealisticProcurementUnseenVault();
  assert.throws(() => vault.release({ role: "realistic-procurement-specialist" }), /matching frozen evaluation/);
  assert.equal(vault.releaseCount(), 0);
});

test("realistic procurement campaign rewards outcome reasoning and rejects shortcuts", async () => {
  const vault = createRealisticProcurementUnseenVault();
  const unseenCases = releaseFrozenUnseen(vault);
  const campaign = await runRealisticProcurementCampaign({ suites: realisticProcurementCases, unseenCases, strategies: realisticProcurementStrategies });
  const reference = campaign.summaries.find((row) => row.strategyId === "reference-outcome-aware");
  const shortcuts = campaign.summaries.filter((row) => row.strategyId !== "reference-outcome-aware");
  assert.equal(campaign.cases, 11);
  assert.equal(reference.passed, reference.total);
  assert.ok(shortcuts.every((row) => row.passed < row.total));
  assert.ok(shortcuts.every((row) => row.successRate < reference.successRate));
  assert.equal(reference.splitResults.unseen.passed, reference.splitResults.unseen.total);
  assert.equal(vault.releaseCount(), 1);
});

test("the zero-cost campaign is exactly repeatable from reset state", async () => {
  const firstVault = createRealisticProcurementUnseenVault();
  const secondVault = createRealisticProcurementUnseenVault();
  const first = await runRealisticProcurementCampaign({ suites: realisticProcurementCases, unseenCases: releaseFrozenUnseen(firstVault), strategies: realisticProcurementStrategies });
  const second = await runRealisticProcurementCampaign({ suites: realisticProcurementCases, unseenCases: releaseFrozenUnseen(secondVault), strategies: realisticProcurementStrategies });
  assert.equal(first.campaignHash, second.campaignHash);
  assert.deepEqual(first.summaries, second.summaries);
});
