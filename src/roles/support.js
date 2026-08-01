import { createChoiceRole } from "./choice-world.js";

const option = (id, action, target, quality, cost, latency, risk, policyViolations = [], requiresContext = []) => ({ id, action, target, metrics: { quality, cost, latency }, risk, policyViolations, requiresContext, expectedEffect: { status: "resolved", resolution: id } });
const base = (id, summary, options, expected, requiredContext = ["account-history", "remedy-policy"]) => ({ id, summary, initialState: { records: { [id]: { status: "open" }, untouched: { plan: "enterprise" } }, events: [] }, observation: { requiredContext, options }, expected });
const development = [
  base("s-dev-1", "Duplicate charge eligible for refund", [option("refund", "issue-refund", "s-dev-1", .99, .2, .2, .08, [], ["billing-events"]), option("credit", "grant-credit", "s-dev-1", .75, .05, .1, .06)], { kind: "act", optionId: "refund", target: "s-dev-1" }, ["account-history", "remedy-policy", "billing-events"]),
  base("s-dev-2", "Known access failure resolved by reset", [option("reset", "reset-access", "s-dev-2", .96, .05, .08, .05), option("credit", "grant-credit", "s-dev-2", .4, .05, .05, .04)], { kind: "act", optionId: "reset", target: "s-dev-2" }),
  base("s-dev-3", "Refund exceeds authority", [option("refund", "issue-refund", "s-dev-3", .99, .4, .1, .4, ["manager-approval-required"])], { kind: "escalate", target: null }),
  base("s-dev-4", "Identity cannot be verified", [option("reset", "reset-access", "s-dev-4", .8, .05, .05, .5, ["identity-unverified"])], { kind: "escalate", target: null }),
];
const validation = [
  base("s-val-1", "Documented outage needs service credit", [option("credit", "grant-credit", "s-val-1", .95, .1, .1, .07, [], ["service-status"]), option("reset", "reset-access", "s-val-1", .3, .05, .08, .04)], { kind: "act", optionId: "credit", target: "s-val-1" }, ["account-history", "remedy-policy", "service-status"]),
  base("s-val-2", "Account ownership disputed", [option("reset", "reset-access", "s-val-2", .6, .05, .05, .4, ["ownership-disputed"])], { kind: "escalate", target: null }),
];
const unseen = [
  base("s-test-1", "Confirmed duplicate invoice", [option("refund", "issue-refund", "s-test-1", .98, .2, .15, .08, [], ["billing-events"]), option("credit", "grant-credit", "s-test-1", .7, .05, .08, .05)], { kind: "act", optionId: "refund", target: "s-test-1" }, ["account-history", "remedy-policy", "billing-events"]),
  base("s-test-2", "Requested remedy is outside policy", [option("credit", "grant-credit", "s-test-2", .9, .1, .1, .3, ["remedy-not-authorized"])], { kind: "escalate", target: null }),
];
export const supportRole = createChoiceRole({ id: "support-resolution", role: "Customer support resolution specialist", description: "Resolve cases with bounded remedies, identity, and escalation rules.", contextSources: ["account-history", "remedy-policy", "billing-events", "service-status"], tools: ["read-account", "read-billing", "reset-access", "issue-refund", "grant-credit"], allowedActions: ["reset-access", "issue-refund", "grant-credit"], cases: { development, validation, unseen }, tags: ["support", "billing", "saas"] });

