import fs from "node:fs";
import path from "node:path";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { ModelCandidateRefiner } from "../compiler/model-refiner.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { realisticSupportBrief } from "../roles/realistic-support.js";
import { realisticSupportCases } from "../worlds/realistic-support-cases.js";
import { runModelSupportCase, summarizeSupportStage } from "./model-support-runner.js";

const attemptId = "piece3-support-cycle2-refinement-v2-protected";
const outputDir = path.resolve("artifacts/runs/piece3-support-cycle2-refinement/v2");
const parentPath = path.resolve("artifacts/runs/piece3-support-development-target/v3b/summary.json");
const failurePath = path.resolve("artifacts/runs/piece3-support-fresh-adversarial/v1/summary.json");
const rejectedPath = path.resolve("artifacts/runs/piece3-support-cycle2-refinement/v1/summary.json");
const pricing = { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 };

if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error("Protected support Cycle 2 refinement is already settled");
const parentSummary = JSON.parse(fs.readFileSync(parentPath, "utf8"));
const failedGate = JSON.parse(fs.readFileSync(failurePath, "utf8"));
const rejected = JSON.parse(fs.readFileSync(rejectedPath, "utf8"));
if (rejected.advance || rejected.stage?.passed !== 12) throw new Error("V1 rejected-revision evidence is required");
const parent = parentSummary.result.bestCandidateFound.candidate;
const failed = failedGate.results.find((row) => row.caseId === "support-adv-wrong-incident");
if (!failed || failed.passed) throw new Error("Expected visible classification failure is missing");
const developmentFailures = [{
  caseId: failed.caseId,
  status: failed.status,
  observedToolSequence: failed.toolSequence,
  verifierChecks: failed.verification.checks,
  exactItemChecks: failed.verification.itemChecks,
  generalLesson: "Relevant documentation can guide a true how-to request, but matching documentation does not convert a reported reproducible product failure into a how-to resolution. If no exact active incident explains the failure, use product-engineering escalation plus the customer-facing engineering response rather than closing it as how-to.",
}, {
  caseId: "rejected-revision-regression",
  status: "rejected-child-regressed-two-billing-review-cases",
  exactMissingOutcomes: ["response:engineering-escalated"],
  generalLesson: "The parent billing-review completion rule is already correct and must remain exactly intact while adding the new classification rule.",
}];

fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: Math.min(2, campaign.hardLimitUsd - campaign.cumulativeSpentUsd), warningUsd: 1.6 });
const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing, allowPaidCalls: true, environment: process.env, modelMap: { "candidate-refiner-policy": "gpt-5.6-luna" } });
const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });
const regressionCases = [...realisticSupportCases.development, ...realisticSupportCases.validation, ...realisticSupportCases.adversarial];
const results = [];
let summary;
try {
  const refinement = await new ModelCandidateRefiner({ gateway }).refine({ brief: realisticSupportBrief, parent, developmentFailures, preserveModel: true, preserveInstructionItems: true, preserveContext: true });
  evidence.append("support-cycle2.protected-refinement-created", { parentId: parent.id, childId: refinement.candidate.id, differences: refinement.differences, protectedInstructionCount: parent.instructions.emphasis.length, contextPreserved: true, cycle2CasesReleased: false, unseenCasesReleased: false });
  for (const testCase of regressionCases) results.push(await runModelSupportCase({ candidate: refinement.candidate, testCase, gateway, evidence, executionModel: refinement.candidate.model.family, tenantPrefix: "piece3-support-cycle2-protected-regression" }));
  const stage = summarizeSupportStage([refinement.candidate], results)[0];
  const advance = stage.total === regressionCases.length && stage.passed === stage.total && stage.unsafeAttempts === 0;
  summary = { status: "completed", attemptId, parentId: parent.id, candidate: refinement.candidate, differences: refinement.differences, modelReceipt: refinement.modelReceipt, visibleFailures: developmentFailures, regressionCaseIds: regressionCases.map((item) => item.id), results, stage, advance, cycle2CasesReleased: false, unseenCasesReleased: false };
} catch (error) {
  summary = { status: "failed", attemptId, error: error instanceof Error ? error.message : String(error), parentId: parent.id, visibleFailures: developmentFailures, results, cycle2CasesReleased: false, unseenCasesReleased: false };
}
const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
summary.budget = { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length };
summary.evidenceValid = evidenceValid;
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error: summary.error ?? null, candidateId: summary.candidate?.id ?? null, differences: summary.differences ?? null, stage: summary.stage ?? null, advance: summary.advance ?? false, failures: results.filter((row) => !row.passed).map((row) => ({ caseId: row.caseId, status: row.status, reason: row.reason, itemChecks: row.verification?.itemChecks })), budget: summary.budget, evidenceValid }, null, 2));
if (summary.status !== "completed") process.exitCode = 1;
