import fs from "node:fs";
import path from "node:path";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { ModelCandidateArchitect } from "../compiler/model-architect.js";
import { realisticProcurementBrief } from "../roles/realistic-procurement.js";
import { SpecialistAgentRuntime } from "../runtime/agent-runtime.js";
import { TenantRoleMemory } from "../runtime/memory.js";
import { ModelDecisionEngine } from "../runtime/model-decision-engine.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { RealisticProcurementCompany, RealisticProcurementVerifier, londonDueTomorrowTask } from "../worlds/realistic-procurement-company.js";

const GATE_CUMULATIVE_LIMIT_USD = 8;
const MODEL = "gpt-5.6-luna";
const pricing = { inputPerMillionUsd: 0.20, cachedInputPerMillionUsd: 0.02, outputPerMillionUsd: 1.20 };

if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED") throw new Error("Paid viability gate requires Joel approval");
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing");

const campaign = paidCampaignState();
if (campaign.cumulativeSpentUsd >= GATE_CUMULATIVE_LIMIT_USD) throw new Error("Candidate-viability gate cumulative limit is already exhausted");
const outputRoot = path.resolve("artifacts/runs/piece2-viability");
fs.mkdirSync(outputRoot, { recursive: true });
const existing = fs.readdirSync(outputRoot).filter((name) => /^attempt-\d+$/.test(name)).map((name) => Number(name.slice(8)));
const attemptNumber = (existing.length ? Math.max(...existing) : 0) + 1;
const attemptId = `piece2-viability-attempt-${attemptNumber}`;
const outputDir = path.join(outputRoot, `attempt-${attemptNumber}`);
fs.mkdirSync(outputDir, { recursive: true });

const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({
  hardLimitUsd: Math.min(GATE_CUMULATIVE_LIMIT_USD, campaign.hardLimitUsd) - campaign.cumulativeSpentUsd,
  warningUsd: Math.max(0, 6 - campaign.cumulativeSpentUsd),
});
const provider = new OpenAIResponsesProvider({
  apiKey: process.env.OPENAI_API_KEY,
  pricing,
  allowPaidCalls: true,
  environment: process.env,
  modelMap: { "candidate-architect-policy": MODEL },
});
const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });

let summary;
try {
  const architect = new ModelCandidateArchitect({ gateway, minimumCandidates: 4, maxOutputTokens: 12_000 });
  const proposal = await architect.propose({ brief: realisticProcurementBrief, knowledgeEntries: [], priorSpecialists: [] });
  evidence.append("candidate.proposal", {
    admitted: proposal.candidates.map((candidate) => ({ id: candidate.id, fingerprint: candidate.fingerprint, tools: candidate.tools, model: candidate.model })),
    rejected: proposal.rejected.map((entry) => ({ id: entry.candidate?.id ?? null, reasons: entry.reasons })),
  });
  fs.writeFileSync(path.join(outputDir, "candidate-packages.json"), `${JSON.stringify({ candidates: proposal.candidates, rejected: proposal.rejected }, null, 2)}\n`, "utf8");
  if (proposal.candidates.length < 2) throw new Error("Fewer than two valid candidates survived the architect contract");

  const requiredTools = new Set(realisticProcurementBrief.environment.tools);
  const rankedForCheapTrial = [...proposal.candidates].sort((left, right) => {
    const coverage = (candidate) => candidate.tools.filter((tool) => requiredTools.has(tool)).length;
    return coverage(right) - coverage(left);
  });
  const trialCandidates = rankedForCheapTrial.slice(0, 2);
  const results = [];
  for (const candidate of trialCandidates) {
    provider.modelMap[candidate.model.family] = MODEL;
    const world = new RealisticProcurementCompany({ task: londonDueTomorrowTask });
    const verifier = new RealisticProcurementVerifier({ task: londonDueTomorrowTask, initialState: world.initial });
    const runtime = new SpecialistAgentRuntime({
      decisionEngine: new ModelDecisionEngine({ gateway }),
      memory: new TenantRoleMemory(),
      evidence,
      maxTurns: 16,
    });
    const result = await runtime.run({ tenantId: `fictional-trial-${candidate.id}`, candidate, goal: londonDueTomorrowTask.goal, toolHost: world, externalVerifier: verifier });
    results.push({
      candidateId: candidate.id,
      fingerprint: candidate.fingerprint,
      toolCount: candidate.tools.length,
      status: result.status,
      reason: result.reason ?? null,
      turnsUsed: result.session?.toolReceipts?.length ?? 0,
      verification: result.verification ?? null,
    });
  }

  const completed = results.filter((result) => result.status === "completed" && result.verification?.passed);
  summary = {
    status: completed.length ? "passed" : "failed",
    interpretation: completed.length ? "At least one independently verified model-designed specialist completed the representative development case." : "No model-designed specialist independently completed the representative development case.",
    attemptId,
    model: MODEL,
    generatedCandidates: proposal.candidates.length,
    rejectedCandidates: proposal.rejected.length,
    trialCandidates: results,
    completedCount: completed.length,
    frozenUnseenCasesReleased: false,
  };
} catch (error) {
  summary = { status: "failed", attemptId, model: MODEL, error: error instanceof Error ? error.message : String(error), frozenUnseenCasesReleased: false };
}

const evidenceValid = evidence.verify();
const attemptSpendUsd = budget.spentUsd;
const settledCampaign = settlePaidCampaign(campaign, { attemptId, spentUsd: attemptSpendUsd, evidenceValid });
Object.assign(summary, {
  budget: { ...budget.snapshot(), priorCumulativeSpentUsd: campaign.cumulativeSpentUsd, attemptSpendUsd, cumulativeSpentUsd: settledCampaign.cumulativeSpentUsd, gateCumulativeLimitUsd: GATE_CUMULATIVE_LIMIT_USD, campaignHardLimitUsd: settledCampaign.hardLimitUsd },
  evidenceValid,
});
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
if (summary.status !== "passed") process.exitCode = 1;
