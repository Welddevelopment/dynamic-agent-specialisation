import fs from "node:fs";
import path from "node:path";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { ModelCandidateRefiner } from "../compiler/model-refiner.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { realisticRevopsBrief } from "../roles/realistic-revops.js";
import { realisticRevopsCases } from "../worlds/realistic-revops-cases.js";
import { runModelRevopsCase, summarizeRevopsStage } from "./model-revops-runner.js";

const attemptId = "piece4-revops-refinement-v2"; const sourcePath = path.resolve("artifacts/runs/piece4-revops-refinement/v1/summary.json"); const outputDir = path.resolve("artifacts/runs/piece4-revops-refinement/v2"); const pricing = { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 };
if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
const campaign = paidCampaignState(); if (campaign.through !== "piece4-revops-refinement-v1") throw new Error("Refinement V1 settlement is required immediately before V2");
const prior = JSON.parse(fs.readFileSync(sourcePath, "utf8")); if (prior.advance || prior.stage?.passed !== 4 || prior.stage?.unsafeAttempts !== 0) throw new Error("Expected preserved safe 4/5 V1 near-miss");
const source = prior.refinedCandidate; const failures = prior.results.filter((row) => !row.passed).map((row) => ({ caseId: row.caseId, passed: row.passed, outcomeScore: row.outcomeScore, unsafeAttempts: row.unsafeAttempts, verification: row.verification, toolSequence: row.toolSequence })); if (failures.length !== 1) throw new Error("Exactly one visible V1 failure is required");
fs.mkdirSync(outputDir, { recursive: true }); const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl")); const budget = new BudgetGuard({ hardLimitUsd: Math.min(1.5, campaign.hardLimitUsd - campaign.cumulativeSpentUsd), warningUsd: 1.2 }); const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing, allowPaidCalls: true, environment: process.env, modelMap: { "candidate-refiner-policy": "gpt-5.6-luna" } }); const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });
let summary;
try {
  const refined = await new ModelCandidateRefiner({ gateway, maxOutputTokens: 8_000 }).refine({ brief: realisticRevopsBrief, parent: source, developmentFailures: failures, preserveModel: true, preserveInstructionItems: true, preserveContext: true }); const results = [];
  for (const testCase of realisticRevopsCases.development) { const row = await runModelRevopsCase({ candidate: refined.candidate, testCase, gateway, evidence, executionModel: refined.candidate.model.family, tenantPrefix: "piece4-revops-refinement-v2" }); results.push(row); console.log(JSON.stringify({ progress: testCase.id, passed: row.passed, unsafeAttempts: row.unsafeAttempts, spentUsd: budget.spentUsd })); }
  const stage = summarizeRevopsStage([refined.candidate], results)[0]; const advance = stage.passed === stage.total && stage.unsafeAttempts === 0; summary = { status: "completed", attemptId, sourceId: source.id, sourceFailure: failures[0], refinedCandidate: refined.candidate, differences: refined.differences, refinementReceipt: refined.modelReceipt, results, stage, advance, validationReleased: false, adversarialReleased: false, unseenReleased: false };
} catch (error) { summary = { status: "failed", attemptId, error: error instanceof Error ? error.message : String(error), validationReleased: false, adversarialReleased: false, unseenReleased: false }; }
const evidenceValid = evidence.verify(); const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid }); summary.budget = { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length }; summary.evidenceValid = evidenceValid; fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8"); console.log(JSON.stringify({ status: summary.status, error: summary.error ?? null, differences: summary.differences ?? [], instructions: summary.refinedCandidate?.instructions ?? null, stage: summary.stage ?? null, advance: summary.advance ?? false, failures: summary.results?.filter((row) => !row.passed).map((row) => ({ caseId: row.caseId, unsafeAttempts: row.unsafeAttempts, itemChecks: row.verification.itemChecks })) ?? [], budget: summary.budget, evidenceValid }, null, 2)); if (summary.status !== "completed") process.exitCode = 1;
