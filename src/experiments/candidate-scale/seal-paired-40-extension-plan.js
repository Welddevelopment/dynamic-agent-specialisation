import fs from "node:fs";
import path from "node:path";
import { createCommercialSupportPack } from "../../product/commercial-support-pack.js";
import { finalizePaired40ExtensionPlan, PAIRED_40_EXTENSION_ROOT } from "./paired-40-extension.js";
import { PAIRED_SCALE_ARTIFACT_ROOT } from "./paired-protocol.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function read(filePath) { requireCondition(fs.existsSync(filePath), `Missing required frozen artifact: ${filePath}`); return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function writePrivate(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); fs.chmodSync(filePath, 0o600); }

const baseRoot = path.resolve(PAIRED_SCALE_ARTIFACT_ROOT);
const state = path.join(baseRoot, "model-campaign");
for (const forbidden of ["evaluation-observation-progress.json", "pre-final-selection-freeze.json", "completed-result.json"]) {
  requireCondition(!fs.existsSync(path.join(state, forbidden)), `40-prefix plan must be sealed before v5 performance evidence exists: ${forbidden}`);
}

const preregistration = read(path.resolve(PAIRED_40_EXTENSION_ROOT, "preregistration.json"));
const basePlan = read(path.join(baseRoot, "live-plan.json"));
const generatedPortfolio = read(path.join(state, "generated-portfolio.json"));
const baseStructuralFreeze = read(path.join(state, "structural-selection-freeze.json"));
const plan = finalizePaired40ExtensionPlan({ preregistration, basePlan, generatedPortfolio, baseStructuralFreeze, brief: createCommercialSupportPack().roleDraft.compiled.brief });
const outputPath = path.resolve(PAIRED_40_EXTENSION_ROOT, "live-plan.json");
requireCondition(!fs.existsSync(outputPath), "40-prefix live plan already exists; preserve it rather than resealing after new information");
writePrivate(outputPath, plan);

process.stdout.write(`${JSON.stringify({
  status: "paired-prefix-40-extension-plan-sealed-before-performance",
  extensionPlanHash: plan.extensionPlanHash,
  preregistrationHash: plan.preregistrationHash,
  portfolioIntegrityHash: plan.portfolioIntegrityHash,
  first40Count: plan.first40CandidateIds.length,
  finalistIds: plan.finalistIds,
  outputPath,
  modelCalls: 0,
  spendUsd: 0,
}, null, 2)}\n`);
