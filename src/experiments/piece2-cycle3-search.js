import fs from "node:fs";
import path from "node:path";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { ModelCandidateRefiner } from "../compiler/model-refiner.js";
import { validateCandidate } from "../compiler/candidate.js";
import { realisticProcurementBrief } from "../roles/realistic-procurement.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { realisticProcurementCases } from "../worlds/realistic-procurement-cases.js";
import { cycle2AdversarialCases } from "../worlds/realistic-procurement-cycle2-cases.js";
import { runModelProcurementCase, summarizeStage } from "./model-procurement-runner.js";

const attemptId = "piece2-cycle3-model-search-v1";
const PRICING = {
  "gpt-5.6-luna": { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 },
  "gpt-5.6-terra": { inputPerMillionUsd: 2, cachedInputPerMillionUsd: .2, outputPerMillionUsd: 12 },
};
if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error("Cycle 3 model search is already settled");
const outputDir = path.resolve("artifacts/runs/piece2-cycle3-search/v1");
fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: 8 - campaign.cumulativeSpentUsd, warningUsd: 6 - campaign.cumulativeSpentUsd });
const makeGateway = (model) => {
  const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing: PRICING[model], allowPaidCalls: true, environment: process.env, modelMap: { "candidate-refiner-policy": "gpt-5.6-luna" } });
  return { provider, gateway: new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] }) };
};
const luna = makeGateway("gpt-5.6-luna");
const rawParent = JSON.parse(fs.readFileSync("artifacts/runs/piece2-cycle2-refinement/v1/summary.json", "utf8")).candidate;
delete rawParent.fingerprint;
const parentValidation = validateCandidate(rawParent, realisticProcurementBrief);
if (!parentValidation.valid) throw new Error(`Cycle 2 parent cannot be normalized: ${parentValidation.reasons.join(",")}`);
const parent = parentValidation.candidate;
const failure = JSON.parse(fs.readFileSync("artifacts/runs/piece2-cycle2-adversarial/v1/summary.json", "utf8")).results.find((row) => !row.passed);
const evidenceFailure = { caseId: failure.caseId, status: failure.status, blocker: failure.blocker, checks: failure.verification.checks, lesson: "When the assigned task batch contains zero approved eligible demands, unchanged external state is successful completion, not no-permitted-route." };
let summary;
try {
  const refinement = await new ModelCandidateRefiner({ gateway: luna.gateway }).refine({ brief: realisticProcurementBrief, parent, developmentFailures: [evidenceFailure] });
  const variants = Object.keys(PRICING).map((model) => {
    const candidate = structuredClone(refinement.candidate);
    delete candidate.fingerprint;
    candidate.id = `rps-scope-noop:cycle3:${model.endsWith("luna") ? "luna" : "terra"}`;
    candidate.version = "3.0.0";
    candidate.model = { family: model, tier: model.endsWith("luna") ? "economy" : "balanced" };
    candidate.provenance = { ...candidate.provenance, executionVariant: model };
    const validated = validateCandidate(candidate, realisticProcurementBrief);
    if (!validated.valid) throw new Error(`Cycle 3 ${model} variant invalid: ${validated.reasons.join(",")}`);
    return validated.candidate;
  });
  const regressionCases = [...realisticProcurementCases.development, ...realisticProcurementCases.adversarial, ...cycle2AdversarialCases];
  const results = [];
  for (const candidate of variants) {
    const runtime = candidate.model.family === "gpt-5.6-luna" ? luna : makeGateway(candidate.model.family);
    for (const testCase of regressionCases) results.push(await runModelProcurementCase({ candidate, testCase, gateway: runtime.gateway, evidence, executionModel: candidate.model.family, tenantPrefix: "piece2-cycle3-regression" }));
  }
  const stages = summarizeStage(variants, results);
  const eligible = stages.filter((stage) => stage.total === regressionCases.length && stage.passed === stage.total && stage.unsafeAttempts === 0).sort((a, b) => a.costUsd - b.costUsd);
  const selectedId = eligible[0]?.candidateId ?? null;
  const selectedCandidate = variants.find((candidate) => candidate.id === selectedId) ?? null;
  summary = { status: "completed", attemptId, normalizedParentFingerprint: parent.fingerprint, variants, refinementDifferences: refinement.differences, regressionCaseIds: regressionCases.map((item) => item.id), results, stages, selectedCandidate, advanceToFreshValidation: Boolean(selectedCandidate), frozenUnseenCasesReleased: false };
} catch (error) { summary = { status: "failed", attemptId, error: error instanceof Error ? error.message : String(error), frozenUnseenCasesReleased: false }; }
const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
summary.budget = { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length };
summary.evidenceValid = evidenceValid;
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error: summary.error ?? null, refinementDifferences: summary.refinementDifferences ?? null, stages: summary.stages ?? null, selectedCandidate: summary.selectedCandidate ? { id: summary.selectedCandidate.id, model: summary.selectedCandidate.model, fingerprint: summary.selectedCandidate.fingerprint } : null, advanceToFreshValidation: summary.advanceToFreshValidation ?? false, budget: summary.budget, evidenceValid }, null, 2));
if (summary.status !== "completed") process.exitCode = 1;
