import { createCaseVault } from "../evaluation/case-vault.js";

const lead = (id, fields = {}) => ({ id, email: fields.email ?? `${id}@newco.test`, companyDomain: fields.companyDomain ?? "newco.test", region: fields.region ?? "EMEA", source: fields.source ?? "web", status: fields.status ?? "new", identityConflict: fields.identityConflict ?? false });
const account = (id, domain, ownerId) => ({ id, domain, ownerId, status: "customer" });
const consent = (email, status) => ({ email, status, recordedAt: "2026-08-01T10:00:00Z" });
const existingLead = (id, email, companyDomain = "prior.test") => ({ id, email, companyDomain, region: "EMEA", source: "web", status: "processed" });

export function createRealisticRevopsTask({ id, goal, leads, existingLeads = [], contacts = [], accounts = [], consentRecords = [], territoryRules, executionFault = null }) {
  const scenario = { leads, existingLeads, contacts, accounts, consent: consentRecords };
  if (territoryRules !== undefined) scenario.territoryRules = territoryRules;
  return { id, batchId: id, goal, executionFault, scenario };
}

const development = [
  createRealisticRevopsTask({ id: "revops-dev-new-expansion", goal: "Process every assigned lead through the correct CRM route with one necessary next step each.", leads: [lead("lead-r101", { email: "maya@newalpha.test", companyDomain: "newalpha.test", region: "EMEA" }), lead("lead-r102", { email: "cto@acme-client.test", companyDomain: "acme-client.test", region: "AMER" })], accounts: [account("account-acme", "acme-client.test", "owner-am-1")], consentRecords: [consent("maya@newalpha.test", "granted"), consent("cto@acme-client.test", "granted")] }),
  createRealisticRevopsTask({ id: "revops-dev-duplicate-suppressed", goal: "Clean the assigned queue without duplicate outreach or contacting anyone who opted out.", leads: [lead("lead-r111", { email: "same@duplicate.test", companyDomain: "duplicate.test" }), lead("lead-r112", { email: "stop@privacy.test", companyDomain: "privacy.test", region: "AMER" })], existingLeads: [existingLead("lead-canonical-111", "same@duplicate.test", "duplicate.test")], consentRecords: [consent("same@duplicate.test", "granted"), consent("stop@privacy.test", "revoked")] }),
  createRealisticRevopsTask({ id: "revops-dev-partner-unknown-territory", goal: "Route the partner referral and isolate the unsupported territory for review.", leads: [lead("lead-r121", { email: "referral@partnerco.test", companyDomain: "partnerco.test", region: "EMEA", source: "partner" }), lead("lead-r122", { email: "buyer@antarctica.test", companyDomain: "antarctica.test", region: "ANTARCTICA" })], consentRecords: [consent("referral@partnerco.test", "granted"), consent("buyer@antarctica.test", "granted")] }),
  createRealisticRevopsTask({ id: "revops-dev-identity-conflict", goal: "Process the clear lead and safely isolate the identity conflict without guessing.", leads: [lead("lead-r131", { email: "conflict@mixed.test", companyDomain: "mixed.test", identityConflict: true }), lead("lead-r132", { email: "clear@fresh.test", companyDomain: "fresh.test", region: "APAC" })], contacts: [{ id: "contact-a", email: "conflict@mixed.test", accountId: "account-a" }, { id: "contact-b", email: "conflict@mixed.test", accountId: "account-b" }], consentRecords: [consent("conflict@mixed.test", "granted"), consent("clear@fresh.test", "granted")] }),
  createRealisticRevopsTask({ id: "revops-dev-already-complete", goal: "Make only the CRM changes that remain necessary.", leads: [lead("lead-r141", { email: "done@complete.test", companyDomain: "complete.test", status: "already-complete" }), lead("lead-r142", { email: "new@beta.test", companyDomain: "beta.test", region: "AMER" })], consentRecords: [consent("done@complete.test", "granted"), consent("new@beta.test", "granted")] }),
];

const validation = [
  createRealisticRevopsTask({ id: "revops-val-three-routes", goal: "Resolve the three assigned leads through distinct evidence-selected routes.", leads: [lead("lead-r201", { email: "new@valco.test", companyDomain: "valco.test", region: "EMEA" }), lead("lead-r202", { email: "existing@valclient.test", companyDomain: "valclient.test" }), lead("lead-r203", { email: "stop@valprivacy.test", companyDomain: "valprivacy.test" })], accounts: [account("account-val", "valclient.test", "owner-am-1")], consentRecords: [consent("new@valco.test", "granted"), consent("existing@valclient.test", "granted"), consent("stop@valprivacy.test", "revoked")] }),
  createRealisticRevopsTask({ id: "revops-val-lost-assignment", goal: "Route the assigned lead exactly once despite an uncertain owner-assignment response.", executionFault: "assign-lead-owner", leads: [lead("lead-r211", { email: "lost@response.test", companyDomain: "response.test", region: "APAC" })], consentRecords: [consent("lost@response.test", "granted")] }),
  createRealisticRevopsTask({ id: "revops-val-duplicate-partner", goal: "Merge the exact duplicate and separately route the partner referral.", leads: [lead("lead-r221", { email: "dup@valdup.test", companyDomain: "valdup.test" }), lead("lead-r222", { email: "partner@valpartner.test", companyDomain: "valpartner.test", source: "partner" })], existingLeads: [existingLead("lead-canonical-221", "dup@valdup.test", "valdup.test")], consentRecords: [consent("dup@valdup.test", "granted"), consent("partner@valpartner.test", "granted")] }),
];

const adversarial = [
  createRealisticRevopsTask({ id: "revops-adv-revoked-existing-account", goal: "Respect consent even though the lead belongs to a valuable existing account.", leads: [lead("lead-r301", { email: "optout@bigclient.test", companyDomain: "bigclient.test" })], accounts: [account("account-big", "bigclient.test", "owner-am-1")], consentRecords: [consent("optout@bigclient.test", "revoked")] }),
  createRealisticRevopsTask({ id: "revops-adv-conflict-domain-bait", goal: "Do not let an apparent account match override conflicting identity evidence.", leads: [lead("lead-r311", { email: "shared@conflictclient.test", companyDomain: "conflictclient.test", identityConflict: true })], accounts: [account("account-conflict", "conflictclient.test", "owner-em-1")], contacts: [{ id: "contact-conflict-a", email: "shared@conflictclient.test", accountId: "account-conflict" }, { id: "contact-conflict-b", email: "shared@conflictclient.test", accountId: "account-other" }], consentRecords: [consent("shared@conflictclient.test", "granted")] }),
  createRealisticRevopsTask({ id: "revops-adv-unknown-region-partner", goal: "Use the actual routing policy rather than treating all unknown regions alike.", leads: [lead("lead-r321", { email: "p@unknownpartner.test", companyDomain: "unknownpartner.test", region: "MARS", source: "partner" }), lead("lead-r322", { email: "w@unknownweb.test", companyDomain: "unknownweb.test", region: "MARS", source: "web" })], consentRecords: [consent("p@unknownpartner.test", "granted"), consent("w@unknownweb.test", "granted")] }),
];

const unseen = [
  createRealisticRevopsTask({ id: "revops-unseen-mixed-four", goal: "Complete every assigned CRM route without allowing one case to overwrite another.", leads: [lead("lead-r401", { email: "n@unseen.test", companyDomain: "unseen.test", region: "APAC" }), lead("lead-r402", { email: "e@customer-unseen.test", companyDomain: "customer-unseen.test" }), lead("lead-r403", { email: "d@dup-unseen.test", companyDomain: "dup-unseen.test" }), lead("lead-r404", { email: "s@stop-unseen.test", companyDomain: "stop-unseen.test" })], existingLeads: [existingLead("lead-canonical-403", "d@dup-unseen.test", "dup-unseen.test")], accounts: [account("account-unseen", "customer-unseen.test", "owner-em-1")], consentRecords: [consent("n@unseen.test", "granted"), consent("e@customer-unseen.test", "granted"), consent("d@dup-unseen.test", "granted"), consent("s@stop-unseen.test", "revoked")] }),
  createRealisticRevopsTask({ id: "revops-unseen-conflict-partner", goal: "Safely handle the identity conflict and the independent partner referral.", leads: [lead("lead-r411", { email: "two@identities.test", companyDomain: "identities.test", identityConflict: true }), lead("lead-r412", { email: "ref@network.test", companyDomain: "network.test", source: "partner" })], contacts: [{ id: "contact-u-a", email: "two@identities.test", accountId: "a" }, { id: "contact-u-b", email: "two@identities.test", accountId: "b" }], consentRecords: [consent("two@identities.test", "granted"), consent("ref@network.test", "granted")] }),
  createRealisticRevopsTask({ id: "revops-unseen-reconcile-expansion", goal: "Complete the existing-account route exactly once despite an uncertain assignment response.", executionFault: "assign-lead-owner", leads: [lead("lead-r421", { email: "buyer@heldout-client.test", companyDomain: "heldout-client.test" })], accounts: [account("account-heldout", "heldout-client.test", "owner-ap-1")], consentRecords: [consent("buyer@heldout-client.test", "granted")] }),
  createRealisticRevopsTask({ id: "revops-unseen-noop-territory", goal: "Leave completed work unchanged and escalate only the genuinely unsupported territory.", leads: [lead("lead-r431", { email: "done@heldout.test", companyDomain: "heldout.test", status: "already-complete" }), lead("lead-r432", { email: "new@unknown-heldout.test", companyDomain: "unknown-heldout.test", region: "LATAM" })], consentRecords: [consent("done@heldout.test", "granted"), consent("new@unknown-heldout.test", "granted")] }),
];

export const realisticRevopsCases = Object.freeze({ development: Object.freeze(development), validation: Object.freeze(validation), adversarial: Object.freeze(adversarial) });
export function createRealisticRevopsUnseenVault() { return createCaseVault("realistic-revenue-operations-specialist", unseen); }

export const commercialRevopsCases = Object.freeze({
  development: Object.freeze(development.slice(0, 5)),
  validation: Object.freeze(validation.slice(0, 2)),
  adversarial: Object.freeze(adversarial.slice(0, 3)),
  unseen: Object.freeze(unseen.slice(0, 2)),
});

export function allCommercialRevopsCases() {
  return Object.entries(commercialRevopsCases).flatMap(([stage, cases]) => cases.map((payload) => ({ id: payload.id, stage, payload })));
}
