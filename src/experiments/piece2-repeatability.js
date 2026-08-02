import fs from "node:fs";
import path from "node:path";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { createRealisticProcurementUnseenVault } from "../worlds/realistic-procurement-cases.js";
import { runModelProcurementCase, summarizeStage } from "./model-procurement-runner.js";

const attemptId = "piece2-repeatability-v1";
const REPEATS = 3;
const MODEL = "gpt-5.6-luna";
if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error("Repeatability stage is already settled");
const freeze = JSON.parse(fs.readFileSync("evidence/piece2-procurement-freeze.json", "utf8"));
const participants = [freeze.candidate, freeze.modelBaselines.find((item) => item.id === "baseline-ordinary-manual-luna")];
if (participants.some((item) => !item || item.model.family !== MODEL)) throw new Error("Repeatability participants changed");
const vault = createRealisticProcurementUnseenVault();
const cases = vault.release({ freezeHash: freeze.freezeHash, role: freeze.roleId, candidateHashes: { [freeze.candidate.id]: freeze.candidate.fingerprint }, baselineHashes: Object.fromEntries(freeze.modelBaselines.map((item) => [item.id, item.fingerprint])) });
const outputDir = path.resolve("artifacts/runs/piece2-repeatability/v1");
fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: 20 - campaign.cumulativeSpentUsd, warningUsd: 15 - campaign.cumulativeSpentUsd });
const results = [];
let error = null;
try {
  for (const participant of participants) {
    for (let repeat = 1; repeat <= REPEATS; repeat += 1) {
      const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing: { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 }, allowPaidCalls: true, environment: process.env });
      const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });
      for (const testCase of cases) {
        const result = await runModelProcurementCase({ candidate: participant, testCase, gateway, evidence, executionModel: MODEL, tenantPrefix: `piece2-repeatability-${repeat}` });
        results.push({ ...result, repeat });
      }
    }
  }
} catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
const summaries = summarizeStage(participants, results);
const byRepeat = participants.map((participant) => ({
  candidateId: participant.id,
  repeats: Array.from({ length: REPEATS }, (_, index) => {
    const rows = results.filter((row) => row.candidateId === participant.id && row.repeat === index + 1);
    return { repeat: index + 1, passed: rows.filter((row) => row.passed).length, total: rows.length, costUsd: rows.reduce((sum, row) => sum + row.modelCostUsd, 0), toolCalls: rows.reduce((sum, row) => sum + row.toolCalls, 0), elapsedMs: rows.reduce((sum, row) => sum + row.elapsedMs, 0) };
  }),
}));
const summary = { status: !error && results.length === participants.length * REPEATS * cases.length ? "completed" : "failed", error, attemptId, freezeHash: freeze.freezeHash, repeats: REPEATS, caseIds: cases.map((item) => item.id), participants, results, summaries, byRepeat, note: "Formerly unseen cases; repetition evidence only, not new unseen evidence.", budget: { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length }, evidenceValid };
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error, summaries, byRepeat, budget: summary.budget, evidenceValid }, null, 2));
if (summary.status !== "completed") process.exitCode = 1;
