import fs from "node:fs";
import path from "node:path";
import { digest } from "../../core/canonical.js";
import { PAIRED_SCALE_ARTIFACT_ROOT } from "./paired-protocol.js";
import { PAIRED_V6_ARTIFACT_ROOT } from "./paired-v6-protocol.js";
import { PAIRED_V7_ARTIFACT_ROOT } from "./paired-v7-protocol.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function fileHash(filePath) { return digest(fs.readFileSync(filePath).toString("base64")); }
const root = path.resolve(PAIRED_V7_ARTIFACT_ROOT); const state = path.join(root, "model-campaign"); const v5 = path.resolve(PAIRED_SCALE_ARTIFACT_ROOT); const v6 = path.resolve(PAIRED_V6_ARTIFACT_ROOT);
const receiptPath = path.join(state, "generation-audit-receipt.json"); const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8")); const core = structuredClone(receipt); delete core.receiptHash;
requireCondition(receipt.receiptHash === digest(core), "V7 generation-audit receipt integrity mismatch");
const paths = { plan: path.join(root, "live-plan.json"), casePack: path.join(root, "private-case-pack.json"), casePackReceipt: path.join(root, "private-case-pack-preflight-receipt.json"), portfolio: path.join(state, "generated-portfolio.json"), checkpoint: path.join(state, "generation-checkpoint.json"), structural: path.join(state, "structural-selection-freeze.json"), singleWriterReceipt: path.join(state, "single-writer-generation-receipt.json"), budget: path.join(state, "budget.json"), cache: path.join(state, "response-cache.json"), evidence: path.join(state, "evidence.jsonl"), v5Failure: path.join(v5, "model-campaign", "generation-failure-receipt.json"), v5Budget: path.join(v5, "model-campaign", "budget.json"), v6Failure: path.join(v6, "infrastructure-failure-receipt.json") };
const mutableDuringEvaluation = new Set(["budget", "cache", "evidence"]); const advanced = [];
for (const [name, filePath] of Object.entries(paths)) {
  if (receipt.sourceBindings[name] === fileHash(filePath)) continue;
  if (mutableDuringEvaluation.has(name) && fs.existsSync(path.join(state, "evaluation-observation-progress.json"))) { advanced.push(name); continue; }
  requireCondition(false, `V7 generation-audit source changed: ${name}`);
}
requireCondition(receipt.verdict === "GO_150_VALID_0_REJECTED" && receipt.validCount === 150 && receipt.rejectedCount === 0 && receipt.unresolvedReservations === 0, "V7 generation-audit verdict is not GO");
process.stdout.write(`${JSON.stringify({ status: "verified-zero-cost-generation-audit", receiptHash: receipt.receiptHash, checkpointHash: receipt.generationCheckpointHash, validCount: receipt.validCount, rejectedCount: receipt.rejectedCount, generationSpendUsd: receipt.generationSpendUsd, mutableSourcesAdvancedAfterAudit: advanced }, null, 2)}\n`);
