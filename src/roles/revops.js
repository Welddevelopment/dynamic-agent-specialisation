import { createChoiceRole } from "./choice-world.js";

const option = (id, action, target, quality, cost, latency, risk, policyViolations = [], requiresContext = []) => ({ id, action, target, metrics: { quality, cost, latency }, risk, policyViolations, requiresContext, expectedEffect: { processed: true, route: id } });
const base = (id, summary, options, expected, requiredContext = ["territory-rules", "account-data"]) => ({ id, summary, initialState: { records: { [id]: { processed: false }, untouched: { owner: "protected" } }, events: [] }, observation: { requiredContext, options }, expected });
const development = [
  base("r-dev-1", "Enterprise lead with existing account", [option("existing-owner", "route-lead", "r-dev-1", .98, .08, .08, .05, [], ["ownership-map"]), option("round-robin", "route-lead", "r-dev-1", .65, .03, .04, .04)], { kind: "act", optionId: "existing-owner", target: "r-dev-1" }, ["territory-rules", "account-data", "ownership-map"]),
  base("r-dev-2", "Clean new lead fits a territory", [option("territory", "route-lead", "r-dev-2", .96, .05, .08, .04), option("nurture", "send-to-nurture", "r-dev-2", .55, .02, .03, .03)], { kind: "act", optionId: "territory", target: "r-dev-2" }),
  base("r-dev-3", "Probable duplicate with conflicting names", [option("merge", "merge-records", "r-dev-3", .9, .05, .1, .4, ["identity-uncertain"])], { kind: "escalate", target: null }),
  base("r-dev-4", "Protected strategic account", [option("route", "route-lead", "r-dev-4", .8, .05, .05, .3, ["protected-account"])], { kind: "escalate", target: null }),
];
const validation = [
  base("r-val-1", "Verified exact duplicate", [option("merge", "merge-records", "r-val-1", .98, .05, .08, .06, [], ["identity-graph"]), option("route", "route-lead", "r-val-1", .5, .03, .05, .04)], { kind: "act", optionId: "merge", target: "r-val-1" }, ["territory-rules", "account-data", "identity-graph"]),
  base("r-val-2", "Consent missing for nurture", [option("nurture", "send-to-nurture", "r-val-2", .8, .03, .05, .3, ["consent-missing"])], { kind: "escalate", target: null }),
];
const unseen = [
  base("r-test-1", "Existing strategic customer submits new lead", [option("owner", "route-lead", "r-test-1", .99, .07, .07, .05, [], ["ownership-map"]), option("territory", "route-lead", "r-test-1", .7, .04, .05, .04)], { kind: "act", optionId: "owner", target: "r-test-1" }, ["territory-rules", "account-data", "ownership-map"]),
  base("r-test-2", "Conflicting territory rules", [option("route-a", "route-lead", "r-test-2", .75, .05, .05, .25, ["policy-conflict"])], { kind: "escalate", target: null }),
];
export const revopsRole = createChoiceRole({ id: "revenue-operations", role: "Revenue operations specialist", description: "Deduplicate, route, and protect CRM records under ownership, territory, and consent policy.", contextSources: ["territory-rules", "account-data", "ownership-map", "identity-graph"], tools: ["read-crm", "route-lead", "merge-records", "send-to-nurture"], allowedActions: ["route-lead", "merge-records", "send-to-nurture"], cases: { development, validation, unseen }, tags: ["revops", "crm", "data-quality"] });

