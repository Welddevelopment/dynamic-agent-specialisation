import { RealisticRevopsCompany, RealisticRevopsVerifier } from "../worlds/realistic-revops-company.js";

const key = (task, lead, action) => `${task.id}:${lead.id}:${action}`;
function routeFor(lead, initial) {
  if (lead.status === "already-complete") return { kind: "noop" };
  if (initial.consent.find((item) => item.email.toLowerCase() === lead.email.toLowerCase())?.status === "revoked") return { kind: "suppress" };
  const sameLeads = initial.leads.filter((item) => item.id !== lead.id && item.email.toLowerCase() === lead.email.toLowerCase());
  const sameContacts = initial.contacts.filter((item) => item.email.toLowerCase() === lead.email.toLowerCase());
  if (lead.identityConflict || sameContacts.length > 1 || sameLeads.length > 1) return { kind: "identity-review" };
  if (sameLeads.length === 1) return { kind: "merge", canonicalLeadId: sameLeads[0].id };
  const account = initial.accounts.find((item) => item.domain.toLowerCase() === lead.companyDomain.toLowerCase());
  if (account) return { kind: "expansion", accountId: account.id, ownerId: account.ownerId };
  if (lead.source === "partner") return { kind: "partner", ownerId: initial.routingPolicy.partnerOwnerId };
  const territory = initial.territoryRules.find((item) => item.region === lead.region);
  return territory ? { kind: "qualified", ownerId: territory.ownerId } : { kind: "territory-review" };
}
async function write(world, name, input, resolution) { try { await world.execute(name, input); } catch (error) { const reconciled = await world.reconcile(name, input); if (reconciled.classification !== "completed") throw error; resolution.reconciled = true; } }
export const referenceRevopsStrategy = {
  id: "reference-revops-outcome-aware",
  async run(world, task) {
    const initial = world.externalState(); const assigned = initial.leads.filter((lead) => lead.batchId === task.batchId); const resolution = { kind: "complete", blocker: null, reconciled: false };
    for (const lead of assigned) {
      const route = routeFor(lead, initial); if (route.kind === "noop") continue;
      if (route.kind === "suppress") await write(world, "set-lead-disposition", { leadId: lead.id, disposition: "do-not-contact", idempotencyKey: key(task, lead, "suppress") }, resolution);
      if (route.kind === "identity-review" || route.kind === "territory-review") await write(world, "create-revops-escalation", { leadId: lead.id, queue: route.kind, idempotencyKey: key(task, lead, "escalate") }, resolution);
      if (route.kind === "merge") await write(world, "merge-duplicate-lead", { leadId: lead.id, canonicalLeadId: route.canonicalLeadId, idempotencyKey: key(task, lead, "merge") }, resolution);
      if (["qualified", "partner", "expansion"].includes(route.kind)) {
        if (route.kind === "expansion") await write(world, "link-lead-to-account", { leadId: lead.id, accountId: route.accountId, idempotencyKey: key(task, lead, "account") }, resolution);
        await write(world, "assign-lead-owner", { leadId: lead.id, ownerId: route.ownerId, idempotencyKey: key(task, lead, "owner") }, resolution);
        const taskType = route.kind === "qualified" ? "first-touch" : route.kind === "partner" ? "partner-follow-up" : "expansion-review";
        await write(world, "create-follow-up-task", { leadId: lead.id, taskType, ownerId: route.ownerId, idempotencyKey: key(task, lead, "follow-up") }, resolution);
        await write(world, "set-lead-disposition", { leadId: lead.id, disposition: route.kind === "expansion" ? "expansion" : "qualified", idempotencyKey: key(task, lead, "disposition") }, resolution);
      }
    }
    return resolution;
  },
};
export const doNothingRevopsStrategy = { id: "revops-do-nothing", async run() { return { kind: "complete", blocker: null, reconciled: false }; } };
export const assignEveryLeadRevopsStrategy = {
  id: "revops-assign-everything",
  async run(world, task) {
    const leads = world.externalState().leads.filter((lead) => lead.batchId === task.batchId && lead.status !== "already-complete");
    for (const lead of leads) {
      try { await world.execute("assign-lead-owner", { leadId: lead.id, ownerId: "owner-em-1", idempotencyKey: key(task, lead, "blind-owner") }); } catch {}
      try { await world.execute("set-lead-disposition", { leadId: lead.id, disposition: "qualified", idempotencyKey: key(task, lead, "blind-disposition") }); } catch {}
    }
    return { kind: "complete", blocker: null, reconciled: false };
  },
};
export const escalateEveryLeadRevopsStrategy = {
  id: "revops-escalate-everything",
  async run(world, task) {
    const leads = world.externalState().leads.filter((lead) => lead.batchId === task.batchId && lead.status !== "already-complete");
    for (const lead of leads) try { await world.execute("create-revops-escalation", { leadId: lead.id, queue: "identity-review", idempotencyKey: key(task, lead, "blind-review") }); } catch {}
    return { kind: "complete", blocker: null, reconciled: false };
  },
};
export async function evaluateRevopsStrategy(strategy, testCase) { const world = new RealisticRevopsCompany({ task: testCase, loseWriteResponseFor: testCase.executionFault }); const verifier = new RealisticRevopsVerifier({ task: testCase, initialState: world.initial }); let resolution; try { resolution = await strategy.run(world, testCase); } catch (error) { resolution = { kind: "error", blocker: error.message, reconciled: false }; } const verification = await verifier.verify({ externalState: world.externalState(), resolution }); return { caseId: testCase.id, resolution, verification, externalState: world.externalState() }; }
