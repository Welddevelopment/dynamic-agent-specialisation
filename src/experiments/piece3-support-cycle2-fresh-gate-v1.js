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
import { supportCycle2AdversarialCases, supportCycle2ValidationCases } from "../worlds/realistic-support-cycle2-cases.js";
import { createRealisticSupportUnseenVault } from "../worlds/realistic-support-cases.js";
import { runModelSupportCase, summarizeSupportStage } from "./model-support-runner.js";

const split = process.argv[2];
if (!["validation", "adversarial"].includes(split)) throw new Error("Split must be validation or adversarial");
const attemptId = `piece3-support-cycle2-fresh-${split}-v1`;
const outputDir = path.resolve(`artifacts/runs/piece3-support-cycle2-fresh-${split}/v1`);
const candidatePath = path.resolve("artifacts/runs/piece3-support-cycle2-refinement/v2/summary.json");
const validationPath = path.resolve("artifacts/runs/piece3-support-cycle2-fresh-validation/v1/summary.json");
const pricing = { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 };
const contractFiles = ["src/compiler/candidate.js", "src/runtime/agent-runtime.js", "src/runtime/model-decision-engine.js", "src/runtime/memory.js", "src/worlds/realistic-support-company.js", "src/worlds/realistic-support-cycle2-cases.js", "src/experiments/model-support-runner.js"];

if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
const refinement = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
if (!refinement.advance) throw new Error("Protected 14-case support regression must pass first");
if (split === "adversarial" && !JSON.parse(fs.readFileSync(validationPath, "utf8")).advance) throw new Error("Cycle 2 validation must pass first");
const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error(`${split} gate is already settled`);
const candidate = refinement.candidate;
const baselines = createPiece3SupportBaselines();
const unseen = createRealisticSupportUnseenVault();
const freeze = {
  schemaVersion: 1,
  roleId: realisticSupportBrief.id,
  candidateHash: digest(candidate),
  baselineHashes: Object.fromEntries(baselines.map((baseline) => [baseline.id, digest(baseline)])),
  validationHash: digest(supportCycle2ValidationCases),
  adversarialHash: digest(supportCycle2AdversarialCases),
  unseenHash: unseen.digest,
  roleBriefHash: digest(realisticSupportBrief),
  runtimeContractHashes: Object.fromEntries(contractFiles.map((filename) => [filename, digest(fs.readFileSync(filename, "utf8"))])),
};
freeze.freezeHash = digest(freeze);
if (split === "adversarial" && JSON.parse(fs.readFileSync(validationPath, "utf8")).freeze.freezeHash !== freeze.freezeHash) throw new Error("Cycle 2 support boundary changed after validation freeze");

fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: Math.min(.75, campaign.hardLimitUsd - campaign.cumulativeSpentUsd), warningUsd: .6 });
const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing, allowPaidCalls: true, environment: process.env });
const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });
const cases = split === "validation" ? supportCycle2ValidationCases : supportCycle2AdversarialCases;
const results = [];
let error = null;
evidence.append("support-cycle2-fresh.started", { split, freezeHash: freeze.freezeHash, candidateId: candidate.id, caseIds: cases.map((item) => item.id), unseenCasesReleased: false });
try { for (const testCase of cases) results.push(await runModelSupportCase({ candidate, testCase, gateway, evidence, executionModel: candidate.model.family, tenantPrefix: `piece3-support-cycle2-fresh-${split}` })); }
catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
const stage = summarizeSupportStage([candidate], results)[0];
const advance = !error && stage.total === cases.length && stage.passed === stage.total && stage.unsafeAttempts === 0;
const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
const summary = { status: !error && results.length === cases.length ? "completed" : "failed", error, attemptId, split, freeze, candidate, caseIds: cases.map((item) => item.id), results, stage, advance, baselinesRun: false, unseenCasesReleased: false, budget: { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length }, evidenceValid };
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error, split, freezeHash: freeze.freezeHash, stage, advance, failures: results.filter((row) => !row.passed).map((row) => ({ caseId: row.caseId, status: row.status, reason: row.reason, itemChecks: row.verification?.itemChecks })), budget: summary.budget, evidenceValid }, null, 2));
if (summary.status !== "completed") process.exitCode = 1;
