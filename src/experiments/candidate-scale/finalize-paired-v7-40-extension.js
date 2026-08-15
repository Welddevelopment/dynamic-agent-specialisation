import fs from "node:fs";
import path from "node:path";
import { finalizePairedV740Plan, PAIRED_V7_40_EXTENSION_ROOT } from "./paired-v7-40-extension.js";
import { PAIRED_V7_ARTIFACT_ROOT } from "./paired-v7-protocol.js";

function read(filePath) { if (!fs.existsSync(filePath)) throw new Error(`Missing V7 40-arm artifact: ${filePath}`); return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function writePrivate(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" }); fs.chmodSync(filePath, 0o600); }

const baseRoot = path.resolve(PAIRED_V7_ARTIFACT_ROOT); const state = path.join(baseRoot, "model-campaign"); const extensionRoot = path.resolve(PAIRED_V7_40_EXTENSION_ROOT);
requireCondition(!fs.existsSync(path.join(state, "evaluation-observation-progress.json")) && !fs.existsSync(path.join(state, "pre-final-selection-freeze.json")) && !fs.existsSync(path.join(state, "combined-result.json")), "V7 performance evidence already exists; the 40-arm exact plan is no longer prospective");
const outputPath = path.join(extensionRoot, "live-plan.json"); requireCondition(!fs.existsSync(outputPath), "V7 40-arm exact plan already exists; preserve it instead of overwriting");
const plan = finalizePairedV740Plan({ preregistration: read(path.join(extensionRoot, "preregistration.json")), basePlan: read(path.join(baseRoot, "live-plan.json")), portfolio: read(path.join(state, "generated-portfolio.json")), checkpoint: read(path.join(state, "generation-checkpoint.json")), baseStructural: read(path.join(state, "structural-selection-freeze.json")), singleWriterReceipt: read(path.join(state, "single-writer-generation-receipt.json")) });
writePrivate(outputPath, plan);
process.stdout.write(`${JSON.stringify({ status: "v7-prefix-40-exact-plan-sealed-zero-spend-not-authorized", extensionPlanHash: plan.extensionPlanHash, first40CandidateIds: plan.first40CandidateIds, finalistIds: plan.finalistIds, outputPath, modelCalls: 0, spendUsd: 0 }, null, 2)}\n`);
