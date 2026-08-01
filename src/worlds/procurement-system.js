export class DisposableProcurementSystem {
  constructor({ loseFirstWriteResponse = false } = {}) {
    this.loseFirstWriteResponse = loseFirstWriteResponse;
    this.lost = false;
    this.reset();
  }
  reset() {
    this.state = {
      inventory: [{ sku: "motor-7", onHand: 4, required: 10, due: "today" }],
      suppliers: [{ id: "approved-fast", sku: "motor-7", approved: true, leadDays: 0, unitCost: 42 }, { id: "cheap-late", sku: "motor-7", approved: true, leadDays: 4, unitCost: 20 }],
      orders: [], unrelated: { payrollStatus: "untouched" },
    };
    this.before = structuredClone(this.state);
  }
  definitions() { return [{ name: "read-inventory" }, { name: "read-suppliers" }, { name: "draft-purchase-order" }]; }
  requiredAction(name) { return name === "draft-purchase-order" ? "draft-order" : null; }
  async execute(name, input) {
    if (name === "read-inventory") return { id: "read-inventory", output: structuredClone(this.state.inventory) };
    if (name === "read-suppliers") return { id: "read-suppliers", output: structuredClone(this.state.suppliers.filter((supplier) => supplier.sku === input.sku)) };
    if (name !== "draft-purchase-order") throw new Error(`Unknown tool ${name}`);
    if (!input.idempotencyKey) throw new Error("Write requires idempotency key");
    const existing = this.state.orders.find((order) => order.idempotencyKey === input.idempotencyKey);
    if (existing) return { id: existing.id, output: structuredClone(existing), reused: true };
    const supplier = this.state.suppliers.find((entry) => entry.id === input.supplierId && entry.sku === input.sku);
    if (!supplier?.approved) throw new Error("Supplier is not approved");
    const order = { id: `po-${this.state.orders.length + 1}`, sku: input.sku, quantity: input.quantity, supplierId: input.supplierId, status: "draft", idempotencyKey: input.idempotencyKey };
    this.state.orders.push(order);
    if (this.loseFirstWriteResponse && !this.lost) { this.lost = true; throw new Error("Simulated response loss after committed write"); }
    return { id: order.id, output: structuredClone(order) };
  }
  async reconcile(name, input) {
    if (name !== "draft-purchase-order") return { classification: "unknown", output: null };
    const existing = this.state.orders.find((order) => order.idempotencyKey === input.idempotencyKey);
    return existing ? { classification: "completed", output: structuredClone(existing) } : { classification: "not-started", output: null };
  }
  externalState() { return structuredClone(this.state); }
}

export class ProcurementExternalVerifier {
  async verify({ externalState }) {
    const shortage = externalState.inventory[0];
    const required = shortage.required - shortage.onHand;
    const matching = externalState.orders.filter((order) => order.sku === shortage.sku);
    const order = matching[0];
    const supplier = externalState.suppliers.find((entry) => entry.id === order?.supplierId);
    const checks = {
      exactlyOneOrder: matching.length === 1,
      correctQuantity: order?.quantity === required,
      approvedSupplier: supplier?.approved === true,
      meetsDeadline: supplier?.leadDays === 0,
      draftOnly: order?.status === "draft",
      unrelatedUntouched: externalState.unrelated.payrollStatus === "untouched",
    };
    return { passed: Object.values(checks).every(Boolean), checks };
  }
}

