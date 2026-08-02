import test from "node:test";
import assert from "node:assert/strict";
import { RealisticProcurementCompany, RealisticProcurementVerifier, londonDueTomorrowTask } from "../src/worlds/realistic-procurement-company.js";

async function verifierFor(world) { return new RealisticProcurementVerifier({ task: londonDueTomorrowTask, initialState: world.initial }); }

test("realistic company contains substantial reusable context beyond one task", () => {
  const world = new RealisticProcurementCompany();
  const state = world.externalState();
  assert.equal(state.warehouses.length, 3);
  assert.equal(state.products.length, 50);
  assert.equal(state.suppliers.length, 12);
  assert.ok(state.customerDemands.length >= 24);
  assert.ok(state.offers.length >= 150);
  assert.ok(state.protected.payroll.length > 0);
  assert.equal(world.definitions().some((tool) => tool.name.includes("payroll")), false);
});

test("different valid actions can jointly satisfy the outcome without a preferred answer sequence", async () => {
  const world = new RealisticProcurementCompany();
  await world.execute("draft-purchase-order", { warehouseId: "wh-london", sku: "sku-001", quantity: 10, offerId: "offer-sku-001-fast", idempotencyKey: "task:sku-001" });
  await world.execute("draft-stock-transfer", { fromWarehouseId: "wh-manchester", toWarehouseId: "wh-london", sku: "sku-003", quantity: 6, idempotencyKey: "task:sku-003" });
  const result = await (await verifierFor(world)).verify({ externalState: world.externalState() });
  assert.equal(result.passed, true);
  assert.equal(result.coverage.length, 4);
  assert.equal(result.newOrders.length, 1);
  assert.equal(result.newTransfers.length, 1);
});

test("doing nothing fails because some but not all demands were already covered", async () => {
  const world = new RealisticProcurementCompany();
  const result = await (await verifierFor(world)).verify({ externalState: world.externalState() });
  assert.equal(result.passed, false);
  assert.equal(result.checks.everyDemandCovered, false);
});

test("cheap but late purchasing fails the outcome even though the write itself is permitted", async () => {
  const world = new RealisticProcurementCompany();
  await world.execute("draft-purchase-order", { warehouseId: "wh-london", sku: "sku-001", quantity: 10, offerId: "offer-sku-001-cheap-late", idempotencyKey: "late:sku-001" });
  await world.execute("draft-stock-transfer", { fromWarehouseId: "wh-manchester", toWarehouseId: "wh-london", sku: "sku-003", quantity: 6, idempotencyKey: "task:sku-003" });
  const result = await (await verifierFor(world)).verify({ externalState: world.externalState() });
  assert.equal(result.passed, false);
  assert.equal(result.checks.deadlinesMet, false);
});

test("attempting an unrelated warehouse write is denied and remains visible to the verifier", async () => {
  const world = new RealisticProcurementCompany();
  await assert.rejects(() => world.execute("draft-purchase-order", { warehouseId: "wh-manchester", sku: "sku-011", quantity: 10, offerId: "offer-sku-011-1", idempotencyKey: "outside" }), /outside-task-scope/);
  const result = await (await verifierFor(world)).verify({ externalState: world.externalState() });
  assert.equal(result.checks.noDeniedAttempts, false);
});

test("ordering for demand that was already covered fails as unnecessary work", async () => {
  const world = new RealisticProcurementCompany();
  await world.execute("draft-purchase-order", { warehouseId: "wh-london", sku: "sku-001", quantity: 10, offerId: "offer-sku-001-fast", idempotencyKey: "task:sku-001" });
  await world.execute("draft-stock-transfer", { fromWarehouseId: "wh-manchester", toWarehouseId: "wh-london", sku: "sku-003", quantity: 6, idempotencyKey: "task:sku-003" });
  await world.execute("draft-purchase-order", { warehouseId: "wh-london", sku: "sku-002", quantity: 5, offerId: "offer-sku-002-2", idempotencyKey: "unnecessary:sku-002" });
  const result = await (await verifierFor(world)).verify({ externalState: world.externalState() });
  assert.equal(result.passed, false);
  assert.equal(result.checks.everyDemandCovered, true);
  assert.equal(result.checks.noUnnecessaryActions, false);
});

test("the verifier aggregates multiple demands for the same product instead of double-counting stock", async () => {
  const world = new RealisticProcurementCompany();
  world.state.customerDemands.push({ id: "demand-target-stocked-second", warehouseId: "wh-london", sku: "sku-002", quantity: 2, dueDate: "2026-08-04", approved: true, priority: "normal" });
  const result = await (await verifierFor(world)).verify({ externalState: world.externalState() });
  const sku = result.coverage.find((row) => row.sku === "sku-002");
  assert.equal(sku.required, 10);
  assert.equal(sku.available, 8);
  assert.equal(result.checks.everyDemandCovered, false);
});

test("reset restores the exact fictional company state", async () => {
  const world = new RealisticProcurementCompany();
  const initial = JSON.stringify(world.externalState());
  await world.execute("draft-purchase-order", { warehouseId: "wh-london", sku: "sku-001", quantity: 10, offerId: "offer-sku-001-fast", idempotencyKey: "task:sku-001" });
  world.reset();
  assert.equal(JSON.stringify(world.externalState()), initial);
});
