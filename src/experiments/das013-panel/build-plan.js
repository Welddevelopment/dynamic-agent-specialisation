import fs from "node:fs";
import path from "node:path";
import { assertPanelPreregistration, createPanelPreregistration, PANEL_APPROVAL, PANEL_ARTIFACT_ROOT, PANEL_PRICING_HASH } from "./protocol.js";
import { PANEL_PHASES } from "./roster.js";

/** Seals the panel preregistration with an explicit two-UTC-day validity window. */
const today = new Date();
const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
const window = [today.toISOString().slice(0, 10), tomorrow.toISOString().slice(0, 10)];
const root = path.resolve(PANEL_ARTIFACT_ROOT);
const planPath = path.join(root, "plan.json");
if (fs.existsSync(planPath)) throw new Error(`Panel plan already sealed at ${planPath}; never reseal`);
const plan = assertPanelPreregistration(createPanelPreregistration({ sealUtcDates: window }));
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600, flag: "wx" });
process.stdout.write([
  `Sealed: ${planPath}`,
  `planHash: ${plan.planHash}`,
  `validity window (UTC): ${window.join(" / ")}`,
  "",
  "env block:",
  "DAS_ENABLE_PAID_MODEL_CALLS=JOEL_APPROVED",
  `DAS013_PANEL_APPROVAL=${PANEL_APPROVAL}`,
  `DAS013_PANEL_PLAN_HASH=${plan.planHash}`,
  `DAS013_PANEL_PRICING_HASH=${PANEL_PRICING_HASH}`,
  `DAS013_PANEL_PHASE_A_LIMIT_USD=${PANEL_PHASES.A.hardCeilingUsd}`,
  `DAS013_PANEL_PHASE_B_LIMIT_USD=${PANEL_PHASES.B.hardCeilingUsd}`,
  "",
].join("\n"));
