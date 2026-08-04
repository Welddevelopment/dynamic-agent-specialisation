import { COMMERCIAL_CAMPAIGNS } from "../product/commercial-model-campaign.js";
import { runCommercialModelCampaign } from "../product/commercial-model-campaign-runner.js";
import { createCommercialSupportModelEvaluator, createCommercialSupportPack } from "../product/commercial-support-pack.js";

try {
  const result = await runCommercialModelCampaign({ pack: createCommercialSupportPack(), createEvaluator: createCommercialSupportModelEvaluator, campaign: COMMERCIAL_CAMPAIGNS.support });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify(error.campaignFailure ?? { error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
  process.exitCode = 1;
}
