import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { CommercialComparisonRunner } from "../product/commercial-comparison-runner.js";
import { buildCommercialEvidenceViews } from "../product/commercial-evidence-view.js";
import { createCommercialModelCampaignPlan, createCommercialModelCampaignRuntime } from "../product/commercial-model-campaign.js";
import { createCommercialProcurementModelEvaluator, createCommercialProcurementPack } from "../product/commercial-procurement-pack.js";
import { assertCommercialComparisonResult, createCommercialActivationReceipt, createCommercialSpecialistBundle } from "../product/commercial-specialist-lifecycle.js";

function writePrivate(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); fs.chmodSync(file, 0o600); }

const pack = createCommercialProcurementPack();
const plan = createCommercialModelCampaignPlan({ contract: pack.contract, participants: pack.participants });
const campaign = createCommercialModelCampaignRuntime({ environment: process.env, contract: pack.contract });
const evaluator = createCommercialProcurementModelEvaluator({ gateway: campaign.gateway, evidence: campaign.evidence, maxTurns: plan.maxTurnsPerTask });
const runner = new CommercialComparisonRunner({ evaluate: evaluator, evidence: campaign.evidence, estimateCost: () => 0 });

try {
  const rawResult = await runner.run({ contract: pack.contract, unseenVault: pack.unseenVault, participants: pack.participants });
  const result = structuredClone(rawResult);
  delete result.resultHash;
  result.campaignId = plan.campaignId;
  result.campaignPlanHash = plan.planHash;
  result.campaignCumulativeSpendUsd = campaign.budget.spentUsd;
  result.campaignReservedUsd = campaign.budget.reservedUsd;
  result.pricingTableHash = plan.pricingTableHash;
  result.evidenceLedgerValid = campaign.evidence.verify();
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
  writePrivate(path.join(campaign.root, "model-result.json"), result);
  writePrivate(path.join(campaign.root, "specialist-bundle.json"), bundle);
  writePrivate(path.join(campaign.root, "evidence-views.json"), evidenceViews);
  writePrivate(path.join(campaign.root, "disposable-activation-receipt.json"), activation);
  process.stdout.write(`${JSON.stringify({ status: "completed", decision: result.decision, selectedParticipantId: result.selectedParticipantId, campaignCumulativeSpendUsd: result.campaignCumulativeSpendUsd, campaignReservedUsd: result.campaignReservedUsd, evidenceLedgerValid: result.evidenceLedgerValid, resultHash: result.resultHash, bundleHash: bundle.bundleHash, activationHash: activation.activationHash, evidenceBoundary: result.evidenceBoundary }, null, 2)}\n`);
} catch (error) {
  const failure = {
    schemaVersion: "das.commercial-model-campaign-failure.v1",
    campaignId: plan.campaignId,
    planHash: plan.planHash,
    error: error instanceof Error ? error.message : String(error),
    budget: campaign.budget.snapshot(),
    cacheEntries: campaign.cache.size(),
    evidenceLedgerValid: campaign.evidence.verify(),
    evidenceBoundary: "Preserved failed or interrupted commercial model campaign. No result or improvement should be inferred.",
  };
  failure.failureHash = digest(failure);
  writePrivate(path.join(campaign.root, "latest-failure.json"), failure);
  process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
  process.exitCode = 1;
}
