import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRevopsStrategy, referenceRevopsStrategy } from "../src/evaluation/realistic-revops-strategies.js";
import { createRevopsCycle2ProspectiveUnseenVault, revopsCycle2AdversarialCases, revopsCycle2ValidationCases } from "../src/worlds/realistic-revops-cycle2-cases.js";

test("deterministic reference satisfies every exposed RevOps Cycle 2 case", async () => {
  const cases = [...revopsCycle2ValidationCases, ...revopsCycle2AdversarialCases];
  assert.equal(cases.length, 6);
  for (const testCase of cases) {
    const result = await evaluateRevopsStrategy(referenceRevopsStrategy, testCase);
    assert.equal(result.verification.passed, true, `${testCase.id}: ${JSON.stringify(result.verification)}`);
  }
});

test("RevOps Cycle 2 prospective cases remain sealed", () => {
  const vault = createRevopsCycle2ProspectiveUnseenVault();
  assert.equal(vault.count, 4);
  assert.equal(vault.releaseCount(), 0);
  assert.throws(() => vault.release({}), /matching frozen evaluation/);
});

test("Cycle 2 explicitly tests route precedence and mixed-route isolation", () => {
  assert.ok(revopsCycle2ValidationCases.some((item) => item.scenario.leads.length >= 5));
  assert.ok(revopsCycle2AdversarialCases.some((item) => item.scenario.leads.some((lead) => lead.source === "partner") && item.scenario.accounts.length > 0));
  assert.ok(revopsCycle2AdversarialCases.some((item) => item.scenario.leads.some((lead) => lead.identityConflict) && item.scenario.existingLeads.length > 0));
});
