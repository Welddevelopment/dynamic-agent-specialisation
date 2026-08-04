import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { CommercialComparisonRunner } from "./commercial-comparison-runner.js";
import { buildCommercialEvidenceViews } from "./commercial-evidence-view.js";
import { createCommercialModelCampaignPlan, createCommercialModelCampaignRuntime } from "./commercial-model-campaign.js";
import { assertCommercialComparisonResult, createCommercialActivationReceipt, createCommercialSpecialistBundle } from "./commercial-specialist-lifecycle.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function writePrivate(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); fs.chmodSync(file, 0o600); }

export async function runCommercialModelCampaign({
  pack,
  createEvaluator,
  campaign,
  environment = process.env,
  fetchImpl = fetch,
}) {
  requireCondition(pack?.contract && Array.isArray(pack.participants), "A complete commercial pack is required");
  requireCondition(typeof createEvaluator === "function", "A role-specific model evaluator is required");
  requireCondition(campaign?.id && campaign?.approval && campaign?.stateDirectory, "A complete role-specific campaign configuration is required");

  const plan = createCommercialModelCampaignPlan({
    contract: pack.contract,
    participants: pack.participants,
    campaignId: campaign.id,
    campaignApproval: campaign.approval,
  });
  const runtime = createCommercialModelCampaignRuntime({
    environment,
    contract: pack.contract,
    stateDirectory: campaign.stateDirectory,
    campaignId: campaign.id,
    campaignApproval: campaign.approval,
    fetchImpl,
  });
  const evaluator = createEvaluator({ gateway: runtime.gateway, evidence: runtime.evidence, maxTurns: plan.maxTurnsPerTask });
  const runner = new CommercialComparisonRunner({ evaluate: evaluator, evidence: runtime.evidence, estimateCost: () => 0 });

  try {
    const rawResult = await runner.run({ contract: pack.contract, unseenVault: pack.unseenVault, participants: pack.participants });
    const result = structuredClone(rawResult);
    delete result.resultHash;
    result.campaignId = plan.campaignId;
    result.campaignPlanHash = plan.planHash;
    result.campaignCumulativeSpendUsd = runtime.budget.spentUsd;
    result.campaignReservedUsd = runtime.budget.reservedUsd;
    result.pricingTableHash = plan.pricingTableHash;
    result.evidenceLedgerValid = runtime.evidence.verify();
    result.resultHash = digest(result);
    assertCommercialComparisonResult(result);
    const selected = pack.participants.find((item) => item.id === result.selectedParticipantId);
    const bundle = createCommercialSpecialistBundle({ contract: pack.contract, result, participant: selected, roleDraft: pack.roleDraft });
    const evidenceViews = buildCommercialEvidenceViews({ contract: pack.contract, result, bundle });
    const activation = createCommercialActivationReceipt({ bundle, contract: pack.contract, environment: {
      kind: "disposable-sandbox",
      driverId: pack.contract.driver.id,
      driverVersion: pack.contract.driver.version,
      verifierId: pack.contract.driver.verifier.id,
      verifierStatus: "verified",
      systemBindings: structuredClone(pack.contract.driver.systemBindings),
    } });
    writePrivate(path.join(runtime.root, "model-result.json"), result);
    writePrivate(path.join(runtime.root, "specialist-bundle.json"), bundle);
    writePrivate(path.join(runtime.root, "evidence-views.json"), evidenceViews);
    writePrivate(path.join(runtime.root, "disposable-activation-receipt.json"), activation);
    return { status: "completed", decision: result.decision, selectedParticipantId: result.selectedParticipantId, campaignCumulativeSpendUsd: result.campaignCumulativeSpendUsd, campaignReservedUsd: result.campaignReservedUsd, evidenceLedgerValid: result.evidenceLedgerValid, resultHash: result.resultHash, bundleHash: bundle.bundleHash, activationHash: activation.activationHash, evidenceBoundary: result.evidenceBoundary };
  } catch (error) {
    const failure = {
      schemaVersion: "das.commercial-model-campaign-failure.v1",
      campaignId: plan.campaignId,
      planHash: plan.planHash,
      error: error instanceof Error ? error.message : String(error),
      budget: runtime.budget.snapshot(),
      cacheEntries: runtime.cache.size(),
      evidenceLedgerValid: runtime.evidence.verify(),
      evidenceBoundary: "Preserved failed or interrupted commercial model campaign. No result or improvement should be inferred.",
    };
    failure.failureHash = digest(failure);
    writePrivate(path.join(runtime.root, "latest-failure.json"), failure);
    error.campaignFailure = failure;
    throw error;
  }
}
