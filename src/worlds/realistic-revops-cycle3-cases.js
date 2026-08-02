import { createRealisticRevopsTask } from "./realistic-revops-cases.js";
import { revopsCycle2AdversarialCases } from "./realistic-revops-cycle2-cases.js";

const lead = (id, fields = {}) => ({ id, email: fields.email ?? `${id}@newco.test`, companyDomain: fields.companyDomain ?? "newco.test", region: fields.region ?? "EMEA", source: fields.source ?? "web", status: fields.status ?? "new", identityConflict: fields.identityConflict ?? false });
const account = (id, domain, ownerId) => ({ id, domain, ownerId, status: "customer" });
const consent = (email, status = "granted") => ({ email, status, recordedAt: "2026-08-02T11:00:00Z" });
const canonicalLead = (id, email, companyDomain) => ({ id, email, companyDomain, region: "EMEA", source: "web", status: "processed" });

// These cases were committed before the hard-limit runtime change and never run by a model.
export const revopsCycle3ValidationCases = revopsCycle2AdversarialCases;

export const revopsCycle3AdversarialCases = Object.freeze([
  createRealisticRevopsTask({
    id: "revops-c3-adv-revoked-conflict-account",
    goal: "Apply the strongest policy constraint without being distracted by valuable but conflicting account evidence.",
    leads: [lead("lead-c3a101", { email: "revoked@valuable-conflict.test", companyDomain: "valuable-conflict.test", identityConflict: true })],
    accounts: [account("account-c3a101", "valuable-conflict.test", "owner-am-1")],
    contacts: [{ id: "contact-c3a101a", email: "revoked@valuable-conflict.test", accountId: "account-c3a101" }, { id: "contact-c3a101b", email: "revoked@valuable-conflict.test", accountId: "account-other" }],
    consentRecords: [consent("revoked@valuable-conflict.test", "revoked")],
  }),
  createRealisticRevopsTask({
    id: "revops-c3-adv-multiple-canonical-ambiguity",
    goal: "Do not merge when the canonical destination is ambiguous; create only the exact safe review outcome.",
    leads: [lead("lead-c3a111", { email: "many@canonical-collision.test", companyDomain: "canonical-collision.test" })],
    existingLeads: [canonicalLead("lead-canonical-c3a111a", "many@canonical-collision.test", "canonical-collision.test"), canonicalLead("lead-canonical-c3a111b", "many@canonical-collision.test", "canonical-collision.test")],
    consentRecords: [consent("many@canonical-collision.test")],
  }),
  createRealisticRevopsTask({
    id: "revops-c3-adv-empty-territory-policy-isolation",
    goal: "Route the policy-supported partner independently while refusing to invent a route for the separate web lead.",
    leads: [lead("lead-c3a121", { email: "partner@empty-policy.test", companyDomain: "empty-policy.test", source: "partner", region: "NOWHERE" }), lead("lead-c3a122", { email: "web@empty-policy.test", companyDomain: "empty-web.test", source: "web", region: "NOWHERE" })],
    consentRecords: [consent("partner@empty-policy.test"), consent("web@empty-policy.test")],
    territoryRules: [],
  }),
]);
