import fs from "node:fs";
import path from "node:path";
import { createPairedV740ReusePlan } from "./paired-v7-40-reuse-plan.js";
import { PAIRED_V7_40_EXTENSION_ROOT } from "./paired-v7-40-extension.js";
import { createPairedV7ProtocolCore, PAIRED_V7_ARTIFACT_ROOT } from "./paired-v7-protocol.js";

function read(filePath) { if (!fs.existsSync(filePath)) throw new Error(`Missing V7 40-arm reuse input: ${filePath}`); return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function writePrivate(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" }); fs.chmodSync(filePath, 0o600); }

const root = path.resolve(PAIRED_V7_ARTIFACT_ROOT);
const state = path.join(root, "model-campaign");
const extensionRoot = path.resolve(PAIRED_V7_40_EXTENSION_ROOT);
const outputPath = path.join(extensionRoot, "reuse-plan.json");
if (fs.existsSync(outputPath)) throw new Error("V7 40-arm reuse plan already exists; preserve it instead of overwriting");
const reusePlan = createPairedV740ReusePlan({
  extensionPlan: read(path.join(extensionRoot, "live-plan.json")),
  basePlan: read(path.join(root, "live-plan.json")),
  baseResult: read(path.join(state, "combined-result.json")),
  baseAnalysis: read(path.join(state, "paired-v7-analysis.json")),
  portfolio: read(path.join(state, "generated-portfolio.json")),
  casePack: read(path.join(root, "private-case-pack.json")),
  protocol: createPairedV7ProtocolCore(),
});
writePrivate(outputPath, reusePlan);
process.stdout.write(`${JSON.stringify({ status: "v7-prefix-40-reuse-plan-sealed-zero-spend-not-authorized", reusePlanHash: reusePlan.reusePlanHash, reusableSelectionObservations: reusePlan.selection.reusableObservations.length, missingCandidateSelectionObservations: reusePlan.selection.missingCandidateObservations.length, missingBaselineSelectionObservations: reusePlan.selection.missingBaselineObservations.length, maximumAdditionalObservations: reusePlan.maximumAdditionalObservationsBeforeEarlySafetyStops, paidExecutionAuthorized: false, outputPath, modelCalls: 0, spendUsd: 0 }, null, 2)}\n`);
