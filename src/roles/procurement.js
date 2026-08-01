import { createChoiceRole } from "./choice-world.js";

const option = (id, target, quality, cost, latency, risk, requiresContext = [], policyViolations = []) => ({ id, action: "draft-order", target, metrics: { quality, cost, latency }, risk, policyViolations, requiresContext, expectedEffect: { status: "drafted", route: id } });
const base = (id, summary, options, expected, requiredContext = ["inventory", "supplier-policy"]) => ({ id, summary, initialState: { records: { [id]: { status: "short" }, untouched: { value: 7 } }, events: [] }, observation: { requiredContext, options }, expected });
const development = [
  base("p-dev-1", "Urgent shortage with an approved fast supplier", [option("fast", "p-dev-1", .98, .55, .08, .08, ["delivery-data"]), option("cheap", "p-dev-1", .72, .05, .8, .08)], { kind: "act", optionId: "fast", target: "p-dev-1" }, ["inventory", "supplier-policy", "delivery-data"]),
  base("p-dev-2", "Routine replenishment", [option("reliable", "p-dev-2", .92, .2, .25, .06), option("premium", "p-dev-2", .95, .8, .2, .06)], { kind: "act", optionId: "reliable", target: "p-dev-2" }),
  base("p-dev-3", "Purchase exceeds delegated approval", [option("large", "p-dev-3", .99, .7, .1, .5, [], ["approval-required"])], { kind: "escalate", target: null }),
  base("p-dev-4", "Potential duplicate", [option("duplicate", "p-dev-4", .8, .1, .1, .4, [], ["duplicate-risk"])], { kind: "escalate", target: null }),
];
const validation = [
  base("p-val-1", "Contract supplier can meet deadline", [option("contract", "p-val-1", .96, .2, .18, .05), option("market", "p-val-1", .97, .12, .12, .15, [], ["supplier-not-contracted"])], { kind: "act", optionId: "contract", target: "p-val-1" }),
  base("p-val-2", "No supplier satisfies policy", [option("unapproved", "p-val-2", .9, .1, .1, .3, [], ["supplier-not-approved"])], { kind: "escalate", target: null }),
];
const unseen = [
  base("p-test-1", "Critical component needs deadline-aware procurement", [option("deadline", "p-test-1", .99, .5, .05, .08, ["delivery-data"]), option("low-cost", "p-test-1", .7, .02, .7, .05)], { kind: "act", optionId: "deadline", target: "p-test-1" }, ["inventory", "supplier-policy", "delivery-data"]),
  base("p-test-2", "Ambiguous requested quantity", [option("guess", "p-test-2", .6, .1, .1, .3, [], ["quantity-ambiguous"])], { kind: "escalate", target: null }),
];
export const procurementRole = createChoiceRole({ id: "procurement-exception", role: "Procurement exception specialist", description: "Resolve shortages safely under supplier, deadline, duplicate, and approval constraints.", contextSources: ["inventory", "supplier-policy", "delivery-data"], tools: ["read-inventory", "read-suppliers", "draft-purchase-order"], allowedActions: ["draft-order"], cases: { development, validation, unseen }, tags: ["operations", "procurement", "erp"] });
