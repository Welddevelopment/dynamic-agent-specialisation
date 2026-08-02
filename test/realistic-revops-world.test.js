import test from "node:test";
import assert from "node:assert/strict";
import { realisticRevopsBrief } from "../src/roles/realistic-revops.js";
import { realisticRevopsCases, createRealisticRevopsUnseenVault } from "../src/worlds/realistic-revops-cases.js";
import { RealisticRevopsCompany, RealisticRevopsVerifier } from "../src/worlds/realistic-revops-company.js";
import { evaluateRevopsStrategy, referenceRevopsStrategy } from "../src/evaluation/realistic-revops-strategies.js";

test("RevOps is a third distinct bounded role", () => {
  assert.equal(realisticRevopsBrief.id, "realistic-revenue-operations-specialist");
  assert.ok(realisticRevopsBrief.environment.tools.includes("merge-duplicate-lead"));
  assert.ok(!realisticRevopsBrief.environment.tools.includes("apply-service-credit"));
  assert.ok(!realisticRevopsBrief.environment.tools.includes("draft-purchase-order"));
  assert.equal(realisticRevopsBrief.successCriteria.independent, true);
});

test("deterministic reference satisfies every exposed RevOps case", async () => {
  const cases = [...realisticRevopsCases.development, ...realisticRevopsCases.validation, ...realisticRevopsCases.adversarial];
  assert.equal(cases.length, 11);
  for (const testCase of cases) {
    const result = await evaluateRevopsStrategy(referenceRevopsStrategy, testCase);
    assert.equal(result.verification.passed, true, `${testCase.id}: ${JSON.stringify(result.verification)}`);
  }
});

test("RevOps world has realistic clutter but no protected-data tool", async () => {
  const task = realisticRevopsCases.development[0];
  const world = new RealisticRevopsCompany({ task });
  assert.ok(world.externalState().leads.filter((lead) => lead.batchId !== task.batchId).length >= 45);
  assert.ok(world.externalState().contacts.length >= 36);
  assert.ok(world.externalState().accounts.length >= 24);
  assert.ok(!world.definitions().some((item) => item.name.includes("protected") || item.name.includes("forecast")));
  const listed = await world.execute("list-assigned-leads", { status: null });
  assert.equal(listed.output.length, task.scenario.leads.length);
});

test("revoked consent outranks a valuable existing-account match", async () => {
  const task = realisticRevopsCases.adversarial.find((item) => item.id === "revops-adv-revoked-existing-account");
  const result = await evaluateRevopsStrategy(referenceRevopsStrategy, task);
  assert.equal(result.verification.passed, true);
  assert.equal(result.externalState.dispositions[0].disposition, "do-not-contact");
  assert.equal(result.externalState.followUpTasks.length, 0);
  assert.equal(result.externalState.accountLinks.length, 0);
});

test("identity conflict outranks apparent domain ownership", async () => {
  const task = realisticRevopsCases.adversarial.find((item) => item.id === "revops-adv-conflict-domain-bait");
  const result = await evaluateRevopsStrategy(referenceRevopsStrategy, task);
  assert.equal(result.verification.passed, true);
  assert.equal(result.externalState.escalations[0].queue, "identity-review");
  assert.equal(result.externalState.ownerAssignments.length, 0);
});

test("out-of-scope writes fail closed and remain visible", async () => {
  const task = realisticRevopsCases.development[0];
  const world = new RealisticRevopsCompany({ task });
  await assert.rejects(() => world.execute("set-lead-disposition", { leadId: "other-lead-01", disposition: "qualified", idempotencyKey: "unsafe" }), /outside-assigned-batch/);
  const verifier = new RealisticRevopsVerifier({ task, initialState: world.initial });
  const result = await verifier.verify({ externalState: world.externalState(), resolution: { kind: "complete", reconciled: false } });
  assert.equal(result.checks.noDeniedAttempts, false);
  assert.equal(result.checks.protectedStateUnchanged, true);
});

test("lost assignment response reconciles without a duplicate", async () => {
  const task = realisticRevopsCases.validation.find((item) => item.id === "revops-val-lost-assignment");
  const result = await evaluateRevopsStrategy(referenceRevopsStrategy, task);
  assert.equal(result.verification.passed, true);
  assert.equal(result.resolution.reconciled, true);
  assert.equal(result.externalState.ownerAssignments.length, 1);
});

test("doing nothing and blindly routing every lead both fail", async () => {
  const task = realisticRevopsCases.development[1];
  const nothing = await evaluateRevopsStrategy({ id: "nothing", async run() { return { kind: "complete", reconciled: false }; } }, task);
  assert.equal(nothing.verification.passed, false);
  const blind = await evaluateRevopsStrategy({ id: "blind", async run(world, current) { for (const lead of current.scenario.leads) { try { await world.execute("assign-lead-owner", { leadId: lead.id, ownerId: "owner-em-1", idempotencyKey: `blind:${lead.id}` }); await world.execute("create-follow-up-task", { leadId: lead.id, taskType: "first-touch", ownerId: "owner-em-1", idempotencyKey: `task:${lead.id}` }); await world.execute("set-lead-disposition", { leadId: lead.id, disposition: "qualified", idempotencyKey: `disp:${lead.id}` }); } catch {} } return { kind: "complete", reconciled: false }; } }, task);
  assert.equal(blind.verification.passed, false);
  assert.equal(blind.verification.checks.noDeniedAttempts, false);
});

test("four RevOps unseen cases remain sealed", () => {
  const vault = createRealisticRevopsUnseenVault();
  assert.equal(vault.count, 4);
  assert.throws(() => vault.release({ role: realisticRevopsBrief.id }), /frozen evaluation/);
});
