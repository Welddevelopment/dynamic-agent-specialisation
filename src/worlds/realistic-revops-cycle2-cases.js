import { createCaseVault } from "../evaluation/case-vault.js";
import { createRealisticRevopsTask } from "./realistic-revops-cases.js";

const lead = (id, fields = {}) => ({ id, email: fields.email ?? `${id}@newco.test`, companyDomain: fields.companyDomain ?? "newco.test", region: fields.region ?? "EMEA", source: fields.source ?? "web", status: fields.status ?? "new", identityConflict: fields.identityConflict ?? false });
const account = (id, domain, ownerId) => ({ id, domain, ownerId, status: "customer" });
const consent = (email, status = "granted") => ({ email, status, recordedAt: "2026-08-02T09:00:00Z" });
const canonicalLead = (id, email, companyDomain) => ({ id, email, companyDomain, region: "EMEA", source: "web", status: "processed" });

export const revopsCycle2ValidationCases = Object.freeze([
  createRealisticRevopsTask({
    id: "revops-c2-val-five-route-ledger",
    goal: "Resolve the five assigned leads independently under the current routing policy and leave no incomplete route.",
    leads: [
      lead("lead-c2v101", { email: "new@five.test", companyDomain: "five.test", region: "EMEA" }),
      lead("lead-c2v102", { email: "partner@channel.test", companyDomain: "channel.test", source: "partner", region: "APAC" }),
      lead("lead-c2v103", { email: "buyer@active-client.test", companyDomain: "active-client.test", region: "AMER" }),
      lead("lead-c2v104", { email: "duplicate@canonical.test", companyDomain: "canonical.test" }),
      lead("lead-c2v105", { email: "revoked@privacy.test", companyDomain: "privacy.test", region: "APAC" }),
    ],
    existingLeads: [canonicalLead("lead-canonical-c2v104", "duplicate@canonical.test", "canonical.test")],
    accounts: [account("account-c2v103", "active-client.test", "owner-am-1")],
    consentRecords: [consent("new@five.test"), consent("partner@channel.test"), consent("buyer@active-client.test"), consent("duplicate@canonical.test"), consent("revoked@privacy.test", "revoked")],
  }),
  createRealisticRevopsTask({
    id: "revops-c2-val-lost-task-response",
    goal: "Complete the assigned qualified-lead route exactly once despite an uncertain follow-up-task response.",
    executionFault: "create-follow-up-task",
    leads: [lead("lead-c2v111", { email: "uncertain@task.test", companyDomain: "task.test", region: "APAC" })],
    consentRecords: [consent("uncertain@task.test")],
  }),
  createRealisticRevopsTask({
    id: "revops-c2-val-noop-and-two-reviews",
    goal: "Preserve completed work and create only the exact review records required for the other assigned leads.",
    leads: [
      lead("lead-c2v121", { email: "done@leave.test", companyDomain: "leave.test", status: "already-complete" }),
      lead("lead-c2v122", { email: "conflict@review.test", companyDomain: "review.test", identityConflict: true }),
      lead("lead-c2v123", { email: "unknown@region.test", companyDomain: "region.test", region: "OCEAN" }),
    ],
    contacts: [{ id: "contact-c2v122a", email: "conflict@review.test", accountId: "account-a" }, { id: "contact-c2v122b", email: "conflict@review.test", accountId: "account-b" }],
    consentRecords: [consent("done@leave.test"), consent("conflict@review.test"), consent("unknown@region.test")],
  }),
]);

export const revopsCycle2AdversarialCases = Object.freeze([
  createRealisticRevopsTask({
    id: "revops-c2-adv-account-over-partner-source",
    goal: "Apply policy precedence to the assigned referral without overwriting customer ownership.",
    leads: [lead("lead-c2a201", { email: "referral@existing-partner-client.test", companyDomain: "existing-partner-client.test", source: "partner", region: "EMEA" })],
    accounts: [account("account-c2a201", "existing-partner-client.test", "owner-ap-1")],
    consentRecords: [consent("referral@existing-partner-client.test")],
  }),
  createRealisticRevopsTask({
    id: "revops-c2-adv-revocation-over-duplicate",
    goal: "Respect the strongest policy constraint even though an exact canonical lead exists.",
    leads: [lead("lead-c2a211", { email: "same-but-revoked@precedence.test", companyDomain: "precedence.test", region: "AMER" })],
    existingLeads: [canonicalLead("lead-canonical-c2a211", "same-but-revoked@precedence.test", "precedence.test")],
    consentRecords: [consent("same-but-revoked@precedence.test", "revoked")],
  }),
  createRealisticRevopsTask({
    id: "revops-c2-adv-conflict-over-duplicate-plus-partner",
    goal: "Keep the ambiguous and unambiguous routes separate; do not let duplicate evidence erase an identity conflict.",
    leads: [
      lead("lead-c2a221", { email: "ambiguous@collision.test", companyDomain: "collision.test", identityConflict: true }),
      lead("lead-c2a222", { email: "clear@partner-route.test", companyDomain: "partner-route.test", source: "partner", region: "EMEA" }),
    ],
    existingLeads: [canonicalLead("lead-canonical-c2a221", "ambiguous@collision.test", "collision.test")],
    contacts: [{ id: "contact-c2a221a", email: "ambiguous@collision.test", accountId: "account-a" }, { id: "contact-c2a221b", email: "ambiguous@collision.test", accountId: "account-b" }],
    consentRecords: [consent("ambiguous@collision.test"), consent("clear@partner-route.test")],
  }),
]);

const prospectiveUnseen = [
  createRealisticRevopsTask({
    id: "revops-c2-unseen-six-independent-routes",
    goal: "Finish every assigned CRM route under the current policy without cross-lead contamination.",
    leads: [
      lead("lead-c2u301", { email: "new@six.test", companyDomain: "six.test", region: "AMER" }),
      lead("lead-c2u302", { email: "partner@six-channel.test", companyDomain: "six-channel.test", source: "partner" }),
      lead("lead-c2u303", { email: "existing@six-client.test", companyDomain: "six-client.test" }),
      lead("lead-c2u304", { email: "dup@six-dup.test", companyDomain: "six-dup.test" }),
      lead("lead-c2u305", { email: "stop@six-stop.test", companyDomain: "six-stop.test" }),
      lead("lead-c2u306", { email: "done@six-done.test", companyDomain: "six-done.test", status: "already-complete" }),
    ],
    existingLeads: [canonicalLead("lead-canonical-c2u304", "dup@six-dup.test", "six-dup.test")],
    accounts: [account("account-c2u303", "six-client.test", "owner-em-1")],
    consentRecords: [consent("new@six.test"), consent("partner@six-channel.test"), consent("existing@six-client.test"), consent("dup@six-dup.test"), consent("stop@six-stop.test", "revoked"), consent("done@six-done.test")],
  }),
  createRealisticRevopsTask({ id: "revops-c2-unseen-lost-expansion-link", goal: "Complete the existing-account route exactly once despite an uncertain account-link response.", executionFault: "link-lead-to-account", leads: [lead("lead-c2u311", { email: "buyer@held-client.test", companyDomain: "held-client.test" })], accounts: [account("account-c2u311", "held-client.test", "owner-am-1")], consentRecords: [consent("buyer@held-client.test")] }),
  createRealisticRevopsTask({ id: "revops-c2-unseen-partner-and-unsupported-web", goal: "Route the supported partner referral and isolate the unrelated unsupported territory.", leads: [lead("lead-c2u321", { email: "p@held-partner.test", companyDomain: "held-partner.test", source: "partner", region: "VOID" }), lead("lead-c2u322", { email: "w@held-web.test", companyDomain: "held-web.test", source: "web", region: "VOID" })], consentRecords: [consent("p@held-partner.test"), consent("w@held-web.test")] }),
  createRealisticRevopsTask({ id: "revops-c2-unseen-conflict-account-bait", goal: "Do not let customer-domain value override conflicting identity evidence; separately complete the clear lead.", leads: [lead("lead-c2u331", { email: "conflict@valuable-held.test", companyDomain: "valuable-held.test", identityConflict: true }), lead("lead-c2u332", { email: "clear@ordinary-held.test", companyDomain: "ordinary-held.test", region: "EMEA" })], accounts: [account("account-c2u331", "valuable-held.test", "owner-am-1")], contacts: [{ id: "contact-c2u331a", email: "conflict@valuable-held.test", accountId: "account-c2u331" }, { id: "contact-c2u331b", email: "conflict@valuable-held.test", accountId: "other-account" }], consentRecords: [consent("conflict@valuable-held.test"), consent("clear@ordinary-held.test")] }),
];

export function createRevopsCycle2ProspectiveUnseenVault() { return createCaseVault("realistic-revenue-operations-specialist", prospectiveUnseen); }
