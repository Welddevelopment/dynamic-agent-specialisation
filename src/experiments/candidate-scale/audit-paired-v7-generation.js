import fs from "node:fs";
import path from "node:path";
import { digest } from "../../core/canonical.js";
import { EvidenceLedger } from "../../core/evidence.js";
import { assertPairedV7EvaluationInputs } from "./paired-v7-evaluation-contract.js";
import { PAIRED_SCALE_ARTIFACT_ROOT } from "./paired-protocol.js";
import { PAIRED_V6_ARTIFACT_ROOT } from "./paired-v6-protocol.js";
import { createPairedV7ProtocolCore, PAIRED_V7_ARTIFACT_ROOT } from "./paired-v7-protocol.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function withoutHash(value, key = "integrityHash") { const copy = structuredClone(value); delete copy[key]; return copy; }
function fileHash(filePath) { return digest(fs.readFileSync(filePath).toString("base64")); }
function writePrivate(filePath, value) { fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" }); fs.chmodSync(filePath, 0o600); }

const root = path.resolve(PAIRED_V7_ARTIFACT_ROOT); const state = path.join(root, "model-campaign");
const v5Root = path.resolve(PAIRED_SCALE_ARTIFACT_ROOT); const v6Root = path.resolve(PAIRED_V6_ARTIFACT_ROOT);
const outputPath = path.join(state, "generation-audit-receipt.json");
requireCondition(!fs.existsSync(outputPath), "V7 generation audit receipt already exists; preserve it");
requireCondition(!fs.existsSync(path.join(state, ".campaign-writer.lock.json")), "V7 generation writer is still live or stale; do not audit partial state");
const read = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const paths = {
  plan: path.join(root, "live-plan.json"), casePack: path.join(root, "private-case-pack.json"), casePackReceipt: path.join(root, "private-case-pack-preflight-receipt.json"),
  portfolio: path.join(state, "generated-portfolio.json"), checkpoint: path.join(state, "generation-checkpoint.json"), structural: path.join(state, "structural-selection-freeze.json"), singleWriterReceipt: path.join(state, "single-writer-generation-receipt.json"),
  budget: path.join(state, "budget.json"), cache: path.join(state, "response-cache.json"), evidence: path.join(state, "evidence.jsonl"),
  v5Failure: path.join(v5Root, "model-campaign", "generation-failure-receipt.json"), v5Budget: path.join(v5Root, "model-campaign", "budget.json"), v6Failure: path.join(v6Root, "infrastructure-failure-receipt.json"),
};
for (const [name, filePath] of Object.entries(paths)) requireCondition(fs.existsSync(filePath), `V7 generation audit missing ${name}`);
const values = Object.fromEntries(Object.entries(paths).filter(([name]) => name !== "evidence").map(([name, filePath]) => [name, read(filePath)]));
const v5BudgetBytes = fs.readFileSync(paths.v5Budget); const protocol = createPairedV7ProtocolCore();
assertPairedV7EvaluationInputs({ plan: values.plan, casePack: values.casePack, casePackReceipt: values.casePackReceipt, portfolio: values.portfolio, checkpoint: values.checkpoint, structural: values.structural, singleWriterReceipt: values.singleWriterReceipt, v5Failure: values.v5Failure, v5BudgetState: values.v5Budget, v5BudgetBytes, v6Failure: values.v6Failure, protocol });
requireCondition(values.budget.integrityHash === digest(withoutHash(values.budget)), "V7 durable budget integrity mismatch");
requireCondition(values.budget.calls.length === 15 && values.budget.calls.every((call) => call.status === "settled"), "V7 generation audit requires exactly 15 settled architect calls");
requireCondition(values.cache.integrityHash === digest(withoutHash(values.cache)) && values.cache.entries.length === 15, "V7 generation response cache is not a clean 15-entry cache");
const evidence = new EvidenceLedger(paths.evidence); requireCondition(evidence.verify(), "V7 generation evidence ledger is not one linear chain");
const budgetSnapshot = { campaignId: values.budget.campaignId, hardLimitUsd: values.budget.hardLimitUsd, warningUsd: values.budget.warningUsd, spentUsd: values.budget.calls.reduce((sum, call) => sum + Number(call.actualUsd ?? 0), 0), reservedUsd: 0, calls: values.budget.calls };
requireCondition(digest(budgetSnapshot) === digest(values.portfolio.budget) && digest(budgetSnapshot) === digest(values.checkpoint.budget), "V7 generation budget snapshot differs from sealed portfolio/checkpoint");
const receiptCore = {
  schemaVersion: "das.candidate-scale-paired-generation-audit.v7-single-writer-recovery",
  verdict: "GO_150_VALID_0_REJECTED",
  planHash: values.plan.planHash,
  protocolCoreHash: protocol.protocolCoreHash,
  generationCheckpointHash: values.checkpoint.integrityHash,
  generatedCount: values.checkpoint.generatedCount,
  validCount: values.checkpoint.validCount,
  rejectedCount: values.checkpoint.rejectedCount,
  exactUniqueCount: values.checkpoint.exactUniqueCount,
  evaluationUnionCount: values.structural.evaluationUnionIds.length,
  generationSpendUsd: budgetSnapshot.spentUsd,
  cumulativePriorAndV7SpendUsd: values.checkpoint.cumulativePriorAndV7SpendUsd,
  writerReceiptHash: values.singleWriterReceipt.receiptHash,
  evidenceLedgerValid: true,
  unresolvedReservations: 0,
  sourceBindings: Object.fromEntries(Object.entries(paths).map(([name, filePath]) => [name, fileHash(filePath)])),
  boundary: "This authorizes only the separately gated V7 evaluation of the frozen structural finalist union. It is not a task-performance result and does not authorize a 40-candidate extension.",
};
const receipt = { ...receiptCore, receiptHash: digest(receiptCore) }; writePrivate(outputPath, receipt);
process.stdout.write(`${JSON.stringify({ verdict: receipt.verdict, checkpointHash: receipt.generationCheckpointHash, validCount: receipt.validCount, rejectedCount: receipt.rejectedCount, exactUniqueCount: receipt.exactUniqueCount, generationSpendUsd: receipt.generationSpendUsd, cumulativePriorAndV7SpendUsd: receipt.cumulativePriorAndV7SpendUsd, receiptHash: receipt.receiptHash, outputPath }, null, 2)}\n`);
