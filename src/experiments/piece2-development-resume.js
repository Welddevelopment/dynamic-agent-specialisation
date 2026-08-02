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
const RESUME = 1;
const attemptId = `piece2-development-v1-resume-${RESUME}`;
if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error("This development resume is already settled");
const baseDir = path.resolve("artifacts/runs/piece2-development/v1");
const outputDir = path.resolve(`artifacts/runs/piece2-development/v1-resume-${RESUME}`);
fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: 3 - campaign.cumulativeSpentUsd, warningUsd: 2 - campaign.cumulativeSpentUsd });
const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing: { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 }, allowPaidCalls: true, environment: process.env });
const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });
const candidates = JSON.parse(fs.readFileSync("artifacts/runs/piece2-viability/attempt-2/candidate-packages.json", "utf8")).candidates;
for (const candidate of candidates) provider.modelMap[candidate.model.family] = MODEL;
const prior = JSON.parse(fs.readFileSync(path.join(baseDir, "progress.json"), "utf8")).results;
const completedPairs = new Set(prior.map((row) => `${row.candidateId}\u0000${row.caseId}`));
const resumed = [];
let error = null;
try {
  for (const candidate of candidates) {
    for (const testCase of realisticProcurementCases.development) {
      if (completedPairs.has(`${candidate.id}\u0000${testCase.id}`)) continue;
      const result = await runModelProcurementCase({ candidate, testCase, gateway, evidence, executionModel: MODEL, tenantPrefix: `piece2-development-resume-${RESUME}` });
      resumed.push(result);
      fs.writeFileSync(path.join(outputDir, "progress.json"), `${JSON.stringify({ prior, resumed, combined: [...prior, ...resumed] }, null, 2)}\n`, "utf8");
    }
  }
} catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
const results = [...prior, ...resumed];
const summaries = summarizeStage(candidates, results);
const expected = candidates.length * realisticProcurementCases.development.length;
const summary = {
  status: !error && results.length === expected ? "completed" : "failed",
  error, attemptId, executionModel: MODEL, priorResultsPreserved: prior.length, resumedResults: resumed.length,
  results, summaries,
  eliminationRecommendation: summaries.filter((row) => row.unsafeAttempts === 0).sort((a, b) => b.successRate - a.successRate || a.costUsd - b.costUsd).slice(0, 2).map((row) => row.candidateId),
  frozenUnseenCasesReleased: false,
  budget: { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length }, evidenceValid,
};
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error, priorResultsPreserved: prior.length, resumedResults: resumed.length, summaries, eliminationRecommendation: summary.eliminationRecommendation, budget: summary.budget, evidenceValid }, null, 2));
if (summary.status !== "completed") process.exitCode = 1;
