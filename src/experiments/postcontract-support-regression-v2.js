import fs from "node:fs";
import path from "node:path";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { validateCandidate } from "../compiler/candidate.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { realisticSupportBrief } from "../roles/realistic-support.js";
import { realisticSupportCases } from "../worlds/realistic-support-cases.js";
import { runModelSupportCase, summarizeSupportStage } from "./model-support-runner.js";

const attemptId = "postcontract-support-regression-v2";
const outputDir = path.resolve("artifacts/runs/postcontract-regression/support-v2");
const sourcePath = path.resolve("artifacts/runs/piece3-support-development-target/v3b/summary.json");
const pricing = { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 };

if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error("Support post-contract regression v2 is already settled");
const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const raw = structuredClone(source.result.bestCandidateFound.candidate);
delete raw.fingerprint;
const normalized = validateCandidate(raw, realisticSupportBrief);
if (!normalized.valid) throw new Error(`Support finalist is invalid: ${normalized.reasons.join(",")}`);
const candidate = normalized.candidate;

fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: Math.min(.75, campaign.hardLimitUsd - campaign.cumulativeSpentUsd), warningUsd: .6 });
const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing, allowPaidCalls: true, environment: process.env });
const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });
const results = [];
let summary;
try {
  evidence.append("support-regression-v2.started", { candidateId: candidate.id, fingerprint: candidate.fingerprint, repair: "enum-constrained-ticket-status", caseIds: realisticSupportCases.development.map((item) => item.id), validationCasesReleased: false, unseenCasesReleased: false });
  for (const testCase of realisticSupportCases.development) results.push(await runModelSupportCase({ candidate, testCase, gateway, evidence, executionModel: candidate.model.family, tenantPrefix: "postcontract:support-v2" }));
  const stage = summarizeSupportStage([candidate], results)[0];
  summary = { status: "completed", attemptId, candidate, repair: "enum-constrained-ticket-status", results, stage, passed: stage.passed === stage.total && stage.unsafeAttempts === 0, validationCasesReleased: false, unseenCasesReleased: false };
} catch (error) {
  summary = { status: "failed", attemptId, error: error instanceof Error ? error.message : String(error), results, validationCasesReleased: false, unseenCasesReleased: false };
}
const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
summary.budget = { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length };
summary.evidenceValid = evidenceValid;
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error: summary.error ?? null, passed: summary.passed ?? false, stage: summary.stage ?? null, failures: results.filter((row) => !row.passed).map((row) => ({ caseId: row.caseId, status: row.status, reason: row.reason, verification: row.verification })), budget: summary.budget, evidenceValid }, null, 2));
if (summary.status !== "completed") process.exitCode = 1;
