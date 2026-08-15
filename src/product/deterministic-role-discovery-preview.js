function clean(value, maximum = 2_000) { return String(value ?? "").trim().slice(0, maximum); }
function fact(path, value, basis = "inference", confidence = .7) { return { path, value, basis, confidence, reviewRequired: basis === "inference" }; }

const PREVIEWS = Object.freeze([
  {
    id: "support-operations",
    pattern: /(?:ticket|customer support|helpdesk|refund|incident)/i,
    title: "Customer support operations specialist",
    outcome: "Resolve assigned support work accurately while escalating consequential exceptions",
    completion: "Complete only when the customer-facing response and external ticket state agree",
    systems: ["ticketing platform", "customer accounts", "incident system", "billing ledger"],
    measures: ["correct resolution route", "correct response", "correct external ticket state", "zero unauthorized actions"],
  },
  {
    id: "procurement-coverage",
    pattern: /(?:procurement|purchase|supplier|inventory|restock)/i,
    title: "Procurement coverage specialist",
    outcome: "Cover approved demand without excess or unauthorized purchasing",
    completion: "Complete only when each assigned demand is covered through an approved route in external system state",
    systems: ["inventory", "approved demand", "supplier offers", "purchase orders"],
    measures: ["demand covered", "approved route used", "no duplicate purchase", "no excess quantity"],
  },
  {
    id: "revenue-operations",
    pattern: /(?:revops|crm|lead|sales routing|revenue operations)/i,
    title: "CRM and revenue operations specialist",
    outcome: "Route assigned leads while preserving consent, territory, ownership, and account boundaries",
    completion: "Complete only when each lead has the correct externally verified disposition, owner, and next action",
    systems: ["CRM", "lead queue", "contacts", "accounts", "consent ledger", "territory rules"],
    measures: ["correct identity", "correct owner", "correct disposition", "no action after revoked consent"],
  },
  {
    id: "frontend-implementation",
    pattern: /(?:figma|react page|frontend implementation|component library|storybook|responsive page|open (?:a )?(?:draft )?pull request)/i,
    title: "Bounded frontend implementation specialist",
    outcome: "Turn approved designs into responsive React source using the existing component library and open a reviewable draft pull request",
    completion: "Complete only when independent repository-state checks confirm the assigned source, responsive requirements and review boundary with no merge or deployment",
    systems: ["approved Figma handoff", "React repository", "component library or Storybook", "repository policy", "pull-request checks"],
    measures: ["assigned source matches approved design requirements", "required viewports and checks pass", "only approved files change", "draft pull request exists", "no merge or deployment"],
    frontend: {
      componentPolicy: "Reuse approved existing components; a genuinely missing component requires a reviewable proposal.",
      requiredViewports: "Confirm the exact viewport and device contract before comparison.",
    },
  },
]);

function findPreview(description) { return PREVIEWS.find((item) => item.pattern.test(description)) ?? null; }

export function createDeterministicRoleDiscoveryPreviewProvider() {
  return Object.freeze({
    id: "deterministic-structural-role-preview",
    version: "1.0.0",
    async discover(request) {
      const description = clean(request?.description, 12_000);
      const preview = findPreview(description);
      const sparse = description.split(/\s+/).filter(Boolean).length < 8;
      const facts = preview
        ? [
          fact("role.title", preview.title, "inference", sparse ? .45 : .75),
          ...(!sparse ? [
            fact("role.outcome", preview.outcome, "inference", .65),
            fact("role.completionRule", preview.completion, "inference", .55),
            fact("systems.inventory", preview.systems, "inference", .45),
            fact("success.measures", preview.measures, "inference", .45),
            ...(preview.frontend ? [
              fact("success.observableReadyDefinition", preview.completion, "inference", .45),
              fact("frontend.componentPolicy", preview.frontend.componentPolicy, "inference", .45),
              fact("frontend.requiredViewports", preview.frontend.requiredViewports, "inference", .35),
            ] : []),
          ] : []),
        ]
        : [fact("role.title", "Unsupported-role preview", "inference", .2)];
      if (request?.approvedArtifacts?.[0]) {
        facts.push({
          ...fact("evaluation.representativeCases", ["Approved artifact available for structured review"], "artifact", .5),
          sourceId: request.approvedArtifacts[0].id,
        });
      }
      if (request?.currentAgentConfiguration) {
        facts.push({
          ...fact("currentAgent.configuration", { supplied: true, configurationHash: request.currentAgentConfiguration.contentHash }, "current-agent", 1),
          sourceId: request.currentAgentConfiguration.id,
        });
      }
      return {
        schemaVersion: "das.role-discovery-provider-output.v1",
        requestHash: request.requestHash,
        roleFamily: preview?.id ?? "unsupported",
        roleFamilyConfidence: preview ? (sparse ? .45 : .75) : .2,
        facts,
        warnings: [
          "Deterministic structural preview only: keyword routing and predefined safe proposals, not intelligent or model-backed role extraction.",
        ],
        usage: { modelCalls: 0, externalRequests: 0, spendUsd: 0 },
      };
    },
  });
}
