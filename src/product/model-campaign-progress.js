import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { EvidenceLedger } from "../core/evidence.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }
function readJson(file, label) {
  requireCondition(fs.existsSync(file), `${label} is missing`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }

export function inspectCommercialModelCampaignProgress({ stateDirectory, plan }) {
  requireCondition(stateDirectory && plan?.campaignId && plan?.planHash, "Campaign progress needs an exact state directory and frozen plan");
  const root = path.resolve(stateDirectory);
  const budgetPath = path.join(root, "budget.json");
  const cachePath = path.join(root, "response-cache.json");
  const evidencePath = path.join(root, "evidence.jsonl");
  const pausePath = path.join(root, "latest-pause.json");
  const resultPath = path.join(root, "model-result.json");
  const budget = readJson(budgetPath, "Durable model budget");
  const cache = readJson(cachePath, "Persistent response cache");
  requireCondition(budget.schemaVersion === "das.durable-model-budget.v1" && budget.integrityHash === digest(withoutHash(budget, "integrityHash")), "Durable model budget integrity mismatch");
  requireCondition(cache.schemaVersion === "das.model-response-cache.v1" && cache.integrityHash === digest(withoutHash(cache, "integrityHash")), "Persistent response cache integrity mismatch");
  requireCondition(budget.campaignId === plan.campaignId, "Durable budget belongs to another campaign");
  const evidence = new EvidenceLedger(evidencePath);
  requireCondition(evidence.verify(), "Campaign evidence ledger integrity mismatch");
  const records = evidence.records();
  const calls = budget.calls ?? [];
  const settled = calls.filter((item) => item.status === "settled");
  const pause = fs.existsSync(pausePath) ? readJson(pausePath, "Campaign pause receipt") : null;
  if (pause) {
    requireCondition(pause.failureHash === digest(withoutHash(pause, "failureHash")), "Campaign pause receipt integrity mismatch");
    requireCondition(pause.campaignId === plan.campaignId && pause.planHash === plan.planHash, "Campaign pause receipt belongs to another frozen plan");
  }
  const completed = fs.existsSync(resultPath);
  const receipt = {
    schemaVersion: "das.commercial-model-campaign-progress.v1",
    campaignId: plan.campaignId,
    planHash: plan.planHash,
    status: completed ? "completed-result-present" : pause?.status ?? "in-progress",
    resumable: !completed && pause?.resumable === true,
    progress: {
      spentUsd: settled.reduce((sum, item) => sum + Number(item.actualUsd ?? 0), 0),
      settledCalls: settled.length,
      cachedResponses: cache.entries?.length ?? 0,
      cancelledUnchargedCalls: calls.filter((item) => item.status === "cancelled").length,
      unresolvedReservations: calls.filter((item) => ["reserved", "outcome-unknown"].includes(item.status)).length,
      independentlyVerifiedCases: records.filter((item) => item.type === "commercial-comparison.case-verified").length,
      finishedStages: records.filter((item) => item.type === "commercial-comparison.stage-finished").map((item) => item.payload?.stage).filter(Boolean),
    },
    integrity: {
      evidenceLedgerValid: true,
      budgetFileSha256: sha256(budgetPath),
      responseCacheFileSha256: sha256(cachePath),
      evidenceFileSha256: sha256(evidencePath),
      pauseFileSha256: pause ? sha256(pausePath) : null,
      resultFileSha256: completed ? sha256(resultPath) : null,
    },
    resume: {
      reusesCachedResponses: true,
      chargedCallsReplayed: false,
      exactPlanRequired: true,
      note: completed ? "The completed result must be inspected separately." : pause?.resumable ? "Rerun the exact frozen campaign after account funding is restored. Settled requests are served from the integrity-checked local cache." : "No resumable provider-funding pause is currently recorded.",
    },
    evidenceBoundary: completed
      ? "Progress receipt only. The separate sealed result determines whether any participant improved."
      : "Preserved partial campaign progress only. No participant ranking, improvement, repeatability, or commercial result may be inferred before the frozen comparison completes.",
  };
  receipt.receiptHash = digest(receipt);
  return Object.freeze(receipt);
}

export function writeCommercialModelCampaignProgress({ stateDirectory, plan }) {
  const receipt = inspectCommercialModelCampaignProgress({ stateDirectory, plan });
  const output = path.resolve(stateDirectory, "progress-receipt.json");
  fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(output, 0o600);
  return Object.freeze({ output, receipt });
}
