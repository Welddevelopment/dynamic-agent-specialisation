import fs from "node:fs";
import path from "node:path";
import { digest } from "../../core/canonical.js";
import { PAIRED_V6_ARTIFACT_ROOT } from "./paired-v6-protocol.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function bytesHash(filePath) { return digest(fs.readFileSync(filePath).toString("base64")); }
function withoutHash(value, key = "integrityHash") { const copy = structuredClone(value); delete copy[key]; return copy; }
function writePrivate(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  fs.chmodSync(filePath, 0o600);
}

export function analyzeForkedV6Evidence(records) {
  requireCondition(Array.isArray(records) && records.length > 0, "V6 failure analysis needs evidence records");
  const byHash = new Map();
  for (const record of records) {
    const { hash, ...core } = record;
    requireCondition(hash && digest(core) === hash, "V6 evidence contains an invalid record hash");
    requireCondition(!byHash.has(hash), "V6 evidence contains a duplicate event hash");
    byHash.set(hash, record);
  }
  const children = new Map();
  for (const record of records) {
    requireCondition(record.previousHash === "GENESIS" || byHash.has(record.previousHash), "V6 evidence references an unknown parent");
    const values = children.get(record.previousHash) ?? [];
    values.push(record.hash); children.set(record.previousHash, values);
  }
  requireCondition((children.get("GENESIS") ?? []).length === 1, "V6 evidence needs one genesis child");
  const forkParents = [...children.entries()].filter(([parent, values]) => parent !== "GENESIS" && values.length > 1);
  requireCondition(forkParents.length === 1 && forkParents[0][1].length === 2, "V6 failure receipt expects exactly one two-writer fork");

  function isAncestor(ancestorHash, descendantHash) {
    let current = byHash.get(descendantHash);
    while (current) {
      if (current.previousHash === ancestorHash) return true;
      current = byHash.get(current.previousHash);
    }
    return false;
  }
  const reservations = records.filter((record) => record.type === "model.call-reserved");
  const settlements = records.filter((record) => record.type === "model.call-settled");
  const cacheHits = records.filter((record) => record.type === "model.cache-hit");
  const matchedReservationHashes = new Set();
  const settlementBindings = [];
  for (const settlement of settlements) {
    const eligible = reservations.filter((reservation) =>
      reservation.payload.id === settlement.payload.reservationId
      && isAncestor(reservation.hash, settlement.hash)
      && !matchedReservationHashes.has(reservation.hash));
    requireCondition(eligible.length > 0, `V6 settlement ${settlement.hash} has no matching ancestor reservation`);
    eligible.sort((left, right) => right.sequence - left.sequence);
    const reservation = eligible[0];
    matchedReservationHashes.add(reservation.hash);
    settlementBindings.push({ reservationEventHash: reservation.hash, settlementEventHash: settlement.hash, reservationId: reservation.payload.id, requestHash: reservation.payload.requestHash, responseHash: settlement.payload.responseHash, actualUsd: Number(settlement.payload.actualUsd) });
  }
  const unresolved = reservations.filter((reservation) => !matchedReservationHashes.has(reservation.hash));
  requireCondition(unresolved.length === 2, `V6 failure receipt expected two unresolved reservations, found ${unresolved.length}`);
  const responseHashes = settlements.map((record) => record.payload.responseHash);
  requireCondition(responseHashes.every(Boolean) && new Set(responseHashes).size === responseHashes.length, "V6 settled provider responses are not distinctly identifiable");
  const knownSettledSpendUsd = settlementBindings.reduce((sum, entry) => sum + entry.actualUsd, 0);
  const maximumUnknownInFlightSpendUsd = unresolved.reduce((sum, record) => sum + Number(record.payload.projectedUsd), 0);
  return Object.freeze({
    forkParentHash: forkParents[0][0],
    forkChildHashes: [...forkParents[0][1]],
    reservationEvents: reservations.length,
    settledProviderCalls: settlements.length,
    distinctSettledResponseHashes: responseHashes.length,
    cacheHits: cacheHits.length,
    knownSettledSpendUsd,
    unresolvedReservations: unresolved.map((record) => ({ eventHash: record.hash, reservationId: record.payload.id, requestHash: record.payload.requestHash, projectedUsd: Number(record.payload.projectedUsd) })),
    maximumUnknownInFlightSpendUsd,
    conservativeProviderSpendUpperBoundUsd: knownSettledSpendUsd + maximumUnknownInFlightSpendUsd,
    settlementBindings,
  });
}

const root = path.resolve(PAIRED_V6_ARTIFACT_ROOT);
const state = path.join(root, "model-campaign");
const outputPath = path.join(root, "infrastructure-failure-receipt.json");
requireCondition(!fs.existsSync(outputPath), "V6 infrastructure failure receipt already exists; preserve it");
const sourceNames = ["live-plan.json", "private-case-pack.json", "private-case-pack-preflight-receipt.json", "model-campaign/budget.json", "model-campaign/campaign-clock.json", "model-campaign/evidence.jsonl", "model-campaign/generation-progress.json", "model-campaign/response-cache.json"];
for (const name of sourceNames) requireCondition(fs.existsSync(path.join(root, name)), `V6 failure source is missing: ${name}`);
for (const forbidden of ["generated-portfolio.json", "generation-checkpoint.json", "structural-selection-freeze.json", "combined-result.json"]) requireCondition(!fs.existsSync(path.join(state, forbidden)), `V6 unexpectedly has ${forbidden}; do not record this failure automatically`);

const evidenceBytes = fs.readFileSync(path.join(state, "evidence.jsonl"), "utf8");
const records = evidenceBytes.split("\n").filter(Boolean).map((line) => JSON.parse(line));
const forensic = analyzeForkedV6Evidence(records);
const budget = JSON.parse(fs.readFileSync(path.join(state, "budget.json"), "utf8"));
requireCondition(budget.integrityHash === digest(withoutHash(budget)), "V6 surviving budget snapshot integrity mismatch");
const survivingBudgetSpendUsd = budget.calls.filter((call) => call.status === "settled").reduce((sum, call) => sum + Number(call.actualUsd ?? 0), 0);
requireCondition(survivingBudgetSpendUsd < forensic.knownSettledSpendUsd, "V6 surviving budget does not demonstrate the observed fork undercount");
const progress = JSON.parse(fs.readFileSync(path.join(state, "generation-progress.json"), "utf8"));
const receiptCore = {
  schemaVersion: "das.candidate-scale-v6-infrastructure-failure.v1",
  campaignId: "candidate-scale-paired-5-vs-150-v6-contract-repair",
  resultStatus: "invalid-concurrent-writer-infrastructure-run",
  performanceEvaluationStarted: false,
  generatedPortfolioSealed: false,
  generationCheckpointSealed: false,
  scientificResultUsable: false,
  failure: {
    class: "concurrent-writer-state-corruption",
    finding: "Two live generators wrote the same budget, cache, progress and append-only evidence paths. The evidence graph forked and the surviving budget snapshot undercounted distinct settled provider responses.",
    terminatedWriterPids: [40547, 41071],
    noLiveWriterVerifiedAfterTermination: true,
    survivingProgressBatch: progress.completedBatch,
  },
  accounting: {
    knownSettledProviderCalls: forensic.settledProviderCalls,
    knownSettledSpendUsd: forensic.knownSettledSpendUsd,
    unresolvedInFlightReservations: forensic.unresolvedReservations.length,
    maximumUnknownInFlightSpendUsd: forensic.maximumUnknownInFlightSpendUsd,
    conservativeProviderSpendUpperBoundUsd: forensic.conservativeProviderSpendUpperBoundUsd,
    cacheHits: forensic.cacheHits,
    survivingBudgetRecordedCalls: budget.calls.length,
    survivingBudgetRecordedSpendUsd: survivingBudgetSpendUsd,
    deduplicationRule: "Deduplicate only identical settled response hashes. Every settled response hash was unique. Match settlements to their nearest same-id ancestor reservation within the fork graph; unmatched reservations remain charged at their full projected maximum.",
  },
  evidenceGraph: {
    records: records.length,
    forkParentHash: forensic.forkParentHash,
    forkChildHashes: forensic.forkChildHashes,
    reservationEvents: forensic.reservationEvents,
    settledResponseHashesHash: digest(forensic.settlementBindings.map((entry) => entry.responseHash).sort()),
    unresolvedReservationsHash: digest(forensic.unresolvedReservations),
  },
  sourceBindings: Object.fromEntries(sourceNames.map((name) => [name, bytesHash(path.join(root, name))])),
  recoveryRule: "Preserve V6 unchanged as failed infrastructure evidence. Start a fresh campaign namespace only after an exclusive single-writer lock passes concurrent-process tests. Do not import, repair, substitute or evaluate V6 candidates.",
};
const receipt = { ...receiptCore, receiptHash: digest(receiptCore) };
writePrivate(outputPath, receipt);
process.stdout.write(`${JSON.stringify({ status: receipt.resultStatus, receiptHash: receipt.receiptHash, knownSettledProviderCalls: receipt.accounting.knownSettledProviderCalls, knownSettledSpendUsd: receipt.accounting.knownSettledSpendUsd, maximumUnknownInFlightSpendUsd: receipt.accounting.maximumUnknownInFlightSpendUsd, conservativeProviderSpendUpperBoundUsd: receipt.accounting.conservativeProviderSpendUpperBoundUsd, outputPath }, null, 2)}\n`);
