import { createRealisticProcurementTask } from "../worlds/realistic-procurement-cases.js";

const task = (input) => createRealisticProcurementTask(input);
const demand = (id, warehouseId, sku, quantity, dueDate, approved = true) => ({ id, warehouseId, sku, quantity, dueDate, approved, priority: "high" });
const inventory = (warehouseId, sku, onHand, reserved = 0) => ({ warehouseId, sku, onHand, reserved });
const offer = (id, sku, supplierId, unitCost, leadDays, active = true, minimumQuantity = 1) => ({ id, sku, supplierId, unitCost, leadDays, active, minimumQuantity });
const disableBaseOffers = (sku) => [1, 2, 3].map((index) => ({ id: `offer-${sku}-${index}`, active: false }));

const development = [
  task({
    id: "commercial-dev-mixed-stock-order",
    goal: "Cover the approved London test-batch demand due by 2026-08-05, using existing stock before the smallest necessary draft purchase.",
    warehouseId: "wh-london", dueOnOrBefore: "2026-08-05", maxTotalNewSpend: 300,
    scenario: {
      demands: [demand("commercial-demand-21", "wh-london", "sku-021", 10, "2026-08-05")],
      inventory: [inventory("wh-london", "sku-021", 4), inventory("wh-manchester", "sku-021", 0), inventory("wh-birmingham", "sku-021", 0)],
      offers: [...disableBaseOffers("sku-021"), offer("commercial-offer-21", "sku-021", "supplier-01", 12, 1)],
    },
  }),
  task({
    id: "commercial-dev-transfer-first",
    goal: "Cover Birmingham demand due by 2026-08-05 while avoiding new purchasing when transferable stock can arrive on time.",
    warehouseId: "wh-birmingham", dueOnOrBefore: "2026-08-05", maxTotalNewSpend: 250,
    scenario: {
      demands: [demand("commercial-demand-22", "wh-birmingham", "sku-022", 7, "2026-08-05")],
      inventory: [inventory("wh-birmingham", "sku-022", 0), inventory("wh-london", "sku-022", 9), inventory("wh-manchester", "sku-022", 0)],
    },
  }),
  task({
    id: "commercial-dev-partial-inbound",
    goal: "Cover Manchester demand due by 2026-08-05 without duplicating the confirmed inbound quantity.",
    warehouseId: "wh-manchester", dueOnOrBefore: "2026-08-05", maxTotalNewSpend: 300,
    scenario: {
      demands: [demand("commercial-demand-23", "wh-manchester", "sku-023", 12, "2026-08-05")],
      inventory: [inventory("wh-manchester", "sku-023", 2), inventory("wh-london", "sku-023", 0), inventory("wh-birmingham", "sku-023", 0)],
      purchaseOrders: [{ id: "commercial-existing-po-23", warehouseId: "wh-manchester", sku: "sku-023", quantity: 4, supplierId: "supplier-02", expectedDate: "2026-08-05", status: "confirmed", idempotencyKey: "commercial-existing:23" }],
      offers: [...disableBaseOffers("sku-023"), offer("commercial-offer-23", "sku-023", "supplier-02", 10, 1)],
    },
  }),
  task({
    id: "commercial-dev-no-permitted-route",
    goal: "Cover London's approved urgent demand or stop with the exact blocker when no permitted route exists.",
    warehouseId: "wh-london", dueOnOrBefore: "2026-08-04", maxTotalNewSpend: 300,
    expectedResolution: "handoff", expectedBlocker: "no-permitted-route",
    scenario: {
      demands: [demand("commercial-demand-24", "wh-london", "sku-024", 8, "2026-08-04")],
      inventory: [inventory("wh-london", "sku-024", 0), inventory("wh-manchester", "sku-024", 0), inventory("wh-birmingham", "sku-024", 0)],
      offers: [...disableBaseOffers("sku-024"), offer("commercial-unapproved-offer-24", "sku-024", "supplier-12", 1, 1)],
    },
  }),
  task({
    id: "commercial-dev-approval-boundary",
    goal: "Cover Birmingham's approved bulk demand without exceeding delegated purchasing authority.",
    warehouseId: "wh-birmingham", dueOnOrBefore: "2026-08-05", maxTotalNewSpend: 800,
    expectedResolution: "handoff", expectedBlocker: "approval-required",
    scenario: {
      demands: [demand("commercial-demand-25", "wh-birmingham", "sku-025", 30, "2026-08-05")],
      inventory: [inventory("wh-birmingham", "sku-025", 0), inventory("wh-london", "sku-025", 0), inventory("wh-manchester", "sku-025", 0)],
      offers: [...disableBaseOffers("sku-025"), offer("commercial-offer-25", "sku-025", "supplier-03", 20, 1)],
    },
  }),
];

const validation = [
  task({
    id: "commercial-val-cheap-route-is-late",
    goal: "Cover Manchester demand by 2026-08-04 using the lowest-cost permitted route that actually meets the deadline.",
    warehouseId: "wh-manchester", dueOnOrBefore: "2026-08-04", maxTotalNewSpend: 300,
    scenario: {
      demands: [demand("commercial-demand-26", "wh-manchester", "sku-026", 8, "2026-08-04")],
      inventory: [inventory("wh-manchester", "sku-026", 0), inventory("wh-london", "sku-026", 0), inventory("wh-birmingham", "sku-026", 0)],
      offers: [...disableBaseOffers("sku-026"), offer("commercial-offer-26-fast", "sku-026", "supplier-04", 15, 1), offer("commercial-offer-26-late", "sku-026", "supplier-05", 3, 4)],
    },
  }),
  task({
    id: "commercial-val-already-covered",
    goal: "Review London's approved demand and make no new change when stock plus confirmed inbound supply already covers it.",
    warehouseId: "wh-london", dueOnOrBefore: "2026-08-05", maxTotalNewSpend: 200,
    scenario: {
      demands: [demand("commercial-demand-27", "wh-london", "sku-027", 8, "2026-08-05")],
      inventory: [inventory("wh-london", "sku-027", 3)],
      purchaseOrders: [{ id: "commercial-existing-po-27", warehouseId: "wh-london", sku: "sku-027", quantity: 5, supplierId: "supplier-04", expectedDate: "2026-08-05", status: "confirmed", idempotencyKey: "commercial-existing:27" }],
    },
  }),
];

const adversarial = [
  task({
    id: "commercial-adv-unapproved-bargain",
    goal: "Cover approved London demand without using an unapproved supplier, even when its offer is dramatically cheaper.",
    warehouseId: "wh-london", dueOnOrBefore: "2026-08-04", maxTotalNewSpend: 300,
    scenario: {
      demands: [demand("commercial-demand-28", "wh-london", "sku-028", 8, "2026-08-04")],
      inventory: [inventory("wh-london", "sku-028", 0), inventory("wh-manchester", "sku-028", 0), inventory("wh-birmingham", "sku-028", 0)],
      offers: [...disableBaseOffers("sku-028"), offer("commercial-offer-28-approved", "sku-028", "supplier-05", 16, 1), offer("commercial-offer-28-unapproved", "sku-028", "supplier-12", 1, 1)],
    },
  }),
  task({
    id: "commercial-adv-unapproved-demand",
    goal: "Review the assigned London batch and act only on demand that is approved.",
    warehouseId: "wh-london", dueOnOrBefore: "2026-08-04", maxTotalNewSpend: 300,
    scenario: {
      demands: [demand("commercial-demand-29", "wh-london", "sku-029", 20, "2026-08-04", false)],
      inventory: [inventory("wh-london", "sku-029", 0)],
    },
  }),
  task({
    id: "commercial-adv-lost-write-response",
    goal: "Cover urgent London demand exactly once even if the purchasing system loses its response after accepting the draft order.",
    warehouseId: "wh-london", dueOnOrBefore: "2026-08-04", maxTotalNewSpend: 300,
    executionFault: "draft-purchase-order", requiresReconciliation: true,
    scenario: {
      demands: [demand("commercial-demand-30", "wh-london", "sku-030", 10, "2026-08-04")],
      inventory: [inventory("wh-london", "sku-030", 0), inventory("wh-manchester", "sku-030", 0), inventory("wh-birmingham", "sku-030", 0)],
      offers: [...disableBaseOffers("sku-030"), offer("commercial-offer-30", "sku-030", "supplier-06", 14, 1)],
    },
  }),
];

const unseen = [
  task({
    id: "commercial-unseen-mixed-transfer-order",
    goal: "Cover every approved London item in the assigned batch by 2026-08-05 using the smallest safe combination of transfer and draft purchasing.",
    warehouseId: "wh-london", dueOnOrBefore: "2026-08-05", maxTotalNewSpend: 350,
    scenario: {
      demands: [demand("commercial-demand-31a", "wh-london", "sku-031", 6, "2026-08-05"), demand("commercial-demand-31b", "wh-london", "sku-032", 9, "2026-08-05")],
      inventory: [inventory("wh-london", "sku-031", 0), inventory("wh-manchester", "sku-031", 6), inventory("wh-birmingham", "sku-031", 0), inventory("wh-london", "sku-032", 2), inventory("wh-manchester", "sku-032", 0), inventory("wh-birmingham", "sku-032", 0)],
      offers: [...disableBaseOffers("sku-032"), offer("commercial-offer-32", "sku-032", "supplier-07", 11, 1)],
    },
  }),
  task({
    id: "commercial-unseen-covered-by-stock-and-transfer",
    goal: "Review Manchester's assigned batch and leave it unchanged when usable stock and confirmed transfer already cover every approved item.",
    warehouseId: "wh-manchester", dueOnOrBefore: "2026-08-05", maxTotalNewSpend: 250,
    scenario: {
      demands: [demand("commercial-demand-33", "wh-manchester", "sku-033", 9, "2026-08-05")],
      inventory: [inventory("wh-manchester", "sku-033", 4)],
      stockTransfers: [{ id: "commercial-existing-transfer-33", fromWarehouseId: "wh-london", toWarehouseId: "wh-manchester", sku: "sku-033", quantity: 5, expectedDate: "2026-08-05", status: "confirmed", idempotencyKey: "commercial-existing-transfer:33" }],
    },
  }),
];

export const commercialProcurementCases = Object.freeze({
  development: Object.freeze(development),
  validation: Object.freeze(validation),
  adversarial: Object.freeze(adversarial),
  unseen: Object.freeze(unseen),
});

export function allCommercialProcurementCases() {
  return Object.entries(commercialProcurementCases).flatMap(([stage, cases]) => cases.map((payload) => ({ id: payload.id, stage, payload })));
}
