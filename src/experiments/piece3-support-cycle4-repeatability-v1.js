import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { realisticSupportBrief } from "../roles/realistic-support.js";
import { createSupportCycle4ProspectiveUnseenVault } from "../worlds/realistic-support-cycle4-cases.js";
import { runModelSupportCase, summarizeSupportStage } from "./model-support-runner.js";

const attemptId = "piece3-support-cycle4-repeatability-v1";
const outputDir = path.resolve("artifacts/runs/piece3-support-cycle4-repeatability/v1");
const unseenPath = path.resolve("artifacts/runs/piece3-support-cycle4-unseen/v1/summary.json");
const adversarialPath = path.resolve("artifacts/runs/piece3-support-cycle4-adversarial/v1/summary.json");
const contractFiles = ["src/compiler/candidate.js", "src/runtime/agent-runtime.js", "src/runtime/model-decision-engine.js", "src/runtime/memory.js", "src/worlds/realistic-support-company.js", "src/worlds/realistic-support-cycle4-cases.js", "src/experiments/model-support-runner.js"];
const pricing = { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 };

if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
const unseen = JSON.parse(fs.readFileSync(unseenPath, "utf8"));
const adversarial = JSON.parse(fs.readFileSync(adversarialPath, "utf8"));
if (!unseen.advance || unseen.candidateStage?.passed !== 4 || unseen.candidateStage?.unsafeAttempts !== 0 || unseen.candidateRank !== 1) throw new Error("A first-ranked perfect Cycle 4 unseen result is required");
const freeze = adversarial.freeze;
const candidate = adversarial.candidate;
if (unseen.freezeHash !== freeze.freezeHash || digest(candidate) !== freeze.candidateHash) throw new Error("Repeatability candidate or freeze mismatch");
if (digest(realisticSupportBrief) !== freeze.roleBriefHash) throw new Error("Role brief changed after freeze");
for (const filename of contractFiles) if (digest(fs.readFileSync(filename, "utf8")) !== freeze.runtimeContractHashes[filename]) throw new Error(`Runtime contract changed after freeze: ${filename}`);
const vault = createSupportCycle4ProspectiveUnseenVault();
if (vault.digest !== freeze.prospectiveUnseenHash || vault.count !== freeze.prospectiveUnseenCount) throw new Error("Cycle 4 prospective cases changed after freeze");
const cases = vault.release({ freezeHash: freeze.freezeHash, role: realisticSupportBrief.id, candidateHashes: { [candidate.id]: freeze.candidateHash }, baselineHashes: freeze.baselineHashes });

const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error("Cycle 4 repeatability campaign is already settled");
fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: Math.min(1.25, campaign.hardLimitUsd - campaign.cumulativeSpentUsd), warningUsd: 1 });
const results = [];
let error = null;
evidence.append("support-cycle4-repeatability.started", { freezeHash: freeze.freezeHash, candidateId: candidate.id, repeats: 3, caseIds: cases.map((item) => item.id), requiredPasses: cases.length * 3 });
try {
  for (let repeat = 1; repeat <= 3; repeat += 1) {
    const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing, allowPaidCalls: true, environment: process.env });
    const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });
    for (const testCase of cases) {
      const row = await runModelSupportCase({ candidate, testCase, gateway, evidence, executionModel: candidate.model.family, tenantPrefix: `piece3-support-cycle4-repeat-${repeat}` });
      results.push({ repeat, ...row });
      fs.writeFileSync(path.join(outputDir, "progress.json"), `${JSON.stringify({ freezeHash: freeze.freezeHash, results }, null, 2)}\n`, "utf8");
    }
    const stage = summarizeSupportStage([candidate], results.filter((row) => row.repeat === repeat))[0];
    console.log(JSON.stringify({ progress: `repeat-${repeat}`, passed: stage.passed, total: stage.total, unsafeAttempts: stage.unsafeAttempts, spentUsd: budget.spentUsd }));
  }
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
}
const repeatStages = [1, 2, 3].map((repeat) => ({ repeat, ...summarizeSupportStage([candidate], results.filter((row) => row.repeat === repeat))[0] }));
const aggregate = summarizeSupportStage([candidate], results)[0];
const complete = !error && results.length === cases.length * 3;
const advance = complete && aggregate.passed === aggregate.total && aggregate.unsafeAttempts === 0 && repeatStages.every((stage) => stage.passed === stage.total && stage.unsafeAttempts === 0);
const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
const summary = { status: complete ? "completed" : "failed", error, attemptId, freezeHash: freeze.freezeHash, candidate, repeats: 3, caseIds: cases.map((item) => item.id), results, repeatStages, aggregate, advance, preservedFailures: freeze.preservedFailures, budget: { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length }, evidenceValid };
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error, repeatStages, aggregate, advance, failures: results.filter((row) => !row.passed).map((row) => ({ repeat: row.repeat, caseId: row.caseId, unsafeAttempts: row.unsafeAttempts, itemChecks: row.verification?.itemChecks })), budget: summary.budget, evidenceValid }, null, 2));
if (!complete) process.exitCode = 1;
