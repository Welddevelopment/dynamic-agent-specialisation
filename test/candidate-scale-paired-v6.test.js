import test from "node:test";
import assert from "node:assert/strict";
import { generateBatchedCandidatePortfolio } from "../src/experiments/candidate-scale/batched-architect.js";
import { DeterministicCandidateBatchArchitect } from "../src/experiments/candidate-scale/deterministic-fixtures.js";
import { DeterministicPairedV6BatchArchitect } from "../src/experiments/candidate-scale/paired-v6-architect.js";
import { assertPairedV6ContextInvariant, canonicalizeV6RawCandidate, pairedV6ContextModeForBatch, PAIRED_V6_CONTEXT_MODE_SCHEDULE } from "../src/experiments/candidate-scale/paired-v6-contract.js";
import { assertPairedV6Authorization, createPairedV6ProtocolCore, PAIRED_V6_APPROVAL, sealPairedV6Protocol, V5_FAILURE_RECEIPT_HASH, V5_PRIOR_SPEND_USD, V6_HARD_CEILING_USD } from "../src/experiments/candidate-scale/paired-v6-protocol.js";
import { assertPairedV6PrivateCasePack, createFreshPairedV6PrivateCasePack, pairedV6PrivateCasePackHash } from "../src/experiments/candidate-scale/paired-v6-private-case-pack.js";
import { createCommercialSupportPack } from "../src/product/commercial-support-pack.js";
import { digest } from "../src/core/canonical.js";

test("v6 contract schedule prospectively separates complete and selective context semantics", () => {
  assert.equal(PAIRED_V6_CONTEXT_MODE_SCHEDULE.length, 15);
  assert.equal(pairedV6ContextModeForBatch(1), "complete");
  assert.equal(pairedV6ContextModeForBatch(2), "selective");
  assert.throws(() => pairedV6ContextModeForBatch(16), /outside/);
});

test("v6 deterministic generation produces 150 contract-valid packages with explicit context invariants", async () => {
  const brief = createCommercialSupportPack().roleDraft.compiled.brief;
  const architect = new DeterministicPairedV6BatchArchitect({ sourceArchitect: new DeterministicCandidateBatchArchitect() });
  const generated = await generateBatchedCandidatePortfolio({ brief, architect, targetCount: 150, batchSize: 10, executionModel: { family: "gpt-5.6-luna", tier: "paired-v6-normalized-execution" } });
  assert.equal(generated.candidates.length, 150);
  assert.equal(generated.rejected.length, 0);
  assert.equal(generated.candidates.every((candidate) => assertPairedV6ContextInvariant(candidate, brief)), true);
  assert.equal(generated.candidates.filter((candidate) => candidate.strategy.requireCompleteContext).length, 80);
  assert.equal(generated.candidates.filter((candidate) => !candidate.strategy.requireCompleteContext).length, 70);
  assert.equal(generated.candidates.filter((candidate) => candidate.strategy.requireCompleteContext).every((candidate) => candidate.context.sources.length === brief.environment.contextSources.length), true);
  assert.equal(generated.candidates.filter((candidate) => !candidate.strategy.requireCompleteContext).every((candidate) => candidate.context.sources.length < brief.environment.contextSources.length), true);
});

test("v6 canonicalization rejects selective packages that claim all sources or repeat a source", () => {
  const brief = createCommercialSupportPack().roleDraft.compiled.brief;
  const raw = {
    id: "bad-selective", roleId: brief.id, model: { family: "x", tier: "y" }, instructions: { style: "test", emphasis: ["safe"] },
    context: { sourceMode: "selective", sources: [...brief.environment.contextSources], selection: "all" }, tools: [brief.environment.tools[0]], memory: { kind: "none", scope: "task" }, authority: { allowedActions: [] }, escalation: { enabled: true, threshold: .5, mode: "handoff" }, verifier: { kind: "independent-external-state", binding: brief.successCriteria.verifierId }, limits: { maxCostPerTaskUsd: .1, maxLatencyMs: 1_000 }, strategy: { qualityWeight: 1, costWeight: 1, speedWeight: 1, riskTolerance: 0 }, provenance: { kind: "compiler-generated", parents: [], rationale: "test" }, version: "1",
  };
  assert.throws(() => canonicalizeV6RawCandidate(raw, brief, "selective"), /strict non-empty subset/);
  raw.context.sources = [brief.environment.contextSources[0], brief.environment.contextSources[0]];
  assert.throws(() => canonicalizeV6RawCandidate(raw, brief, "selective"), /repeated/);
});

test("v6 protocol carries v5 spend forward and preserves more than the reserved dollar", () => {
  const protocol = createPairedV6ProtocolCore();
  assert.equal(protocol.budget.priorSharedSpendUsd, V5_PRIOR_SPEND_USD);
  assert.equal(protocol.budget.hardCampaignCeilingUsd, V6_HARD_CEILING_USD);
  assert.ok(protocol.budget.maximumCombinedV5V6SpendUsd < 23);
  assert.equal(protocol.budget.priorFailureReceiptHash, V5_FAILURE_RECEIPT_HASH);
  assert.equal(protocol.pricingVerifiedUtcDate, "2026-08-12");
  assert.equal(protocol.pricingVerifiedLocalDate, "2026-08-12");
  assert.equal(protocol.pricingVerificationSource, "https://developers.openai.com/api/docs/pricing");
});

test("v6 gets a fresh independently preflighted case pack and exact authorization gate", async () => {
  const pack = await createFreshPairedV6PrivateCasePack({ seed: Buffer.alloc(32, 31), createdAt: "2026-08-11T23:30:00.000Z" });
  assert.equal(assertPairedV6PrivateCasePack(pack), true);
  const plan = sealPairedV6Protocol({ casePackHash: pairedV6PrivateCasePackHash(pack), casePackReceiptHash: digest("v6-receipt") });
  assert.throws(() => assertPairedV6Authorization({ plan, environment: {}, currentUtcDate: "2026-08-12" }), /not approved/);
  const environment = {
    DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED",
    DAS_CANDIDATE_SCALE_V6_APPROVAL: PAIRED_V6_APPROVAL,
    DAS_CANDIDATE_SCALE_V6_PLAN_HASH: plan.planHash,
    DAS_CANDIDATE_SCALE_CREDITS_AVAILABLE: "CONFIRMED",
    DAS_CANDIDATE_SCALE_V6_LIMIT_USD: String(V6_HARD_CEILING_USD),
    DAS_CANDIDATE_SCALE_PRICING_VERIFIED_ON: "2026-08-12",
    DAS_CANDIDATE_SCALE_PRICING_TABLE_HASH: plan.protocol.pricingHash,
    DAS_CANDIDATE_SCALE_V5_FAILURE_RECEIPT_HASH: V5_FAILURE_RECEIPT_HASH,
    OPENAI_API_KEY: "test-placeholder",
  };
  assert.equal(assertPairedV6Authorization({ plan, environment, currentUtcDate: "2026-08-12" }).limitUsd, V6_HARD_CEILING_USD);
  environment.DAS_CANDIDATE_SCALE_V6_LIMIT_USD = "21.84";
  assert.throws(() => assertPairedV6Authorization({ plan, environment, currentUtcDate: "2026-08-12" }), /no greater/);
});
