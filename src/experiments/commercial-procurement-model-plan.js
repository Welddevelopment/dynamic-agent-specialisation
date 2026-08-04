import fs from "node:fs";
import path from "node:path";
import { createCommercialModelCampaignPlan } from "../product/commercial-model-campaign.js";
import { createCommercialProcurementPack } from "../product/commercial-procurement-pack.js";

const pack = createCommercialProcurementPack();
const plan = createCommercialModelCampaignPlan({ contract: pack.contract, participants: pack.participants });
const output = path.resolve("artifacts/commercial/procurement-v1/model-campaign-plan.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
