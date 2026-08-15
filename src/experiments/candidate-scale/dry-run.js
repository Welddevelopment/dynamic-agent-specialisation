import fs from "node:fs";
import path from "node:path";
import { createCaseVault } from "../../evaluation/case-vault.js";
import { realisticSupportBrief } from "../../roles/realistic-support.js";
import { digest } from "../../core/canonical.js";
import { generateBatchedCandidatePortfolio } from "./batched-architect.js";
import { DeterministicCandidateBatchArchitect, createDeterministicScaleEvaluator, deterministicScaleCases } from "./deterministic-fixtures.js";
import { createCandidateScaleExecutionPlan } from "./execution-plan.js";
import { CandidateScaleFunnel } from "./funnel.js";
import { analyzeCandidateScalingCurve } from "./scaling-analysis.js";

const OUTPUT = path.resolve("artifacts/candidate-scale/v1");

function writeJson(name, value) {
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function writeReadme({ plan, portfolio, result, curve }) {
  const body = `# Candidate-scale experiment v1 — zero-spend rehearsal

This directory is isolated from every prior DAS evaluation. It contains a deterministic rehearsal of the future candidate-search scaling experiment. It made **zero model calls** and spent **$0**.

## What the rehearsal established

- ${portfolio.acceptedCount}/${portfolio.targetCount} complete packages passed the existing DAS candidate contract.
- Construction was divided into ${portfolio.batchCount} bounded batches of at most ${portfolio.batchSize}, with compact prior-design memory carried between batches.
- Exact design duplicates were detected separately from coarse architecture families and meaningful structural distance.
- Every package received a cheap viability record; exact duplicate work reused the canonical package's deterministic receipt rather than pretending to be new evidence.
- Safety and incorrect side effects were hard elimination gates.
- Development, validation and adversarial stages reduced the pool before ${result.finalistFreeze.candidates.length} exact finalists were frozen.
- Sealed holdout and fresh-repeat vaults released only after that freeze. The deterministic rehearsal selected \`${result.selectedCandidateId}\`.
- Nested and seeded-random portfolios were simulated at ${curve.evaluatedSizes.join(", ")} candidates over the common viability-screen metric.

## Planning ceiling for a later paid campaign

- Candidate-construction calls: at most ${plan.architectureCalls}
- Task evaluations: at most ${plan.maximumTaskEvaluations}
- Model calls/turns: at most ${plan.maximumTotalModelCalls}
- Projected full-campaign allowance: $${plan.projectedMaximumSpendUsd.toFixed(2)}
- Absolute theoretical ceiling if every task reached the role's full task limit: $${plan.absoluteTheoreticalCeilingUsd.toFixed(2)}
- Dry-plan hash (the future live plan must additionally bind a fresh private case pack): \`${plan.planHash}\`

These are planning bounds, not expected use or current approval. A fresh private case pack must be independently checked and sealed into a new live-plan hash first. The live route then remains disabled until Joel separately approves that exact live plan, confirms credits, chooses a hard spend limit no larger than the projected allowance, verifies same-day pricing, and supplies an API key.

## Claim boundary

This proves the local experiment **machinery** composes. It does not prove that 150 model-generated candidates are valuable, that the deterministic fixture resembles model performance, that the selected fixture is a good real agent, that any portfolio size is universally optimal, or that DAS has customer/production evidence.
`;
  fs.writeFileSync(path.join(OUTPUT, "README.md"), body, { mode: 0o600 });
}

const plan = createCandidateScaleExecutionPlan();
const generated = await generateBatchedCandidatePortfolio({
  brief: realisticSupportBrief,
  architect: new DeterministicCandidateBatchArchitect(),
  targetCount: plan.targetCount,
  batchSize: plan.batchSize,
  executionModel: { family: "gpt-5.6-luna", tier: "normalized-scale-fixture" },
});
if (generated.candidates.length !== plan.targetCount) throw new Error(`Dry run needs ${plan.targetCount} valid packages; received ${generated.candidates.length}`);

const cases = deterministicScaleCases(realisticSupportBrief);
const holdoutVault = createCaseVault(`candidate-scale:${realisticSupportBrief.id}:holdout`, cases.holdoutPayloads);
const repeatVault = createCaseVault(`candidate-scale:${realisticSupportBrief.id}:repeat`, cases.repeatPayloads);
const evaluator = createDeterministicScaleEvaluator();
const funnel = new CandidateScaleFunnel({ evaluate: evaluator, verifierId: realisticSupportBrief.successCriteria.verifierId });
const result = await funnel.run({
  brief: realisticSupportBrief,
  candidates: generated.candidates,
  cases,
  holdoutVault,
  repeatVault,
  baselineHashes: { ordinaryManualFixture: digest("candidate-scale-zero-cost-ordinary-manual-control-v1") },
  stageLimits: plan.stageSurvivors,
  maximumSpendUsd: 0,
  maximumWallClockMs: 10 * 60 * 1_000,
});
const viability = result.history.find((stage) => stage.stage === "viability");
const curve = analyzeCandidateScalingCurve({ candidates: generated.candidates, comparableSummaries: viability.summaries, randomTrials: 500, seed: plan.planHash });
const claimMatrix = {
  schemaVersion: "das.candidate-scale-claim-matrix.v1",
  supportedNow: [
    "A 150-package deterministic fixture can traverse bounded batch generation, the existing candidate contract, execution-model normalization, deduplication, structural-diversity analysis, a staged hard-safety funnel, sealed holdout/repeat release and portfolio resampling with zero paid calls.",
    "The live route is fail-closed behind an exact plan hash, a campaign-specific approval phrase, explicit credit confirmation, a hard spend limit, same-day pricing approval and an API key.",
  ],
  possibleAfterModelRun: {
    diminishingCurve: "Within the frozen role/generator/models/cases, marginal best-result gain flattened after the observed portfolio size. This would not establish a universal candidate count.",
    continuedGain: "Within the frozen experiment, larger candidate portfolios continued to discover stronger safe candidates through the largest tested size. This would not prove the curve continues beyond it.",
    lowDiversity: "Raw candidate count overstated the effective search breadth because many packages collapsed into repeated or near-repeated architectures.",
    noSafeWinner: "The scaled search did not produce a candidate that cleared every frozen safety and outcome gate; that is a valid negative result, not evidence to weaken the gates.",
  },
  neverEstablishedByThisExperiment: ["universal optimal candidate count", "customer value", "production reliability", "general superiority across roles", "global best agent architecture"],
};
claimMatrix.claimMatrixHash = digest(claimMatrix);

writeJson("execution-plan.json", plan);
writeJson("batched-portfolio-receipt.json", generated.receipt);
writeJson("deterministic-funnel-result.json", result);
writeJson("portfolio-scaling-analysis.json", curve);
writeJson("claim-matrix.json", claimMatrix);
writeReadme({ plan, portfolio: generated.receipt, result, curve });

process.stdout.write(`${JSON.stringify({
  status: "zero-spend-dry-run-complete",
  candidates: generated.receipt.acceptedCount,
  batches: generated.receipt.batchCount,
  exactUniqueDesigns: generated.receipt.diversity.exactUniqueDesigns,
  meaningfulUniqueDesigns: generated.receipt.diversity.meaningfulUniqueDesignCount,
  stageSurvivors: result.stageSurvivors,
  selectedCandidateId: result.selectedCandidateId,
  curveSizes: curve.evaluatedSizes,
  modelCalls: 0,
  spendUsd: 0,
  livePlanHash: plan.planHash,
  liveMaximumSpendUsd: plan.projectedMaximumSpendUsd,
  output: OUTPUT,
}, null, 2)}\n`);
