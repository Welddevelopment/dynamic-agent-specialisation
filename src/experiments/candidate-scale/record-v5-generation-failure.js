import fs from "node:fs";
import path from "node:path";
import { digest } from "../../core/canonical.js";
import { validateCandidate } from "../../compiler/candidate.js";
import { createCommercialSupportPack } from "../../product/commercial-support-pack.js";
import { analyzeCandidateDiversity } from "./diversity.js";
import { PAIRED_SCALE_ARTIFACT_ROOT } from "./paired-protocol.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function read(filePath) { requireCondition(fs.existsSync(filePath), `Missing v5 artifact: ${filePath}`); return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function writeNew(filePath, value) { requireCondition(!fs.existsSync(filePath), `Preserved v5 failure artifact already exists: ${filePath}`); fs.writeFileSync(filePath, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); fs.chmodSync(filePath, 0o600); }

const root = path.resolve(PAIRED_SCALE_ARTIFACT_ROOT);
const state = path.join(root, "model-campaign");
const plan = read(path.join(root, "live-plan.json"));
const cachePath = path.join(state, "response-cache.json");
const budgetPath = path.join(state, "budget.json");
const evidencePath = path.join(state, "evidence.jsonl");
const cache = read(cachePath);
const budget = read(budgetPath);
requireCondition(Array.isArray(cache.entries) && cache.entries.length === 15, "v5 failure receipt requires the exact 15 cached architect batches");
requireCondition(Array.isArray(budget.calls) && budget.calls.length === 15 && budget.calls.every((call) => call.status === "settled"), "v5 failure receipt requires 15 settled calls");
const brief = createCommercialSupportPack().roleDraft.compiled.brief;
const raw = cache.entries.flatMap((entry, batchIndex) => {
  const payload = typeof entry.response?.output === "string" ? JSON.parse(entry.response.output) : entry.response?.output;
  requireCondition(Array.isArray(payload?.candidates) && payload.candidates.length === 10, `v5 cached batch ${batchIndex + 1} is not an exact ten-candidate response`);
  return payload.candidates.map((candidate, offset) => ({ batchIndex: batchIndex + 1, responsePosition: offset + 1, acceptedPosition: batchIndex * 10 + offset + 1, candidate }));
});
requireCondition(raw.length === 150, "v5 failure receipt requires exactly 150 raw candidates");
const validations = raw.map((entry) => ({ ...entry, validation: validateCandidate(entry.candidate, brief) }));
const valid = validations.filter((entry) => entry.validation.valid).map((entry) => entry.validation.candidate);
const rejected = validations.filter((entry) => !entry.validation.valid).map((entry) => ({ batchIndex: entry.batchIndex, responsePosition: entry.responsePosition, acceptedPosition: entry.acceptedPosition, candidateId: String(entry.candidate?.id ?? ""), rawHash: digest(entry.candidate), reasons: entry.validation.reasons }));
const reasonCounts = {};
for (const row of rejected) for (const reason of row.reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
const diversity = analyzeCandidateDiversity(valid);
const evidenceBytes = fs.readFileSync(evidencePath);
const cacheBytes = fs.readFileSync(cachePath);
const budgetBytes = fs.readFileSync(budgetPath);
const receipt = {
  schemaVersion: "das.candidate-scale-v5-generation-failure-receipt.v1",
  planHash: plan.planHash,
  protocolCoreHash: plan.protocolCoreHash,
  sourceBindings: { responseCacheSha256: digest(cacheBytes.toString("base64")), budgetSha256: digest(budgetBytes.toString("base64")), evidenceLedgerSha256: digest(evidenceBytes.toString("base64")) },
  rawCandidateCount: raw.length,
  validCandidateCount: valid.length,
  rejectedCandidateCount: rejected.length,
  groupedExactReasonCounts: Object.fromEntries(Object.entries(reasonCounts).sort(([a], [b]) => a.localeCompare(b))),
  rejected,
  validPoolDiversity: { exactUniqueDesigns: diversity.exactUniqueDesigns, meaningfulUniqueDesignCount: diversity.meaningfulUniqueDesignCount, architectureSignatureCount: diversity.architectureSignatureCount, exactDuplicatePackages: diversity.exactDuplicatePackages },
  paidCalls: budget.calls.length,
  actualSpendUsd: budget.calls.reduce((sum, call) => sum + Number(call.actualUsd ?? 0), 0),
  portfolioEmitted: false,
  performanceEvaluationStarted: false,
  resultStatus: "negative-generation-validity-gate",
  evidenceBoundary: "The v5 architect returned 150 raw packages, but the frozen candidate contract accepted only 96. The campaign correctly stopped before structural portfolio freeze or performance evaluation. This receipt is a read-only reconstruction from integrity-bound durable inputs and is not performance evidence.",
};
receipt.receiptHash = digest(receipt);
requireCondition(receipt.validCandidateCount === 96 && receipt.rejectedCandidateCount === 54, "v5 reconstructed valid/rejected counts changed");
requireCondition(receipt.actualSpendUsd > 1.16332 && receipt.actualSpendUsd < 1.16334, "v5 reconstructed spend changed");
requireCondition(receipt.validPoolDiversity.exactUniqueDesigns === 96 && receipt.validPoolDiversity.meaningfulUniqueDesignCount === 96 && receipt.validPoolDiversity.architectureSignatureCount === 96, "v5 reconstructed diversity changed");
const receiptPath = path.join(state, "generation-failure-receipt.json");
const reportPath = path.join(root, "generation-failure-report.md");
writeNew(receiptPath, receipt);
writeNew(reportPath, `# Candidate-scale v5 generation failure\n\n- Status: preserved negative generation result\n- Raw candidates returned: **${receipt.rawCandidateCount}**\n- Contract-valid candidates: **${receipt.validCandidateCount}**\n- Rejected candidates: **${receipt.rejectedCandidateCount}**\n- Paid architect calls: **${receipt.paidCalls}**\n- Actual spend: **$${receipt.actualSpendUsd.toFixed(5)}**\n- Valid-pool diversity: **${receipt.validPoolDiversity.exactUniqueDesigns}/${receipt.validPoolDiversity.meaningfulUniqueDesignCount}/${receipt.validPoolDiversity.architectureSignatureCount}** exact/meaningful/signature unique\n- Portfolio emitted: **No**\n- Performance evaluation started: **No**\n\nThe dominant frozen-contract failure was a candidate setting \`requireCompleteContext=true\` while omitting one or more declared role context sources. The failure was preserved; rejected packages were not repaired or replaced after seeing performance.\n\nReceipt hash: \`${receipt.receiptHash}\`\n`);
process.stdout.write(`${JSON.stringify({ status: receipt.resultStatus, receiptHash: receipt.receiptHash, rawCandidateCount: receipt.rawCandidateCount, validCandidateCount: receipt.validCandidateCount, rejectedCandidateCount: receipt.rejectedCandidateCount, groupedExactReasonCounts: receipt.groupedExactReasonCounts, actualSpendUsd: receipt.actualSpendUsd, paidCalls: receipt.paidCalls, receiptPath, reportPath }, null, 2)}\n`);
