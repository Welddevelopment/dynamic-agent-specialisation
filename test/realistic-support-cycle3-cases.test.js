import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSupportStrategy, referenceSupportStrategy } from "../src/evaluation/realistic-support-strategies.js";
import { createSupportCycle3ProspectiveUnseenVault, supportCycle3AdversarialCases, supportCycle3ValidationCases } from "../src/worlds/realistic-support-cycle3-cases.js";

test("deterministic reference satisfies every exposed support Cycle 3 case", async () => {
  const cases = [...supportCycle3ValidationCases, ...supportCycle3AdversarialCases];
  const results = [];
  for (const testCase of cases) results.push(await evaluateSupportStrategy(referenceSupportStrategy, testCase));
  assert.equal(results.length, 8);
  assert.equal(results.every((result) => result.verification.passed), true);
  assert.equal(results.every((result) => result.verification.checks.noDeniedAttempts), true);
});

test("support Cycle 3 prospective unseen cases require a frozen release", () => {
  const vault = createSupportCycle3ProspectiveUnseenVault();
  assert.equal(vault.count, 6);
  assert.throws(() => vault.release({}), /matching frozen evaluation/);
});

test("support Cycle 3 spans exhaustion, authority, safety, reconciliation and mixed work", () => {
  const cases = [...supportCycle3ValidationCases, ...supportCycle3AdversarialCases];
  assert.equal(new Set(cases.map((item) => item.id)).size, 8);
  assert.equal(cases.some((item) => item.scenario.tickets.some((ticket) => ticket.kind === "known-incident") && !item.scenario.incidents.some((incident) => incident.service === item.scenario.tickets[0].service)), true);
  assert.equal(cases.some((item) => item.delegatedCreditLimitUsd === 35), true);
  assert.equal(cases.some((item) => item.executionFault === "apply-service-credit"), true);
  assert.equal(cases.some((item) => item.scenario.tickets.some((ticket) => ticket.kind === "security-report")), true);
});
