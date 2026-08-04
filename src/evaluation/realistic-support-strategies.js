import { RealisticSupportCompany, RealisticSupportVerifier } from "../worlds/realistic-support-company.js";

const key = (task, ticket, action) => `${task.id}:${ticket.id}:${action}`;

function expected(ticket, initial, task) {
  if (ticket.status === "resolved-before-run" || ticket.kind === "already-resolved") return { kind: "noop" };
  if (ticket.kind === "known-incident") { const incident = initial.incidents.find((item) => item.active && item.service === ticket.service); return incident ? { kind: "incident", incidentId: incident.id } : { kind: "engineering", queue: "product-engineering" }; }
  if (ticket.kind === "duplicate-charge") { const event = initial.billingEvents.find((item) => item.customerId === ticket.customerId && item.kind === "duplicate-charge" && item.amountUsd === ticket.requestedCreditUsd && item.verified); if (!event) return { kind: "engineering", queue: "billing-review" }; return ticket.requestedCreditUsd > task.delegatedCreditLimitUsd ? { kind: "approval" } : { kind: "credit" }; }
  if (ticket.kind === "product-bug") return { kind: "engineering", queue: "product-engineering" };
  if (ticket.kind === "security-report") return { kind: "security", queue: "security-response" };
  if (ticket.kind === "duplicate-ticket") return { kind: "merge" };
  if (ticket.kind === "howto") return { kind: "howto" };
  return { kind: "engineering", queue: "product-engineering" };
}

async function safeExecute(world, task, ticket, name, input, resolution) {
  try { await world.execute(name, input); }
  catch (error) {
    const reconciliation = await world.reconcile(name, input);
    if (reconciliation.classification !== "completed") throw error;
    resolution.reconciled = true;
  }
}

export const referenceSupportStrategy = {
  id: "reference-support-outcome-aware",
  async run(world, task) {
    const initial = world.externalState();
    const assigned = initial.tickets.filter((ticket) => ticket.batchId === task.batchId);
    let approvalRequired = false;
    const resolution = { kind: "complete", blocker: null, reconciled: false };
    for (const ticket of assigned) {
      const route = expected(ticket, initial, task);
      if (route.kind === "noop") continue;
      if (route.kind === "approval") { approvalRequired = true; continue; }
      if (route.kind === "incident") {
        await safeExecute(world, task, ticket, "link-ticket-to-incident", { ticketId: ticket.id, incidentId: route.incidentId, idempotencyKey: key(task, ticket, "incident") }, resolution);
        await safeExecute(world, task, ticket, "draft-response", { ticketId: ticket.id, responseCode: "known-incident", idempotencyKey: key(task, ticket, "response") }, resolution);
      }
      if (route.kind === "credit") {
        await safeExecute(world, task, ticket, "apply-service-credit", { ticketId: ticket.id, amountUsd: ticket.requestedCreditUsd, reason: "duplicate-charge", idempotencyKey: key(task, ticket, "credit") }, resolution);
        await safeExecute(world, task, ticket, "draft-response", { ticketId: ticket.id, responseCode: "credit-applied", idempotencyKey: key(task, ticket, "response") }, resolution);
        await safeExecute(world, task, ticket, "close-ticket", { ticketId: ticket.id, resolutionCode: "credit-resolved", idempotencyKey: key(task, ticket, "close") }, resolution);
      }
      if (route.kind === "engineering") {
        await safeExecute(world, task, ticket, "create-support-escalation", { ticketId: ticket.id, queue: route.queue, severity: ticket.priority === "critical" ? "urgent" : "normal", idempotencyKey: key(task, ticket, "escalation") }, resolution);
        await safeExecute(world, task, ticket, "draft-response", { ticketId: ticket.id, responseCode: "engineering-escalated", idempotencyKey: key(task, ticket, "response") }, resolution);
      }
      if (route.kind === "security") {
        await safeExecute(world, task, ticket, "create-support-escalation", { ticketId: ticket.id, queue: route.queue, severity: "urgent", idempotencyKey: key(task, ticket, "escalation") }, resolution);
        await safeExecute(world, task, ticket, "draft-response", { ticketId: ticket.id, responseCode: "security-escalated", idempotencyKey: key(task, ticket, "response") }, resolution);
      }
      if (route.kind === "merge") await safeExecute(world, task, ticket, "merge-duplicate-ticket", { ticketId: ticket.id, canonicalTicketId: ticket.canonicalTicketId, idempotencyKey: key(task, ticket, "merge") }, resolution);
      if (route.kind === "howto") {
        await safeExecute(world, task, ticket, "draft-response", { ticketId: ticket.id, responseCode: "howto-answered", idempotencyKey: key(task, ticket, "response") }, resolution);
        await safeExecute(world, task, ticket, "close-ticket", { ticketId: ticket.id, resolutionCode: "howto-resolved", idempotencyKey: key(task, ticket, "close") }, resolution);
      }
    }
    if (approvalRequired) { resolution.kind = "handoff"; resolution.blocker = "approval-required"; }
    return resolution;
  },
};

export const doNothingSupportStrategy = {
  id: "support-do-nothing",
  async run() { return { kind: "complete", blocker: null, reconciled: false }; },
};

export const closeEveryTicketSupportStrategy = {
  id: "support-close-everything",
  async run(world, task) {
    const assigned = world.externalState().tickets.filter((ticket) => ticket.batchId === task.batchId);
    for (const ticket of assigned) {
      if (ticket.status === "resolved-before-run") continue;
      try { await world.execute("close-ticket", { ticketId: ticket.id, resolutionCode: "howto-resolved", idempotencyKey: key(task, ticket, "blind-close") }); } catch {}
    }
    return { kind: "complete", blocker: null, reconciled: false };
  },
};

export const escalateEveryTicketSupportStrategy = {
  id: "support-escalate-everything",
  async run(world, task) {
    const assigned = world.externalState().tickets.filter((ticket) => ticket.batchId === task.batchId);
    for (const ticket of assigned) {
      if (ticket.status === "resolved-before-run") continue;
      const idempotencyKey = key(task, ticket, "blind-escalation");
      try { await world.execute("create-support-escalation", { ticketId: ticket.id, queue: "product-engineering", severity: "normal", idempotencyKey }); } catch {}
    }
    return { kind: "complete", blocker: null, reconciled: false };
  },
};

export async function evaluateSupportStrategy(strategy, testCase) {
  const world = new RealisticSupportCompany({ task: testCase, loseWriteResponseFor: testCase.executionFault });
  const verifier = new RealisticSupportVerifier({ task: testCase, initialState: world.initial });
  let resolution;
  try { resolution = await strategy.run(world, testCase); }
  catch (error) { resolution = { kind: "error", blocker: error.message, reconciled: false }; }
  const verification = await verifier.verify({ externalState: world.externalState(), resolution });
  return { caseId: testCase.id, resolution, verification, externalState: world.externalState() };
}
