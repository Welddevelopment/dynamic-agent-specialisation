import assert from "node:assert/strict";
import test from "node:test";
import { digest } from "../src/core/canonical.js";
import { CommercialComparisonRunner } from "../src/product/commercial-comparison-runner.js";
import { createCommercialLifecycleChallengerHandoff, createCommercialLifecycleHandoffPlan } from "../src/product/commercial-lifecycle-handoff.js";
import { COMMERCIAL_CAMPAIGNS, createCommercialModelCampaignPlan } from "../src/product/commercial-model-campaign.js";
import { createAllCommercialPostcomparisonGates, preflightCommercialPostcomparisonGates } from "../src/product/commercial-postcomparison-cases.js";
import { createCommercialActivationReceipt, createCommercialSpecialistBundle } from "../src/product/commercial-specialist-lifecycle.js";

function environment(pack) {
  return { kind: "disposable-sandbox", driverId: pack.driver.id, driverVersion: pack.driver.version, verifierId: pack.driver.verifier.id, verifierStatus: "verified", systemBindings: structuredClone(pack.driver.systemBindings) };
}

async function selectedFixture(pack, preferredType, campaignPlan = null) {
  const runner = new CommercialComparisonRunner({ evaluate: async ({ participant, caseId, verifierId }) => {
    const preferred = participant.type === preferredType;
    return { verifierId, independentlyVerified: true, passed: true, outcomeScore: 1, unsafeAttempts: 0, incorrectSideEffects: 0, modelCostUsd: preferred ? .001 : .004, elapsedMs: preferred ? 20 : 100, humanInterventions: 0, receiptHash: `${preferredType}:${participant.id}:${caseId}` };
  } });
  const raw = await runner.run({ contract: pack.contract, unseenVault: pack.unseenVault, participants: pack.participants });
  const result = structuredClone(raw);
  if (campaignPlan) {
    delete result.resultHash;
    result.campaignId = campaignPlan.campaignId;
    result.campaignPlanHash = campaignPlan.planHash;
    result.pricingTableHash = campaignPlan.pricingTableHash;
    result.evidenceLedgerValid = true;
    result.resultHash = digest(result);
  }
  const participant = pack.participants.find((item) => item.id === result.selectedParticipantId);
  const bundle = createCommercialSpecialistBundle({ contract: pack.contract, result, participant, roleDraft: pack.roleDraft });
  return { result, participant, bundle };
}

test("fresh post-comparison cases are executable, discriminating and remain unreleased", async () => {
  const { gates, receipt } = await preflightCommercialPostcomparisonGates();
  assert.deepEqual(receipt.checks, { allRolesCommitted: true, everyReferencePassed: true, everyWeakControlFailedAtLeastOne: true, noGateReleased: true });
  assert.ok(Object.values(gates).every((item) => item.gate.releaseCount() === 0));
  assert.equal(receipt.modelCalls, 0);
  assert.equal(receipt.paidModelSpendUsd, 0);
});

test("commercial campaign plans contain no post-comparison case payload or identifier", () => {
  const gates = createAllCommercialPostcomparisonGates();
  for (const [role, { pack, gate }] of Object.entries(gates)) {
    const campaign = COMMERCIAL_CAMPAIGNS[role];
    const plan = createCommercialModelCampaignPlan({ contract: pack.contract, participants: pack.participants, maxTurns: campaign.maxTurnsPerTask, campaignId: campaign.id, campaignApproval: campaign.approval });
    const serialized = JSON.stringify(plan);
    assert.equal(serialized.includes("postcomparison-"), false);
    assert.equal(serialized.includes(gate.contract.cases.digest), false);
    for (const item of gate.contract.cases.caseHashes) assert.equal(serialized.includes(item.id), false);
  }
});

test("exact proved campaign winner is handed to the sealed offline gate without spend or activation authority", async () => {
  const { procurement: { pack, gate } } = createAllCommercialPostcomparisonGates();
  const campaign = COMMERCIAL_CAMPAIGNS.procurement;
  const campaignPlan = createCommercialModelCampaignPlan({ contract: pack.contract, participants: pack.participants, maxTurns: campaign.maxTurnsPerTask, campaignId: campaign.id, campaignApproval: campaign.approval });
  const active = await selectedFixture(pack, "current-agent");
  const activeActivation = createCommercialActivationReceipt({ bundle: active.bundle, contract: pack.contract, environment: environment(pack) });
  const request = { id: "recomparison-exact-1", status: "awaiting-explicit-approval", activeBundleHash: active.bundle.bundleHash, activeActivationHash: activeActivation.activationHash, reasons: ["verified-drift"], spendAuthorized: false };
  const plan = createCommercialLifecycleHandoffPlan({ activeBundle: active.bundle, activeActivation, optimizationRequest: request, comparisonContract: pack.contract, modelCampaignPlan: campaignPlan, postcomparisonGateContract: gate.contract });
  const challenger = await selectedFixture(pack, "compiler-candidate", campaignPlan);
  const handoff = createCommercialLifecycleChallengerHandoff({ plan, comparisonContract: pack.contract, result: challenger.result, bundle: challenger.bundle });
  assert.equal(handoff.status, "awaiting-postcomparison-offline-gates");
  assert.equal(handoff.authority.modelSpendAuthorized, false);
  assert.equal(handoff.authority.activationAuthorized, false);
  assert.equal(handoff.authority.customerWritesAuthorized, false);
  const released = gate.release({ handoff, plan, result: challenger.result, bundle: challenger.bundle });
  assert.equal(released.length, 2);
  assert.equal(gate.releaseCount(), 1);
  assert.ok(released.every((item) => item.payload.id === item.id));
});

test("current retention and tampering cannot release the post-comparison vault", async () => {
  const { support: { pack, gate } } = createAllCommercialPostcomparisonGates();
  const campaign = COMMERCIAL_CAMPAIGNS.support;
  const campaignPlan = createCommercialModelCampaignPlan({ contract: pack.contract, participants: pack.participants, maxTurns: campaign.maxTurnsPerTask, campaignId: campaign.id, campaignApproval: campaign.approval });
  const active = await selectedFixture(pack, "current-agent", campaignPlan);
  const activeActivation = createCommercialActivationReceipt({ bundle: active.bundle, contract: pack.contract, environment: environment(pack) });
  const request = { id: "recomparison-retain-1", status: "awaiting-explicit-approval", activeBundleHash: active.bundle.bundleHash, activeActivationHash: activeActivation.activationHash, reasons: ["verified-drift"], spendAuthorized: false };
  const plan = createCommercialLifecycleHandoffPlan({ activeBundle: active.bundle, activeActivation, optimizationRequest: request, comparisonContract: pack.contract, modelCampaignPlan: campaignPlan, postcomparisonGateContract: gate.contract });
  const noReplacement = createCommercialLifecycleChallengerHandoff({ plan, comparisonContract: pack.contract, result: active.result, bundle: active.bundle });
  assert.equal(noReplacement.status, "retain-current-specialist");
  assert.throws(() => gate.release({ handoff: noReplacement, plan, result: active.result, bundle: active.bundle }), /challenger handoff/);

  const challenger = await selectedFixture(pack, "compiler-candidate", campaignPlan);
  const valid = createCommercialLifecycleChallengerHandoff({ plan, comparisonContract: pack.contract, result: challenger.result, bundle: challenger.bundle });
  const changed = structuredClone(valid);
  changed.candidate.id = "substituted-after-comparison";
  assert.throws(() => gate.release({ handoff: changed, plan, result: challenger.result, bundle: challenger.bundle }), /integrity mismatch/);
  assert.equal(gate.releaseCount(), 0);
});
