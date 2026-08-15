import fs from "node:fs";
import path from "node:path";
import { PAIRED_SCALE_ARTIFACT_ROOT } from "./paired-protocol.js";
import { createPaired40ExtensionPreregistration, PAIRED_40_EXTENSION_ROOT } from "./paired-40-extension.js";

function writePrivate(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

const basePlanPath = path.resolve(PAIRED_SCALE_ARTIFACT_ROOT, "live-plan.json");
if (!fs.existsSync(basePlanPath)) throw new Error("Seal the exact v5 live plan before preregistering its 40-prefix extension");
const basePlan = JSON.parse(fs.readFileSync(basePlanPath, "utf8"));
const preregistration = createPaired40ExtensionPreregistration({ basePlan });
const outputPath = path.resolve(PAIRED_40_EXTENSION_ROOT, "preregistration.json");

if (fs.existsSync(outputPath)) {
  const existing = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  if (existing.preregistrationHash !== preregistration.preregistrationHash) throw new Error("Existing 40-prefix preregistration differs; preserve it and investigate instead of overwriting");
} else {
  writePrivate(outputPath, preregistration);
}

process.stdout.write(`${JSON.stringify({
  status: "paired-prefix-40-extension-preregistered-zero-spend",
  baseV5PlanHash: basePlan.planHash,
  preregistrationHash: preregistration.preregistrationHash,
  finalistCount: preregistration.arm.finalistCount,
  outputPath,
  modelCalls: 0,
  spendUsd: 0,
}, null, 2)}\n`);
