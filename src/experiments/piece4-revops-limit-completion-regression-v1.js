import fs from "node:fs";
import path from "node:path";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { pricingForModel } from "../providers/model-pricing.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { revopsCycle2ValidationCases } from "../worlds/realistic-revops-cycle2-cases.js";
import { runModelRevopsCase, summarizeRevopsStage } from "./model-revops-runner.js";

const attemptId = "piece4-revops-limit-completion-regression-v1";
const sourcePath = path.resolve("artifacts/runs/piece4-revops-cycle2-validation/v1/summary.json");
const outputDir = path.resolve("artifacts/runs/piece4-revops-limit-completion-regression/v1");
if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
const campaign = paidCampaignState();
if (campaign.through !== "piece4-revops-cycle2-validation-v1") throw new Error("Preserved Cycle 2 validation must immediately precede this regression");
const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const preservedFailure = source.results.find((row) => row.caseId === "revops-c2-val-five-route-ledger");
if (source.advance || preservedFailure?.reason !== "candidate-task-cost-limit-before-call" || !preservedFailure.verification.checks.allAssignedHandled) throw new Error("Expected preserved all-outcomes-correct cost-limit failure");
const candidate = source.candidate;
const testCase = revopsCycle2ValidationCases.find((item) => item.id === preservedFailure.caseId);
fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: Math.min(.75, campaign.hardLimitUsd - campaign.cumulativeSpentUsd), warningUsd: .6 });
const gateway = new MeteredModelGateway({ provider: new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing: pricingForModel(candidate.model.family), allowPaidCalls: true, environment: process.env }), budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });
let result = null;
let error = null;
try { result = await runModelRevopsCase({ candidate, testCase, gateway, evidence, executionModel: candidate.model.family, tenantPrefix: "piece4-revops-limit-completion-regression" }); }
catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
const stage = result ? summarizeRevopsStage([candidate], [result])[0] : null;
const complete = !error && result !== null;
const advance = complete && result.passed && result.unsafeAttempts === 0 && result.status === "completed";
const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
const summary = { status: complete ? "completed" : "failed", error, attemptId, sourceAttemptId: source.attemptId, candidate, caseId: testCase.id, result, stage, advance, nextCasesReleased: false, budget: { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length }, evidenceValid };
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error, advance, result: result ? { passed: result.passed, status: result.status, reason: result.reason, completionSource: result.completionSource, unsafeAttempts: result.unsafeAttempts, costUsd: result.modelCostUsd, itemChecks: result.verification.itemChecks } : null, budget: summary.budget, evidenceValid }, null, 2));
if (!complete) process.exitCode = 1;
