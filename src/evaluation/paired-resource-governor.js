import { digest } from "../core/canonical.js";
import { assertAdaptiveEngineeringProtocol } from "./adaptive-engineering-protocol.js";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function finiteNonNegative(value, label) {
  requireCondition(Number.isFinite(value) && value >= 0, `${label} must be a finite non-negative number`);
  return Number(value);
}

export class PairedResourceGovernor {
  #protocol;
  #now;
  #states;

  constructor({ protocol, now = () => Date.now() }) {
    this.#protocol = assertAdaptiveEngineeringProtocol(protocol);
    this.#now = now;
    this.#states = new Map(this.#protocol.arms.map((armId) => [armId, {
      armId,
      startedAtMs: this.#now(),
      engineering: { spentUsd: 0, reservedUsd: 0, settledCalls: 0 },
      operating: { spentUsd: 0, reservedUsd: 0, settledCalls: 0 },
      reservations: new Map(),
      sequence: 0,
    }]));
  }

  #state(armId) {
    const state = this.#states.get(armId);
    requireCondition(state, `Unknown adaptive engineering arm: ${armId}`);
    return state;
  }

  #limit(kind, field) {
    const prefix = kind === "engineering" ? "Engineering" : "Operating";
    return this.#protocol.perArmLimits[`maximum${prefix}${field}`];
  }

  reserve({ armId, kind, projectedUsd, projectedCalls = 1, purpose }) {
    requireCondition(["engineering", "operating"].includes(kind), "Resource reservation kind must be engineering or operating");
    requireCondition(String(purpose ?? "").trim(), "Resource reservation requires a purpose");
    const usd = finiteNonNegative(projectedUsd, "Projected spend");
    requireCondition(Number.isInteger(projectedCalls) && projectedCalls >= 0, "Projected calls must be a non-negative integer");
    const state = this.#state(armId);
    requireCondition(this.#now() - state.startedAtMs <= this.#protocol.perArmLimits.maximumWallClockMs, `${armId} crossed its wall-clock allowance`);
    const bucket = state[kind];
    requireCondition(bucket.spentUsd + bucket.reservedUsd + usd <= this.#limit(kind, "SpendUsd") + 1e-12, `${armId} ${kind} reservation would cross its spend allowance`);
    requireCondition(bucket.settledCalls + [...state.reservations.values()].filter((item) => item.kind === kind).reduce((sum, item) => sum + item.projectedCalls, 0) + projectedCalls <= this.#limit(kind, "Calls"), `${armId} ${kind} reservation would cross its call allowance`);
    state.sequence += 1;
    const value = { armId, kind, projectedUsd: usd, projectedCalls, purpose: String(purpose), sequence: state.sequence };
    const reservationId = digest(value);
    requireCondition(!state.reservations.has(reservationId), "Resource reservation identity collided");
    state.reservations.set(reservationId, value);
    bucket.reservedUsd += usd;
    return Object.freeze({ reservationId, ...value });
  }

  settle({ reservation, actualUsd, actualCalls = reservation?.projectedCalls ?? 0 }) {
    const state = this.#state(reservation?.armId);
    const stored = state.reservations.get(reservation?.reservationId);
    requireCondition(stored && digest(stored) === reservation.reservationId, "Unknown or mutated resource reservation");
    const usd = finiteNonNegative(actualUsd, "Actual spend");
    requireCondition(Number.isInteger(actualCalls) && actualCalls >= 0, "Actual calls must be a non-negative integer");
    requireCondition(usd <= stored.projectedUsd + 1e-12, "Actual spend exceeded the fail-closed reservation");
    requireCondition(actualCalls <= stored.projectedCalls, "Actual calls exceeded the fail-closed reservation");
    const bucket = state[stored.kind];
    bucket.reservedUsd -= stored.projectedUsd;
    bucket.spentUsd += usd;
    bucket.settledCalls += actualCalls;
    state.reservations.delete(reservation.reservationId);
    return this.snapshot(stored.armId);
  }

  cancel(reservation) {
    const state = this.#state(reservation?.armId);
    const stored = state.reservations.get(reservation?.reservationId);
    requireCondition(stored && digest(stored) === reservation.reservationId, "Unknown or mutated resource reservation");
    state[stored.kind].reservedUsd -= stored.projectedUsd;
    state.reservations.delete(reservation.reservationId);
  }

  assertSettled(armId) {
    const state = this.#state(armId);
    requireCondition(state.reservations.size === 0, `${armId} has unresolved resource reservations`);
    return this.snapshot(armId);
  }

  snapshot(armId) {
    const state = this.#state(armId);
    return Object.freeze({
      armId,
      elapsedMs: this.#now() - state.startedAtMs,
      engineering: Object.freeze({ ...state.engineering }),
      operating: Object.freeze({ ...state.operating }),
      unresolvedReservations: state.reservations.size,
      equalPerArmLimitsHash: digest(this.#protocol.perArmLimits),
    });
  }
}
