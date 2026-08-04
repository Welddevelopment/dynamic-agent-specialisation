import fs from "node:fs";
import path from "node:path";
import { COMMERCIAL_CAMPAIGNS, createCommercialModelCampaignPlan } from "../product/commercial-model-campaign.js";
import { createCommercialRevopsPack } from "../product/commercial-revops-pack.js";

const pack = createCommercialRevopsPack();
const plan = createCommercialModelCampaignPlan({ contract: pack.contract, participants: pack.participants, maxTurns: COMMERCIAL_CAMPAIGNS.revops.maxTurnsPerTask, campaignId: COMMERCIAL_CAMPAIGNS.revops.id, campaignApproval: COMMERCIAL_CAMPAIGNS.revops.approval });
const output = path.resolve("artifacts/commercial/revops-v1/model-campaign-plan.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
