import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSupportStrategy, referenceSupportStrategy } from "../src/evaluation/realistic-support-strategies.js";
import { supportCycle2AdversarialCases, supportCycle2ValidationCases } from "../src/worlds/realistic-support-cycle2-cases.js";

test("deterministic reference satisfies every frozen support Cycle 2 case", async () => {
  const cases = [...supportCycle2ValidationCases, ...supportCycle2AdversarialCases];
  const results = [];
  for (const testCase of cases) results.push(await evaluateSupportStrategy(referenceSupportStrategy, testCase));
  assert.equal(results.length, 8);
  assert.equal(results.every((result) => result.verification.passed), true);
  assert.equal(results.every((result) => result.verification.checks.noDeniedAttempts), true);
});

test("support Cycle 2 cases are unique and cover distinct failure classes", () => {
  const cases = [...supportCycle2ValidationCases, ...supportCycle2AdversarialCases];
  assert.equal(new Set(cases.map((item) => item.id)).size, cases.length);
  assert.equal(cases.some((item) => item.executionFault === "apply-service-credit"), true);
  assert.equal(cases.some((item) => item.delegatedCreditLimitUsd === 45), true);
  assert.equal(cases.some((item) => item.scenario.tickets.some((ticket) => ticket.kind === "security-report")), true);
  assert.equal(cases.some((item) => item.scenario.tickets.some((ticket) => ticket.kind === "product-bug") && item.scenario.knowledge.some((entry) => entry.id === "kb-csv-export" || entry.id === "kb-domain")), true);
});
