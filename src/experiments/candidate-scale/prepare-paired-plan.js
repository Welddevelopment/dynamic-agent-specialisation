import fs from "node:fs";
import path from "node:path";
import { digest } from "../../core/canonical.js";
import { assertPairedPrivateCasePack, createFreshPairedPrivateCasePack, pairedPrivateCasePackHash } from "./paired-private-case-pack.js";
import { createPairedScaleProtocolCore, PAIRED_SCALE_ARTIFACT_ROOT, sealPairedScaleProtocol } from "./paired-protocol.js";

function writePrivate(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

const root = path.resolve(PAIRED_SCALE_ARTIFACT_ROOT);
const casePackPath = path.join(root, "private-case-pack.json");
const receiptPath = path.join(root, "private-case-pack-preflight-receipt.json");
const planPath = path.join(root, "live-plan.json");
const protocol = createPairedScaleProtocolCore();
let casePack;
if (fs.existsSync(casePackPath)) {
  casePack = JSON.parse(fs.readFileSync(casePackPath, "utf8"));
  assertPairedPrivateCasePack(casePack, { protocol });
} else {
  casePack = await createFreshPairedPrivateCasePack();
  assertPairedPrivateCasePack(casePack, { protocol });
  writePrivate(casePackPath, casePack);
}
const receipt = {
  schemaVersion: "das.candidate-scale-paired-case-preflight-receipt.v1",
  protocolCoreHash: protocol.protocolCoreHash,
  casePackHash: pairedPrivateCasePackHash(casePack),
  caseCounts: casePack.caseCounts,
  caseHashes: casePack.caseHashes,
  roleHash: casePack.roleHash,
  verifierHash: casePack.verifierHash,
  baselineHashesHash: casePack.baselineHashesHash,
  independentReferenceReceipt: casePack.independentReferenceReceipt,
  shortcutControlReceipt: casePack.shortcutControlReceipt,
  modelCalls: 0,
  spendUsd: 0,
  evidenceBoundary: casePack.evidenceBoundary,
};
receipt.receiptHash = digest(receipt);
writePrivate(receiptPath, receipt);
const plan = sealPairedScaleProtocol({ casePackHash: receipt.casePackHash, casePackReceiptHash: receipt.receiptHash });
writePrivate(planPath, plan);

process.stdout.write(`${JSON.stringify({
  status: "paired-5-vs-150-plan-sealed-zero-spend",
  planHash: plan.planHash,
  protocolCoreHash: plan.protocolCoreHash,
  casePackHash: plan.casePackHash,
  casePackReceiptHash: plan.casePackReceiptHash,
  pricingHash: plan.protocol.pricingHash,
  pricingVerifiedUtcDate: plan.protocol.pricingVerifiedUtcDate,
  projectedMaximumUsd: plan.protocol.budget.projectedMaximumUsd,
  hardCampaignCeilingUsd: plan.protocol.budget.hardCampaignCeilingUsd,
  modelCalls: 0,
  spendUsd: 0,
  outputs: { casePackPath, receiptPath, planPath },
}, null, 2)}\n`);

