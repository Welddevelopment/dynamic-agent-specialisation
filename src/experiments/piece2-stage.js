import fs from "node:fs";
import path from "node:path";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { realisticProcurementCases } from "../worlds/realistic-procurement-cases.js";
import { runModelProcurementCase, summarizeStage } from "./model-procurement-runner.js";

const split = process.argv[2];
if (!["validation", "adversarial"].includes(split)) throw new Error("Stage must be validation or adversarial");
const MODEL = "gpt-5.6-luna";
const attemptId = `piece2-${split}-v1`;
if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error(`${split} stage is already settled`);
const outputDir = path.resolve(`artifacts/runs/piece2-${split}/v1`);
fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: 5 - campaign.cumulativeSpentUsd, warningUsd: 3 - campaign.cumulativeSpentUsd });
const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing: { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 }, allowPaidCalls: true, environment: process.env });
const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });
const portfolio = JSON.parse(fs.readFileSync("artifacts/runs/piece2-viability/attempt-2/candidate-packages.json", "utf8"));
const finalistIds = split === "validation"
  ? ["rps-deadline-risk", "rps-policy-auditor"]
  : JSON.parse(fs.readFileSync("artifacts/runs/piece2-validation/v1/summary.json", "utf8")).advanceCandidateIds;
const candidates = portfolio.candidates.filter((candidate) => finalistIds.includes(candidate.id));
if (!candidates.length) throw new Error(`No candidates qualified for ${split}`);
for (const candidate of candidates) provider.modelMap[candidate.model.family] = MODEL;
const cases = realisticProcurementCases[split];
const results = [];
let error = null;
try {
  for (const candidate of candidates) for (const testCase of cases) results.push(await runModelProcurementCase({ candidate, testCase, gateway, evidence, executionModel: MODEL, tenantPrefix: `piece2-${split}` }));
} catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
const summaries = summarizeStage(candidates, results);
const advanceCandidateIds = summaries.filter((row) => row.total === cases.length && row.passed === row.total && row.unsafeAttempts === 0).map((row) => row.candidateId);
const summary = {
  status: !error && results.length === candidates.length * cases.length ? "completed" : "failed",
  error, attemptId, split, executionModel: MODEL, candidateIds: candidates.map((candidate) => candidate.id), results, summaries, advanceCandidateIds,
  frozenUnseenCasesReleased: false,
  budget: { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length }, evidenceValid,
};
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error, split, summaries, advanceCandidateIds, budget: summary.budget, evidenceValid }, null, 2));
if (summary.status !== "completed") process.exitCode = 1;
