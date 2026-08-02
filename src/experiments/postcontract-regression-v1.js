import fs from "node:fs";
import path from "node:path";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { validateCandidate } from "../compiler/candidate.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { realisticProcurementBrief } from "../roles/realistic-procurement.js";
import { realisticSupportBrief } from "../roles/realistic-support.js";
import { realisticProcurementCases } from "../worlds/realistic-procurement-cases.js";
import { cycle2AdversarialCases } from "../worlds/realistic-procurement-cycle2-cases.js";
import { realisticSupportCases } from "../worlds/realistic-support-cases.js";
import { runModelProcurementCase, summarizeStage } from "./model-procurement-runner.js";
import { runModelSupportCase, summarizeSupportStage } from "./model-support-runner.js";

const attemptId = "postcontract-regression-v1";
const outputDir = path.resolve("artifacts/runs/postcontract-regression/v1");
const supportSource = path.resolve("artifacts/runs/piece3-support-development-target/v3b/summary.json");
const procurementSource = path.resolve("artifacts/runs/piece2-cycle3-search/v1/summary.json");
const pricing = { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 };

if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
if (!fs.existsSync(supportSource) || !fs.existsSync(procurementSource)) throw new Error("Frozen support and procurement sources are required");
const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error("Post-contract regression v1 is already settled");
fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: Math.min(1.5, campaign.hardLimitUsd - campaign.cumulativeSpentUsd), warningUsd: 1.2 });
const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing, allowPaidCalls: true, environment: process.env });
const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });

function normalize(raw, brief, label) {
  const candidate = structuredClone(raw);
  delete candidate.fingerprint;
  const result = validateCandidate(candidate, brief);
  if (!result.valid) throw new Error(`${label} is invalid under the enforced contract: ${result.reasons.join(",")}`);
  return result.candidate;
}

const supportHistory = JSON.parse(fs.readFileSync(supportSource, "utf8"));
const procurementHistory = JSON.parse(fs.readFileSync(procurementSource, "utf8"));
const supportCandidate = normalize(supportHistory.result.bestCandidateFound.candidate, realisticSupportBrief, "Support finalist");
const procurementCandidate = normalize(procurementHistory.selectedCandidate, realisticProcurementBrief, "Procurement finalist");
const procurementRegressionCases = [...realisticProcurementCases.development, ...realisticProcurementCases.adversarial, ...cycle2AdversarialCases];

const supportResults = [];
const procurementResults = [];
let summary;
try {
  evidence.append("postcontract.regression-started", {
    runtimeContract: "enforced-specialist-package-v1",
    supportCandidate: { id: supportCandidate.id, fingerprint: supportCandidate.fingerprint },
    procurementCandidate: { id: procurementCandidate.id, fingerprint: procurementCandidate.fingerprint },
    supportCaseIds: realisticSupportCases.development.map((item) => item.id),
    procurementCaseIds: procurementRegressionCases.map((item) => item.id),
    validationCasesReleased: false,
    unseenCasesReleased: false,
  });
  for (const testCase of realisticSupportCases.development) {
    supportResults.push(await runModelSupportCase({ candidate: supportCandidate, testCase, gateway, evidence, executionModel: supportCandidate.model.family, tenantPrefix: "postcontract:support" }));
  }
  for (const testCase of procurementRegressionCases) {
    procurementResults.push(await runModelProcurementCase({ candidate: procurementCandidate, testCase, gateway, evidence, executionModel: procurementCandidate.model.family, tenantPrefix: "postcontract:procurement" }));
  }
  const supportStage = summarizeSupportStage([supportCandidate], supportResults)[0];
  const procurementStage = summarizeStage([procurementCandidate], procurementResults)[0];
  summary = {
    status: "completed",
    attemptId,
    runtimeContract: "enforced-specialist-package-v1",
    supportCandidate,
    procurementCandidate,
    supportResults,
    procurementResults,
    supportStage,
    procurementStage,
    passed: supportStage.passed === supportStage.total && supportStage.unsafeAttempts === 0 && procurementStage.passed === procurementStage.total && procurementStage.unsafeAttempts === 0,
    validationCasesReleased: false,
    unseenCasesReleased: false,
  };
} catch (error) {
  summary = { status: "failed", attemptId, error: error instanceof Error ? error.message : String(error), supportResults, procurementResults, validationCasesReleased: false, unseenCasesReleased: false };
}

const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
summary.budget = { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length };
summary.evidenceValid = evidenceValid;
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error: summary.error ?? null, passed: summary.passed ?? false, supportStage: summary.supportStage ?? null, procurementStage: summary.procurementStage ?? null, failedSupportCases: supportResults.filter((row) => !row.passed).map((row) => ({ caseId: row.caseId, status: row.status, reason: row.reason })), failedProcurementCases: procurementResults.filter((row) => !row.passed).map((row) => ({ caseId: row.caseId, status: row.status, reason: row.reason })), budget: summary.budget, evidenceValid }, null, 2));
if (summary.status !== "completed") process.exitCode = 1;
