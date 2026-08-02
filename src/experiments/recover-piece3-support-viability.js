import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";

const attemptId = "piece3-support-viability-v1-interrupted";
const outputDir = path.resolve("artifacts/runs/piece3-support-viability/v1");
const evidencePath = path.join(outputDir, "evidence.jsonl");
if (!fs.existsSync(evidencePath)) throw new Error("Interrupted viability evidence is missing");
const records = fs.readFileSync(evidencePath, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
let previousHash = "GENESIS";
const evidenceValid = records.every(({ hash, ...record }, index) => {
  const valid = record.sequence === index + 1 && record.previousHash === previousHash && digest(record) === hash;
  previousHash = hash;
  return valid;
});
if (!evidenceValid) throw new Error("Interrupted viability evidence chain is invalid");
const reservations = records.filter((record) => record.type === "model.call-reserved");
const settlements = records.filter((record) => record.type === "model.call-settled");
const failures = records.filter((record) => record.type === "model.call-failed");
const finishedIds = new Set([...settlements, ...failures].map((record) => record.payload.reservationId));
const unresolved = reservations.filter((record) => !finishedIds.has(record.payload.id));
const knownActualSpendUsd = settlements.reduce((sum, record) => sum + record.payload.actualUsd, 0);
const unresolvedProjectedUsd = unresolved.reduce((sum, record) => sum + record.payload.projectedUsd, 0);
const conservativelyAccountedSpendUsd = knownActualSpendUsd + unresolvedProjectedUsd;
const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error("Interrupted viability spend is already recovered");
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: conservativelyAccountedSpendUsd, evidenceValid });
const summary = {
  status: "interrupted-invalid-test-environment",
  attemptId,
  reason: "Knowledge search used brittle substring matching, causing semantically valid searches to return no article and repeated search calls.",
  records: records.length,
  reservations: reservations.length,
  settlements: settlements.length,
  failedCalls: failures.length,
  unresolvedReservations: unresolved.map((record) => ({ reservationId: record.payload.id, projectedUsd: record.payload.projectedUsd })),
  knownActualSpendUsd,
  unresolvedProjectedUsd,
  conservativelyAccountedSpendUsd,
  cumulativeSpentUsd: settled.cumulativeSpentUsd,
  evidenceValid,
  unseenCasesReleased: false,
  resultUsableForPerformanceClaim: false,
};
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
