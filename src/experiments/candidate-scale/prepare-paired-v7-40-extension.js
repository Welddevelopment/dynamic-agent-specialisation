import fs from "node:fs";
import path from "node:path";
import { createPairedV740Preregistration, PAIRED_V7_40_EXTENSION_ROOT } from "./paired-v7-40-extension.js";
import { PAIRED_V7_ARTIFACT_ROOT } from "./paired-v7-protocol.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function writePrivate(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" }); fs.chmodSync(filePath, 0o600); }

const baseRoot = path.resolve(PAIRED_V7_ARTIFACT_ROOT); const basePlanPath = path.join(baseRoot, "live-plan.json");
requireCondition(fs.existsSync(basePlanPath), "Seal the V7 live plan before preregistering its 40-prefix arm");
const forbidden = ["evaluation-observation-progress.json", "pre-final-selection-freeze.json", "combined-result.json"];
requireCondition(forbidden.every((name) => !fs.existsSync(path.join(baseRoot, "model-campaign", name))), "V7 performance evidence already exists; the 40-arm preregistration is no longer prospective");
const basePlan = JSON.parse(fs.readFileSync(basePlanPath, "utf8")); const preregistration = createPairedV740Preregistration({ basePlan });
const outputPath = path.resolve(PAIRED_V7_40_EXTENSION_ROOT, "preregistration.json");
requireCondition(!fs.existsSync(outputPath), "V7 40-arm preregistration already exists; preserve it instead of overwriting");
writePrivate(outputPath, preregistration);
process.stdout.write(`${JSON.stringify({ status: "v7-prefix-40-preregistered-zero-spend", baseV7PlanHash: basePlan.planHash, preregistrationHash: preregistration.preregistrationHash, requestedCount: preregistration.arm.requestedCount, finalistCount: preregistration.arm.finalistCount, outputPath, modelCalls: 0, spendUsd: 0 }, null, 2)}\n`);
