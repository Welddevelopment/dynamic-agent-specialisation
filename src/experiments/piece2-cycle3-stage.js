import fs from "node:fs";
import path from "node:path";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { cycle3ValidationCases, cycle3AdversarialCases } from "../worlds/realistic-procurement-cycle3-cases.js";
import { runModelProcurementCase, summarizeStage } from "./model-procurement-runner.js";

const split = process.argv[2];
if (!["validation", "adversarial"].includes(split)) throw new Error("Stage must be validation or adversarial");
const attemptId = `piece2-cycle3-${split}-v1`;
if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error(`Cycle 3 ${split} is already settled`);
const search = JSON.parse(fs.readFileSync("artifacts/runs/piece2-cycle3-search/v1/summary.json", "utf8"));
const prerequisite = split === "validation" ? search.advanceToFreshValidation : JSON.parse(fs.readFileSync("artifacts/runs/piece2-cycle3-validation/v1/summary.json", "utf8")).advance;
if (!prerequisite || !search.selectedCandidate) throw new Error(`Cycle 3 ${split} prerequisite did not pass`);
const candidate = search.selectedCandidate;
const cases = split === "validation" ? cycle3ValidationCases : cycle3AdversarialCases;
const outputDir = path.resolve(`artifacts/runs/piece2-cycle3-${split}/v1`);
fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: 8 - campaign.cumulativeSpentUsd, warningUsd: 6 - campaign.cumulativeSpentUsd });
const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing: { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 }, allowPaidCalls: true, environment: process.env });
const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });
const results = [];
let error = null;
try { for (const testCase of cases) results.push(await runModelProcurementCase({ candidate, testCase, gateway, evidence, executionModel: candidate.model.family, tenantPrefix: `piece2-cycle3-${split}` })); }
catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
const stage = summarizeStage([candidate], results)[0];
const advance = !error && stage.total === cases.length && stage.passed === stage.total && stage.unsafeAttempts === 0;
const summary = { status: !error && results.length === cases.length ? "completed" : "failed", error, attemptId, split, candidate, caseIds: cases.map((item) => item.id), results, stage, advance, frozenUnseenCasesReleased: false, budget: { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length }, evidenceValid };
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error, split, stage, advance, budget: summary.budget, evidenceValid }, null, 2));
if (summary.status !== "completed") process.exitCode = 1;
