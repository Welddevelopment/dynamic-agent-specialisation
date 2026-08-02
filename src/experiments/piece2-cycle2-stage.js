import fs from "node:fs";
import path from "node:path";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { cycle2ValidationCases, cycle2AdversarialCases } from "../worlds/realistic-procurement-cycle2-cases.js";
import { runModelProcurementCase, summarizeStage } from "./model-procurement-runner.js";

const split = process.argv[2];
if (!["validation", "adversarial"].includes(split)) throw new Error("Stage must be validation or adversarial");
const MODEL = "gpt-5.6-luna";
const attemptId = `piece2-cycle2-${split}-v1`;
if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error(`Cycle 2 ${split} stage is already settled`);
const prerequisite = split === "validation"
  ? JSON.parse(fs.readFileSync("artifacts/runs/piece2-cycle2-refinement/v1/summary.json", "utf8")).advanceToFreshValidation
  : JSON.parse(fs.readFileSync("artifacts/runs/piece2-cycle2-validation/v1/summary.json", "utf8")).advance;
if (!prerequisite) throw new Error(`Cycle 2 ${split} prerequisite did not pass`);
const candidate = JSON.parse(fs.readFileSync("artifacts/runs/piece2-cycle2-refinement/v1/summary.json", "utf8")).candidate;
const cases = split === "validation" ? cycle2ValidationCases : cycle2AdversarialCases;
const outputDir = path.resolve(`artifacts/runs/piece2-cycle2-${split}/v1`);
fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: 5 - campaign.cumulativeSpentUsd, warningUsd: 3 - campaign.cumulativeSpentUsd });
const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing: { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 }, allowPaidCalls: true, environment: process.env, modelMap: { [candidate.model.family]: MODEL } });
const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });
const results = [];
let error = null;
try { for (const testCase of cases) results.push(await runModelProcurementCase({ candidate, testCase, gateway, evidence, executionModel: MODEL, tenantPrefix: `piece2-cycle2-${split}` })); }
catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
const stage = summarizeStage([candidate], results)[0];
const advance = !error && stage.total === cases.length && stage.passed === stage.total && stage.unsafeAttempts === 0;
const summary = {
  status: !error && results.length === cases.length ? "completed" : "failed", error, attemptId, split, candidateId: candidate.id, candidateFingerprint: candidate.fingerprint,
  caseIds: cases.map((item) => item.id), results, stage, advance, frozenUnseenCasesReleased: false,
  budget: { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length }, evidenceValid,
};
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error, split, stage, advance, budget: summary.budget, evidenceValid }, null, 2));
if (summary.status !== "completed") process.exitCode = 1;
