import { realisticSupportBrief } from "../roles/realistic-support.js";
import { realisticProcurementBrief } from "../roles/realistic-procurement.js";
import { realisticRevopsBrief } from "../roles/realistic-revops.js";

function template({ id, name, description, evidencePosition, brief, systemSuggestions, policyPrompts, examplePrompts }) {
  return Object.freeze({
    id,
    name,
    description,
    evidencePosition,
    provenBriefId: brief.id,
    provenVerifierId: brief.successCriteria.verifierId,
    defaultRoleTitle: brief.role,
    defaultOutcome: brief.outcome.primary,
    defaultCompletionRule: brief.outcome.completionRule,
    allowedActionVocabulary: Object.freeze([...brief.authority.allowedActions]),
    forbiddenActionVocabulary: Object.freeze([...brief.authority.forbiddenActions]),
    verifierMeasures: Object.freeze([...brief.successCriteria.measures]),
    systemSuggestions: Object.freeze(systemSuggestions),
    policyPrompts: Object.freeze(policyPrompts),
    examplePrompts: Object.freeze(examplePrompts),
  });
}

const templates = [
  template({
    id: "support-operations",
    name: "Customer support operations",
    description: "Resolve an assigned support queue through responses, bounded credits, incident links, escalation, merge and closure routes.",
    evidencePosition: "first-commercial-path",
    brief: realisticSupportBrief,
    systemSuggestions: ["ticketing platform", "customer accounts", "billing ledger", "incident system", "knowledge base", "support policy"],
    policyPrompts: ["Which issues must go to security?", "What credit limit can the specialist approve?", "When may a ticket be closed?", "Which customer data is protected?"],
    examplePrompts: ["known incident", "eligible duplicate charge", "security report", "how-to question", "request above delegated authority", "duplicate ticket"],
  }),
  template({
    id: "procurement-coverage",
    name: "Procurement coverage",
    description: "Cover approved demand through existing stock, inbound supply, transfer or bounded draft purchasing.",
    evidencePosition: "technical-template-retain-existing-result",
    brief: realisticProcurementBrief,
    systemSuggestions: ["inventory", "approved demand", "open purchase orders", "warehouse network", "supplier offers", "purchasing policy"],
    policyPrompts: ["Which suppliers are approved?", "What spend can the specialist draft?", "May it submit or only draft?", "How is excess purchasing prevented?"],
    examplePrompts: ["already covered demand", "safe warehouse transfer", "approved supplier purchase", "late or unapproved supplier", "approval required"],
  }),
  template({
    id: "revenue-operations",
    name: "CRM and revenue operations",
    description: "Route assigned leads while preserving identity, consent, territory, ownership and account boundaries.",
    evidencePosition: "technical-template-retain-existing-result",
    brief: realisticRevopsBrief,
    systemSuggestions: ["CRM", "lead queue", "contacts", "accounts", "consent ledger", "territory rules", "routing policy"],
    policyPrompts: ["How is identity confirmed?", "What happens after revoked consent?", "Who owns existing accounts?", "Which territories require review?"],
    examplePrompts: ["new qualified lead", "exact duplicate", "existing account expansion", "revoked consent", "ambiguous identity", "partner referral"],
  }),
];

const byId = new Map(templates.map((item) => [item.id, item]));

export function listCommercialRoleTemplates() { return templates.map((item) => structuredClone(item)); }
export function commercialRoleTemplate(id) { const value = byId.get(id); return value ? structuredClone(value) : null; }
