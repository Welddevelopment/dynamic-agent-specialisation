import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSupportStrategy, referenceSupportStrategy } from "../src/evaluation/realistic-support-strategies.js";
import { createSupportCycle4ProspectiveUnseenVault, supportCycle4AdversarialCases, supportCycle4ValidationCases } from "../src/worlds/realistic-support-cycle4-cases.js";

test("deterministic reference satisfies every exposed support Cycle 4 case", async () => {
  const cases = [...supportCycle4ValidationCases, ...supportCycle4AdversarialCases];
  const results = [];
  for (const testCase of cases) results.push(await evaluateSupportStrategy(referenceSupportStrategy, testCase));
  assert.equal(results.length, 6);
  assert.equal(results.every((result) => result.verification.passed), true);
  assert.equal(results.every((result) => result.verification.checks.noDeniedAttempts), true);
});

test("support Cycle 4 prospective unseen cases remain sealed", () => {
  const vault = createSupportCycle4ProspectiveUnseenVault();
  assert.equal(vault.count, 4);
  assert.throws(() => vault.release({}), /matching frozen evaluation/);
});

test("support Cycle 4 stresses stable completion of evidence-selected routes", () => {
  const cases = [...supportCycle4ValidationCases, ...supportCycle4AdversarialCases];
  assert.equal(new Set(cases.map((item) => item.id)).size, 6);
  assert.equal(cases.every((item) => item.scenario.tickets.length >= 2), true);
  assert.equal(cases.filter((item) => item.scenario.tickets.some((ticket) => ticket.kind === "duplicate-charge")).length >= 5, true);
  assert.equal(cases.some((item) => item.executionFault === "apply-service-credit"), true);
});
