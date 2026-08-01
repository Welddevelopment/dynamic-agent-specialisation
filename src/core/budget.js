export class BudgetGuard {
  constructor({ hardLimitUsd, warningUsd = hardLimitUsd * 0.8 }) {
    if (!(hardLimitUsd >= 0)) throw new Error("A non-negative hard budget is required");
    this.hardLimitUsd = hardLimitUsd;
    this.warningUsd = warningUsd;
    this.spentUsd = 0;
    this.reservedUsd = 0;
    this.calls = [];
  }
  reserve({ provider, model, projectedUsd, purpose }) {
    if (!(projectedUsd >= 0)) throw new Error("Projected cost must be non-negative");
    if (this.spentUsd + this.reservedUsd + projectedUsd > this.hardLimitUsd) throw new Error(`Projected call would cross hard budget $${this.hardLimitUsd.toFixed(2)}`);
    const reservation = { id: `reservation-${this.calls.length + 1}`, provider, model, projectedUsd, purpose };
    this.reservedUsd += projectedUsd;
    this.calls.push({ ...reservation, status: "reserved" });
    return reservation;
  }
  settle(reservationId, actualUsd, usage = {}) {
    const call = this.calls.find((entry) => entry.id === reservationId);
    if (!call || call.status !== "reserved") throw new Error("Unknown or settled reservation");
    if (!(actualUsd >= 0)) throw new Error("Actual cost must be non-negative");
    this.reservedUsd -= call.projectedUsd;
    if (this.spentUsd + actualUsd > this.hardLimitUsd) throw new Error("Actual cost crossed hard budget");
    this.spentUsd += actualUsd;
    Object.assign(call, { status: "settled", actualUsd, usage });
    return this.snapshot();
  }
  cancel(reservationId, reason) {
    const call = this.calls.find((entry) => entry.id === reservationId);
    if (!call || call.status !== "reserved") throw new Error("Unknown or settled reservation");
    this.reservedUsd -= call.projectedUsd;
    Object.assign(call, { status: "cancelled", reason });
  }
  snapshot() { return { hardLimitUsd: this.hardLimitUsd, warningUsd: this.warningUsd, spentUsd: this.spentUsd, reservedUsd: this.reservedUsd, calls: structuredClone(this.calls) }; }
}

