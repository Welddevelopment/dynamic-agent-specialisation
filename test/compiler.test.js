import test from "node:test";
import assert from "node:assert/strict";
import { runDeterministicReference } from "../src/run.js";
import { roles } from "../src/roles/index.js";
import { runCandidateOnCases } from "../src/evaluation/runner.js";
import { generateCandidatePortfolio } from "../src/compiler/generator.js";
import { SpecialistControlPlane } from "../src/compiler/control-plane.js";
import { digest } from "../src/core/canonical.js";

test("same compiler completes five structurally different role adapters", () => {
  const run = runDeterministicReference();
  assert.equal(run.results.length, 5);
  assert.equal(run.evidenceValid, true);
  assert.equal(run.paidModelCostUsd, 0);
  for (const { result } of run.results) {
    assert.ok(result.tournament.recommendation);
    assert.equal(result.tournament.recommendation.safetyViolations, 0);
  }
  assert.ok(run.results.some(({ result }) => result.candidates.some((candidate) => candidate.provenance.kind === "compiler-refinement")));
});

test("unseen cases are absent from the public role cases and require a frozen release token", () => {
  const role = roles[0];
  assert.equal(role.cases.unseen, undefined);
  assert.throws(() => role.unseen.release({ role: role.id }), /frozen evaluation/);
});

test("independent verifier catches unsafe action where escalation was required", () => {
  const role = roles[0];
  const candidate = generateCandidatePortfolio(role.brief)[0];
  candidate.strategy.riskTolerance = 1;
  const unsafeCase = structuredClone(role.cases.development[2]);
  unsafeCase.observation.options[0].policyViolations = [];
  const result = runCandidateOnCases({ candidate, role, cases: [unsafeCase] });
  assert.ok(result.safetyViolations >= 1);
  assert.equal(result.successRate, 0);
});

test("recommended specialist activates autonomously but switching remains fail-closed", () => {
  const run = runDeterministicReference();
  const { role, result } = run.results[0];
  const environment = { policyHash: digest(role.brief.policies), authorityHash: digest(role.brief.authority), availableTools: role.brief.environment.tools };
  const control = new SpecialistControlPlane();
  const activation = control.activateRecommended({ compiled: result, role, environment });
  assert.equal(activation.activated, true);
  const blocked = control.requestSwitch({ specialist: result.retained, role, environment: { ...environment, availableTools: [] }, requestedBy: "senior-engineer" });
  assert.equal(blocked.activated, false);
  assert.equal(control.active(role.id).id, result.retained.id);
});
