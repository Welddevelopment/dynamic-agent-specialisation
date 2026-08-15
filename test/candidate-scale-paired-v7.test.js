import test from "node:test";
import assert from "node:assert/strict";
import { createCommercialSupportPack } from "../src/product/commercial-support-pack.js";
import { generateBatchedCandidatePortfolio } from "../src/experiments/candidate-scale/batched-architect.js";
import { DeterministicCandidateBatchArchitect } from "../src/experiments/candidate-scale/deterministic-fixtures.js";
import { DeterministicPairedV7BatchArchitect } from "../src/experiments/candidate-scale/paired-v7-architect.js";
import { assertPairedV7ContextInvariant, pairedV7ContextModeForBatch } from "../src/experiments/candidate-scale/paired-v7-contract.js";
import { assertPairedV7PrivateCasePack, createFreshPairedV7PrivateCasePack, pairedV7PrivateCasePackHash } from "../src/experiments/candidate-scale/paired-v7-private-case-pack.js";
import { V5_FAILURE_RECEIPT_HASH } from "../src/experiments/candidate-scale/paired-v6-protocol.js";
import { assertPairedV7Authorization, createPairedV7ProtocolCore, PAIRED_V7_APPROVAL, sealPairedV7Protocol, V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH, V7_HARD_CEILING_USD, V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD } from "../src/experiments/candidate-scale/paired-v7-protocol.js";

test("V7 preserves the V6 scientific comparison kernel while changing only recovery infrastructure", () => {
  const protocol = createPairedV7ProtocolCore();
  assert.equal(protocol.scientificComparison.unchangedFromV6, true);
  assert.equal(protocol.scientificComparison.v6ScientificKernelHash, protocol.scientificComparison.v7ScientificKernelHash);
  assert.equal(protocol.targetCandidateCount, 150); assert.equal(protocol.prefixCandidateCount, 5); assert.equal(protocol.batchSize, 10);
  assert.equal(protocol.budget.priorSharedSpendUsd, V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD);
  assert.equal(protocol.budget.maximumCombinedPriorAndV7SpendUsd, V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD + V7_HARD_CEILING_USD);
  assert.ok(protocol.budget.maximumCombinedPriorAndV7SpendUsd <= 23);
  assert.equal(Object.values(protocol.budget.projectedComponentsUsd).reduce((sum, value) => sum + value, 0), V7_HARD_CEILING_USD);
});

test("V7 deterministic rehearsal yields 150 valid candidates with the frozen 80/70 context schedule", async () => {
  const protocol = createPairedV7ProtocolCore();
  const brief = createCommercialSupportPack().roleDraft.compiled.brief;
  const generated = await generateBatchedCandidatePortfolio({ brief, architect: new DeterministicPairedV7BatchArchitect({ sourceArchitect: new DeterministicCandidateBatchArchitect() }), targetCount: 150, batchSize: 10, executionModel: { family: protocol.generation.executionModel, tier: "paired-v6-normalized-execution" } });
  assert.equal(generated.candidates.length, 150); assert.equal(generated.rejected.length, 0);
  let complete = 0; let selective = 0;
  for (const [index, candidate] of generated.candidates.entries()) {
    assert.equal(assertPairedV7ContextInvariant(candidate, brief), true);
    const expected = pairedV7ContextModeForBatch(Math.floor(index / 10) + 1);
    assert.equal(candidate.strategy.requireCompleteContext, expected === "complete");
    if (expected === "complete") complete += 1; else selective += 1;
  }
  assert.deepEqual({ complete, selective }, { complete: 80, selective: 70 });
});

test("V7 fresh private pack and exact paid authorization fail closed", async () => {
  const pack = await createFreshPairedV7PrivateCasePack({ seed: Buffer.alloc(32, 17), createdAt: "2026-08-12T00:20:00.000Z" });
  assert.equal(assertPairedV7PrivateCasePack(pack), true);
  const plan = sealPairedV7Protocol({ casePackHash: pairedV7PrivateCasePackHash(pack), casePackReceiptHash: "a".repeat(64) });
  assert.throws(() => assertPairedV7Authorization({ plan, environment: {}, currentUtcDate: "2026-08-12" }), /not approved/);
  const environment = {
    DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED",
    DAS_CANDIDATE_SCALE_V7_APPROVAL: PAIRED_V7_APPROVAL,
    DAS_CANDIDATE_SCALE_V7_PLAN_HASH: plan.planHash,
    DAS_CANDIDATE_SCALE_CREDITS_AVAILABLE: "CONFIRMED",
    DAS_CANDIDATE_SCALE_V7_LIMIT_USD: String(V7_HARD_CEILING_USD),
    DAS_CANDIDATE_SCALE_PRICING_VERIFIED_ON: "2026-08-12",
    DAS_CANDIDATE_SCALE_PRICING_TABLE_HASH: plan.protocol.pricingHash,
    DAS_CANDIDATE_SCALE_V5_FAILURE_RECEIPT_HASH: V5_FAILURE_RECEIPT_HASH,
    DAS_CANDIDATE_SCALE_V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH: V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH,
    OPENAI_API_KEY: "test-placeholder",
  };
  assert.equal(assertPairedV7Authorization({ plan, environment, currentUtcDate: "2026-08-12" }).limitUsd, V7_HARD_CEILING_USD);
  environment.DAS_CANDIDATE_SCALE_V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH = "wrong";
  assert.throws(() => assertPairedV7Authorization({ plan, environment, currentUtcDate: "2026-08-12" }), /infrastructure failure receipt/);
});
