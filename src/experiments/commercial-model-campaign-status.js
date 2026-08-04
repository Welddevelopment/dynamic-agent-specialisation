import fs from "node:fs";
import path from "node:path";
import { COMMERCIAL_CAMPAIGNS } from "../product/commercial-model-campaign.js";
import { writeCommercialModelCampaignProgress } from "../product/model-campaign-progress.js";

const role = process.argv[2];
const campaign = COMMERCIAL_CAMPAIGNS[role];
if (!campaign) throw new Error("Usage: npm run commercial:model:status -- <procurement|support|revops>");
const planPath = path.resolve(campaign.stateDirectory, "..", "model-campaign-plan.json");
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const { output, receipt } = writeCommercialModelCampaignProgress({ stateDirectory: campaign.stateDirectory, plan });
console.log(JSON.stringify({ output, ...receipt }, null, 2));
