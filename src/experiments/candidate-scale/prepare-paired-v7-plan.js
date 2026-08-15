import fs from "node:fs";
import path from "node:path";
import { digest } from "../../core/canonical.js";
import { PAIRED_SCALE_ARTIFACT_ROOT } from "./paired-protocol.js";
import { PAIRED_V6_ARTIFACT_ROOT, V5_BUDGET_SOURCE_HASH, V5_FAILURE_RECEIPT_HASH, V5_PRIOR_SPEND_USD } from "./paired-v6-protocol.js";
import { createPairedV7ProtocolCore, PAIRED_V7_ARTIFACT_ROOT, sealPairedV7Protocol, V6_CONSERVATIVE_SPEND_UPPER_BOUND_USD, V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH } from "./paired-v7-protocol.js";
import { assertPairedV7PrivateCasePack, createFreshPairedV7PrivateCasePack, pairedV7PrivateCasePackHash } from "./paired-v7-private-case-pack.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function writePrivate(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" }); fs.chmodSync(filePath, 0o600); }
function verifyReceipt(value, key = "receiptHash") { const copy = structuredClone(value); const expected = copy[key]; delete copy[key]; return Boolean(expected) && digest(copy) === expected; }

const v5ReceiptPath = path.resolve(PAIRED_SCALE_ARTIFACT_ROOT, "model-campaign/generation-failure-receipt.json");
const v6FailurePath = path.resolve(PAIRED_V6_ARTIFACT_ROOT, "infrastructure-failure-receipt.json");
requireCondition(fs.existsSync(v5ReceiptPath) && fs.existsSync(v6FailurePath), "V7 plan requires preserved V5 and V6 failure receipts");
const v5Receipt = JSON.parse(fs.readFileSync(v5ReceiptPath, "utf8"));
requireCondition(verifyReceipt(v5Receipt) && v5Receipt.receiptHash === V5_FAILURE_RECEIPT_HASH && v5Receipt.sourceBindings.budgetSha256 === V5_BUDGET_SOURCE_HASH && v5Receipt.actualSpendUsd === V5_PRIOR_SPEND_USD, "V7 V5 failure/spend binding changed");
const v6Failure = JSON.parse(fs.readFileSync(v6FailurePath, "utf8"));
requireCondition(verifyReceipt(v6Failure) && v6Failure.receiptHash === V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH, "V7 V6 infrastructure-failure receipt changed");
requireCondition(v6Failure.resultStatus === "invalid-concurrent-writer-infrastructure-run" && v6Failure.performanceEvaluationStarted === false && v6Failure.scientificResultUsable === false, "V7 cannot start from a usable or evaluated V6 result");
requireCondition(v6Failure.accounting.conservativeProviderSpendUpperBoundUsd === V6_CONSERVATIVE_SPEND_UPPER_BOUND_USD, "V7 V6 conservative spend upper bound changed");

const root = path.resolve(PAIRED_V7_ARTIFACT_ROOT);
const casePackPath = path.join(root, "private-case-pack.json");
const receiptPath = path.join(root, "private-case-pack-preflight-receipt.json");
const planPath = path.join(root, "live-plan.json");
requireCondition(!fs.existsSync(casePackPath) && !fs.existsSync(receiptPath) && !fs.existsSync(planPath), "V7 artifacts already exist; preserve the sealed campaign instead of reseeding");
const protocol = createPairedV7ProtocolCore();
const casePack = await createFreshPairedV7PrivateCasePack();
assertPairedV7PrivateCasePack(casePack, { protocol });
writePrivate(casePackPath, casePack);
const receipt = {
  schemaVersion: "das.candidate-scale-paired-case-preflight-receipt.v7-single-writer-recovery",
  protocolCoreHash: protocol.protocolCoreHash,
  casePackHash: pairedV7PrivateCasePackHash(casePack),
  caseCounts: casePack.caseCounts,
  caseHashes: casePack.caseHashes,
  roleHash: casePack.roleHash,
  verifierHash: casePack.verifierHash,
  baselineHashesHash: casePack.baselineHashesHash,
  independentReferenceReceipt: casePack.independentReferenceReceipt,
  shortcutControlReceipt: casePack.shortcutControlReceipt,
  v5FailureReceiptHash: V5_FAILURE_RECEIPT_HASH,
  v6InfrastructureFailureReceiptHash: V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH,
  v6ConservativeSpendUpperBoundUsd: V6_CONSERVATIVE_SPEND_UPPER_BOUND_USD,
  modelCalls: 0,
  spendUsd: 0,
  evidenceBoundary: casePack.evidenceBoundary,
};
receipt.receiptHash = digest(receipt);
writePrivate(receiptPath, receipt);
const plan = sealPairedV7Protocol({ casePackHash: receipt.casePackHash, casePackReceiptHash: receipt.receiptHash });
writePrivate(planPath, plan);
process.stdout.write(`${JSON.stringify({ status: "paired-v7-single-writer-recovery-plan-sealed-zero-spend", planHash: plan.planHash, protocolCoreHash: plan.protocolCoreHash, casePackHash: plan.casePackHash, casePackReceiptHash: plan.casePackReceiptHash, v5FailureReceiptHash: plan.v5FailureReceiptHash, v6InfrastructureFailureReceiptHash: plan.v6InfrastructureFailureReceiptHash, priorSharedSpendUpperBoundUsd: plan.priorSharedSpendUpperBoundUsd, v7HardCeilingUsd: plan.protocol.budget.hardCampaignCeilingUsd, maximumCombinedPriorAndV7SpendUsd: plan.protocol.budget.maximumCombinedPriorAndV7SpendUsd, preservedBufferUsd: plan.protocol.budget.sharedUserCeilingUsd - plan.protocol.budget.maximumCombinedPriorAndV7SpendUsd, outputs: { casePackPath, receiptPath, planPath }, modelCalls: 0, spendUsd: 0 }, null, 2)}\n`);
