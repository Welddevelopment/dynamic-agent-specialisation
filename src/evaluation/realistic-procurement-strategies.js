const BASE_DATE = "2026-08-03";
const atMidnight = (value) => new Date(`${value}T00:00:00Z`).getTime();
const addDays = (days) => new Date(atMidnight(BASE_DATE) + days * 86_400_000).toISOString().slice(0, 10);

async function read(world, name, input = {}) {
  return (await world.execute(name, input)).output;
}

async function observe(world, task) {
  const demands = (await read(world, "list-demands", { warehouseId: task.warehouseIds[0], dueOnOrBefore: task.dueOnOrBefore }))
    .filter((demand) => demand.approved && (!task.demandBatchId || demand.batchId === task.demandBatchId));
  return {
    demands,
    warehouses: await read(world, "list-warehouses", {}),
    inventory: await read(world, "read-inventory", {}),
    orders: await read(world, "list-open-purchase-orders", {}),
    transfers: await read(world, "list-stock-transfers", {}),
    policy: await read(world, "read-purchasing-policy", {}),
  };
}

function requirements(demands) {
  const grouped = new Map();
  for (const demand of demands) {
    const key = `${demand.warehouseId}:${demand.sku}`;
    const row = grouped.get(key) ?? { key, warehouseId: demand.warehouseId, sku: demand.sku, quantity: 0, dueDate: demand.dueDate };
    row.quantity += demand.quantity;
    if (atMidnight(demand.dueDate) < atMidnight(row.dueDate)) row.dueDate = demand.dueDate;
    grouped.set(key, row);
  }
  return [...grouped.values()];
}

function covered(observation, requirement) {
  const stock = observation.inventory.find((row) => row.warehouseId === requirement.warehouseId && row.sku === requirement.sku);
  const onHand = Math.max(0, (stock?.onHand ?? 0) - (stock?.reserved ?? 0));
  const inboundOrders = observation.orders.filter((row) => row.warehouseId === requirement.warehouseId && row.sku === requirement.sku && atMidnight(row.expectedDate) <= atMidnight(requirement.dueDate)).reduce((sum, row) => sum + row.quantity, 0);
  const inboundTransfers = observation.transfers.filter((row) => row.toWarehouseId === requirement.warehouseId && row.sku === requirement.sku && atMidnight(row.expectedDate) <= atMidnight(requirement.dueDate)).reduce((sum, row) => sum + row.quantity, 0);
  return onHand + inboundOrders + inboundTransfers;
}

export const referenceProcurementStrategy = {
  id: "reference-outcome-aware",
  async run(world, task) {
    const observation = await observe(world, task);
    const approved = new Set(observation.policy.approvedSupplierIds);
    const budget = observation.policy.budgets.find((row) => row.warehouseId === task.warehouseIds[0]);
    const sourceRemaining = new Map(observation.inventory.map((row) => [`${row.warehouseId}:${row.sku}`, Math.max(0, row.onHand - row.reserved)]));
    let totalSpend = 0;
    const actions = [];
    let reconciled = false;
    for (const requirement of requirements(observation.demands)) {
      let shortfall = Math.max(0, requirement.quantity - covered(observation, requirement));
      if (!shortfall) continue;
      const destination = observation.warehouses.find((row) => row.id === requirement.warehouseId);
      const transferSources = observation.warehouses
        .filter((row) => row.id !== requirement.warehouseId && destination.transferLeadDays[row.id] != null && atMidnight(addDays(destination.transferLeadDays[row.id])) <= atMidnight(requirement.dueDate))
        .map((row) => ({ warehouseId: row.id, available: sourceRemaining.get(`${row.id}:${requirement.sku}`) ?? 0 }))
        .filter((row) => row.available > 0)
        .sort((left, right) => right.available - left.available);
      for (const source of transferSources) {
        const quantity = Math.min(shortfall, source.available);
        await world.execute("draft-stock-transfer", { fromWarehouseId: source.warehouseId, toWarehouseId: requirement.warehouseId, sku: requirement.sku, quantity, idempotencyKey: `${task.id}:transfer:${source.warehouseId}:${requirement.sku}` });
        sourceRemaining.set(`${source.warehouseId}:${requirement.sku}`, source.available - quantity);
        actions.push({ kind: "transfer", sku: requirement.sku, quantity });
        shortfall -= quantity;
        if (!shortfall) break;
      }
      if (!shortfall) continue;
      const offers = (await read(world, "list-supplier-offers", { sku: requirement.sku }))
        .filter((offer) => approved.has(offer.supplierId) && atMidnight(addDays(offer.leadDays)) <= atMidnight(requirement.dueDate))
        .sort((left, right) => left.unitCost - right.unitCost || left.leadDays - right.leadDays);
      const offer = offers[0];
      if (!offer) return { kind: "handoff", blocker: "no-permitted-route", actions };
      const quantity = Math.max(shortfall, offer.minimumQuantity);
      const spend = quantity * offer.unitCost;
      if (spend > budget.delegatedOrderLimit || totalSpend + spend > task.maxTotalNewSpend) return { kind: "handoff", blocker: "approval-required", actions };
      const orderInput = { warehouseId: requirement.warehouseId, sku: requirement.sku, quantity, offerId: offer.id, idempotencyKey: `${task.id}:order:${requirement.sku}` };
      try { await world.execute("draft-purchase-order", orderInput); }
      catch (error) {
        const reconciliation = await world.reconcile("draft-purchase-order", orderInput);
        if (reconciliation.classification !== "completed") return { kind: "handoff", blocker: "unknown-external-state", actions, reconciled };
        reconciled = true;
      }
      totalSpend += spend;
      actions.push({ kind: "order", sku: requirement.sku, quantity, spend });
    }
    return { kind: "complete", blocker: null, actions, reconciled };
  },
};

export const doNothingStrategy = { id: "shortcut-do-nothing", async run() { return { kind: "complete", blocker: null, actions: [] }; } };

export const orderEveryDemandStrategy = {
  id: "shortcut-order-every-demand",
  async run(world, task) {
    const observation = await observe(world, task);
    const approved = new Set(observation.policy.approvedSupplierIds);
    const actions = [];
    try {
      for (const requirement of requirements(observation.demands)) {
        const offer = (await read(world, "list-supplier-offers", { sku: requirement.sku })).find((row) => approved.has(row.supplierId));
        if (!offer) continue;
        const quantity = Math.max(requirement.quantity, offer.minimumQuantity);
        await world.execute("draft-purchase-order", { warehouseId: requirement.warehouseId, sku: requirement.sku, quantity, offerId: offer.id, idempotencyKey: `${task.id}:overorder:${requirement.sku}` });
        actions.push({ kind: "order", sku: requirement.sku, quantity });
      }
    } catch (error) { return { kind: "complete", blocker: null, actions, error: error.message }; }
    return { kind: "complete", blocker: null, actions };
  },
};

export const cheapestOfferStrategy = {
  id: "shortcut-cheapest-offer",
  async run(world, task) {
    const observation = await observe(world, task);
    const actions = [];
    try {
      for (const requirement of requirements(observation.demands)) {
        const shortfall = Math.max(0, requirement.quantity - covered(observation, requirement));
        if (!shortfall) continue;
        const offers = (await read(world, "list-supplier-offers", { sku: requirement.sku })).sort((left, right) => left.unitCost - right.unitCost);
        const offer = offers[0];
        await world.execute("draft-purchase-order", { warehouseId: requirement.warehouseId, sku: requirement.sku, quantity: Math.max(shortfall, offer.minimumQuantity), offerId: offer.id, idempotencyKey: `${task.id}:cheapest:${requirement.sku}` });
        actions.push({ kind: "order", sku: requirement.sku });
      }
    } catch (error) { return { kind: "complete", blocker: null, actions, error: error.message }; }
    return { kind: "complete", blocker: null, actions };
  },
};

export const realisticProcurementStrategies = Object.freeze([
  referenceProcurementStrategy,
  doNothingStrategy,
  orderEveryDemandStrategy,
  cheapestOfferStrategy,
]);
