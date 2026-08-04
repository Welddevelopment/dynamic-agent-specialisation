import fs from "node:fs";
import path from "node:path";
import { COMMERCIAL_CAMPAIGNS, createCommercialModelCampaignPlan } from "../product/commercial-model-campaign.js";
import { createCommercialProcurementPack } from "../product/commercial-procurement-pack.js";

const pack = createCommercialProcurementPack();
const plan = createCommercialModelCampaignPlan({ contract: pack.contract, participants: pack.participants, maxTurns: COMMERCIAL_CAMPAIGNS.procurement.maxTurnsPerTask, campaignId: COMMERCIAL_CAMPAIGNS.procurement.id, campaignApproval: COMMERCIAL_CAMPAIGNS.procurement.approval });
const output = path.resolve("artifacts/commercial/procurement-v1/model-campaign-plan.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
