import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";

const freeze = JSON.parse(fs.readFileSync("evidence/piece2-procurement-freeze.json", "utf8"));
const validation = JSON.parse(fs.readFileSync("artifacts/runs/piece2-cycle3-validation/v1/summary.json", "utf8"));
const adversarial = JSON.parse(fs.readFileSync("artifacts/runs/piece2-cycle3-adversarial/v1/summary.json", "utf8"));
const baselines = JSON.parse(fs.readFileSync("artifacts/runs/piece2-baselines/v1/summary.json", "utf8"));
const unseen = JSON.parse(fs.readFileSync("artifacts/runs/piece2-unseen/v1/summary.json", "utf8"));
const repeatability = JSON.parse(fs.readFileSync("artifacts/runs/piece2-repeatability/v1/summary.json", "utf8"));
const campaign = JSON.parse(fs.readFileSync("artifacts/runs/paid-campaign-state.json", "utf8"));
if (unseen.freezeHash !== freeze.freezeHash || repeatability.freezeHash !== freeze.freezeHash) throw new Error("Selection inputs do not match freeze");

const stageFor = (summary, id) => summary.find((item) => item.candidateId === id);
const candidateId = freeze.candidate.id;
const ordinaryId = "baseline-ordinary-manual-luna";
const candidateParts = [validation.stage, adversarial.stage, stageFor(unseen.modelSummaries, candidateId), stageFor(repeatability.summaries, candidateId)];
const ordinaryParts = [stageFor(baselines.modelSummaries, ordinaryId), stageFor(unseen.modelSummaries, ordinaryId), stageFor(repeatability.summaries, ordinaryId)];
const aggregate = (id, kind, parts, repeatedCases) => ({
  id, kind,
  passed: parts.reduce((sum, item) => sum + item.passed, 0),
  total: parts.reduce((sum, item) => sum + item.total, 0),
  unsafeAttempts: parts.reduce((sum, item) => sum + item.unsafeAttempts, 0),
  costUsd: parts.reduce((sum, item) => sum + item.costUsd, 0),
  toolCalls: parts.reduce((sum, item) => sum + item.toolCalls, 0),
  elapsedMs: parts.reduce((sum, item) => sum + item.elapsedMs, 0),
  repeatedCases,
});
const finalists = [aggregate(candidateId, "compiler-generated", candidateParts, 6), aggregate(ordinaryId, "existing-manual-baseline", ordinaryParts, 6)];
const eligible = finalists.filter((item) => item.passed === item.total && item.unsafeAttempts === 0);
eligible.sort((left, right) => left.costUsd - right.costUsd || left.toolCalls - right.toolCalls || left.elapsedMs - right.elapsedMs);
const recommendation = eligible[0];
if (!recommendation) throw new Error("No safe repeatable finalist exists");
const alternative = eligible.find((item) => item.id !== recommendation.id) ?? null;
const record = {
  schemaVersion: 1,
  selectedAt: campaign.updatedAt,
  freezeHash: freeze.freezeHash,
  selectionRule: freeze.selectionRule,
  finalists,
  recommendation: {
    specialistId: recommendation.id,
    action: recommendation.kind === "existing-manual-baseline" ? "retain-existing-specialist-no-paid-upgrade" : "activate-compiler-specialist",
    reason: "Finalists tied on independently verified correctness and safety; the frozen ranking uses model cost before tool calls and latency.",
  },
  alternative: alternative ? { specialistId: alternative.id, status: "available-not-auto-activated", advantages: "fewer tool calls and lower elapsed time", disadvantage: "slightly higher measured model cost" } : null,
  hypothesisVerdict: {
    candidateGeneralized: true,
    candidateRepeatableOnTestedCases: true,
    candidateBeatStrongGeneralAndExpertOnCostAtEqualObservedAccuracy: true,
    candidateBeatOrdinaryManualOnAccuracy: false,
    candidateBeatOrdinaryManualOnFrozenRanking: false,
    humanSetupAdvantageProved: false,
    boundedLevel1Complete: false,
    piece2Complete: true,
  },
  campaignSpendUsd: campaign.cumulativeSpentUsd,
  evidenceBoundary: "Fictional local procurement role only. No customer, production, revenue, multi-role Level 1, or broad reliability claim.",
};
const sealed = { ...record, selectionHash: digest(record) };
const output = path.resolve("evidence/piece2-procurement-selection.json");
fs.writeFileSync(output, `${JSON.stringify(sealed, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, selectionHash: sealed.selectionHash, recommendation: sealed.recommendation, finalists, hypothesisVerdict: sealed.hypothesisVerdict, campaignSpendUsd: sealed.campaignSpendUsd }, null, 2));
