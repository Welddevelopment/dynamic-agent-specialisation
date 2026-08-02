import fs from "node:fs";
import path from "node:path";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { createPiece2ModelBaselines } from "../evaluation/piece2-baselines.js";
import { realisticProcurementStrategies } from "../evaluation/realistic-procurement-strategies.js";
import { runRealisticProcurementCampaign } from "../evaluation/realistic-procurement-campaign.js";
import { cycle3ValidationCases, cycle3AdversarialCases } from "../worlds/realistic-procurement-cycle3-cases.js";
import { runModelProcurementCase, summarizeStage } from "./model-procurement-runner.js";

const attemptId = "piece2-baseline-stage-v1";
const PRICING = {
  "gpt-5.6-luna": { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 },
  "gpt-5.6-terra": { inputPerMillionUsd: 2, cachedInputPerMillionUsd: .2, outputPerMillionUsd: 12 },
  "gpt-5.6-sol": { inputPerMillionUsd: 5, cachedInputPerMillionUsd: .5, outputPerMillionUsd: 30 },
};
if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
const candidateAdversarial = JSON.parse(fs.readFileSync("artifacts/runs/piece2-cycle3-adversarial/v1/summary.json", "utf8"));
if (!candidateAdversarial.advance) throw new Error("Candidate did not pass Cycle 3 adversarial gate");
const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error("Baseline stage is already settled");
const outputDir = path.resolve("artifacts/runs/piece2-baselines/v1");
fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: 15 - campaign.cumulativeSpentUsd, warningUsd: 10 - campaign.cumulativeSpentUsd });
const baselines = createPiece2ModelBaselines();
const cases = [...cycle3ValidationCases, ...cycle3AdversarialCases];
const modelResults = [];
let error = null;
try {
  for (const candidate of baselines) {
    const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing: PRICING[candidate.model.family], allowPaidCalls: true, environment: process.env });
    const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });
    for (const testCase of cases) modelResults.push(await runModelProcurementCase({ candidate, testCase, gateway, evidence, executionModel: candidate.model.family, tenantPrefix: "piece2-baseline" }));
  }
} catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
const deterministic = await runRealisticProcurementCampaign({ suites: { development: [], validation: cycle3ValidationCases, adversarial: cycle3AdversarialCases }, strategies: realisticProcurementStrategies });
const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
const summaries = summarizeStage(baselines, modelResults);
const summary = {
  status: !error && modelResults.length === baselines.length * cases.length ? "completed" : "failed", error, attemptId, cases: cases.map((item) => item.id), baselines, modelResults, modelSummaries: summaries, deterministic,
  candidateCycle3: { validation: JSON.parse(fs.readFileSync("artifacts/runs/piece2-cycle3-validation/v1/summary.json", "utf8")).stage, adversarial: candidateAdversarial.stage },
  frozenUnseenCasesReleased: false,
  budget: { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length }, evidenceValid,
};
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error, modelSummaries: summaries, deterministicSummaries: deterministic.summaries, candidateCycle3: summary.candidateCycle3, budget: summary.budget, evidenceValid }, null, 2));
if (summary.status !== "completed") process.exitCode = 1;
