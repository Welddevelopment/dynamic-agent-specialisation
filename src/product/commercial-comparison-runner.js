import { digest } from "../core/canonical.js";
import { assertCommercialComparisonFreeze, releaseCommercialUnseen } from "./commercial-comparison.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function byId(items) { return new Map(items.map((item) => [item.id, item])); }

function normalizeObservation(raw, participant, caseId, verifierId) {
  const value = {
    participantId: participant.id,
    caseId,
    verifierId: String(raw?.verifierId ?? ""),
    independentlyVerified: raw?.independentlyVerified === true,
    passed: raw?.passed === true,
    outcomeScore: Number(raw?.outcomeScore),
    unsafeAttempts: Number(raw?.unsafeAttempts),
    incorrectSideEffects: Number(raw?.incorrectSideEffects),
    modelCostUsd: Number(raw?.modelCostUsd),
    elapsedMs: Number(raw?.elapsedMs),
    humanInterventions: Number(raw?.humanInterventions ?? 0),
    receiptHash: String(raw?.receiptHash ?? ""),
  };
  requireCondition(value.verifierId === verifierId && value.independentlyVerified, `Case ${caseId} was not judged by the bound independent verifier`);
  requireCondition(Number.isFinite(value.outcomeScore) && value.outcomeScore >= 0 && value.outcomeScore <= 1, `Case ${caseId} returned an invalid outcome score`);
  for (const key of ["unsafeAttempts", "incorrectSideEffects", "modelCostUsd", "elapsedMs", "humanInterventions"]) requireCondition(Number.isFinite(value[key]) && value[key] >= 0, `Case ${caseId} returned invalid ${key}`);
  requireCondition(value.receiptHash, `Case ${caseId} needs an external verification receipt`);
  return value;
}

function summarize(participant, rows) {
  const count = rows.length || 1;
  return {
    participantId: participant.id,
    type: participant.type,
    label: participant.label,
    cases: rows.length,
    passed: rows.filter((row) => row.passed).length,
    passRate: rows.filter((row) => row.passed).length / count,
    meanOutcomeScore: rows.reduce((sum, row) => sum + row.outcomeScore, 0) / count,
    unsafeAttempts: rows.reduce((sum, row) => sum + row.unsafeAttempts, 0),
    incorrectSideEffects: rows.reduce((sum, row) => sum + row.incorrectSideEffects, 0),
    modelCostUsd: rows.reduce((sum, row) => sum + row.modelCostUsd, 0),
    meanElapsedMs: rows.reduce((sum, row) => sum + row.elapsedMs, 0) / count,
    humanInterventions: rows.reduce((sum, row) => sum + row.humanInterventions, 0),
    observationHashes: rows.map((row) => digest(row)),
  };
}

function rank(summaries, priorities) {
  return [...summaries].sort((left, right) => {
    if (left.unsafeAttempts !== right.unsafeAttempts) return left.unsafeAttempts - right.unsafeAttempts;
    if (left.incorrectSideEffects !== right.incorrectSideEffects) return left.incorrectSideEffects - right.incorrectSideEffects;
    if (left.passRate !== right.passRate) return right.passRate - left.passRate;
    if (left.meanOutcomeScore !== right.meanOutcomeScore) return right.meanOutcomeScore - left.meanOutcomeScore;
    const utility = (item) => item.meanOutcomeScore * priorities.quality - item.modelCostUsd * priorities.cost - (item.meanElapsedMs / 1000) * priorities.speed - item.humanInterventions * .25;
    return utility(right) - utility(left);
  });
}

function isSafe(summary, thresholds) { return summary.unsafeAttempts <= thresholds.maximumUnsafeAttempts && summary.incorrectSideEffects <= thresholds.maximumIncorrectSideEffects; }

export class CommercialComparisonRunner {
  constructor({ evaluate, estimateCost = () => 0, evidence = null, now = () => Date.now() }) {
    requireCondition(typeof evaluate === "function", "Commercial comparison runner needs an executable evaluator");
    this.evaluate = evaluate;
    this.estimateCost = estimateCost;
    this.evidence = evidence;
    this.now = now;
  }

  async run({ contract, unseenVault, participants }) {
    assertCommercialComparisonFreeze(contract);
    const runtimeById = byId(participants ?? []);
    requireCondition(runtimeById.size === contract.participants.length, "Every frozen participant needs one runtime implementation");
    for (const frozen of contract.participants) {
      const runtime = runtimeById.get(frozen.id);
      requireCondition(runtime && runtime.configurationHash === frozen.configurationHash && runtime.runnerId === frozen.runnerId, `Runtime participant ${frozen.id} does not match the freeze`);
    }
    const startedAt = this.now();
    let spentUsd = 0;
    const stageHistory = [];
    const active = new Set(contract.participants.map((item) => item.id));
    const priorities = buildPriorities(contract);

    const runStage = async (stage, caseRecords, participantIds) => {
      const rows = [];
      for (const participantId of participantIds) {
        const participant = runtimeById.get(participantId);
        for (const testCase of caseRecords) {
          requireCondition(this.now() - startedAt <= contract.budget.maximumWallClockMs, "Commercial comparison reached its hard time limit");
          const projected = Number(await this.estimateCost({ participant, testCase: testCase.payload, stage }));
          requireCondition(Number.isFinite(projected) && projected >= 0, "Comparison cost estimate must be non-negative");
          requireCondition(spentUsd + projected <= contract.budget.maximumModelSpendUsd, "Commercial comparison reached its hard model-spend limit before the next call");
          const raw = await this.evaluate({ participant, testCase: testCase.payload, caseId: testCase.id, stage, verifierId: contract.driver.verifier.id });
          const row = normalizeObservation(raw, participant, testCase.id, contract.driver.verifier.id);
          spentUsd += row.modelCostUsd;
          requireCondition(spentUsd <= contract.budget.maximumModelSpendUsd, "Evaluator exceeded the frozen commercial comparison budget");
          rows.push(row);
          this.evidence?.append("commercial-comparison.case-verified", { stage, ...row });
        }
      }
      const summaries = participantIds.map((id) => summarize(runtimeById.get(id), rows.filter((row) => row.participantId === id)));
      const record = { stage, summaries, resultHash: digest({ stage, summaries }) };
      stageHistory.push(record);
      this.evidence?.append("commercial-comparison.stage-finished", record);
      return record;
    };

    const development = await runStage("development", contract.cases.development, [...active]);
    for (const summary of development.summaries) if (!isSafe(summary, contract.thresholds)) active.delete(summary.participantId);
    requireCondition(active.size > 0, "Every participant failed the development safety gate");

    const validation = await runStage("validation", contract.cases.validation, [...active]);
    for (const summary of validation.summaries) if (!isSafe(summary, contract.thresholds) || summary.passRate < 1) active.delete(summary.participantId);
    requireCondition(active.size > 0, "No participant passed the validation gate");

    const adversarial = await runStage("adversarial", contract.cases.adversarial, [...active]);
    for (const summary of adversarial.summaries) if (!isSafe(summary, contract.thresholds) || summary.passRate < 1) active.delete(summary.participantId);
    const compilerFinalists = [...active].filter((id) => contract.participants.find((item) => item.id === id)?.type === "compiler-candidate");
    requireCondition(compilerFinalists.length > 0, "No compiler candidate passed the pre-unseen gates");

    const preUnseenReceipt = {
      contractFreezeHash: contract.freezeHash,
      validationPassed: true,
      adversarialPassed: true,
      unsafeAttempts: validation.summaries.concat(adversarial.summaries).filter((item) => active.has(item.participantId)).reduce((sum, item) => sum + item.unsafeAttempts, 0),
      incorrectSideEffects: validation.summaries.concat(adversarial.summaries).filter((item) => active.has(item.participantId)).reduce((sum, item) => sum + item.incorrectSideEffects, 0),
      finalistIds: [...active],
    };
    const unseenPayloads = releaseCommercialUnseen({ contract, unseenVault, preUnseenReceipt });
    const unseenRecords = unseenPayloads.map((payload, index) => ({ ...contract.cases.unseen.caseHashes[index], stage: "unseen", payload }));
    const unseen = await runStage("unseen", unseenRecords, [...active]);
    const eligible = unseen.summaries.filter((summary) => isSafe(summary, contract.thresholds) && summary.passRate === 1);
    requireCondition(eligible.length > 0, "No participant passed the frozen unseen comparison");
    const ordered = rank(eligible, priorities);
    const selected = ordered[0];
    const current = eligible.find((item) => item.type === "current-agent") ?? null;
    let decision = selected.type === "current-agent" ? "retain-existing" : selected.type === "compiler-candidate" ? "activate-compiler" : "select-proven-baseline";
    if (current && selected.type === "compiler-candidate" && selected.meanOutcomeScore - current.meanOutcomeScore < contract.thresholds.minimumOutcomeImprovement) decision = "retain-existing-unproved-upgrade";
    const selectedId = decision === "retain-existing-unproved-upgrade" ? current.participantId : selected.participantId;
    const repeatParticipant = runtimeById.get(selectedId);
    const repeatRows = [];
    for (let repeat = 1; repeat <= contract.thresholds.minimumRepeatRuns; repeat += 1) {
      const repeated = await runStage(`repeat-${repeat}`, unseenRecords, [selectedId]);
      repeatRows.push(repeated.summaries[0]);
    }
    requireCondition(repeatRows.every((summary) => isSafe(summary, contract.thresholds) && summary.passRate === 1), "Selected specialist failed fresh repeatability");
    const receipt = {
      schemaVersion: "das.commercial-comparison-result.v1",
      contractFreezeHash: contract.freezeHash,
      selectedParticipantId: repeatParticipant.id,
      decision,
      rankedUnseen: ordered,
      preUnseenReceipt,
      stageHistory,
      repeatability: { runs: repeatRows.length, summaries: repeatRows },
      spendUsd: spentUsd,
      evidenceBoundary: "Comparison-runner evidence only. Customer value and production reliability require a real controlled deployment.",
    };
    receipt.resultHash = digest(receipt);
    this.evidence?.append("commercial-comparison.completed", receipt);
    return receipt;
  }
}

function buildPriorities(contract) {
  return { quality: Number(contract.priorities?.quality ?? 1), cost: Number(contract.priorities?.cost ?? .25), speed: Number(contract.priorities?.speed ?? .2) };
}
