import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digest } from "../src/core/canonical.js";
import { CommercialComparisonRunner } from "../src/product/commercial-comparison-runner.js";
import { createCommercialLifecycleChallengerHandoff, createCommercialLifecycleHandoffPlan } from "../src/product/commercial-lifecycle-handoff.js";
import { COMMERCIAL_CAMPAIGNS, createCommercialModelCampaignPlan } from "../src/product/commercial-model-campaign.js";
import { POSTCOMPARISON_APPROVAL, authorizePostcomparisonModelPlan, createPostcomparisonModelPlan, runPostcomparisonModelGate } from "../src/product/commercial-postcomparison-model-runner.js";
import { createAllCommercialPostcomparisonGates } from "../src/product/commercial-postcomparison-cases.js";
import { createCommercialActivationReceipt, createCommercialSpecialistBundle } from "../src/product/commercial-specialist-lifecycle.js";
import { CURRENT_MODEL_PRICING_USD } from "../src/providers/model-pricing.js";

function environmentFor(pack) { return { kind: "disposable-sandbox", driverId: pack.driver.id, driverVersion: pack.driver.version, verifierId: pack.driver.verifier.id, verifierStatus: "verified", systemBindings: structuredClone(pack.driver.systemBindings) }; }

async function selectedFixture(pack, preferredType, campaignPlan = null) {
  const runner = new CommercialComparisonRunner({ evaluate: async ({ participant, caseId, verifierId }) => { const preferred = participant.type === preferredType; return { verifierId, independentlyVerified: true, passed: true, outcomeScore: 1, unsafeAttempts: 0, incorrectSideEffects: 0, modelCostUsd: preferred ? .001 : .004, elapsedMs: preferred ? 20 : 100, humanInterventions: 0, receiptHash: `${preferredType}:${participant.id}:${caseId}` }; } });
  const raw = await runner.run({ contract: pack.contract, unseenVault: pack.unseenVault, participants: pack.participants });
  const result = structuredClone(raw);
  if (campaignPlan) { delete result.resultHash; result.campaignId = campaignPlan.campaignId; result.campaignPlanHash = campaignPlan.planHash; result.pricingTableHash = campaignPlan.pricingTableHash; result.evidenceLedgerValid = true; result.resultHash = digest(result); }
  const participant = pack.participants.find((item) => item.id === result.selectedParticipantId);
  return { result, bundle: createCommercialSpecialistBundle({ contract: pack.contract, result, participant, roleDraft: pack.roleDraft }) };
}

async function fixture() {
  const { procurement: { pack, gate } } = createAllCommercialPostcomparisonGates();
  const campaign = COMMERCIAL_CAMPAIGNS.procurement;
  const campaignPlan = createCommercialModelCampaignPlan({ contract: pack.contract, participants: pack.participants, campaignId: campaign.id, campaignApproval: campaign.approval });
  const active = await selectedFixture(pack, "current-agent");
  const activeActivation = createCommercialActivationReceipt({ bundle: active.bundle, contract: pack.contract, environment: environmentFor(pack) });
  const request = { id: "postcomparison-model-test", status: "awaiting-explicit-approval", activeBundleHash: active.bundle.bundleHash, activeActivationHash: activeActivation.activationHash, spendAuthorized: false };
  const lifecyclePlan = createCommercialLifecycleHandoffPlan({ activeBundle: active.bundle, activeActivation, optimizationRequest: request, comparisonContract: pack.contract, modelCampaignPlan: campaignPlan, postcomparisonGateContract: gate.contract });
  const challenger = await selectedFixture(pack, "compiler-candidate", campaignPlan);
  const handoff = createCommercialLifecycleChallengerHandoff({ plan: lifecyclePlan, comparisonContract: pack.contract, result: challenger.result, bundle: challenger.bundle });
  return { pack, gate, lifecyclePlan, handoff, ...challenger };
}

test("post-comparison plan adds a separate exact spend gate without shadow or activation authority", async () => {
  const value = await fixture();
  const plan = createPostcomparisonModelPlan({ lifecyclePlan: value.lifecyclePlan, handoff: value.handoff, result: value.result, bundle: value.bundle, gateContract: value.gate.contract });
  assert.equal(plan.sealedCaseCount, 2);
  assert.equal(plan.maximumTaskEvaluations, 2);
  assert.ok(Object.values(plan.authority).every((item) => item === false));
  const date = "2026-08-05";
  const complete = { DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED", DAS_POSTCOMPARISON_MODEL_APPROVAL: POSTCOMPARISON_APPROVAL, DAS_POSTCOMPARISON_PLAN_HASH: plan.planHash, DAS_POSTCOMPARISON_LIMIT_USD: String(plan.hardSpendLimitUsd), DAS_POSTCOMPARISON_PRICING_VERIFIED_ON: date, DAS_POSTCOMPARISON_PRICING_TABLE_HASH: digest(CURRENT_MODEL_PRICING_USD), OPENAI_API_KEY: "test" };
  for (const key of Object.keys(complete)) { const environment = { ...complete }; delete environment[key]; assert.throws(() => authorizePostcomparisonModelPlan({ plan, environment, pricingVerifiedDate: date })); }
  assert.equal(authorizePostcomparisonModelPlan({ plan, environment: complete, pricingVerifiedDate: date }).paidCallsAuthorized, true);
});

test("post-comparison runner emits exact disposable lifecycle observations and stops before shadow", async () => {
  const value = await fixture();
  const plan = createPostcomparisonModelPlan({ lifecyclePlan: value.lifecyclePlan, handoff: value.handoff, result: value.result, bundle: value.bundle, gateContract: value.gate.contract });
  const date = new Date().toISOString().slice(0, 10);
  const environment = { DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED", DAS_POSTCOMPARISON_MODEL_APPROVAL: POSTCOMPARISON_APPROVAL, DAS_POSTCOMPARISON_PLAN_HASH: plan.planHash, DAS_POSTCOMPARISON_LIMIT_USD: String(plan.hardSpendLimitUsd), DAS_POSTCOMPARISON_PRICING_VERIFIED_ON: date, DAS_POSTCOMPARISON_PRICING_TABLE_HASH: digest(CURRENT_MODEL_PRICING_USD), OPENAI_API_KEY: "test" };
  let networkCalls = 0;
  const summary = await runPostcomparisonModelGate({ ...value, createEvaluator: () => async ({ caseId, verifierId }) => ({ verifierId, independentlyVerified: true, passed: true, outcomeScore: 1, unsafeAttempts: 0, incorrectSideEffects: 0, modelCostUsd: 0, elapsedMs: 1, humanInterventions: 0, receiptHash: digest({ caseId, verifierId }) }), environment, stateDirectory: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "das-postcomparison-model-")), "state"), fetchImpl: async () => { networkCalls += 1; throw new Error("network must remain idle in structural test"); } });
  assert.equal(summary.status, "offline-gates-passed-awaiting-shadow");
  assert.equal(summary.observations.length, 2);
  assert.ok(summary.observations.every((item) => item.executionMode === "disposable" && item.businessWritesCommitted === 0 && item.verificationPassed));
  assert.ok(Object.values(summary.authority).every((item) => item === false));
  assert.equal(networkCalls, 0);
});
