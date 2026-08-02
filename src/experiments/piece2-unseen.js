import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { createRealisticProcurementUnseenVault } from "../worlds/realistic-procurement-cases.js";
import { cycle3ValidationCases, cycle3AdversarialCases } from "../worlds/realistic-procurement-cycle3-cases.js";
import { realisticProcurementStrategies } from "../evaluation/realistic-procurement-strategies.js";
import { runRealisticProcurementCampaign } from "../evaluation/realistic-procurement-campaign.js";
import { RealisticProcurementCompany, RealisticProcurementVerifier } from "../worlds/realistic-procurement-company.js";
import { SpecialistAgentRuntime } from "../runtime/agent-runtime.js";
import { ModelDecisionEngine } from "../runtime/model-decision-engine.js";
import { runModelProcurementCase, summarizeStage } from "./model-procurement-runner.js";

const attemptId = "piece2-frozen-unseen-v1";
const PRICING = {
  "gpt-5.6-luna": { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 },
  "gpt-5.6-terra": { inputPerMillionUsd: 2, cachedInputPerMillionUsd: .2, outputPerMillionUsd: 12 },
  "gpt-5.6-sol": { inputPerMillionUsd: 5, cachedInputPerMillionUsd: .5, outputPerMillionUsd: 30 },
};
if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error("Frozen unseen stage is already settled");
const freeze = JSON.parse(fs.readFileSync("evidence/piece2-procurement-freeze.json", "utf8"));
const { freezeHash, ...record } = freeze;
if (digest(record) !== freezeHash) throw new Error("Freeze artifact hash is invalid");
const vault = createRealisticProcurementUnseenVault();
if (vault.digest !== freeze.cases.unseenHash || vault.count !== freeze.cases.unseenCount) throw new Error("Unseen vault changed after freeze");
if (digest(cycle3ValidationCases) !== freeze.cases.cycle3ValidationHash || digest(cycle3AdversarialCases) !== freeze.cases.cycle3AdversarialHash) throw new Error("Pre-unseen cases changed after freeze");
const boundaryChecks = {
  runtimeHash: digest(SpecialistAgentRuntime.toString()), decisionEngineHash: digest(ModelDecisionEngine.toString()), worldHash: digest(RealisticProcurementCompany.toString()), verifierHash: digest(RealisticProcurementVerifier.toString()),
};
if (Object.entries(boundaryChecks).some(([key, value]) => freeze.boundaries[key] !== value)) throw new Error("Runtime or verifier boundary changed after freeze");
for (const item of freeze.deterministicBaselines) {
  const strategy = realisticProcurementStrategies.find((entry) => entry.id === item.id);
  if (!strategy || digest(strategy.run.toString()) !== item.sourceHash) throw new Error(`Deterministic baseline changed after freeze: ${item.id}`);
}
const candidateHashes = { [freeze.candidate.id]: freeze.candidate.fingerprint };
const baselineHashes = Object.fromEntries(freeze.modelBaselines.map((item) => [item.id, item.fingerprint]));
const unseenCases = vault.release({ freezeHash, role: freeze.roleId, candidateHashes, baselineHashes });
const outputDir = path.resolve("artifacts/runs/piece2-unseen/v1");
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "release.json"), `${JSON.stringify({ freezeHash, releasedAt: new Date().toISOString(), caseIds: unseenCases.map((item) => item.id), vaultReleaseCount: vault.releaseCount() }, null, 2)}\n`, "utf8");
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: 20 - campaign.cumulativeSpentUsd, warningUsd: 15 - campaign.cumulativeSpentUsd });
const participants = [freeze.candidate, ...freeze.modelBaselines];
const modelResults = [];
let error = null;
try {
  for (const participant of participants) {
    const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing: PRICING[participant.model.family], allowPaidCalls: true, environment: process.env });
    const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });
    for (const testCase of unseenCases) {
      modelResults.push(await runModelProcurementCase({ candidate: participant, testCase, gateway, evidence, executionModel: participant.model.family, tenantPrefix: "piece2-frozen-unseen" }));
      fs.writeFileSync(path.join(outputDir, "progress.json"), `${JSON.stringify({ freezeHash, modelResults }, null, 2)}\n`, "utf8");
    }
  }
} catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
const deterministic = await runRealisticProcurementCampaign({ suites: { development: [], validation: [], adversarial: [] }, unseenCases, strategies: realisticProcurementStrategies });
const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
const modelSummaries = summarizeStage(participants, modelResults);
const summary = {
  status: !error && modelResults.length === participants.length * unseenCases.length ? "completed" : "failed", error, attemptId, freezeHash, vaultReleaseCount: vault.releaseCount(), unseenCaseIds: unseenCases.map((item) => item.id), participants, modelResults, modelSummaries, deterministic,
  budget: { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length }, evidenceValid,
};
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error, freezeHash, vaultReleaseCount: summary.vaultReleaseCount, unseenCaseIds: summary.unseenCaseIds, modelSummaries, deterministicSummaries: deterministic.summaries, budget: summary.budget, evidenceValid }, null, 2));
if (summary.status !== "completed") process.exitCode = 1;
