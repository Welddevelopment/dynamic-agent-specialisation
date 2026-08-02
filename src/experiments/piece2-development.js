import fs from "node:fs";
import path from "node:path";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { realisticProcurementCases } from "../worlds/realistic-procurement-cases.js";
import { runModelProcurementCase, summarizeStage } from "./model-procurement-runner.js";

const MODEL = "gpt-5.6-luna";
const STAGE_CUMULATIVE_LIMIT_USD = 3;
const attemptId = "piece2-development-v1";
if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error("Development stage is already settled");
const outputDir = path.resolve("artifacts/runs/piece2-development/v1");
fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: STAGE_CUMULATIVE_LIMIT_USD - campaign.cumulativeSpentUsd, warningUsd: 2 - campaign.cumulativeSpentUsd });
const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing: { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 }, allowPaidCalls: true, environment: process.env });
const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });
const portfolio = JSON.parse(fs.readFileSync("artifacts/runs/piece2-viability/attempt-2/candidate-packages.json", "utf8"));
const candidates = portfolio.candidates;
for (const candidate of candidates) provider.modelMap[candidate.model.family] = MODEL;

const results = [];
let error = null;
try {
  for (const candidate of candidates) {
    for (const testCase of realisticProcurementCases.development) {
      const result = await runModelProcurementCase({ candidate, testCase, gateway, evidence, executionModel: MODEL, tenantPrefix: "piece2-development" });
      results.push(result);
      fs.writeFileSync(path.join(outputDir, "progress.json"), `${JSON.stringify({ results, summaries: summarizeStage(candidates, results) }, null, 2)}\n`, "utf8");
    }
  }
} catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }

const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
const summaries = summarizeStage(candidates, results);
const summary = {
  status: !error && results.length === candidates.length * realisticProcurementCases.development.length ? "completed" : "failed",
  error,
  attemptId,
  executionModel: MODEL,
  candidates: candidates.length,
  cases: realisticProcurementCases.development.length,
  results,
  summaries,
  eliminationRecommendation: summaries.filter((row) => row.unsafeAttempts === 0).sort((a, b) => b.successRate - a.successRate || a.costUsd - b.costUsd).slice(0, 2).map((row) => row.candidateId),
  frozenUnseenCasesReleased: false,
  budget: { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length },
  evidenceValid,
};
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error, summaries, eliminationRecommendation: summary.eliminationRecommendation, budget: summary.budget, evidenceValid }, null, 2));
if (summary.status !== "completed") process.exitCode = 1;
