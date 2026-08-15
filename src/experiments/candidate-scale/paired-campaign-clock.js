import { digest } from "../../core/canonical.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }

export function createPairedCampaignClock({ planHash, startedAt = new Date().toISOString() }) {
  const value = { schemaVersion: "das.candidate-scale-paired-campaign-clock.v1", planHash, startedAt };
  return { ...value, integrityHash: digest(value) };
}

export function assertPairedCampaignClock(clock, { planHash }) {
  const copy = structuredClone(clock); const expected = copy.integrityHash; delete copy.integrityHash;
  requireCondition(clock?.schemaVersion === "das.candidate-scale-paired-campaign-clock.v1" && clock.planHash === planHash && expected === digest(copy), "Paired campaign clock integrity mismatch");
  requireCondition(Number.isFinite(Date.parse(clock.startedAt)), "Paired campaign clock needs a valid start time"); return true;
}

export function pairedCampaignRemainingMs(clock, maximumWallClockMs, now = Date.now()) {
  const remaining = maximumWallClockMs - (now - Date.parse(clock.startedAt));
  requireCondition(remaining > 0, "Paired campaign reached its single durable wall-clock limit"); return remaining;
}

