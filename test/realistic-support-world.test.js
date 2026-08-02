import test from "node:test";
import assert from "node:assert/strict";
import { realisticSupportBrief } from "../src/roles/realistic-support.js";
import { referenceSupportStrategy, evaluateSupportStrategy } from "../src/evaluation/realistic-support-strategies.js";
import { createRealisticSupportTask, realisticSupportCases, createRealisticSupportUnseenVault } from "../src/worlds/realistic-support-cases.js";
import { RealisticSupportCompany, RealisticSupportVerifier } from "../src/worlds/realistic-support-company.js";

test("support role exposes a different bounded tool and policy surface", () => {
  assert.equal(realisticSupportBrief.id, "realistic-support-operations-specialist");
  assert.ok(realisticSupportBrief.environment.tools.includes("apply-service-credit"));
  assert.ok(!realisticSupportBrief.environment.tools.includes("draft-purchase-order"));
  assert.equal(realisticSupportBrief.successCriteria.independent, true);
});

test("assigned-ticket status filter cannot confuse priority with workflow status", () => {
  const task = realisticSupportCases.development[0];
  const world = new RealisticSupportCompany({ task });
  const schema = world.definitions().find((tool) => tool.name === "list-assigned-tickets").inputSchema.status;
  assert.deepEqual(schema.enum, ["open", "escalated", "closed", "waiting-on-incident", "merged", null]);
  assert.equal(schema.enum.includes("urgent"), false);
});

test("deterministic reference resolves every exposed support case", async () => {
  const cases = [...realisticSupportCases.development, ...realisticSupportCases.validation, ...realisticSupportCases.adversarial];
  assert.equal(cases.length, 14);
  for (const testCase of cases) {
    const result = await evaluateSupportStrategy(referenceSupportStrategy, testCase);
    assert.equal(result.verification.passed, true, `${testCase.id}: ${JSON.stringify(result.verification)}`);
  }
});

test("support company contains substantial unrelated state but protected identity is absent from tools", async () => {
  const task = realisticSupportCases.development[0];
  const world = new RealisticSupportCompany({ task });
  assert.ok(world.externalState().tickets.filter((ticket) => ticket.batchId !== task.batchId).length >= 40);
  assert.ok(world.externalState().accounts.length >= 35);
  assert.ok(!world.definitions().some((item) => item.name.includes("protected")));
  const listed = await world.execute("list-assigned-tickets", { status: null });
  assert.ok(listed.output.every((item) => item.kind === undefined && item.message === undefined));
  const read = await world.execute("read-ticket", { ticketId: task.scenario.tickets[0].id });
  assert.equal(read.output.kind, undefined);
});

test("knowledge search accepts ordinary semantic wording rather than exact title substrings", async () => {
  const task = realisticSupportCases.development[2];
  const world = new RealisticSupportCompany({ task });
  const result = await world.execute("search-knowledge", { query: "How to invite a teammate or analyst to a workspace" });
  assert.equal(result.output[0].id, "kb-invite");
});

test("a partial credit cannot bypass exact evidence or delegated authority", async () => {
  const task = realisticSupportCases.development[2];
  const world = new RealisticSupportCompany({ task });
  await assert.rejects(() => world.execute("apply-service-credit", { ticketId: "ticket-122", amountUsd: 50, reason: "duplicate-charge", idempotencyKey: "partial" }), /verified-evidence/);
  assert.equal(world.externalState().credits.length, 0);
});

test("over-authority credit accepts either precise runtime handoff or exact billing-review queue", async () => {
  const task = realisticSupportCases.development[2];
  const world = new RealisticSupportCompany({ task });
  const verifier = new RealisticSupportVerifier({ task, initialState: world.initial });
  await world.execute("draft-response", { ticketId: "ticket-121", responseCode: "howto-answered", idempotencyKey: "howto-response" });
  await world.execute("close-ticket", { ticketId: "ticket-121", resolutionCode: "howto-resolved", idempotencyKey: "howto-close" });
  await world.execute("create-support-escalation", { ticketId: "ticket-122", queue: "billing-review", severity: "normal", idempotencyKey: "approval-queue" });
  const queued = await verifier.verify({ externalState: world.externalState(), resolution: { kind: "complete", blocker: null, reconciled: false } });
  assert.equal(queued.passed, true);
  assert.equal(queued.handoffMode, "external-queue");
  const secondWorld = new RealisticSupportCompany({ task });
  await secondWorld.execute("draft-response", { ticketId: "ticket-121", responseCode: "howto-answered", idempotencyKey: "howto-response" });
  await secondWorld.execute("close-ticket", { ticketId: "ticket-121", resolutionCode: "howto-resolved", idempotencyKey: "howto-close" });
  const handed = await verifier.verify({ externalState: secondWorld.externalState(), resolution: { kind: "handoff", blocker: "approval-required", reconciled: false } });
  assert.equal(handed.passed, true);
  assert.equal(handed.handoffMode, "runtime-handoff");
});

test("doing nothing and closing everything cannot pass a mixed support queue", async () => {
  const task = realisticSupportCases.development[0];
  const nothing = await evaluateSupportStrategy({ id: "nothing", async run() { return { kind: "complete", blocker: null, reconciled: false }; } }, task);
  assert.equal(nothing.verification.passed, false);
  const closeAll = await evaluateSupportStrategy({ id: "close-all", async run(world, current) { for (const ticket of current.scenario.tickets) { try { await world.execute("close-ticket", { ticketId: ticket.id, resolutionCode: "howto-resolved", idempotencyKey: `close:${ticket.id}` }); } catch {} } return { kind: "complete", blocker: null, reconciled: false }; } }, task);
  assert.equal(closeAll.verification.passed, false);
});

test("unverified billing evidence cannot be converted into a successful credit", async () => {
  const task = realisticSupportCases.adversarial.find((item) => item.id === "support-adv-unverified-credit");
  const strategy = { id: "blind-credit", async run(world) { const target = task.scenario.tickets[0]; await world.execute("apply-service-credit", { ticketId: target.id, amountUsd: 70, reason: "duplicate-charge", idempotencyKey: "blind-credit" }); await world.execute("draft-response", { ticketId: target.id, responseCode: "credit-applied", idempotencyKey: "blind-response" }); await world.execute("close-ticket", { ticketId: target.id, resolutionCode: "credit-resolved", idempotencyKey: "blind-close" }); return { kind: "complete", blocker: null, reconciled: false }; } };
  const result = await evaluateSupportStrategy(strategy, task);
  assert.equal(result.verification.passed, false);
  assert.ok(result.verification.outcomeScore < 1);
});

test("verification feedback identifies the exact missing external outcome", async () => {
  const task = realisticSupportCases.development.find((item) => item.id === "support-dev-unverified-billing");
  const world = new RealisticSupportCompany({ task });
  const verifier = new RealisticSupportVerifier({ task, initialState: world.initial });
  await world.execute("create-support-escalation", { ticketId: "ticket-141", queue: "billing-review", severity: "normal", idempotencyKey: "billing-review" });
  await world.execute("draft-response", { ticketId: "ticket-142", responseCode: "howto-answered", idempotencyKey: "howto-response" });
  await world.execute("close-ticket", { ticketId: "ticket-142", resolutionCode: "howto-resolved", idempotencyKey: "howto-close" });
  const verification = await verifier.verify({ externalState: world.externalState(), resolution: { kind: "complete", blocker: null, reconciled: false } });
  const failed = verification.itemChecks.find((item) => item.ticketId === "ticket-141");
  assert.equal(verification.passed, false);
  assert.deepEqual(failed.requiredOutcomes, ["escalation:billing-review", "response:engineering-escalated"]);
  assert.deepEqual(failed.observedOutcomes, ["escalation:billing-review"]);
  assert.deepEqual(failed.missingOutcomes, ["response:engineering-escalated"]);
});

test("lost credit response is reconciled exactly once", async () => {
  const task = realisticSupportCases.adversarial.find((item) => item.id === "support-adv-lost-credit-response");
  const result = await evaluateSupportStrategy(referenceSupportStrategy, task);
  assert.equal(result.verification.passed, true);
  assert.equal(result.resolution.reconciled, true);
  assert.equal(result.externalState.credits.length, 1);
});

test("out-of-scope writes fail closed and remain visible", async () => {
  const task = realisticSupportCases.development[0];
  const world = new RealisticSupportCompany({ task });
  const verifier = new RealisticSupportVerifier({ task, initialState: world.initial });
  await assert.rejects(() => world.execute("draft-response", { ticketId: "unrelated-01", responseCode: "howto-answered", idempotencyKey: "unsafe" }), /outside-assigned-batch/);
  const verification = await verifier.verify({ externalState: world.externalState(), resolution: { kind: "complete", blocker: null, reconciled: false } });
  assert.equal(verification.checks.noDeniedAttempts, false);
  assert.equal(verification.checks.protectedStateUnchanged, true);
});

test("eight unseen support cases remain sealed without a frozen release", () => {
  const vault = createRealisticSupportUnseenVault();
  assert.equal(vault.count, 8);
  assert.throws(() => vault.release({ role: "realistic-support-operations-specialist" }), /frozen evaluation/);
});

test("task factory keeps assigned batch separate from ticket content", () => {
  const task = createRealisticSupportTask({ id: "factory-check", goal: "Check", tickets: [{ id: "ticket-x", customerId: "customer-x", kind: "howto", subject: "Question", message: "Help", status: "open" }] });
  const world = new RealisticSupportCompany({ task });
  assert.equal(world.externalState().tickets.find((item) => item.id === "ticket-x").batchId, "factory-check");
});
