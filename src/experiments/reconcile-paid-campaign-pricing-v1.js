import fs from "node:fs";
import path from "node:path";
import { EvidenceLedger } from "../core/evidence.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";

const attemptId = "pricing-reconciliation-v1";
const outputDir = path.resolve("artifacts/runs/pricing-reconciliation/v1");
const affected = [
  {
    attemptId: "piece4-revops-development-comparison-v1",
    path: "artifacts/runs/piece4-revops-development-comparison/v1/summary.json",
    modelFor: (summary, row) => summary.participants.find((item) => item.id === row.candidateId)?.model?.family,
  },
  {
    attemptId: "piece4-revops-model-promotion-v1",
    path: "artifacts/runs/piece4-revops-model-promotion/v1/summary.json",
    modelFor: (summary, row) => summary.candidates.find((item) => item.id === row.candidateId)?.model?.family,
  },
  {
    attemptId: "piece4-revops-validation-v1",
    path: "artifacts/runs/piece4-revops-validation/v1/summary.json",
    modelFor: (summary) => summary.candidate.model.family,
  },
  {
    attemptId: "piece4-revops-route-contract-regression-v1",
    path: "artifacts/runs/piece4-revops-route-contract-regression/v1/summary.json",
    modelFor: (summary) => summary.candidate.model.family,
  },
];
const multiplier = { "gpt-5.6-luna": 1, "gpt-5.6-terra": 10, "gpt-5.6-sol": 25 };
const state = paidCampaignState();
if (state.through !== "piece4-revops-route-contract-regression-v1") throw new Error("Pricing reconciliation must immediately follow the affected regression");
const corrections = affected.map((item) => {
  const summary = JSON.parse(fs.readFileSync(item.path, "utf8"));
  const rows = summary.results.map((row) => {
    const model = item.modelFor(summary, row);
    const factor = multiplier[model];
    if (!factor) throw new Error(`Unknown model pricing multiplier: ${model}`);
    const recordedUsd = row.modelCostUsd;
    return { candidateId: row.candidateId, caseId: row.caseId, model, factor, recordedUsd, correctedUsd: recordedUsd * factor, correctionUsd: recordedUsd * (factor - 1) };
  });
  return { attemptId: item.attemptId, recordedUsd: rows.reduce((sum, row) => sum + row.recordedUsd, 0), correctedUsd: rows.reduce((sum, row) => sum + row.correctedUsd, 0), correctionUsd: rows.reduce((sum, row) => sum + row.correctionUsd, 0), rows };
});
const correctionUsd = corrections.reduce((sum, item) => sum + item.correctionUsd, 0);
fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
evidence.append("pricing-reconciliation.calculated", { affectedAttempts: corrections.map((item) => item.attemptId), priorCumulativeUsd: state.cumulativeSpentUsd, correctionUsd });
const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(state, { attemptId, spentUsd: correctionUsd, evidenceValid });
const summary = { status: "completed", attemptId, reason: "Terra and Sol calls in four RevOps attempts were recorded with Luna rates; all three rate dimensions use exact 10x and 25x multipliers respectively.", priorCumulativeUsd: state.cumulativeSpentUsd, corrections, correctionUsd, correctedCumulativeUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, evidenceValid };
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, correctionUsd, correctedCumulativeUsd: summary.correctedCumulativeUsd, remainingUsd: summary.hardLimitUsd - summary.correctedCumulativeUsd, affectedAttempts: corrections.map((item) => ({ attemptId: item.attemptId, recordedUsd: item.recordedUsd, correctedUsd: item.correctedUsd, correctionUsd: item.correctionUsd })), evidenceValid }, null, 2));
