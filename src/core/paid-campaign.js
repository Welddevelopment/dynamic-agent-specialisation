import fs from "node:fs";
import path from "node:path";

export const PAID_CAMPAIGN_HARD_LIMIT_USD = 25;
export const PAID_CAMPAIGN_KNOWN_SPEND_USD = 0.0076864;

export function paidCampaignState(filename = "artifacts/runs/paid-campaign-state.json") {
  const absolute = path.resolve(filename);
  if (!fs.existsSync(absolute)) {
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const initial = { currency: "USD", hardLimitUsd: PAID_CAMPAIGN_HARD_LIMIT_USD, cumulativeSpentUsd: PAID_CAMPAIGN_KNOWN_SPEND_USD, through: "piece2-smoke-attempt-3" };
    fs.writeFileSync(absolute, `${JSON.stringify(initial, null, 2)}\n`, "utf8");
    return { filename: absolute, ...initial };
  }
  const current = JSON.parse(fs.readFileSync(absolute, "utf8"));
  if (current.hardLimitUsd !== PAID_CAMPAIGN_HARD_LIMIT_USD) throw new Error("Paid campaign hard limit changed unexpectedly");
  if (current.cumulativeSpentUsd + 1e-12 < PAID_CAMPAIGN_KNOWN_SPEND_USD) throw new Error("Paid campaign ledger is below known historical spend");
  return { filename: absolute, ...current };
}

export function settlePaidCampaign(state, { attemptId, spentUsd, evidenceValid }) {
  if (!evidenceValid) throw new Error("Refusing to settle paid campaign from invalid evidence");
  const cumulativeSpentUsd = state.cumulativeSpentUsd + spentUsd;
  if (cumulativeSpentUsd > state.hardLimitUsd) throw new Error("Paid campaign exceeded hard limit");
  const next = { currency: "USD", hardLimitUsd: state.hardLimitUsd, cumulativeSpentUsd, through: attemptId, updatedAt: new Date().toISOString() };
  fs.writeFileSync(state.filename, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { filename: state.filename, ...next };
}
