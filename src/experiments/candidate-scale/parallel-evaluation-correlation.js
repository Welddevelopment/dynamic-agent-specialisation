import { AsyncLocalStorage } from "node:async_hooks";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function settledSpend(call) {
  return call.status === "settled" ? Number(call.actualUsd ?? 0) : 0;
}

/**
 * An isolated V7 recovery helper. It delegates durable accounting to one
 * DurableBudgetGuard while attaching every reservation to the exact async
 * observation which created it. Nothing imports this helper in the live V7
 * runner; switching runners requires a separate boundary audit and approval.
 */
export class ObservationCorrelatedBudget {
  constructor({ budget, requireObservation = true }) {
    requireCondition(budget && typeof budget.reserve === "function" && typeof budget.snapshot === "function", "Observation correlation needs a durable budget");
    this.base = budget;
    this.requireObservation = requireObservation;
    this.storage = new AsyncLocalStorage();
  }

  get filePath() { return this.base.filePath; }
  get hardLimitUsd() { return this.base.hardLimitUsd; }
  get warningUsd() { return this.base.warningUsd; }
  get campaignId() { return this.base.campaignId; }
  get spentUsd() { return this.base.spentUsd; }
  get reservedUsd() { return this.base.reservedUsd; }
  get calls() { return this.base.calls; }

  reserve(input) {
    const context = this.storage.getStore();
    requireCondition(context || !this.requireObservation, "A paid reservation was attempted outside an observation correlation scope");
    const reservation = this.base.reserve(input);
    if (context) context.reservationIds.push(reservation.id);
    return reservation;
  }

  settle(...args) { return this.base.settle(...args); }
  cancel(...args) { return this.base.cancel(...args); }
  reject(...args) { return this.base.reject(...args); }
  resolveUnknown(...args) { return this.base.resolveUnknown(...args); }
  snapshot() { return this.base.snapshot(); }

  async runObservation(identity, worker) {
    requireCondition(identity && typeof worker === "function", "A correlated observation needs an identity and worker");
    requireCondition(!this.storage.getStore(), "Nested observation correlation scopes are not allowed");
    const context = { identity: structuredClone(identity), reservationIds: [] };
    const value = await this.storage.run(context, worker);
    const snapshot = this.base.snapshot();
    const byId = new Map(snapshot.calls.map((call) => [call.id, call]));
    const callReceipts = context.reservationIds.map((id) => {
      const call = byId.get(id);
      requireCondition(call, `Correlated reservation ${id} is missing from the durable budget`);
      requireCondition(call.status !== "reserved", `Correlated reservation ${id} is still active after the observation returned`);
      requireCondition(call.status !== "outcome-unknown", `Correlated reservation ${id} has an unresolved provider outcome`);
      return structuredClone(call);
    });
    return {
      value,
      identity: structuredClone(context.identity),
      reservationIds: [...context.reservationIds],
      callReceipts,
      campaignSpendUsd: callReceipts.reduce((sum, call) => sum + settledSpend(call), 0),
    };
  }
}

export function reconcileCorrelatedObservation(raw, correlation) {
  requireCondition(raw && correlation, "Observation reconciliation needs raw output and correlation evidence");
  const observation = {
    ...raw,
    campaignSpendUsd: correlation.campaignSpendUsd,
    modelCalls: correlation.callReceipts.length,
    budgetCallReceipts: structuredClone(correlation.callReceipts),
  };
  requireCondition(Math.abs(Number(observation.modelCostUsd ?? 0) - correlation.campaignSpendUsd) <= 1e-9, "Participant-local model cost does not reconcile with correlated durable call receipts");
  return observation;
}
