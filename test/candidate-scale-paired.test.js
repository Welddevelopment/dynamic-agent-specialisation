import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { digest } from "../src/core/canonical.js";
import { generateBatchedCandidatePortfolio } from "../src/experiments/candidate-scale/batched-architect.js";
import { DeterministicCandidateBatchArchitect } from "../src/experiments/candidate-scale/deterministic-fixtures.js";
import { assertPaired40ExtensionAuthorization, createPaired40ExtensionPreregistration, finalizePaired40ExtensionPlan, PAIRED_40_EXTENSION_APPROVAL } from "../src/experiments/candidate-scale/paired-40-extension.js";
import { assertPairedPrivateCasePack, createFreshPairedPrivateCasePack, pairedPrivateCasePackHash } from "../src/experiments/candidate-scale/paired-private-case-pack.js";
import { assertPairedScaleAuthorization, createPairedScaleProtocolCore, PAIRED_SCALE_APPROVAL, sealPairedScaleProtocol } from "../src/experiments/candidate-scale/paired-protocol.js";
import { PairedScaleOpenAIProvider } from "../src/experiments/candidate-scale/paired-openai-provider.js";
import { assertPairedEvaluationWallClock, assertPairedObservationProgress, createPairedObservationProgress, pairedObservationProgressKey, recordPairedObservation, resumePairedObservation, sealPairedObservationProgress } from "../src/experiments/candidate-scale/paired-observation-progress.js";
import { assertPairedCampaignClock, createPairedCampaignClock, pairedCampaignRemainingMs } from "../src/experiments/candidate-scale/paired-campaign-clock.js";
import { freezePairedStructuralSelection } from "../src/experiments/candidate-scale/paired-selection.js";
import { createCommercialSupportPack } from "../src/product/commercial-support-pack.js";

test("paired 5-vs-150 protocol freezes the nested control, fair bindings, untouched confirmation and $23 gate", () => {
  const protocol = createPairedScaleProtocolCore();
  assert.equal(protocol.targetCandidateCount, 150);
  assert.equal(protocol.prefixCandidateCount, 5);
  assert.equal(protocol.structuralScreen.modelCalls, 0);
  assert.equal(protocol.evaluation.baselineRule.includes("every selection case"), true);
  assert.equal(protocol.evaluation.noWinnerRule.includes("do not release"), true);
  assert.equal(protocol.budget.hardCampaignCeilingUsd, 23);
  assert.equal(protocol.bindings.baselines.length, 4);
  assert.equal(protocol.pricingVerifiedUtcDate, "2026-08-11");
});

test("fresh paired private pack is dynamic-count bound and passes deterministic reference/shortcut preflight", async () => {
  const pack = await createFreshPairedPrivateCasePack({ seed: Buffer.alloc(32, 7), createdAt: "2026-08-11T23:00:00.000Z" });
  assert.equal(assertPairedPrivateCasePack(pack), true);
  assert.deepEqual(pack.caseCounts, { development: 2, validation: 2, adversarial: 2, holdout: 2, repeat: 3 });
  assert.equal(pack.independentReferenceReceipt.passed, true);
  assert.equal(pack.shortcutControlReceipt.allShortcutsRejected, true);
  const mutated = structuredClone(pack); mutated.cases.holdout[0].goal = "mutated";
  assert.throws(() => assertPairedPrivateCasePack(mutated), /integrity mismatch/);
});

test("paired authorization fails closed unless the exact plan, UTC pricing and campaign ceiling are approved", async () => {
  const pack = await createFreshPairedPrivateCasePack({ seed: Buffer.alloc(32, 9), createdAt: "2026-08-11T23:00:00.000Z" });
  const plan = sealPairedScaleProtocol({ casePackHash: pairedPrivateCasePackHash(pack), casePackReceiptHash: digest("receipt") });
  assert.throws(() => assertPairedScaleAuthorization({ plan, environment: {}, currentUtcDate: "2026-08-11" }), /not approved/);
  const environment = {
    DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED",
    DAS_CANDIDATE_SCALE_APPROVAL: PAIRED_SCALE_APPROVAL,
    DAS_CANDIDATE_SCALE_PLAN_HASH: plan.planHash,
    DAS_CANDIDATE_SCALE_CREDITS_AVAILABLE: "CONFIRMED",
    DAS_CANDIDATE_SCALE_LIMIT_USD: "23",
    DAS_CANDIDATE_SCALE_PRICING_VERIFIED_ON: "2026-08-11",
    DAS_CANDIDATE_SCALE_PRICING_TABLE_HASH: plan.protocol.pricingHash,
    OPENAI_API_KEY: "test-placeholder",
  };
  assert.equal(assertPairedScaleAuthorization({ plan, environment, currentUtcDate: "2026-08-11" }).limitUsd, 23);
  environment.DAS_CANDIDATE_SCALE_LIMIT_USD = "23.01";
  assert.throws(() => assertPairedScaleAuthorization({ plan, environment, currentUtcDate: "2026-08-11" }), /no greater/);
});

test("paired provider reserves input at the more expensive cache-write rate", () => {
  const protocol = createPairedScaleProtocolCore();
  const provider = new PairedScaleOpenAIProvider({ apiKey: "test", pricingByModel: protocol.pricing.models, environment: { DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED" } });
  const request = { model: "gpt-5.6-terra", input: "x".repeat(4_000), maxOutputTokens: 1_000 };
  const estimatedInputTokens = Math.ceil(JSON.stringify(request.input).length / 4);
  const expected = estimatedInputTokens / 1_000_000 * 2.5 + 1_000 / 1_000_000 * 12;
  assert.equal(provider.projectCost(request), expected);
});

test("paired provider fails closed on impossible cached/cache-write usage", async () => {
  const protocol = createPairedScaleProtocolCore();
  const fetchImpl = async () => ({ ok: true, async json() { return { id: "response-test", output_text: "{}", usage: { input_tokens: 10, output_tokens: 1, input_tokens_details: { cached_tokens: 8, cache_write_tokens: 4 } } }; } });
  const provider = new PairedScaleOpenAIProvider({ apiKey: "test", pricingByModel: protocol.pricing.models, fetchImpl, environment: { DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED" } });
  await assert.rejects(provider.generate({ model: "gpt-5.6-luna", input: "test", responseFormat: { type: "json_schema", name: "test", schema: { type: "object", properties: {}, required: [], additionalProperties: false } } }), /greater than total input/);
});

test("paired observation resume returns the exact frozen observation and enforces the durable clock", () => {
  const progress = createPairedObservationProgress({ planHash: "plan", startedAt: "2026-08-11T12:00:00.000Z" });
  const key = pairedObservationProgressKey({ planHash: "plan", phase: "selection", participantId: "candidate", configurationHash: "config", caseId: "case", caseHash: "case-hash" });
  const observation = { participantId: "candidate", modelCostUsd: 0.1, receiptHash: "receipt" };
  recordPairedObservation(progress, key, observation);
  const sealed = sealPairedObservationProgress(progress); assert.equal(assertPairedObservationProgress(sealed, { planHash: "plan" }), true);
  assert.deepEqual(resumePairedObservation(sealed, key), observation);
  assert.doesNotThrow(() => assertPairedEvaluationWallClock(sealed, 1_000, Date.parse(sealed.startedAt) + 999));
  assert.throws(() => assertPairedEvaluationWallClock(sealed, 1_000, Date.parse(sealed.startedAt) + 1_001), /wall-clock/);
});

test("paired generation and evaluation share one integrity-bound campaign clock", () => {
  const clock = createPairedCampaignClock({ planHash: "plan", startedAt: "2026-08-11T12:00:00.000Z" });
  assert.equal(assertPairedCampaignClock(clock, { planHash: "plan" }), true);
  assert.equal(pairedCampaignRemainingMs(clock, 90 * 60_000, Date.parse(clock.startedAt) + 30 * 60_000), 60 * 60_000);
  assert.throws(() => pairedCampaignRemainingMs(clock, 90 * 60_000, Date.parse(clock.startedAt) + 90 * 60_000), /single durable/);
});

test("40-prefix extension is preregistered against exact v5 and seals exact positions 1-40 with seven finalists", async () => {
  const basePlan = JSON.parse(fs.readFileSync("artifacts/candidate-scale/paired-5-vs-150-v5/live-plan.json", "utf8"));
  const preregistration = createPaired40ExtensionPreregistration({ basePlan });
  assert.equal(preregistration.arm.requestedCount, 40);
  assert.equal(preregistration.arm.finalistCount, 7);
  assert.match(preregistration.claimBoundary, /cannot establish a universal optimal/);
  const brief = createCommercialSupportPack().roleDraft.compiled.brief;
  const generated = await generateBatchedCandidatePortfolio({ brief, architect: new DeterministicCandidateBatchArchitect(), targetCount: 150, batchSize: 10, executionModel: { family: basePlan.protocol.generation.executionModel, tier: "paired-normalized-execution" } });
  const portfolio = { schemaVersion: "das.candidate-scale-paired-generated-portfolio.v1", planHash: basePlan.planHash, protocolCoreHash: basePlan.protocolCoreHash, roleHash: basePlan.protocol.bindings.roleHash, model: basePlan.protocol.generation.architectModel, candidates: generated.candidates, rejected: generated.rejected, receipt: generated.receipt, budget: {}, evidenceLedgerValid: true };
  portfolio.integrityHash = digest(portfolio);
  const baseStructuralFreeze = freezePairedStructuralSelection({ candidates: portfolio.candidates, brief, prefixCount: 5, globalCount: 10, meaningfulDistance: 0.12 });
  const plan = finalizePaired40ExtensionPlan({ preregistration, basePlan, generatedPortfolio: portfolio, baseStructuralFreeze, brief });
  assert.equal(plan.first40CandidateIds.length, 40);
  assert.deepEqual(plan.first40CandidateIds, portfolio.candidates.slice(0, 40).map((candidate) => candidate.id));
  assert.equal(plan.finalistIds.length, 7);
  assert.equal(plan.first40StructuralFreeze.portfolioCount, 40);
});

test("40-prefix extension launch fails closed without completed v5, root silence confirmation and exact live plan", () => {
  const basePlan = JSON.parse(fs.readFileSync("artifacts/candidate-scale/paired-5-vs-150-v5/live-plan.json", "utf8"));
  const preregistration = createPaired40ExtensionPreregistration({ basePlan });
  const plan = { schemaVersion: "test", extensionId: preregistration.extensionId, extensionPlanHash: "" };
  plan.extensionPlanHash = digest({ schemaVersion: plan.schemaVersion, extensionId: plan.extensionId });
  assert.throws(() => assertPaired40ExtensionAuthorization({ plan, environment: {} }), /requires successful v5 completion/);
  const environment = {
    DAS_CANDIDATE_SCALE_V5_COMPLETE: "CONFIRMED",
    DAS_CANDIDATE_SCALE_NO_NEW_USER_MESSAGE: "CONFIRMED_BY_ROOT",
    DAS_CANDIDATE_SCALE_40_EXTENSION_APPROVAL: PAIRED_40_EXTENSION_APPROVAL,
    DAS_CANDIDATE_SCALE_40_EXTENSION_PLAN_HASH: plan.extensionPlanHash,
    DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED",
    OPENAI_API_KEY: "test-placeholder",
  };
  assert.equal(assertPaired40ExtensionAuthorization({ plan, environment }), true);
  environment.DAS_CANDIDATE_SCALE_NO_NEW_USER_MESSAGE = "";
  assert.throws(() => assertPaired40ExtensionAuthorization({ plan, environment }), /root confirmation/);
});
