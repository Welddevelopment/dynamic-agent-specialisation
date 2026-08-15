import { realisticSupportBrief } from "../roles/realistic-support.js";
import { realisticProcurementBrief } from "../roles/realistic-procurement.js";
import { realisticRevopsBrief } from "../roles/realistic-revops.js";
import { frontendImplementationBrief } from "../roles/frontend-implementation.js";

const FULL_ASSISTED_LIFECYCLE = Object.freeze({
  discovery: true,
  businessIntake: true,
  bindingScaffold: true,
  systemImportReview: true,
  bindingDescriptorReview: true,
  bindingAcceptance: true,
  comparisonPlanning: true,
  comparisonResult: true,
  controlledActivation: true,
  blockers: Object.freeze([]),
});

const FRONTEND_DESIGN_LIFECYCLE = Object.freeze({
  discovery: true,
  businessIntake: true,
  bindingScaffold: true,
  systemImportReview: true,
  bindingDescriptorReview: false,
  bindingAcceptance: false,
  comparisonPlanning: false,
  comparisonResult: false,
  controlledActivation: false,
  blockers: Object.freeze([
    "Customer-local Figma or approved-design-source adapter is not registered.",
    "Customer-local repository and draft-pull-request adapter is not registered.",
    "Independent customer-repository, build and responsive-result verifier is not registered or accepted.",
  ]),
});

function template({ id, name, description, evidencePosition, brief, lifecycle = FULL_ASSISTED_LIFECYCLE, systemSuggestions, policyPrompts, examplePrompts }) {
  return Object.freeze({
    id,
    name,
    description,
    evidencePosition,
    referenceEvidence: Object.freeze({
      scope: "local-fictional-role-pack",
      briefId: brief.id,
      verifierId: brief.successCriteria.verifierId,
      customerBindingEvidence: false,
    }),
    lifecycle: Object.freeze({ ...lifecycle, blockers: Object.freeze([...lifecycle.blockers]) }),
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
  template({
    id: "frontend-implementation",
    name: "Frontend implementation",
    description: "Turn approved designs into bounded responsive React source and open a draft pull request without merging or deploying.",
    evidencePosition: "local-fictional-bounded-role-pack",
    brief: frontendImplementationBrief,
    lifecycle: FRONTEND_DESIGN_LIFECYCLE,
    systemSuggestions: ["approved Figma handoff", "React repository", "component library or Storybook", "repository policy", "pull-request checks"],
    policyPrompts: ["Which source paths may be edited?", "When may a new component be proposed?", "Which viewports and checks define ready?", "Who may merge or deploy?"],
    examplePrompts: ["ordinary responsive page", "missing approved component", "untrusted deploy instruction", "protected-file request", "lost write response"],
  }),
];

const byId = new Map(templates.map((item) => [item.id, item]));

export function listCommercialRoleTemplates() { return templates.map((item) => structuredClone(item)); }
export function commercialRoleTemplate(id) { const value = byId.get(id); return value ? structuredClone(value) : null; }
