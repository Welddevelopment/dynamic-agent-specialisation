import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { ModelCandidateRefiner } from "../compiler/model-refiner.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { realisticSupportBrief } from "../roles/realistic-support.js";
import { supportCycle2AdversarialCases, supportCycle2ValidationCases } from "../worlds/realistic-support-cycle2-cases.js";
import { createSupportCycle3ProspectiveUnseenVault, supportCycle3AdversarialCases, supportCycle3ValidationCases } from "../worlds/realistic-support-cycle3-cases.js";
import { createRealisticSupportUnseenVault, realisticSupportCases } from "../worlds/realistic-support-cases.js";
import { runModelSupportCase, summarizeSupportStage } from "./model-support-runner.js";

const attemptId = "piece3-support-repeatability-repair-v1";
const outputDir = path.resolve("artifacts/runs/piece3-support-repeatability-repair/v1");
const repeatPath = path.resolve("artifacts/runs/piece3-support-cycle3-repeatability/v1/summary.json");
const oldFreezePath = path.resolve("artifacts/runs/piece3-support-cycle2-fresh-adversarial/v1/summary.json");
const cycle3FreezePath = path.resolve("artifacts/runs/piece3-support-cycle3-adversarial/v1/summary.json");
const pricing = { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 };

if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
const repeat = JSON.parse(fs.readFileSync(repeatPath, "utf8"));
if (repeat.advance || repeat.aggregate?.passed !== 17 || repeat.aggregate?.total !== 18 || repeat.aggregate?.unsafeAttempts !== 0) throw new Error("Preserved safe 17/18 repeatability result is required");
const parent = repeat.candidate;
const failure = repeat.results.find((row) => !row.passed);
if (!failure || failure.caseId !== "support-c3-unseen-mixed-evidence") throw new Error("Expected preserved mixed-route repeatability failure is missing");
const oldFreeze = JSON.parse(fs.readFileSync(oldFreezePath, "utf8")).freeze;
const cycle3Freeze = JSON.parse(fs.readFileSync(cycle3FreezePath, "utf8")).freeze;
const oldVault = createRealisticSupportUnseenVault();
const oldUnseen = oldVault.release({ freezeHash: oldFreeze.freezeHash, role: realisticSupportBrief.id, candidateHashes: { [parent.id]: digest(parent) }, baselineHashes: oldFreeze.baselineHashes });
const cycle3Vault = createSupportCycle3ProspectiveUnseenVault();
const cycle3Unseen = cycle3Vault.release({ freezeHash: cycle3Freeze.freezeHash, role: realisticSupportBrief.id, candidateHashes: { [parent.id]: cycle3Freeze.candidateHash }, baselineHashes: cycle3Freeze.baselineHashes });
const developmentFailures = [{
  caseId: failure.caseId,
  repeat: failure.repeat,
  status: failure.status,
  observedToolSequence: failure.toolSequence,
  verifierChecks: failure.verification.checks,
  exactItemChecks: failure.verification.itemChecks,
  generalLesson: "Once external evidence selects a supported route for a ticket, retain that route until every route-specific required outcome is externally verified or a real blocker appears. In particular, a verified duplicate-charge route requires exactly one credit, exactly one credit-applied response, and exactly one credit-resolved closure; do not reclassify that ticket as billing review or product behavior after the credit succeeds. Apply the same route-lock principle to incident, how-to, engineering, security, merge, approval and no-op paths while preserving all existing authority and reconciliation rules.",
}];
const regressionCases = [
  ...realisticSupportCases.development,
  ...realisticSupportCases.validation,
  ...realisticSupportCases.adversarial,
  ...supportCycle2ValidationCases,
  ...supportCycle2AdversarialCases,
  ...oldUnseen,
  ...supportCycle3ValidationCases,
  ...supportCycle3AdversarialCases,
  ...cycle3Unseen,
];

const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error("Repeatability repair is already settled");
fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: Math.min(3.5, campaign.hardLimitUsd - campaign.cumulativeSpentUsd), warningUsd: 2.8 });
const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing, allowPaidCalls: true, environment: process.env, modelMap: { "candidate-refiner-policy": "gpt-5.6-luna" } });
const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });
const results = [];
let summary;
try {
  const refinement = await new ModelCandidateRefiner({ gateway }).refine({ brief: realisticSupportBrief, parent, developmentFailures, preserveModel: true, preserveInstructionItems: true, preserveContext: true });
  evidence.append("support-repeatability.repair-created", { parentId: parent.id, childId: refinement.candidate.id, differences: refinement.differences, preservedResult: "17/18 safe", prospectiveCycle4CasesReleased: false });
  for (const testCase of regressionCases) {
    results.push(await runModelSupportCase({ candidate: refinement.candidate, testCase, gateway, evidence, executionModel: refinement.candidate.model.family, tenantPrefix: "piece3-support-repeatability-repair" }));
    fs.writeFileSync(path.join(outputDir, "progress.json"), `${JSON.stringify({ candidate: refinement.candidate, results }, null, 2)}\n`, "utf8");
  }
  const stage = summarizeSupportStage([refinement.candidate], results)[0];
  const advance = stage.total === regressionCases.length && stage.passed === stage.total && stage.unsafeAttempts === 0;
  summary = { status: "completed", attemptId, preservedRepeatabilityResult: { passed: 17, total: 18, unsafeAttempts: 0, advance: false }, parentId: parent.id, candidate: refinement.candidate, differences: refinement.differences, modelReceipt: refinement.modelReceipt, visibleFailures: developmentFailures, regressionCaseIds: regressionCases.map((item) => item.id), results, stage, advance, prospectiveCycle4CasesReleased: false };
} catch (error) {
  summary = { status: "failed", attemptId, error: error instanceof Error ? error.message : String(error), parentId: parent.id, preservedRepeatabilityResult: { passed: 17, total: 18, unsafeAttempts: 0, advance: false }, visibleFailures: developmentFailures, results, prospectiveCycle4CasesReleased: false };
}
const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
summary.budget = { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length };
summary.evidenceValid = evidenceValid;
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error: summary.error ?? null, candidateId: summary.candidate?.id ?? null, differences: summary.differences ?? null, stage: summary.stage ?? null, advance: summary.advance ?? false, failures: results.filter((row) => !row.passed).map((row) => ({ caseId: row.caseId, status: row.status, reason: row.reason, unsafeAttempts: row.unsafeAttempts, itemChecks: row.verification?.itemChecks })), budget: summary.budget, evidenceValid }, null, 2));
if (summary.status !== "completed") process.exitCode = 1;
