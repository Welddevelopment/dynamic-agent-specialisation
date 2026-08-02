import fs from "node:fs";
import path from "node:path";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { ModelCandidateRefiner } from "../compiler/model-refiner.js";
import { realisticProcurementBrief } from "../roles/realistic-procurement.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { realisticProcurementCases } from "../worlds/realistic-procurement-cases.js";
import { runModelProcurementCase, summarizeStage } from "./model-procurement-runner.js";

const MODEL = "gpt-5.6-luna";
const attemptId = "piece2-controlled-refinement-v1";
if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error("Refinement stage is already settled");
const outputDir = path.resolve("artifacts/runs/piece2-refinement/v1");
fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: 3 - campaign.cumulativeSpentUsd, warningUsd: 2 - campaign.cumulativeSpentUsd });
const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing: { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 }, allowPaidCalls: true, environment: process.env, modelMap: { "candidate-refiner-policy": MODEL } });
const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });
const portfolio = JSON.parse(fs.readFileSync("artifacts/runs/piece2-viability/attempt-2/candidate-packages.json", "utf8"));
const parent = portfolio.candidates.find((candidate) => candidate.id === "rps-coverage-first");
provider.modelMap[parent.model.family] = MODEL;
const development = JSON.parse(fs.readFileSync("artifacts/runs/piece2-development/v1-resume-1/summary.json", "utf8"));
const failures = development.results.filter((row) => row.candidateId === parent.id && !row.passed).map((row) => ({ caseId: row.caseId, status: row.status, checks: row.verification.checks, coverage: row.verification.coverage, newOrders: row.verification.newOrders, newTransfers: row.verification.newTransfers }));
if (failures.length !== 1) throw new Error(`Expected one grounded parent failure, found ${failures.length}`);

let summary;
try {
  const refinement = await new ModelCandidateRefiner({ gateway }).refine({ brief: realisticProcurementBrief, parent, developmentFailures: failures });
  provider.modelMap[refinement.candidate.model.family] = MODEL;
  fs.writeFileSync(path.join(outputDir, "refined-candidate.json"), `${JSON.stringify(refinement, null, 2)}\n`, "utf8");
  const results = [];
  for (const testCase of realisticProcurementCases.development) results.push(await runModelProcurementCase({ candidate: refinement.candidate, testCase, gateway, evidence, executionModel: MODEL, tenantPrefix: "piece2-refinement" }));
  const stage = summarizeStage([refinement.candidate], results)[0];
  summary = { status: "completed", attemptId, parentId: parent.id, candidate: refinement.candidate, differences: refinement.differences, failuresUsed: failures.map((failure) => failure.caseId), results, stage, advanceToValidation: stage.passed === stage.total && stage.unsafeAttempts === 0, frozenUnseenCasesReleased: false };
} catch (error) { summary = { status: "failed", attemptId, error: error instanceof Error ? error.message : String(error), frozenUnseenCasesReleased: false }; }
const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
summary.budget = { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length };
summary.evidenceValid = evidenceValid;
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error: summary.error ?? null, differences: summary.differences ?? null, stage: summary.stage ?? null, advanceToValidation: summary.advanceToValidation ?? false, budget: summary.budget, evidenceValid }, null, 2));
if (summary.status !== "completed") process.exitCode = 1;
