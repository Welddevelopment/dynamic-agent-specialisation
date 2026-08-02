import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { createPiece4RevopsBaselines } from "../evaluation/piece4-revops-baselines.js";
import { pricingForModel } from "../providers/model-pricing.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { realisticRevopsBrief } from "../roles/realistic-revops.js";
import { createRevopsCycle2ProspectiveUnseenVault } from "../worlds/realistic-revops-cycle2-cases.js";
import { runModelRevopsCase, summarizeRevopsStage } from "./model-revops-runner.js";

const attemptId = "piece4-revops-cycle3-unseen-v1";
const outputDir = path.resolve("artifacts/runs/piece4-revops-cycle3-unseen/v1");
const adversarialPath = path.resolve("artifacts/runs/piece4-revops-cycle3-adversarial/v1/summary.json");
const contractFiles = ["src/compiler/candidate.js", "src/runtime/agent-runtime.js", "src/runtime/model-decision-engine.js", "src/runtime/memory.js", "src/worlds/realistic-revops-company.js", "src/worlds/realistic-revops-cycle2-cases.js", "src/worlds/realistic-revops-cycle3-cases.js", "src/experiments/model-revops-runner.js"];
const compareRows = (left, right) => left.unsafeAttempts - right.unsafeAttempts || right.passed - left.passed || right.meanOutcomeScore - left.meanOutcomeScore || left.verificationRepairRounds - right.verificationRepairRounds || left.costUsd - right.costUsd || left.toolCalls - right.toolCalls || left.elapsedMs - right.elapsedMs;
if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
const adversarial = JSON.parse(fs.readFileSync(adversarialPath, "utf8"));
if (!adversarial.advance) throw new Error("Cycle 3 adversarial gate must pass before unseen release");
const freeze = adversarial.freeze;
const candidate = adversarial.candidate;
if (digest(candidate) !== freeze.candidateHash || digest(realisticRevopsBrief) !== freeze.roleBriefHash) throw new Error("Candidate or role changed after freeze");
const baselines = createPiece4RevopsBaselines();
for (const baseline of baselines) if (digest(baseline) !== freeze.baselineHashes[baseline.id]) throw new Error(`Baseline changed after freeze: ${baseline.id}`);
for (const filename of contractFiles) if (digest(fs.readFileSync(filename, "utf8")) !== freeze.runtimeContractHashes[filename]) throw new Error(`Runtime contract changed after freeze: ${filename}`);
const vault = createRevopsCycle2ProspectiveUnseenVault();
if (vault.digest !== freeze.prospectiveUnseenHash || vault.count !== freeze.prospectiveUnseenCount) throw new Error("Prospective vault changed after freeze");
const cases = vault.release({ freezeHash: freeze.freezeHash, role: realisticRevopsBrief.id, candidateHashes: { [candidate.id]: freeze.candidateHash }, baselineHashes: freeze.baselineHashes });
const participants = [candidate, ...baselines];
const campaign = paidCampaignState();
if (campaign.through !== "piece4-revops-cycle3-adversarial-v1") throw new Error("Cycle 3 adversarial settlement must immediately precede unseen release");
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "release.json"), `${JSON.stringify({ freezeHash: freeze.freezeHash, releasedAt: new Date().toISOString(), caseIds: cases.map((item) => item.id), vaultReleaseCount: vault.releaseCount() }, null, 2)}\n`, "utf8");
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: Math.min(5.5, campaign.hardLimitUsd - campaign.cumulativeSpentUsd), warningUsd: 4.75 });
const results = [];
let error = null;
evidence.append("revops-cycle3-unseen.started", { freezeHash: freeze.freezeHash, participantIds: participants.map((item) => item.id), caseIds: cases.map((item) => item.id) });
try {
  for (const participant of participants) {
    const gateway = new MeteredModelGateway({ provider: new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing: pricingForModel(participant.model.family), allowPaidCalls: true, environment: process.env }), budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });
    for (const testCase of cases) {
      const row = await runModelRevopsCase({ candidate: participant, testCase, gateway, evidence, executionModel: participant.model.family, tenantPrefix: "piece4-revops-cycle3-unseen" });
      results.push(row);
      fs.writeFileSync(path.join(outputDir, "progress.json"), `${JSON.stringify({ freezeHash: freeze.freezeHash, results }, null, 2)}\n`, "utf8");
      console.log(JSON.stringify({ progress: `${participant.id}:${testCase.id}`, passed: row.passed, status: row.status, completionSource: row.completionSource, unsafeAttempts: row.unsafeAttempts, spentUsd: budget.spentUsd }));
    }
  }
} catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
const stages = summarizeRevopsStage(participants, results);
const ranking = stages.slice().sort(compareRows).map((item, index) => ({ rank: index + 1, ...item }));
const candidateStage = stages.find((item) => item.candidateId === candidate.id);
const candidateRank = ranking.find((item) => item.candidateId === candidate.id)?.rank ?? null;
const selectedId = ranking[0]?.candidateId ?? null;
const selected = ranking[0] ?? null;
const complete = !error && results.length === participants.length * cases.length;
const advance = complete && candidateStage?.passed === cases.length && candidateStage.unsafeAttempts === 0 && selected?.passed === cases.length && selected.unsafeAttempts === 0;
const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
const summary = { status: complete ? "completed" : "failed", error, attemptId, freezeHash: freeze.freezeHash, caseIds: cases.map((item) => item.id), participants, results, stages, ranking, candidateStage, candidateRank, selectedId, selectedParticipant: participants.find((item) => item.id === selectedId) ?? null, advance, preservedFailures: freeze.preservedFailures, budget: { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length }, evidenceValid };
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error, freezeHash: summary.freezeHash, caseIds: summary.caseIds, ranking, candidateRank, selectedId, advance, failures: results.filter((row) => !row.passed).map((row) => ({ candidateId: row.candidateId, caseId: row.caseId, status: row.status, reason: row.reason, unsafeAttempts: row.unsafeAttempts, itemChecks: row.verification.itemChecks })), budget: summary.budget, evidenceValid }, null, 2));
if (!complete) process.exitCode = 1;
