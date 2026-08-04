import fs from "node:fs";
import path from "node:path";
import { COMMERCIAL_CAMPAIGNS, createCommercialModelCampaignPlan } from "../product/commercial-model-campaign.js";
import { createCommercialSupportPack } from "../product/commercial-support-pack.js";

const pack = createCommercialSupportPack();
const plan = createCommercialModelCampaignPlan({ contract: pack.contract, participants: pack.participants, campaignId: COMMERCIAL_CAMPAIGNS.support.id, campaignApproval: COMMERCIAL_CAMPAIGNS.support.approval });
const output = path.resolve("artifacts/commercial/support-v1/model-campaign-plan.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
