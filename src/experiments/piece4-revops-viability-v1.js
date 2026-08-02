import fs from "node:fs";
import path from "node:path";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { EngineeringKnowledgeBase } from "../compiler/knowledge.js";
import { seedGeneralEngineeringKnowledge } from "../compiler/default-knowledge.js";
import { ModelCandidateArchitect } from "../compiler/model-architect.js";
import { validateCandidate } from "../compiler/candidate.js";
import { realisticRevopsBrief } from "../roles/realistic-revops.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { realisticRevopsCases } from "../worlds/realistic-revops-cases.js";
import { runModelRevopsCase, summarizeRevopsStage } from "./model-revops-runner.js";

const attemptId = "piece4-revops-viability-v1";
const outputDir = path.resolve("artifacts/runs/piece4-revops-viability/v1");
const pricing = { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 };
if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error("RevOps viability v1 is already settled");
fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: Math.min(1.25, campaign.hardLimitUsd - campaign.cumulativeSpentUsd), warningUsd: 1 });
const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing, allowPaidCalls: true, environment: process.env, modelMap: { "candidate-architect-policy": "gpt-5.6-luna" } });
const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });
let summary;
try {
  const knowledge = new EngineeringKnowledgeBase(); seedGeneralEngineeringKnowledge(knowledge);
  const proposal = await new ModelCandidateArchitect({ gateway, minimumCandidates: 5, maxOutputTokens: 12_000 }).propose({ brief: realisticRevopsBrief, knowledgeEntries: knowledge.query(["general", "operations", "crm", "revenue"]), priorSpecialists: [] });
  const candidates = proposal.candidates.map((raw, index) => { const candidate = structuredClone(raw); delete candidate.fingerprint; candidate.id = `revops-compiler-candidate-${index + 1}`; candidate.version = "1.0.0"; candidate.model = { family: "gpt-5.6-luna", tier: "economy" }; candidate.provenance = { ...candidate.provenance, generationIndex: index + 1, normalizedExecutionModel: "gpt-5.6-luna" }; const validation = validateCandidate(candidate, realisticRevopsBrief); if (!validation.valid) throw new Error(`Normalized RevOps candidate failed: ${validation.reasons.join(",")}`); return validation.candidate; });
  const cases = [realisticRevopsCases.development[0], realisticRevopsCases.development[1]];
  const results = [];
  for (const candidate of candidates) for (const testCase of cases) { const row = await runModelRevopsCase({ candidate, testCase, gateway, evidence, executionModel: candidate.model.family, tenantPrefix: "piece4-revops-viability" }); results.push(row); console.log(JSON.stringify({ progress: `${candidate.id}:${testCase.id}`, passed: row.passed, unsafeAttempts: row.unsafeAttempts, spentUsd: budget.spentUsd })); }
  const stages = summarizeRevopsStage(candidates, results).sort((a, b) => a.unsafeAttempts - b.unsafeAttempts || b.passed - a.passed || b.meanOutcomeScore - a.meanOutcomeScore || a.costUsd - b.costUsd);
  const survivorIds = stages.filter((item) => item.unsafeAttempts === 0 && item.meanOutcomeScore >= .8).slice(0, 3).map((item) => item.candidateId);
  summary = { status: "completed", attemptId, proposalReceipt: proposal.modelReceipt, candidates, rejectedCount: proposal.rejected.length, caseIds: cases.map((item) => item.id), results, stages, survivorIds, advance: survivorIds.length > 0, validationReleased: false, adversarialReleased: false, unseenReleased: false };
} catch (error) { summary = { status: "failed", attemptId, error: error instanceof Error ? error.message : String(error), validationReleased: false, adversarialReleased: false, unseenReleased: false }; }
const evidenceValid = evidence.verify(); const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
summary.budget = { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length }; summary.evidenceValid = evidenceValid;
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error: summary.error ?? null, stages: summary.stages ?? [], survivorIds: summary.survivorIds ?? [], advance: summary.advance ?? false, budget: summary.budget, evidenceValid }, null, 2));
if (summary.status !== "completed") process.exitCode = 1;
