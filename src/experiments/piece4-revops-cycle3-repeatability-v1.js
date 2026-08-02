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

const attemptId = "piece4-revops-cycle3-repeatability-v1";
const outputDir = path.resolve("artifacts/runs/piece4-revops-cycle3-repeatability/v1");
const unseenPath = path.resolve("artifacts/runs/piece4-revops-cycle3-unseen/v1/summary.json");
const adversarialPath = path.resolve("artifacts/runs/piece4-revops-cycle3-adversarial/v1/summary.json");
const contractFiles = ["src/compiler/candidate.js", "src/runtime/agent-runtime.js", "src/runtime/model-decision-engine.js", "src/runtime/memory.js", "src/worlds/realistic-revops-company.js", "src/worlds/realistic-revops-cycle2-cases.js", "src/worlds/realistic-revops-cycle3-cases.js", "src/experiments/model-revops-runner.js"];
if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
const unseen = JSON.parse(fs.readFileSync(unseenPath, "utf8"));
const adversarial = JSON.parse(fs.readFileSync(adversarialPath, "utf8"));
if (!unseen.advance || unseen.selectedId !== "revops-baseline-ordinary-manual-luna" || unseen.candidateStage.passed !== 4) throw new Error("Perfect candidate and selected ordinary baseline unseen result required");
const freeze = adversarial.freeze;
const candidate = adversarial.candidate;
const selected = createPiece4RevopsBaselines().find((item) => item.id === unseen.selectedId);
if (digest(candidate) !== freeze.candidateHash || digest(selected) !== freeze.baselineHashes[selected.id] || digest(realisticRevopsBrief) !== freeze.roleBriefHash) throw new Error("Repeatability participant or role changed after freeze");
for (const filename of contractFiles) if (digest(fs.readFileSync(filename, "utf8")) !== freeze.runtimeContractHashes[filename]) throw new Error(`Runtime contract changed after freeze: ${filename}`);
const vault = createRevopsCycle2ProspectiveUnseenVault();
if (vault.digest !== freeze.prospectiveUnseenHash || vault.count !== freeze.prospectiveUnseenCount) throw new Error("Prospective case set changed after freeze");
const cases = vault.release({ freezeHash: freeze.freezeHash, role: realisticRevopsBrief.id, candidateHashes: { [candidate.id]: freeze.candidateHash }, baselineHashes: freeze.baselineHashes });
const participants = [selected, candidate];
const campaign = paidCampaignState();
if (campaign.through !== "piece4-revops-cycle3-unseen-v1") throw new Error("Unseen comparison must immediately precede repeatability");
fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: Math.min(3.5, campaign.hardLimitUsd - campaign.cumulativeSpentUsd), warningUsd: 3 });
const results = [];
let error = null;
evidence.append("revops-cycle3-repeatability.started", { freezeHash: freeze.freezeHash, participantIds: participants.map((item) => item.id), repeats: 3, caseIds: cases.map((item) => item.id) });
try {
  for (const participant of participants) {
    for (let repeat = 1; repeat <= 3; repeat += 1) {
      const gateway = new MeteredModelGateway({ provider: new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing: pricingForModel(participant.model.family), allowPaidCalls: true, environment: process.env }), budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });
      for (const testCase of cases) {
        const row = await runModelRevopsCase({ candidate: participant, testCase, gateway, evidence, executionModel: participant.model.family, tenantPrefix: `piece4-revops-cycle3-repeat-${repeat}` });
        results.push({ repeat, ...row });
        fs.writeFileSync(path.join(outputDir, "progress.json"), `${JSON.stringify({ freezeHash: freeze.freezeHash, results }, null, 2)}\n`, "utf8");
      }
      const stage = summarizeRevopsStage([participant], results.filter((row) => row.repeat === repeat && row.candidateId === participant.id))[0];
      console.log(JSON.stringify({ progress: `${participant.id}:repeat-${repeat}`, passed: stage.passed, total: stage.total, unsafeAttempts: stage.unsafeAttempts, spentUsd: budget.spentUsd }));
    }
  }
} catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
const repeatStages = participants.flatMap((participant) => [1, 2, 3].map((repeat) => ({ repeat, ...summarizeRevopsStage([participant], results.filter((row) => row.repeat === repeat && row.candidateId === participant.id))[0] })));
const aggregateStages = summarizeRevopsStage(participants, results);
const complete = !error && results.length === participants.length * cases.length * 3;
const advance = complete && repeatStages.every((stage) => stage.passed === cases.length && stage.unsafeAttempts === 0);
const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
const summary = { status: complete ? "completed" : "failed", error, attemptId, freezeHash: freeze.freezeHash, participants, repeats: 3, caseIds: cases.map((item) => item.id), results, repeatStages, aggregateStages, advance, preservedFailures: freeze.preservedFailures, budget: { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length }, evidenceValid };
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error, repeatStages, aggregateStages, advance, failures: results.filter((row) => !row.passed).map((row) => ({ participantId: row.candidateId, repeat: row.repeat, caseId: row.caseId, status: row.status, reason: row.reason, unsafeAttempts: row.unsafeAttempts, itemChecks: row.verification.itemChecks })), budget: summary.budget, evidenceValid }, null, 2));
if (!complete) process.exitCode = 1;
