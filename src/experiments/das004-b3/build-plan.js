import fs from "node:fs";
import path from "node:path";
import { createDas004B3Preregistration, DAS004_B3_APPROVAL, DAS004_B3_ARTIFACT_ROOT, DAS004_B3_HARD_LIMIT_USD, DAS004_B3_PRICING_DATE, DAS004_B3_PRICING_HASH, assertDas004B3Preregistration } from "./protocol.js";

/** Seals the preregistration to disk and prints the exact env block the run will demand. */
const root = path.resolve(DAS004_B3_ARTIFACT_ROOT);
const planPath = path.join(root, "plan.json");
if (fs.existsSync(planPath)) throw new Error(`DAS-004/B3 plan already sealed at ${planPath}; never reseal a preregistration`);
const plan = assertDas004B3Preregistration(createDas004B3Preregistration());
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600, flag: "wx" });

process.stdout.write([
  `Sealed: ${planPath}`,
  `planHash: ${plan.planHash}`,
  `distinctArmEntryPoints: ${plan.distinctArmEntryPoints}`,
  "",
  "Add to .env, then run `pnpm das004:b3:run` (or node src/experiments/das004-b3/run.js):",
  "",
  `DAS_ENABLE_PAID_MODEL_CALLS=JOEL_APPROVED`,
  `DAS004_B3_APPROVAL=${DAS004_B3_APPROVAL}`,
  `DAS004_B3_PLAN_HASH=${plan.planHash}`,
  `DAS004_B3_PRICING_HASH=${DAS004_B3_PRICING_HASH}`,
  `DAS004_B3_PRICING_DATE=${DAS004_B3_PRICING_DATE}`,
  `DAS004_B3_LIMIT_USD=${DAS004_B3_HARD_LIMIT_USD}`,
  "",
  `NOTE: the run refuses unless today's UTC date is ${DAS004_B3_PRICING_DATE}. If it slips,`,
  "re-verify the pricing table against the provider and bump DAS004_B3_PRICING_DATE.",
  "",
].join("\n"));
