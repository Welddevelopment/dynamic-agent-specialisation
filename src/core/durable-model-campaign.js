import fs from "node:fs";
import path from "node:path";
import { digest } from "./canonical.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }
function writePrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${digest(Date.now()).slice(0, 10)}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

export class PersistentModelResponseCache {
  constructor({ filePath }) {
    requireCondition(filePath, "Persistent model cache needs a file path");
    this.filePath = path.resolve(filePath);
    this.values = new Map();
    if (fs.existsSync(this.filePath)) this.#load();
  }
  #load() {
    const state = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    requireCondition(state?.schemaVersion === "das.model-response-cache.v1", "Unsupported persistent model cache");
    requireCondition(state.integrityHash && digest(withoutHash(state, "integrityHash")) === state.integrityHash, "Persistent model cache integrity mismatch");
    for (const entry of state.entries ?? []) this.values.set(entry.requestHash, structuredClone(entry.response));
  }
  #save() {
    const state = { schemaVersion: "das.model-response-cache.v1", entries: [...this.values.entries()].map(([requestHash, response]) => ({ requestHash, response })) };
    state.integrityHash = digest(state);
    writePrivate(this.filePath, state);
  }
  key(request) { return digest(request); }
  get(request) { const value = this.values.get(this.key(request)); return value ? structuredClone(value) : null; }
  set(request, response) { this.values.set(this.key(request), structuredClone(response)); this.#save(); }
  size() { return this.values.size; }
}

export class DurableBudgetGuard {
  constructor({ filePath, hardLimitUsd, warningUsd = hardLimitUsd * .8, campaignId }) {
    requireCondition(filePath && campaignId, "Durable budget needs a file path and campaign id");
    requireCondition(Number.isFinite(hardLimitUsd) && hardLimitUsd >= 0, "A non-negative hard budget is required");
    this.filePath = path.resolve(filePath);
    this.hardLimitUsd = hardLimitUsd;
    this.warningUsd = warningUsd;
    this.campaignId = campaignId;
    this.spentUsd = 0;
    this.reservedUsd = 0;
    this.calls = [];
    if (fs.existsSync(this.filePath)) this.#load();
  }
  #load() {
    const state = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    requireCondition(state?.schemaVersion === "das.durable-model-budget.v1", "Unsupported durable model budget");
    requireCondition(state.integrityHash && digest(withoutHash(state, "integrityHash")) === state.integrityHash, "Durable model budget integrity mismatch");
    requireCondition(state.campaignId === this.campaignId && state.hardLimitUsd === this.hardLimitUsd, "Durable model budget campaign or hard limit changed");
    this.warningUsd = state.warningUsd;
    this.calls = structuredClone(state.calls ?? []);
    for (const call of this.calls) if (call.status === "reserved") { call.status = "outcome-unknown"; call.interruption = "process-ended-before-settlement"; }
    this.#recalculate();
    this.#save();
  }
  #recalculate() {
    this.spentUsd = this.calls.filter((call) => call.status === "settled").reduce((sum, call) => sum + call.actualUsd, 0);
    this.reservedUsd = this.calls.filter((call) => ["reserved", "outcome-unknown"].includes(call.status)).reduce((sum, call) => sum + call.projectedUsd, 0);
    requireCondition(this.spentUsd + this.reservedUsd <= this.hardLimitUsd + 1e-12, "Durable model budget state exceeds its hard limit");
  }
  #save() {
    const state = { schemaVersion: "das.durable-model-budget.v1", campaignId: this.campaignId, hardLimitUsd: this.hardLimitUsd, warningUsd: this.warningUsd, calls: this.calls };
    state.integrityHash = digest(state);
    writePrivate(this.filePath, state);
  }
  reserve({ provider, model, projectedUsd, purpose }) {
    requireCondition(Number.isFinite(projectedUsd) && projectedUsd >= 0, "Projected cost must be non-negative");
    requireCondition(this.spentUsd + this.reservedUsd + projectedUsd <= this.hardLimitUsd + 1e-12, `Projected call would cross hard budget $${this.hardLimitUsd.toFixed(2)}`);
    const reservation = { id: `reservation-${this.calls.length + 1}`, provider, model, projectedUsd, purpose, status: "reserved" };
    this.calls.push(reservation);
    this.#recalculate();
    this.#save();
    return structuredClone(reservation);
  }
  settle(reservationId, actualUsd, usage = {}) {
    const call = this.calls.find((entry) => entry.id === reservationId);
    requireCondition(call?.status === "reserved", "Unknown or settled reservation");
    requireCondition(Number.isFinite(actualUsd) && actualUsd >= 0, "Actual cost must be non-negative");
    const otherReserved = this.reservedUsd - call.projectedUsd;
    requireCondition(this.spentUsd + otherReserved + actualUsd <= this.hardLimitUsd + 1e-12, "Actual cost crossed hard budget");
    Object.assign(call, { status: "settled", actualUsd, usage: structuredClone(usage) });
    this.#recalculate();
    this.#save();
    return this.snapshot();
  }
  cancel(reservationId, reason) {
    const call = this.calls.find((entry) => entry.id === reservationId);
    requireCondition(call?.status === "reserved", "Unknown or settled reservation");
    Object.assign(call, { status: "outcome-unknown", interruption: String(reason ?? "provider-call-failed") });
    this.#recalculate();
    this.#save();
  }
  reject(reservationId, { reason = "provider-rejected-before-execution", retryClass = "request" } = {}) {
    const call = this.calls.find((entry) => entry.id === reservationId);
    requireCondition(call?.status === "reserved", "Unknown or settled reservation");
    Object.assign(call, {
      status: "cancelled",
      resolution: "verified-not-charged-provider-rejection",
      interruption: String(reason),
      retryClass: String(retryClass),
    });
    this.#recalculate();
    this.#save();
    return this.snapshot();
  }
  resolveUnknown(reservationId, { actualUsd = 0, usage = {}, notCharged = false } = {}) {
    const call = this.calls.find((entry) => entry.id === reservationId);
    requireCondition(call?.status === "outcome-unknown", "Only an unknown reservation can be resolved");
    requireCondition(notCharged || (Number.isFinite(actualUsd) && actualUsd >= 0), "Unknown reservation needs a verified charge or not-charged result");
    Object.assign(call, notCharged ? { status: "cancelled", resolution: "verified-not-charged" } : { status: "settled", actualUsd, usage: structuredClone(usage), resolution: "verified-charge" });
    this.#recalculate();
    this.#save();
    return this.snapshot();
  }
  snapshot() { return { campaignId: this.campaignId, hardLimitUsd: this.hardLimitUsd, warningUsd: this.warningUsd, spentUsd: this.spentUsd, reservedUsd: this.reservedUsd, calls: structuredClone(this.calls) }; }
}
