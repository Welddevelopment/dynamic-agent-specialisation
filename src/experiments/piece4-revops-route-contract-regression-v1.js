import fs from "node:fs";
import path from "node:path";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { realisticRevopsCases } from "../worlds/realistic-revops-cases.js";
import { runModelRevopsCase, summarizeRevopsStage } from "./model-revops-runner.js";

const attemptId = "piece4-revops-route-contract-regression-v1";
const sourcePath = path.resolve("artifacts/runs/piece4-revops-model-promotion/v1/summary.json");
const outputDir = path.resolve("artifacts/runs/piece4-revops-route-contract-regression/v1");
const pricing = { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 };
if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
const campaign = paidCampaignState();
if (campaign.through !== "piece4-revops-validation-v1") throw new Error("Preserved failed validation must immediately precede the repaired regression");
const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
if (!source.advance || !source.selectedCandidate) throw new Error("Selected promoted candidate is required");
const candidate = source.selectedCandidate;
fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: Math.min(.75, campaign.hardLimitUsd - campaign.cumulativeSpentUsd), warningUsd: .6 });
const gateway = new MeteredModelGateway({ provider: new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing, allowPaidCalls: true, environment: process.env }), budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });
const results = [];
let error = null;
evidence.append("revops-route-contract-regression.started", { candidateId: candidate.id, caseIds: realisticRevopsCases.development.map((item) => item.id), changedBoundary: "machine-readable-routing-policy-v2", laterCasesReleased: false });
try {
  for (const testCase of realisticRevopsCases.development) {
    const row = await runModelRevopsCase({ candidate, testCase, gateway, evidence, executionModel: candidate.model.family, tenantPrefix: "piece4-revops-policy-v2" });
    results.push(row);
    console.log(JSON.stringify({ progress: testCase.id, passed: row.passed, unsafeAttempts: row.unsafeAttempts, repairRounds: row.verificationRepairRounds, spentUsd: budget.spentUsd }));
  }
} catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
const stage = summarizeRevopsStage([candidate], results)[0];
const complete = !error && results.length === realisticRevopsCases.development.length;
const advance = complete && stage.passed === stage.total && stage.unsafeAttempts === 0;
const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
const summary = { status: complete ? "completed" : "failed", error, attemptId, sourceAttemptId: source.attemptId, changedBoundary: "machine-readable-routing-policy-v2", candidate, results, stage, advance, laterCasesReleased: false, budget: { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length }, evidenceValid };
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error, stage, advance, failures: results.filter((row) => !row.passed).map((row) => ({ caseId: row.caseId, unsafeAttempts: row.unsafeAttempts, recoveryClass: row.verification.recoveryClass, itemChecks: row.verification.itemChecks })), budget: summary.budget, evidenceValid }, null, 2));
if (!complete) process.exitCode = 1;
