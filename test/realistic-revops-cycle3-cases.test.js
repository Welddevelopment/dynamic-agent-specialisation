import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRevopsStrategy, referenceRevopsStrategy } from "../src/evaluation/realistic-revops-strategies.js";
import { revopsCycle3AdversarialCases, revopsCycle3ValidationCases } from "../src/worlds/realistic-revops-cycle3-cases.js";

test("deterministic reference satisfies every exposed RevOps Cycle 3 case", async () => {
  const cases = [...revopsCycle3ValidationCases, ...revopsCycle3AdversarialCases];
  assert.equal(cases.length, 6);
  for (const testCase of cases) {
    const result = await evaluateRevopsStrategy(referenceRevopsStrategy, testCase);
    assert.equal(result.verification.passed, true, `${testCase.id}: ${JSON.stringify(result.verification)}`);
  }
});

test("Cycle 3 adversarial cases test compound precedence and policy isolation", () => {
  assert.ok(revopsCycle3AdversarialCases.some((item) => item.scenario.leads[0].identityConflict && item.scenario.consent[0].status === "revoked"));
  assert.ok(revopsCycle3AdversarialCases.some((item) => item.scenario.existingLeads.length === 2));
  assert.ok(revopsCycle3AdversarialCases.some((item) => item.scenario.territoryRules?.length === 0 && item.scenario.leads.length === 2));
});
