import fs from "node:fs";
import path from "node:path";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { ModelOptimizationRefiner } from "../compiler/model-optimization-refiner.js";
import { createPiece3SupportBaselines } from "../evaluation/piece3-support-baselines.js";
import { TargetDrivenImprovementController } from "../optimization/improvement-controller.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { realisticSupportBrief } from "../roles/realistic-support.js";
import { realisticSupportCases } from "../worlds/realistic-support-cases.js";
import { RealisticSupportCompany, RealisticSupportVerifier } from "../worlds/realistic-support-company.js";
import { runModelSupportCase } from "./model-support-runner.js";

const attemptId = "piece3-support-development-target-v3-exact-feedback";
const PRICING = { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 };
const v1Dir = path.resolve("artifacts/runs/piece3-support-development-target/v1");
const v1Path = path.join(v1Dir, "summary.json");
const v1EvidencePath = path.join(v1Dir, "evidence.jsonl");
const viabilityPath = path.resolve("artifacts/runs/piece3-support-viability/v4/summary.json");
const outputDir = path.resolve("artifacts/runs/piece3-support-development-target/v3");
const sourceCandidateId = "support-compiler-candidate-5";

if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED" || !process.env.OPENAI_API_KEY) throw new Error("Approved paid model environment is required");
if (!fs.existsSync(v1Path) || !fs.existsSync(v1EvidencePath) || !fs.existsSync(viabilityPath)) throw new Error("V1 development and V4 viability evidence are required");

const campaign = paidCampaignState();
if (campaign.through === attemptId) throw new Error("Piece 3 exact-feedback refinement is already settled");
fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: Math.min(3, campaign.hardLimitUsd - campaign.cumulativeSpentUsd), warningUsd: 2.5 });
const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing: PRICING, allowPaidCalls: true, environment: process.env, modelMap: { "candidate-optimization-policy": "gpt-5.6-luna" } });
const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });

const prior = JSON.parse(fs.readFileSync(v1Path, "utf8"));
const viability = JSON.parse(fs.readFileSync(viabilityPath, "utf8"));
const sourceCandidate = viability.candidates.find((candidate) => candidate.id === sourceCandidateId);
const baseline = createPiece3SupportBaselines().find((candidate) => candidate.id === prior.result.baseline.candidateId);
if (!sourceCandidate || !baseline) throw new Error("Frozen source candidate or baseline is missing");

const priorEvidence = fs.readFileSync(v1EvidencePath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const sourceMeasurements = prior.result.rounds[0].results.find((item) => item.candidateId === sourceCandidateId)?.caseMeasurements;
if (!sourceMeasurements || sourceMeasurements.length !== realisticSupportCases.development.length) throw new Error("Complete V1 source measurements are required");

async function reconstructVerification(testCase) {
  const tenantSuffix = `:${sourceCandidateId}:${testCase.id}`;
  const decisions = priorEvidence
    .filter((event) => event.type === "runtime.decision" && event.payload?.candidateId === sourceCandidateId && event.payload?.tenantId?.endsWith(tenantSuffix))
    .sort((left, right) => left.sequence - right.sequence)
    .map((event) => event.payload.decision);
  if (!decisions.length) throw new Error(`No preserved decisions for ${testCase.id}`);
  const world = new RealisticSupportCompany({ task: testCase });
  let resolution = null;
  for (const decision of decisions) {
    if (decision.kind === "tool") await world.execute(decision.name, decision.input);
    else resolution = decision;
  }
  const verifier = new RealisticSupportVerifier({ task: testCase, initialState: world.initial });
  const verification = await verifier.verify({ externalState: world.externalState(), resolution });
  evidence.append("support-development.source-verification-reconstructed", {
    sourceAttemptId: prior.attemptId,
    candidateId: sourceCandidateId,
    caseId: testCase.id,
    preservedDecisionCount: decisions.length,
    verification,
  });
  return verification;
}

const enrichedSourceMeasurements = [];
for (const measurement of sourceMeasurements) {
  const testCase = realisticSupportCases.development.find((item) => item.id === measurement.caseId);
  if (!testCase) throw new Error(`Unknown V1 support case ${measurement.caseId}`);
  const verification = await reconstructVerification(testCase);
  if (verification.passed !== measurement.passed) throw new Error(`Reconstructed verification disagrees for ${measurement.caseId}`);
  enrichedSourceMeasurements.push({ ...measurement, verification });
}

const cachedBaseline = prior.evaluationReceipts
  .filter((row) => row.candidateId === baseline.id)
  .map((row) => ({ ...row, toolSequence: [] }));
const refinementReceipts = [];
const evaluationReceipts = [];
const refiner = new ModelOptimizationRefiner({ gateway, maxOutputTokens: 8_000 });
const controller = new TargetDrivenImprovementController({
  contract: prior.contract,
  spentUsd: () => budget.spentUsd,
  evidence,
  evaluate: async (candidate, stage) => {
    if (candidate.id === baseline.id) {
      evidence.append("support-development.cached-measurement-reused", { candidateId: candidate.id, sourceAttemptId: prior.attemptId, caseIds: cachedBaseline.map((row) => row.caseId) });
      return structuredClone(cachedBaseline);
    }
    if (candidate.id === sourceCandidateId) {
      evidence.append("support-development.enriched-source-reused", { candidateId: candidate.id, sourceAttemptId: prior.attemptId, caseIds: enrichedSourceMeasurements.map((row) => row.caseId) });
      return structuredClone(enrichedSourceMeasurements);
    }
    evidence.append("support-development.refined-participant-started", { candidateId: candidate.id, stage, currentSpendUsd: budget.spentUsd });
    const rows = [];
    for (const testCase of realisticSupportCases.development) {
      const row = await runModelSupportCase({ candidate, testCase, gateway, evidence, executionModel: candidate.model.family, tenantPrefix: `piece3-development-exact-feedback:${stage.kind}:${stage.round}` });
      rows.push(row);
      const receipt = { candidateId: candidate.id, stage, caseId: row.caseId, passed: row.passed, outcomeScore: row.outcomeScore, unsafeAttempts: row.unsafeAttempts, modelCostUsd: row.modelCostUsd, elapsedMs: row.elapsedMs, toolCalls: row.toolCalls, toolSequence: row.toolSequence };
      evaluationReceipts.push(receipt);
      evidence.append("support-development.refined-case-finished", receipt);
    }
    return rows;
  },
  estimatePotential: async ({ summary, assessment }) => {
    if (!assessment.qualityChecks.safe) return 0;
    const passGap = Math.max(0, prior.contract.qualityFloor.minimumPassRate - summary.passRate);
    const outcomeGap = Math.max(0, prior.result.baseline.outcomeScore * prior.contract.qualityFloor.minimumOutcomeScoreRatio - summary.outcomeScore);
    const objectiveGap = Object.values(assessment.objectiveChecks).reduce((sum, check) => sum + Math.max(0, check.gap), 0);
    return Math.max(.03, Math.min(.85, .72 - passGap - outcomeGap - objectiveGap));
  },
  refine: async ({ parent, diagnosis, round }) => {
    try {
      const refined = await refiner.refine({ brief: realisticSupportBrief, parent, diagnosis, contract: prior.contract, round });
      const receipt = { parentId: parent.id, childId: refined.candidate.id, round, differences: refined.differences, modelReceipt: refined.modelReceipt };
      refinementReceipts.push(receipt);
      evidence.append("support-development.candidate-refined", receipt);
      return refined.candidate;
    } catch (error) {
      const receipt = { parentId: parent.id, round, error: error instanceof Error ? error.message : String(error) };
      refinementReceipts.push(receipt);
      evidence.append("support-development.refinement-rejected", receipt);
      return null;
    }
  },
});

let summary;
try {
  const result = await controller.run({ baseline, initialCandidates: [sourceCandidate] });
  summary = { status: "completed", attemptId, sourceAttemptId: prior.attemptId, sourceCandidateId, contract: prior.contract, result, evaluationReceipts, refinementReceipts, validationCasesReleased: false, adversarialCasesReleased: false, unseenCasesReleased: false };
} catch (error) {
  summary = { status: "failed", attemptId, sourceAttemptId: prior.attemptId, sourceCandidateId, error: error instanceof Error ? error.message : String(error), contract: prior.contract, evaluationReceipts, refinementReceipts, validationCasesReleased: false, adversarialCasesReleased: false, unseenCasesReleased: false };
}

const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
summary.budget = { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length };
summary.evidenceValid = evidenceValid;
fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: summary.status, error: summary.error ?? null, result: summary.result ? { status: summary.result.status, stopReason: summary.result.stopReason, provisionalWinnerId: summary.result.provisionalWinner?.candidate.id ?? null, bestCandidateId: summary.result.bestCandidateFound?.candidate.id ?? null, rounds: summary.result.rounds.map((round) => ({ round: round.round, results: round.results.map((item) => ({ candidateId: item.candidateId, summary: item.summary, assessment: item.assessment })) })) } : null, refinementReceipts, budget: summary.budget, evidenceValid }, null, 2));
if (summary.status !== "completed") process.exitCode = 1;
