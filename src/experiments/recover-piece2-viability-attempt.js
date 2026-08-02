import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";

const attemptNumber = Number(process.argv[2]);
if (!Number.isInteger(attemptNumber) || attemptNumber < 1) throw new Error("Provide a positive attempt number");
const attemptId = `piece2-viability-attempt-${attemptNumber}`;
const outputDir = path.resolve(`artifacts/runs/piece2-viability/attempt-${attemptNumber}`);
const evidenceFile = path.join(outputDir, "evidence.jsonl");
const rows = fs.readFileSync(evidenceFile, "utf8").trim().split("\n").map(JSON.parse);

let previousHash = "GENESIS";
for (let index = 0; index < rows.length; index += 1) {
  const { hash, ...record } = rows[index];
  if (record.sequence !== index + 1 || record.previousHash !== previousHash || digest(record) !== hash) throw new Error(`Evidence chain failed at row ${index + 1}`);
  previousHash = hash;
}

const settled = rows.filter((row) => row.type === "model.call-settled");
const reservations = new Map(rows.filter((row) => row.type === "model.call-reserved").map((row) => [row.payload.id, row.payload]));
for (const row of rows.filter((entry) => entry.type === "model.call-settled" || entry.type === "model.call-failed")) reservations.delete(row.payload.reservationId);
if (reservations.size) throw new Error(`Cannot recover attempt with ${reservations.size} unresolved model reservation(s)`);

const verifications = rows.filter((row) => row.type === "runtime.external-verification").map((row) => ({
  candidateId: row.payload.candidateId,
  passed: row.payload.verification.passed,
  checks: row.payload.verification.checks,
  newOrders: row.payload.verification.newOrders.length,
  newTransfers: row.payload.verification.newTransfers.length,
  spend: row.payload.verification.spend,
}));
if (!verifications.length) throw new Error("No external verification exists to recover");
const proposal = rows.find((row) => row.type === "candidate.proposal")?.payload;
const attemptSpendUsd = settled.reduce((sum, row) => sum + row.payload.actualUsd, 0);
const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error("Attempt is already settled in the paid campaign ledger");
const nextCampaign = settlePaidCampaign(campaign, { attemptId, spentUsd: attemptSpendUsd, evidenceValid: true });
const summary = {
  status: verifications.some((verification) => verification.passed) ? "passed" : "failed",
  interpretation: "Recovered after the process ended between final verification and summary persistence. All costs and results come from the intact hash-chained evidence ledger.",
  attemptId,
  resolvedModel: "gpt-5.6-luna",
  generatedCandidates: proposal?.admitted?.length ?? null,
  rejectedCandidates: proposal?.rejected?.length ?? null,
  trialCandidates: verifications,
  completedCount: verifications.filter((verification) => verification.passed).length,
  frozenUnseenCasesReleased: false,
  budget: { attemptSpendUsd, priorCumulativeSpentUsd: campaign.cumulativeSpentUsd, cumulativeSpentUsd: nextCampaign.cumulativeSpentUsd, campaignHardLimitUsd: nextCampaign.hardLimitUsd, settledCalls: settled.length },
  evidenceValid: true,
};
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
