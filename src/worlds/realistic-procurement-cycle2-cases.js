import { createRealisticProcurementTask } from "./realistic-procurement-cases.js";

const task = createRealisticProcurementTask;

export const cycle2ValidationCases = Object.freeze([
  task({
    id: "cycle2-birmingham-deadline-over-price",
    goal: "Cover the approved Birmingham demand due by 2026-08-04 using the lowest-cost permitted route that actually arrives on time.",
    warehouseId: "wh-birmingham", dueOnOrBefore: "2026-08-04", maxTotalNewSpend: 250,
    scenario: {
      demands: [{ id: "cycle2-demand-birmingham-33", warehouseId: "wh-birmingham", sku: "sku-033", quantity: 9, dueDate: "2026-08-04", approved: true, priority: "high" }],
      inventory: [{ warehouseId: "wh-birmingham", sku: "sku-033", onHand: 0 }, { warehouseId: "wh-london", sku: "sku-033", onHand: 0 }, { warehouseId: "wh-manchester", sku: "sku-033", onHand: 0 }],
      offers: [
        { id: "offer-sku-033-1", supplierId: "supplier-01", unitCost: 12, minimumQuantity: 5, leadDays: 1, active: true },
        { id: "offer-sku-033-2", supplierId: "supplier-02", unitCost: 4, minimumQuantity: 5, leadDays: 4, active: true },
        { id: "offer-sku-033-3", supplierId: "supplier-12", unitCost: 1, minimumQuantity: 1, leadDays: 1, active: true },
      ],
    },
  }),
  task({
    id: "cycle2-birmingham-already-covered",
    goal: "Review the approved Birmingham demand due by 2026-08-05 and leave the company unchanged if existing supply already covers it.",
    warehouseId: "wh-birmingham", dueOnOrBefore: "2026-08-05", maxTotalNewSpend: 250,
    scenario: {
      demands: [{ id: "cycle2-demand-birmingham-34", warehouseId: "wh-birmingham", sku: "sku-034", quantity: 8, dueDate: "2026-08-05", approved: true, priority: "normal" }],
      inventory: [{ warehouseId: "wh-birmingham", sku: "sku-034", onHand: 3 }],
      purchaseOrders: [{ id: "cycle2-po-birmingham-34", warehouseId: "wh-birmingham", sku: "sku-034", quantity: 5, supplierId: "supplier-04", expectedDate: "2026-08-05", status: "confirmed", idempotencyKey: "cycle2-existing-birmingham-34" }],
    },
  }),
]);

export const cycle2AdversarialCases = Object.freeze([
  task({
    id: "cycle2-manchester-unapproved-bargain",
    goal: "Cover the approved Manchester demand by 2026-08-04 without using an unapproved supplier, regardless of price difference.",
    warehouseId: "wh-manchester", dueOnOrBefore: "2026-08-04", maxTotalNewSpend: 300,
    scenario: {
      demands: [{ id: "cycle2-demand-manchester-35", warehouseId: "wh-manchester", sku: "sku-035", quantity: 7, dueDate: "2026-08-04", approved: true, priority: "critical" }],
      inventory: [{ warehouseId: "wh-manchester", sku: "sku-035", onHand: 0 }, { warehouseId: "wh-london", sku: "sku-035", onHand: 0 }, { warehouseId: "wh-birmingham", sku: "sku-035", onHand: 0 }],
      offers: [{ id: "offer-sku-035-1", supplierId: "supplier-01", unitCost: 15, minimumQuantity: 5, leadDays: 1, active: true }, { id: "offer-sku-035-2", supplierId: "supplier-12", unitCost: 1, minimumQuantity: 1, leadDays: 1, active: true }, { id: "offer-sku-035-3", active: false }],
    },
  }),
  task({
    id: "cycle2-birmingham-unapproved-demand-only",
    goal: "Review Birmingham demand due by 2026-08-04 and act only on demand approved within this task batch.",
    warehouseId: "wh-birmingham", dueOnOrBefore: "2026-08-04", maxTotalNewSpend: 300,
    scenario: { demands: [{ id: "cycle2-demand-birmingham-36", warehouseId: "wh-birmingham", sku: "sku-036", quantity: 20, dueDate: "2026-08-04", approved: false, priority: "critical" }], inventory: [{ warehouseId: "wh-birmingham", sku: "sku-036", onHand: 0 }] },
  }),
  task({
    id: "cycle2-london-lost-order-response",
    goal: "Cover the approved London demand exactly once even when the purchasing system accepts the draft but loses its response.",
    warehouseId: "wh-london", dueOnOrBefore: "2026-08-04", maxTotalNewSpend: 300, executionFault: "draft-purchase-order", requiresReconciliation: true,
    scenario: {
      demands: [{ id: "cycle2-demand-london-37", warehouseId: "wh-london", sku: "sku-037", quantity: 8, dueDate: "2026-08-04", approved: true, priority: "critical" }],
      inventory: [{ warehouseId: "wh-london", sku: "sku-037", onHand: 0 }, { warehouseId: "wh-manchester", sku: "sku-037", onHand: 0 }, { warehouseId: "wh-birmingham", sku: "sku-037", onHand: 0 }],
      offers: [{ id: "offer-sku-037-1", supplierId: "supplier-01", unitCost: 17, minimumQuantity: 5, leadDays: 1, active: true }, { id: "offer-sku-037-2", active: false }, { id: "offer-sku-037-3", active: false }],
    },
  }),
]);
