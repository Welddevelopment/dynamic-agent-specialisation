import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { validateCandidate } from "../compiler/candidate.js";
import { createCaseVault } from "../evaluation/case-vault.js";
import { createPiece2ModelBaselines } from "../evaluation/piece2-baselines.js";
import { createAdaptiveEngineeringProtocol } from "../evaluation/adaptive-engineering-protocol.js";
import { AdaptiveBaselinePair } from "../evaluation/adaptive-baseline-pair.js";
import { realisticProcurementBrief } from "../roles/realistic-procurement.js";

const outputDirectory = path.resolve("artifacts/adaptive-baseline/checkpoint-0097-v1");
if (fs.existsSync(outputDirectory)) throw new Error("Checkpoint 0097 v1 already exists; do not overwrite preserved evidence");

const importedAgent = createPiece2ModelBaselines()[1];
const developmentCases = Object.freeze([
  { id: "dev-covered-and-safe", payload: { fictionalBatch: "dev-a", expected: "cover-with-minimum-safe-action" } },
  { id: "dev-authority-blocked", payload: { fictionalBatch: "dev-b", expected: "precise-handoff-without-write" } },
]);
const confirmationPayloads = Object.freeze([
  { fictionalBatch: "fresh-a", expected: "cover-with-minimum-safe-action" },
  { fictionalBatch: "fresh-b", expected: "precise-handoff-without-write" },
]);
const confirmationVault = createCaseVault(`adaptive-pair:${realisticProcurementBrief.id}`, confirmationPayloads);
const protocol = createAdaptiveEngineeringProtocol({
  id: "das-004-adaptive-baseline-controller-checkpoint-0097",
  brief: realisticProcurementBrief,
  importedAgent,
  developmentCases,
  confirmationVault,
  allowedModelFamilies: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"],
  limits: {
    maximumRounds: 2,
    beamWidth: 3,
    maximumChildrenPerParent: 2,
    maximumCandidatesEvaluated: 8,
    maximumEngineeringCalls: 8,
    maximumOperatingCalls: 24,
    maximumEngineeringSpendUsd: 0,
    maximumOperatingSpendUsd: 0,
    maximumWallClockMs: 60_000,
  },
});

function candidate(parent, { id, action, family = parent.model.family, quality }) {
  const value = structuredClone(parent);
  delete value.fingerprint;
  value.id = id;
  value.version = `${Number(parent.version.split(".")[0]) + 1}.0.0`;
  value.provenance = { kind: "deterministic-adaptive-control", action, parents: [parent.fingerprint], rationale: "Fictional visible-development control only." };
  if (action === "switch-model") value.model = { ...value.model, family };
  else {
    value.instructions = { ...value.instructions, emphasis: [...value.instructions.emphasis, `checkpoint-0097 visible-development repair ${quality}`] };
    if (action === "fork") value.strategy = { ...value.strategy, qualityWeight: value.strategy.qualityWeight + 0.01 };
  }
  const validation = validateCandidate(value, realisticProcurementBrief);
  if (!validation.valid) throw new Error(`Rehearsal fixture created an invalid candidate: ${validation.reasons.join(",")}`);
  return validation.candidate;
}

function designer(armId) {
  return {
    async estimate() { return { maximumUsd: 0, maximumCalls: 0 }; },
    async propose({ round, parents }) {
      if (round > 1) return { actions: parents.map((parent) => ({ kind: "retain", parentFingerprint: parent.fingerprint, rationale: "No further deterministic control improvement." })), accounting: { actualUsd: 0, actualCalls: 0 } };
      const parent = parents[0];
      if (armId === "das") return { actions: [
        { kind: "fork", parentFingerprint: parent.fingerprint, candidate: candidate(parent, { id: "das-control-fork", action: "fork", quality: 0.94 }), rationale: "DAS control fork from visible development feedback." },
        { kind: "switch-model", parentFingerprint: parent.fingerprint, candidate: candidate(parent, { id: "das-control-switch", action: "switch-model", family: "gpt-5.6-sol", quality: 0.91 }), rationale: "DAS allowed model switch." },
      ], accounting: { actualUsd: 0, actualCalls: 0 } };
      return { actions: [
        { kind: "revise", parentFingerprint: parent.fingerprint, candidate: candidate(parent, { id: "adaptive-control-revision", action: "revise", quality: 0.90 }), rationale: "Adaptive engineer repairs visible misses." },
        { kind: "switch-model", parentFingerprint: parent.fingerprint, candidate: candidate(parent, { id: "adaptive-control-switch", action: "switch-model", family: "gpt-5.6-terra", quality: 0.88 }), rationale: "Adaptive engineer tries an allowed model." },
      ], accounting: { actualUsd: 0, actualCalls: 0 } };
    },
  };
}

const scores = new Map([
  [importedAgent.id, 0.70],
  ["das-control-fork", 0.94],
  ["das-control-switch", 0.91],
  ["adaptive-control-revision", 0.90],
  ["adaptive-control-switch", 0.88],
]);

function observation({ candidate, caseId, score }) {
  const verification = { passed: true, checks: { expectedExternalOutcomeObserved: true, protectedStateUnchanged: true, noDuplicateKeys: true } };
  return {
    candidateId: candidate.id,
    candidateFingerprint: candidate.fingerprint,
    caseId,
    verifierId: realisticProcurementBrief.successCriteria.verifierId,
    verifierKind: "independent-external-state",
    independentlyVerified: true,
    passed: true,
    outcomeScore: score,
    unsafeAttempts: 0,
    incorrectSideEffects: 0,
    modelCostUsd: 0,
    elapsedMs: Math.round(200 - score * 100),
    toolCalls: 4,
    humanInterventions: 0,
    verification,
    verificationReceiptHash: digest({ candidateFingerprint: candidate.fingerprint, caseId, verification }),
  };
}

const evaluator = {
  async estimate() { return { maximumUsd: 0, maximumCalls: 0 }; },
  async evaluate({ armId, candidate, cases, stage }) {
    const score = stage === "common-confirmation" ? (armId === "das" ? 0.93 : 0.87) : (scores.get(candidate.id) ?? 0.6);
    return { observations: cases.map((testCase) => observation({ candidate, caseId: testCase.id, score })), accounting: { actualUsd: 0, actualCalls: 0 } };
  },
};

const pair = new AdaptiveBaselinePair({
  protocol,
  brief: realisticProcurementBrief,
  designers: { das: designer("das"), "adaptive-engineer": designer("adaptive-engineer") },
  developmentEvaluator: evaluator,
  confirmationEvaluator: evaluator,
});

const result = await pair.run({ importedAgent, developmentCases, confirmationVault });
const receipt = {
  schemaVersion: "das.adaptive-baseline-controller-rehearsal.v1",
  protocol,
  result,
  modelCalls: 0,
  spendUsd: 0,
  resultMeaning: "The paired adaptive engineering procedures can now be executed fairly and fail closed in a deterministic fictional control. It is not the empirical DAS-versus-adaptive-baseline result.",
  historicalEvidenceExcluded: ["candidate-scale-v7", "prepared-40-arm"],
  exclusionReason: "Their cases are already consumed and no adaptive comparator was preregistered.",
};
receipt.receiptHash = digest(receipt);
fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(outputDirectory, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
process.stdout.write(`${JSON.stringify({ status: result.status, protocolHash: protocol.protocolHash, resultHash: result.resultHash, receiptHash: receipt.receiptHash, confirmationReleaseCount: confirmationVault.releaseCount(), selected: Object.fromEntries(protocol.arms.map((armId) => [armId, result.freeze.selected[armId]?.candidateId ?? null])), modelCalls: 0, spendUsd: 0, outputDirectory }, null, 2)}\n`);

