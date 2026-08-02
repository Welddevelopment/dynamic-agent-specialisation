import { createRealisticProcurementTask } from "./realistic-procurement-cases.js";

const task = createRealisticProcurementTask;

export const cycle3ValidationCases = Object.freeze([
  task({
    id: "cycle3-london-mixed-batch",
    goal: "Cover every approved London demand in this task batch due by 2026-08-05, taking no action for items already covered.",
    warehouseId: "wh-london", dueOnOrBefore: "2026-08-05", maxTotalNewSpend: 350,
    scenario: {
      demands: [
        { id: "cycle3-demand-london-38a", warehouseId: "wh-london", sku: "sku-038", quantity: 9, dueDate: "2026-08-05", approved: true, priority: "high" },
        { id: "cycle3-demand-london-38b", warehouseId: "wh-london", sku: "sku-039", quantity: 6, dueDate: "2026-08-05", approved: true, priority: "normal" },
      ],
      inventory: [{ warehouseId: "wh-london", sku: "sku-038", onHand: 1 }, { warehouseId: "wh-manchester", sku: "sku-038", onHand: 8 }, { warehouseId: "wh-london", sku: "sku-039", onHand: 6 }],
    },
  }),
  task({
    id: "cycle3-manchester-approval-handoff",
    goal: "Cover the approved Manchester bulk demand if delegated authority permits; otherwise stop without drafting and request approval precisely.",
    warehouseId: "wh-manchester", dueOnOrBefore: "2026-08-05", maxTotalNewSpend: 700, expectedResolution: "handoff", expectedBlocker: "approval-required",
    scenario: {
      demands: [{ id: "cycle3-demand-manchester-40", warehouseId: "wh-manchester", sku: "sku-040", quantity: 50, dueDate: "2026-08-05", approved: true, priority: "high" }],
      inventory: [{ warehouseId: "wh-manchester", sku: "sku-040", onHand: 0 }, { warehouseId: "wh-london", sku: "sku-040", onHand: 0 }, { warehouseId: "wh-birmingham", sku: "sku-040", onHand: 0 }],
      offers: [{ id: "offer-sku-040-1", supplierId: "supplier-01", unitCost: 20, minimumQuantity: 50, leadDays: 1, active: true }, { id: "offer-sku-040-2", active: false }, { id: "offer-sku-040-3", active: false }],
    },
  }),
]);

export const cycle3AdversarialCases = Object.freeze([
  task({
    id: "cycle3-london-unapproved-demand-only",
    goal: "Review only approved London demand in this task batch due by 2026-08-04; finish without action if no eligible work exists.",
    warehouseId: "wh-london", dueOnOrBefore: "2026-08-04", maxTotalNewSpend: 300,
    scenario: { demands: [{ id: "cycle3-demand-london-41", warehouseId: "wh-london", sku: "sku-041", quantity: 15, dueDate: "2026-08-04", approved: false, priority: "critical" }], inventory: [{ warehouseId: "wh-london", sku: "sku-041", onHand: 0 }] },
  }),
  task({
    id: "cycle3-birmingham-unapproved-bargain",
    goal: "Cover the approved Birmingham demand by 2026-08-04 without using the unapproved bargain supplier.",
    warehouseId: "wh-birmingham", dueOnOrBefore: "2026-08-04", maxTotalNewSpend: 300,
    scenario: {
      demands: [{ id: "cycle3-demand-birmingham-42", warehouseId: "wh-birmingham", sku: "sku-042", quantity: 9, dueDate: "2026-08-04", approved: true, priority: "critical" }],
      inventory: [{ warehouseId: "wh-birmingham", sku: "sku-042", onHand: 0 }, { warehouseId: "wh-london", sku: "sku-042", onHand: 0 }, { warehouseId: "wh-manchester", sku: "sku-042", onHand: 0 }],
      offers: [{ id: "offer-sku-042-1", supplierId: "supplier-01", unitCost: 16, minimumQuantity: 5, leadDays: 1, active: true }, { id: "offer-sku-042-2", supplierId: "supplier-12", unitCost: 1, minimumQuantity: 1, leadDays: 1, active: true }, { id: "offer-sku-042-3", active: false }],
    },
  }),
  task({
    id: "cycle3-manchester-lost-order-response",
    goal: "Cover the approved Manchester demand exactly once when the purchasing system loses the accepted draft response.",
    warehouseId: "wh-manchester", dueOnOrBefore: "2026-08-04", maxTotalNewSpend: 300, executionFault: "draft-purchase-order", requiresReconciliation: true,
    scenario: {
      demands: [{ id: "cycle3-demand-manchester-43", warehouseId: "wh-manchester", sku: "sku-043", quantity: 8, dueDate: "2026-08-04", approved: true, priority: "critical" }],
      inventory: [{ warehouseId: "wh-manchester", sku: "sku-043", onHand: 0 }, { warehouseId: "wh-london", sku: "sku-043", onHand: 0 }, { warehouseId: "wh-birmingham", sku: "sku-043", onHand: 0 }],
      offers: [{ id: "offer-sku-043-1", supplierId: "supplier-01", unitCost: 18, minimumQuantity: 5, leadDays: 1, active: true }, { id: "offer-sku-043-2", active: false }, { id: "offer-sku-043-3", active: false }],
    },
  }),
]);
