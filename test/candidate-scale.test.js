import test from "node:test";
import assert from "node:assert/strict";
import { createCaseVault } from "../src/evaluation/case-vault.js";
import { digest } from "../src/core/canonical.js";
import { realisticSupportBrief } from "../src/roles/realistic-support.js";
import { generateBatchedCandidatePortfolio } from "../src/experiments/candidate-scale/batched-architect.js";
import { analyzeCandidateDiversity, candidateDesignFingerprint } from "../src/experiments/candidate-scale/diversity.js";
import { DeterministicCandidateBatchArchitect, createDeterministicScaleEvaluator, deterministicScaleCases } from "../src/experiments/candidate-scale/deterministic-fixtures.js";
import { assertCandidateScaleLiveAuthorization, CANDIDATE_SCALE_APPROVAL, createCandidateScaleExecutionPlan } from "../src/experiments/candidate-scale/execution-plan.js";
import { CandidateScaleFunnel } from "../src/experiments/candidate-scale/funnel.js";
import { assertCandidateScaleLiveCasePack } from "../src/experiments/candidate-scale/live-case-pack.js";
import { analyzeCandidateScalingCurve } from "../src/experiments/candidate-scale/scaling-analysis.js";

const EXECUTION_MODEL = { family: "gpt-5.6-luna", tier: "normalized-test" };

async function portfolio(count = 40, batchSize = 7) {
  return generateBatchedCandidatePortfolio({
    brief: realisticSupportBrief,
    architect: new DeterministicCandidateBatchArchitect(),
    targetCount: count,
    batchSize,
    executionModel: EXECUTION_MODEL,
  });
}

test("candidate-scale dry plan freezes all requested portfolio sizes and conservative ceilings", () => {
  const plan = createCandidateScaleExecutionPlan();
  assert.deepEqual(plan.portfolioSizes, [5, 10, 20, 40, 75, 150]);
  assert.equal(plan.architectureCalls, 15);
  assert.equal(plan.maximumTaskEvaluations, 596);
  assert.equal(plan.maximumTotalModelCalls, 10_991);
  assert.ok(Math.abs(plan.projectedMaximumSpendUsd - 61.05) < 1e-9);
  assert.ok(Math.abs(plan.absoluteTheoreticalCeilingUsd - 303.25) < 1e-9);
  assert.equal(typeof plan.planHash, "string");
});

test("live candidate-scale authorization fails closed without exact credit and plan approval", () => {
  const plan = createCandidateScaleExecutionPlan();
  assert.throws(() => assertCandidateScaleLiveAuthorization({ environment: {}, plan, pricingVerifiedDate: "2026-08-12" }), /not approved/);
  const environment = {
    DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED",
    DAS_CANDIDATE_SCALE_APPROVAL: CANDIDATE_SCALE_APPROVAL,
    DAS_CANDIDATE_SCALE_PLAN_HASH: plan.planHash,
    DAS_CANDIDATE_SCALE_LIMIT_USD: "5",
    DAS_CANDIDATE_SCALE_PRICING_VERIFIED_ON: "2026-08-12",
    DAS_CANDIDATE_SCALE_PRICING_TABLE_HASH: plan.pricingTableHash,
    OPENAI_API_KEY: "test-only-placeholder",
  };
  assert.throws(() => assertCandidateScaleLiveAuthorization({ environment, plan, pricingVerifiedDate: "2026-08-12" }), /credits/);
  environment.DAS_CANDIDATE_SCALE_CREDITS_AVAILABLE = "CONFIRMED";
  const authorization = assertCandidateScaleLiveAuthorization({ environment, plan, pricingVerifiedDate: "2026-08-12" });
  assert.equal(authorization.limitUsd, 5);
});

test("live case pack requires fresh sealed cases, baselines, reference proof, and intact persistence", () => {
  const cases = Object.fromEntries(Object.entries({ viability: 2, development: 5, validation: 2, adversarial: 3, holdout: 2, repeat: 6 }).map(([stage, count]) => [stage, Array.from({ length: count }, (_, index) => ({ id: `${stage}-${index + 1}`, payload: stage }))]));
  const pack = {
    schemaVersion: "das.candidate-scale-private-case-pack.v1",
    roleId: "role",
    verifierId: "verifier",
    freshAndUnexposed: true,
    cases,
    baselineHashes: { current: "a", ordinary: "b", expert: "c" },
    independentReferenceReceipt: { passed: true, unsafeAttempts: 0, incorrectSideEffects: 0 },
    shortcutControlReceipt: { allShortcutsRejected: true },
  };
  pack.integrityHash = digest(pack);
  assert.equal(assertCandidateScaleLiveCasePack(pack, { roleId: "role", verifierId: "verifier" }), true);
  pack.cases.holdout[0].payload = "mutated";
  assert.throws(() => assertCandidateScaleLiveCasePack(pack, { roleId: "role", verifierId: "verifier" }), /integrity mismatch/);
});

test("bounded architect carries compact design memory and validates every complete package", async () => {
  const generated = await portfolio(40, 7);
  assert.equal(generated.candidates.length, 40);
  assert.equal(generated.rejected.length, 0);
  assert.equal(generated.receipt.batchCount, 6);
  assert.equal(generated.receipt.batches[0].requestedCount, 7);
  assert.equal(generated.receipt.batches.at(-1).requestedCount, 5);
  assert.equal(generated.receipt.batches.every((batch) => batch.acceptedCount === batch.requestedCount), true);
  assert.equal(generated.candidates.every((candidate) => candidate.model.family === EXECUTION_MODEL.family), true);
  assert.equal(generated.receipt.architectSpendUsd, 0);
});

test("candidate-scale diversity separates exact design duplicates from meaningful architectures", async () => {
  const generated = await portfolio(40, 10);
  const analysis = analyzeCandidateDiversity(generated.candidates);
  assert.ok(analysis.exactDuplicatePackages >= 2);
  assert.equal(analysis.exactUniqueDesigns, new Set(generated.candidates.map(candidateDesignFingerprint)).size);
  assert.ok(analysis.meaningfulUniqueDesignCount > 10);
  assert.ok(analysis.meaningfulUniqueDesignCount <= analysis.exactUniqueDesigns);
  assert.ok(analysis.effectiveUniqueArchitectureCount > 1);
});

test("staged funnel keeps safety hard, freezes finalists, and releases holdout and repeat only afterward", async () => {
  const generated = await portfolio(40, 8);
  const cases = deterministicScaleCases(realisticSupportBrief);
  const holdoutVault = createCaseVault(`candidate-scale:${realisticSupportBrief.id}:holdout`, cases.holdoutPayloads);
  const repeatVault = createCaseVault(`candidate-scale:${realisticSupportBrief.id}:repeat`, cases.repeatPayloads);
  assert.equal(holdoutVault.releaseCount(), 0);
  assert.equal(repeatVault.releaseCount(), 0);
  const funnel = new CandidateScaleFunnel({ evaluate: createDeterministicScaleEvaluator(), verifierId: realisticSupportBrief.successCriteria.verifierId });
  const result = await funnel.run({
    brief: realisticSupportBrief,
    candidates: generated.candidates,
    cases,
    holdoutVault,
    repeatVault,
    baselineHashes: { ordinary: digest("test-ordinary-baseline") },
    stageLimits: { viability: 20, development: 12, validation: 6, adversarial: 3 },
    maximumSpendUsd: 0,
    maximumWallClockMs: 60_000,
  });
  assert.equal(result.totalSpendUsd, 0);
  assert.equal(result.totalModelCalls, 0);
  assert.equal(result.holdoutReleaseCount, 1);
  assert.equal(result.repeatReleaseCount, 1);
  assert.ok(result.finalistFreeze.candidates.length <= 3);
  assert.equal(result.rankedRepeatFinalists.every((summary) => summary.unsafeAttempts === 0 && summary.incorrectSideEffects === 0 && summary.passRate === 1), true);
});

test("portfolio analysis reports nested and random curves without claiming a global optimum", async () => {
  const generated = await portfolio(20, 5);
  const comparableSummaries = generated.candidates.map((candidate, index) => ({
    candidateId: candidate.id,
    candidateFingerprint: candidate.fingerprint,
    cases: 2,
    passRate: 1,
    meanOutcomeScore: 0.70 + index / 100,
    unsafeAttempts: 0,
    incorrectSideEffects: 0,
    campaignSpendUsd: 0,
    modelCalls: 0,
    meanElapsedMs: 10,
  }));
  const curve = analyzeCandidateScalingCurve({ candidates: generated.candidates, comparableSummaries, sizes: [5, 10, 20], randomTrials: 100, seed: "test" });
  assert.deepEqual(curve.evaluatedSizes, [5, 10, 20]);
  assert.equal(curve.random.at(-1).probabilityOfFindingEvaluatedPoolTopPerformer, 1);
  assert.match(curve.evidenceBoundary, /cannot establish a universal optimal/);
});
