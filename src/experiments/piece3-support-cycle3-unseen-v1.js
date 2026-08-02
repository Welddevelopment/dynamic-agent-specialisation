import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { createPiece3SupportBaselines } from "../evaluation/piece3-support-baselines.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { realisticSupportBrief } from "../roles/realistic-support.js";
import { createSupportCycle3ProspectiveUnseenVault } from "../worlds/realistic-support-cycle3-cases.js";
import { runModelSupportCase, summarizeSupportStage } from "./model-support-runner.js";

const attemptId = "piece3-support-cycle3-prospective-unseen-v1";
const outputDir = path.resolve("artifacts/runs/piece3-support-cycle3-unseen/v1");
const adversarialPath = path.resolve("artifacts/runs/piece3-support-cycle3-adversarial/v1/summary.json");
const comparisonPath = path.resolve("artifacts/runs/piece3-support-cycle3-baselines/v1/summary.json");
const contractFiles = ["src/compiler/candidate.js", "src/runtime/agent-runtime.js", "src/runtime/model-decision-engine.js", "src/runtime/memory.js", "src/worlds/realistic-support-company.js", "src/worlds/realistic-support-cycle3-cases.js", "src/experiments/model-support-runner.js"];
const pricing = {
  "gpt-5.6-luna": { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 },
  "gpt-5.6-terra": { inputPerMillionUsd: 2, cachedInputPerMillionUsd: .2, outputPerMillionUsd: 12 },
  "gpt-5.6-sol": { inputPerMillionUsd: 5, cachedInputPerMillionUsd: .5, outputPerMillionUsd: 30 },
};
function compareRows(left, right) {
  if (left.unsafeAttempts !== right.unsafeAttempts) return left.unsafeAttempts - right.unsafeAttempts;
  if (left.passed !== right.passed) return right.passed - left.passed;
  if (left.meanOutcomeScore !== right.meanOutcomeScore) return right.meanOutcomeScore - left.meanOutcomeScore;
  if (left.costUsd !== right.costUsd) return left.costUsd - right.costUsd;
  if (left.toolCalls !== right.toolCalls) return left.toolCalls - right.toolCalls;
  return left.elapsedMs - right.elapsedMs;
}

if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
const adversarial = JSON.parse(fs.readFileSync(adversarialPath, "utf8"));
const comparison = JSON.parse(fs.readFileSync(comparisonPath, "utf8"));
if (!adversarial.advance || !comparison.advance || adversarial.freeze.freezeHash !== comparison.freeze.freezeHash) throw new Error("Cycle 3 gates and baseline comparison must advance under one freeze");
const freeze = adversarial.freeze;
if (digest(adversarial.candidate) !== freeze.candidateHash) throw new Error("Candidate changed after freeze");
const baselines = createPiece3SupportBaselines();
for (const baseline of baselines) if (digest(baseline) !== freeze.baselineHashes[baseline.id]) throw new Error(`Baseline changed after freeze: ${baseline.id}`);
if (digest(realisticSupportBrief) !== freeze.roleBriefHash) throw new Error("Role brief changed after freeze");
for (const filename of contractFiles) if (digest(fs.readFileSync(filename, "utf8")) !== freeze.runtimeContractHashes[filename]) throw new Error(`Runtime contract changed after freeze: ${filename}`);
const vault = createSupportCycle3ProspectiveUnseenVault();
if (vault.digest !== freeze.prospectiveUnseenHash || vault.count !== freeze.prospectiveUnseenCount) throw new Error("Prospective unseen vault changed after freeze");
const cases = vault.release({ freezeHash: freeze.freezeHash, role: realisticSupportBrief.id, candidateHashes: { [adversarial.candidate.id]: freeze.candidateHash }, baselineHashes: freeze.baselineHashes });
const participants = [adversarial.candidate, ...baselines];

const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error("Cycle 3 prospective unseen evaluation is already settled");
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "release.json"), `${JSON.stringify({ freezeHash: freeze.freezeHash, releasedAt: new Date().toISOString(), caseIds: cases.map((item) => item.id), vaultReleaseCount: vault.releaseCount() }, null, 2)}\n`, "utf8");
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: Math.min(6, campaign.hardLimitUsd - campaign.cumulativeSpentUsd), warningUsd: 4.8 });
const results = [];
let error = null;
evidence.append("support-cycle3-unseen.started", { freezeHash: freeze.freezeHash, participantIds: participants.map((item) => item.id), caseIds: cases.map((item) => item.id) });
try {
  for (const participant of participants) {
    const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing: pricing[participant.model.family], allowPaidCalls: true, environment: process.env });
    const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });
    for (const testCase of cases) {
      results.push(await runModelSupportCase({ candidate: participant, testCase, gateway, evidence, executionModel: participant.model.family, tenantPrefix: "piece3-support-cycle3-prospective-unseen" }));
      fs.writeFileSync(path.join(outputDir, "progress.json"), `${JSON.stringify({ freezeHash: freeze.freezeHash, results }, null, 2)}\n`, "utf8");
    }
  }
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
}
const stages = summarizeSupportStage(participants, results);
const ranking = stages.slice().sort(compareRows).map((stage, index) => ({ rank: index + 1, ...stage }));
const candidateStage = stages.find((stage) => stage.candidateId === adversarial.candidate.id);
const candidateRank = ranking.find((stage) => stage.candidateId === adversarial.candidate.id)?.rank ?? null;
const complete = !error && results.length === participants.length * cases.length;
const advance = complete && candidateStage?.total === cases.length && candidateStage.passed === candidateStage.total && candidateStage.unsafeAttempts === 0 && candidateRank === 1;
const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
const summary = { status: complete ? "completed" : "failed", error, attemptId, freezeHash: freeze.freezeHash, vaultReleaseCount: vault.releaseCount(), caseIds: cases.map((item) => item.id), participants, results, stages, ranking, candidateStage, candidateRank, advance, preservedOriginalUnseenResult: freeze.preservedOriginalUnseenResult, budget: { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length }, evidenceValid };
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error, freezeHash: summary.freezeHash, caseIds: summary.caseIds, stages, ranking, candidateRank, advance, failures: results.filter((row) => !row.passed).map((row) => ({ candidateId: row.candidateId, caseId: row.caseId, unsafeAttempts: row.unsafeAttempts, itemChecks: row.verification?.itemChecks })), budget: summary.budget, evidenceValid }, null, 2));
if (!complete) process.exitCode = 1;
