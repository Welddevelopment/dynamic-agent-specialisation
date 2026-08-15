import fs from "node:fs";
import path from "node:path";
import { digest } from "../../core/canonical.js";
import { createPairedV6ProtocolCore, PAIRED_V6_ARTIFACT_ROOT, sealPairedV6Protocol, V5_BUDGET_SOURCE_HASH, V5_FAILURE_RECEIPT_HASH, V5_PRIOR_SPEND_USD } from "./paired-v6-protocol.js";
import { assertPairedV6PrivateCasePack, createFreshPairedV6PrivateCasePack, pairedV6PrivateCasePackHash } from "./paired-v6-private-case-pack.js";
import { PAIRED_SCALE_ARTIFACT_ROOT } from "./paired-protocol.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function writePrivate(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); fs.chmodSync(filePath, 0o600); }

const v5ReceiptPath = path.resolve(PAIRED_SCALE_ARTIFACT_ROOT, "model-campaign/generation-failure-receipt.json");
requireCondition(fs.existsSync(v5ReceiptPath), "v6 plan requires the preserved v5 generation-failure receipt");
const v5Receipt = JSON.parse(fs.readFileSync(v5ReceiptPath, "utf8"));
const receiptCopy = structuredClone(v5Receipt); const receiptHash = receiptCopy.receiptHash; delete receiptCopy.receiptHash;
requireCondition(receiptHash === V5_FAILURE_RECEIPT_HASH && digest(receiptCopy) === receiptHash, "v5 failure receipt integrity changed");
requireCondition(v5Receipt.sourceBindings.budgetSha256 === V5_BUDGET_SOURCE_HASH && v5Receipt.actualSpendUsd === V5_PRIOR_SPEND_USD, "v5 spend/budget binding changed");

const root = path.resolve(PAIRED_V6_ARTIFACT_ROOT);
const casePackPath = path.join(root, "private-case-pack.json");
const receiptPath = path.join(root, "private-case-pack-preflight-receipt.json");
const planPath = path.join(root, "live-plan.json");
requireCondition(!fs.existsSync(casePackPath) && !fs.existsSync(receiptPath) && !fs.existsSync(planPath), "v6 artifacts already exist; preserve the sealed campaign instead of silently reseeding");
const protocol = createPairedV6ProtocolCore();
const casePack = await createFreshPairedV6PrivateCasePack();
assertPairedV6PrivateCasePack(casePack, { protocol });
writePrivate(casePackPath, casePack);
const receipt = {
  schemaVersion: "das.candidate-scale-paired-case-preflight-receipt.v6-contract-repair",
  protocolCoreHash: protocol.protocolCoreHash,
  casePackHash: pairedV6PrivateCasePackHash(casePack),
  caseCounts: casePack.caseCounts,
  caseHashes: casePack.caseHashes,
  roleHash: casePack.roleHash,
  verifierHash: casePack.verifierHash,
  baselineHashesHash: casePack.baselineHashesHash,
  independentReferenceReceipt: casePack.independentReferenceReceipt,
  shortcutControlReceipt: casePack.shortcutControlReceipt,
  v5FailureReceiptHash: V5_FAILURE_RECEIPT_HASH,
  v5PriorSpendUsd: V5_PRIOR_SPEND_USD,
  modelCalls: 0,
  spendUsd: 0,
  evidenceBoundary: casePack.evidenceBoundary,
};
receipt.receiptHash = digest(receipt);
writePrivate(receiptPath, receipt);
const plan = sealPairedV6Protocol({ casePackHash: receipt.casePackHash, casePackReceiptHash: receipt.receiptHash });
writePrivate(planPath, plan);
process.stdout.write(`${JSON.stringify({ status: "paired-v6-contract-repair-plan-sealed-zero-spend", planHash: plan.planHash, protocolCoreHash: plan.protocolCoreHash, casePackHash: plan.casePackHash, casePackReceiptHash: plan.casePackReceiptHash, v5FailureReceiptHash: plan.v5FailureReceiptHash, v5PriorSpendUsd: plan.v5PriorSpendUsd, v6HardCeilingUsd: plan.protocol.budget.hardCampaignCeilingUsd, maximumCombinedV5V6SpendUsd: plan.protocol.budget.maximumCombinedV5V6SpendUsd, preservedBufferUsd: plan.protocol.budget.sharedUserCeilingUsd - plan.protocol.budget.maximumCombinedV5V6SpendUsd, outputs: { casePackPath, receiptPath, planPath }, modelCalls: 0, spendUsd: 0 }, null, 2)}\n`);
