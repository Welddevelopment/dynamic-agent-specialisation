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
import { RealisticRevopsCompany, RealisticRevopsVerifier } from "../worlds/realistic-revops-company.js";
import { runModelRevopsCase, summarizeRevopsStage } from "./model-revops-runner.js";

const attemptId = "piece4-revops-refinement-v1";
const sourceId = "revops-v2-compiler-candidate-3";
const sourceDir = path.resolve("artifacts/runs/piece4-revops-viability/v2");
const outputDir = path.resolve("artifacts/runs/piece4-revops-refinement/v1");
const pricing = { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 };
if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
const campaign = paidCampaignState(); if (campaign.through !== "piece4-revops-viability-v2") throw new Error("Completed V2 settlement is required immediately before refinement");
const prior = JSON.parse(fs.readFileSync(path.join(sourceDir, "summary.json"), "utf8")); const source = prior.candidates.find((item) => item.id === sourceId); if (!source) throw new Error("Frozen V2 source candidate is missing");
const priorEvidence = fs.readFileSync(path.join(sourceDir, "evidence.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
fs.mkdirSync(outputDir, { recursive: true }); const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl")); const budget = new BudgetGuard({ hardLimitUsd: Math.min(1.5, campaign.hardLimitUsd - campaign.cumulativeSpentUsd), warningUsd: 1.2 });
const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing, allowPaidCalls: true, environment: process.env, modelMap: { "candidate-refiner-policy": "gpt-5.6-luna" } }); const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });

async function reconstruct(testCase) {
  const suffix = `:${sourceId}:${testCase.id}`;
  const decisions = priorEvidence.filter((event) => event.type === "runtime.decision" && event.payload?.candidateId === sourceId && event.payload?.tenantId?.endsWith(suffix)).sort((a, b) => a.sequence - b.sequence).map((event) => event.payload.decision);
  if (!decisions.length) throw new Error(`No preserved decisions for ${testCase.id}`);
  const world = new RealisticRevopsCompany({ task: testCase }); let resolution = null;
  for (const decision of decisions) { if (decision.kind === "tool") await world.execute(decision.name, decision.input); else if (decision.kind === "complete") resolution = { kind: "complete", blocker: null, reconciled: false }; else if (decision.kind === "escalate") resolution = { kind: "handoff", blocker: decision.blocker, reconciled: false }; }
  if (!resolution) throw new Error(`No terminal decision for ${testCase.id}`);
  const verifier = new RealisticRevopsVerifier({ task: testCase, initialState: world.initial }); const verification = await verifier.verify({ externalState: world.externalState(), resolution }); evidence.append("revops.source-verification-reconstructed", { sourceId, caseId: testCase.id, decisionCount: decisions.length, verification }); return verification;
}

let summary;
try {
  const reconstructed = [];
  for (const testCase of prior.caseIds.map((id) => realisticRevopsCases.development.find((item) => item.id === id))) { const verification = await reconstruct(testCase); const priorRow = prior.results.find((row) => row.candidateId === sourceId && row.caseId === testCase.id); if (!priorRow || verification.passed !== priorRow.passed) throw new Error(`Reconstruction disagrees for ${testCase.id}`); reconstructed.push({ caseId: testCase.id, passed: verification.passed, outcomeScore: verification.outcomeScore, unsafeAttempts: verification.checks.noDeniedAttempts ? 0 : 1, verification }); }
  const failures = reconstructed.filter((item) => !item.passed); if (failures.length !== 1) throw new Error(`Expected one exact source failure, found ${failures.length}`);
  const refined = await new ModelCandidateRefiner({ gateway, maxOutputTokens: 8_000 }).refine({ brief: realisticRevopsBrief, parent: source, developmentFailures: failures, preserveModel: true, preserveInstructionItems: true, preserveContext: true });
  const results = [];
  for (const testCase of realisticRevopsCases.development) { const row = await runModelRevopsCase({ candidate: refined.candidate, testCase, gateway, evidence, executionModel: refined.candidate.model.family, tenantPrefix: "piece4-revops-refinement-v1" }); results.push(row); console.log(JSON.stringify({ progress: testCase.id, passed: row.passed, unsafeAttempts: row.unsafeAttempts, spentUsd: budget.spentUsd })); }
  const stage = summarizeRevopsStage([refined.candidate], results)[0]; const advance = stage.passed === stage.total && stage.unsafeAttempts === 0;
  summary = { status: "completed", attemptId, sourceId, reconstructed, refinedCandidate: refined.candidate, differences: refined.differences, refinementReceipt: refined.modelReceipt, results, stage, advance, validationReleased: false, adversarialReleased: false, unseenReleased: false };
} catch (error) { summary = { status: "failed", attemptId, sourceId, error: error instanceof Error ? error.message : String(error), validationReleased: false, adversarialReleased: false, unseenReleased: false }; }
const evidenceValid = evidence.verify(); const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid }); summary.budget = { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length }; summary.evidenceValid = evidenceValid;
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8"); console.log(JSON.stringify({ status: summary.status, error: summary.error ?? null, differences: summary.differences ?? [], stage: summary.stage ?? null, advance: summary.advance ?? false, failures: summary.results?.filter((row) => !row.passed).map((row) => ({ caseId: row.caseId, unsafeAttempts: row.unsafeAttempts, itemChecks: row.verification.itemChecks })) ?? [], budget: summary.budget, evidenceValid }, null, 2)); if (summary.status !== "completed") process.exitCode = 1;
