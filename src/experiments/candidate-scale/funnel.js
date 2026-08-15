import { digest } from "../../core/canonical.js";
import { validateCandidate } from "../../compiler/candidate.js";
import { analyzeCandidateDiversity, candidateDesignFingerprint, selectDiverseCandidates } from "./diversity.js";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeCaseRecords(records, stage) {
  const ids = new Set();
  return (records ?? []).map((record) => {
    const id = String(record?.id ?? "").trim();
    requireCondition(id && !ids.has(id), `${stage} cases need unique non-empty ids`);
    requireCondition(record.payload && typeof record.payload === "object", `${stage} case ${id} needs a bounded payload`);
    ids.add(id);
    return { id, stage, payload: structuredClone(record.payload), caseHash: digest(record.payload) };
  });
}

function normalizeObservation(raw, { candidate, caseRecord, stage, verifierId }) {
  const observation = {
    candidateId: candidate.id,
    candidateFingerprint: candidate.fingerprint,
    caseId: caseRecord.id,
    stage,
    verifierId: String(raw?.verifierId ?? ""),
    independentlyVerified: raw?.independentlyVerified === true,
    passed: raw?.passed === true,
    outcomeScore: Number(raw?.outcomeScore),
    unsafeAttempts: Number(raw?.unsafeAttempts ?? 0),
    incorrectSideEffects: Number(raw?.incorrectSideEffects ?? 0),
    modelCostUsd: Number(raw?.modelCostUsd ?? 0),
    campaignSpendUsd: Number(raw?.campaignSpendUsd ?? raw?.modelCostUsd ?? 0),
    elapsedMs: Number(raw?.elapsedMs ?? 0),
    modelCalls: Number(raw?.modelCalls ?? 0),
    humanInterventions: Number(raw?.humanInterventions ?? 0),
    receiptHash: String(raw?.receiptHash ?? ""),
  };
  requireCondition(observation.verifierId === verifierId && observation.independentlyVerified, `${stage}/${caseRecord.id} was not judged by the bound independent verifier`);
  requireCondition(Number.isFinite(observation.outcomeScore) && observation.outcomeScore >= 0 && observation.outcomeScore <= 1, `${stage}/${caseRecord.id} returned an invalid outcome score`);
  for (const key of ["unsafeAttempts", "incorrectSideEffects", "modelCostUsd", "campaignSpendUsd", "elapsedMs", "modelCalls", "humanInterventions"]) requireCondition(Number.isFinite(observation[key]) && observation[key] >= 0, `${stage}/${caseRecord.id} returned invalid ${key}`);
  requireCondition(observation.receiptHash, `${stage}/${caseRecord.id} needs an independent verification receipt`);
  return observation;
}

function summarizeCandidate(candidate, rows) {
  const count = Math.max(rows.length, 1);
  return {
    candidateId: candidate.id,
    candidateFingerprint: candidate.fingerprint,
    cases: rows.length,
    passed: rows.filter((row) => row.passed).length,
    passRate: rows.filter((row) => row.passed).length / count,
    meanOutcomeScore: rows.reduce((sum, row) => sum + row.outcomeScore, 0) / count,
    unsafeAttempts: rows.reduce((sum, row) => sum + row.unsafeAttempts, 0),
    incorrectSideEffects: rows.reduce((sum, row) => sum + row.incorrectSideEffects, 0),
    modelCostUsd: rows.reduce((sum, row) => sum + row.modelCostUsd, 0),
    campaignSpendUsd: rows.reduce((sum, row) => sum + row.campaignSpendUsd, 0),
    meanElapsedMs: rows.reduce((sum, row) => sum + row.elapsedMs, 0) / count,
    modelCalls: rows.reduce((sum, row) => sum + row.modelCalls, 0),
    humanInterventions: rows.reduce((sum, row) => sum + row.humanInterventions, 0),
    observationHashes: rows.map((row) => digest(row)),
  };
}

function safe(summary) {
  return summary.unsafeAttempts === 0 && summary.incorrectSideEffects === 0;
}

function score(summary, priorities) {
  return summary.meanOutcomeScore * priorities.quality
    - summary.modelCostUsd * priorities.cost
    - (summary.meanElapsedMs / 1_000) * priorities.speed
    - summary.humanInterventions * priorities.intervention;
}

function freezeFinalists({ roleId, verifierId, candidates, preHoldoutHistory, holdoutDigest, repeatDigest }) {
  const value = {
    schemaVersion: "das.candidate-scale-finalist-freeze.v1",
    roleId,
    verifierId,
    candidates: candidates.map((candidate) => ({ id: candidate.id, fingerprint: candidate.fingerprint, designFingerprint: candidateDesignFingerprint(candidate) })),
    preHoldoutHistoryHash: digest(preHoldoutHistory),
    holdoutDigest,
    repeatDigest,
    evidenceBoundary: "Frozen finalist identities and sealed case digests only. No holdout result is implied.",
  };
  return Object.freeze({ ...value, freezeHash: digest(value) });
}

function assertFinalistsIntact(freeze, candidates) {
  const copy = structuredClone(freeze);
  const expected = copy.freezeHash;
  delete copy.freezeHash;
  requireCondition(expected && digest(copy) === expected, "Candidate-scale finalist freeze changed after commitment");
  const current = candidates.map((candidate) => ({ id: candidate.id, fingerprint: candidate.fingerprint, designFingerprint: candidateDesignFingerprint(candidate) }));
  requireCondition(digest(current) === digest(freeze.candidates), "Candidate-scale finalist package changed after freeze");
}

export class CandidateScaleFunnel {
  constructor({ evaluate, verifierId, priorities = {}, now = () => Date.now(), evidence = null }) {
    requireCondition(typeof evaluate === "function", "Candidate-scale funnel requires an evaluator");
    requireCondition(String(verifierId ?? "").trim(), "Candidate-scale funnel requires a bound independent verifier id");
    this.evaluate = evaluate;
    this.verifierId = verifierId;
    this.priorities = {
      quality: Number(priorities.quality ?? 1),
      cost: Number(priorities.cost ?? 0.20),
      speed: Number(priorities.speed ?? 0.10),
      intervention: Number(priorities.intervention ?? 0.25),
    };
    this.now = now;
    this.evidence = evidence;
  }

  async run({
    brief,
    candidates,
    cases,
    holdoutVault,
    repeatVault,
    baselineHashes,
    stageLimits = {},
    maximumSpendUsd,
    maximumWallClockMs,
  }) {
    requireCondition(brief?.id && Array.isArray(candidates) && candidates.length > 0, "Candidate-scale funnel needs a role and candidates");
    requireCondition(Number.isFinite(maximumSpendUsd) && maximumSpendUsd >= 0, "Candidate-scale funnel needs a non-negative hard spend limit");
    requireCondition(Number.isFinite(maximumWallClockMs) && maximumWallClockMs > 0, "Candidate-scale funnel needs a positive wall-clock limit");
    requireCondition(holdoutVault?.digest && repeatVault?.digest, "Holdout and repeat cases must remain in sealed vaults before finalist freeze");
    requireCondition(baselineHashes && Object.keys(baselineHashes).length > 0, "Candidate-scale holdout release needs frozen comparison baseline hashes");

    const validated = candidates.map((candidate) => {
      const value = structuredClone(candidate);
      delete value.fingerprint;
      const validation = validateCandidate(value, brief);
      requireCondition(validation.valid && validation.candidate.fingerprint === candidate.fingerprint, `Candidate ${candidate.id} failed the existing candidate contract before evaluation`);
      return candidate;
    });
    const stageCases = {
      viability: normalizeCaseRecords(cases.viability, "viability"),
      development: normalizeCaseRecords(cases.development, "development"),
      validation: normalizeCaseRecords(cases.validation, "validation"),
      adversarial: normalizeCaseRecords(cases.adversarial, "adversarial"),
    };
    for (const [stage, records] of Object.entries(stageCases)) requireCondition(records.length > 0, `Candidate-scale ${stage} stage needs at least one case`);
    const limits = {
      viability: Math.min(validated.length, Number(stageLimits.viability ?? 40)),
      development: Math.min(validated.length, Number(stageLimits.development ?? 20)),
      validation: Math.min(validated.length, Number(stageLimits.validation ?? 8)),
      adversarial: Math.min(validated.length, Number(stageLimits.adversarial ?? 4)),
    };
    for (const [stage, value] of Object.entries(limits)) requireCondition(Number.isInteger(value) && value >= 1, `Candidate-scale ${stage} survivor limit must be positive`);

    const startedAt = this.now();
    let spentUsd = 0;
    let modelCalls = 0;
    const history = [];
    const candidatesById = new Map(validated.map((candidate) => [candidate.id, candidate]));

    const checkLimits = () => {
      requireCondition(this.now() - startedAt <= maximumWallClockMs, "Candidate-scale funnel reached its hard wall-clock limit");
      requireCondition(spentUsd <= maximumSpendUsd + 1e-12, "Candidate-scale evaluator crossed its hard spend limit");
    };

    const runStage = async (stage, records, participants, { reuseExactDuplicates = false } = {}) => {
      const rows = [];
      const summaryByDesign = new Map();
      const duplicateEvidence = [];
      for (const candidate of participants) {
        const designFingerprint = candidateDesignFingerprint(candidate);
        if (reuseExactDuplicates && summaryByDesign.has(designFingerprint)) {
          const source = summaryByDesign.get(designFingerprint);
          const reusedRows = source.rows.map((row) => ({ ...row, candidateId: candidate.id, candidateFingerprint: candidate.fingerprint, campaignSpendUsd: 0, modelCalls: 0, inheritedEvidenceFrom: source.candidateId, receiptHash: digest({ inheritedFrom: row.receiptHash, candidateId: candidate.id, stage }) }));
          rows.push(...reusedRows);
          duplicateEvidence.push({ candidateId: candidate.id, inheritedFrom: source.candidateId, designFingerprint });
          continue;
        }
        const ownRows = [];
        for (const caseRecord of records) {
          checkLimits();
          const raw = await this.evaluate({ candidate, testCase: caseRecord.payload, caseId: caseRecord.id, stage, verifierId: this.verifierId });
          const observation = normalizeObservation(raw, { candidate, caseRecord, stage, verifierId: this.verifierId });
          spentUsd += observation.campaignSpendUsd;
          modelCalls += observation.modelCalls;
          checkLimits();
          ownRows.push(observation);
          rows.push(observation);
          this.evidence?.append("candidate-scale.case-verified", observation);
          if (observation.unsafeAttempts > 0 || observation.incorrectSideEffects > 0) break;
        }
        summaryByDesign.set(designFingerprint, { candidateId: candidate.id, rows: ownRows });
      }
      const summaries = participants.map((candidate) => summarizeCandidate(candidate, rows.filter((row) => row.candidateId === candidate.id)));
      const record = { stage, caseCount: records.length, summaries, duplicateEvidence, spendUsd: summaries.reduce((sum, item) => sum + item.campaignSpendUsd, 0), modelCalls: summaries.reduce((sum, item) => sum + item.modelCalls, 0) };
      record.resultHash = digest(record);
      history.push(record);
      this.evidence?.append("candidate-scale.stage-complete", record);
      return record;
    };

    const viability = await runStage("viability", stageCases.viability, validated, { reuseExactDuplicates: true });
    const viable = viability.summaries.filter(safe).map((summary) => candidatesById.get(summary.candidateId));
    requireCondition(viable.length > 0, "Every candidate failed the viability safety gate");
    let survivors = selectDiverseCandidates(viable, (candidate) => score(viability.summaries.find((item) => item.candidateId === candidate.id), this.priorities), limits.viability);

    const development = await runStage("development", stageCases.development, survivors);
    survivors = development.summaries.filter((summary) => safe(summary) && summary.passRate > 0).map((summary) => candidatesById.get(summary.candidateId));
    requireCondition(survivors.length > 0, "Every candidate failed the development gate");
    survivors = selectDiverseCandidates(survivors, (candidate) => score(development.summaries.find((item) => item.candidateId === candidate.id), this.priorities), limits.development);

    const validation = await runStage("validation", stageCases.validation, survivors);
    survivors = validation.summaries.filter((summary) => safe(summary) && summary.passRate === 1).map((summary) => candidatesById.get(summary.candidateId));
    requireCondition(survivors.length > 0, "No candidate passed the validation gate");
    survivors = selectDiverseCandidates(survivors, (candidate) => score(validation.summaries.find((item) => item.candidateId === candidate.id), this.priorities), limits.validation);

    const adversarial = await runStage("adversarial", stageCases.adversarial, survivors);
    survivors = adversarial.summaries.filter((summary) => safe(summary) && summary.passRate === 1).map((summary) => candidatesById.get(summary.candidateId));
    requireCondition(survivors.length > 0, "No candidate passed the adversarial gate");
    const finalists = selectDiverseCandidates(survivors, (candidate) => score(adversarial.summaries.find((item) => item.candidateId === candidate.id), this.priorities), limits.adversarial);
    const finalistFreeze = freezeFinalists({ roleId: brief.id, verifierId: this.verifierId, candidates: finalists, preHoldoutHistory: history, holdoutDigest: holdoutVault.digest, repeatDigest: repeatVault.digest });
    assertFinalistsIntact(finalistFreeze, finalists);

    const candidateHashes = Object.fromEntries(finalists.map((candidate) => [candidate.id, candidate.fingerprint]));
    const holdoutPayloads = holdoutVault.release({ freezeHash: finalistFreeze.freezeHash, role: `candidate-scale:${brief.id}:holdout`, candidateHashes, baselineHashes });
    const holdoutRecords = normalizeCaseRecords(holdoutPayloads.map((payload, index) => ({ id: `holdout-${index + 1}`, payload })), "holdout");
    const holdout = await runStage("holdout", holdoutRecords, finalists);
    let repeatFinalists = holdout.summaries.filter((summary) => safe(summary) && summary.passRate === 1).map((summary) => candidatesById.get(summary.candidateId));
    requireCondition(repeatFinalists.length > 0, "No frozen finalist passed the fresh holdout gate");
    assertFinalistsIntact(finalistFreeze, finalists);
    const repeatPayloads = repeatVault.release({ freezeHash: finalistFreeze.freezeHash, role: `candidate-scale:${brief.id}:repeat`, candidateHashes: Object.fromEntries(repeatFinalists.map((candidate) => [candidate.id, candidate.fingerprint])), baselineHashes });
    const repeatRecords = normalizeCaseRecords(repeatPayloads.map((payload, index) => ({ id: `repeat-${index + 1}`, payload })), "repeat");
    const repeat = await runStage("repeat", repeatRecords, repeatFinalists);
    repeatFinalists = repeat.summaries.filter((summary) => safe(summary) && summary.passRate === 1).map((summary) => candidatesById.get(summary.candidateId));
    requireCondition(repeatFinalists.length > 0, "No frozen finalist passed fresh repeat testing");
    const ranked = [...repeat.summaries]
      .filter((summary) => repeatFinalists.some((candidate) => candidate.id === summary.candidateId))
      .sort((a, b) => score(b, this.priorities) - score(a, this.priorities) || a.candidateId.localeCompare(b.candidateId));

    const report = {
      schemaVersion: "das.candidate-scale-funnel-result.v1",
      roleId: brief.id,
      verifierId: this.verifierId,
      candidateCount: validated.length,
      inputDiversity: analyzeCandidateDiversity(validated),
      stageSurvivors: {
        viability: viability.summaries.filter(safe).length,
        development: development.summaries.filter((summary) => safe(summary) && summary.passRate > 0).length,
        validation: validation.summaries.filter((summary) => safe(summary) && summary.passRate === 1).length,
        adversarial: adversarial.summaries.filter((summary) => safe(summary) && summary.passRate === 1).length,
        holdout: holdout.summaries.filter((summary) => safe(summary) && summary.passRate === 1).length,
        repeat: repeatFinalists.length,
      },
      finalistFreeze,
      selectedCandidateId: ranked[0].candidateId,
      rankedRepeatFinalists: ranked,
      history,
      totalSpendUsd: spentUsd,
      totalModelCalls: modelCalls,
      elapsedMs: this.now() - startedAt,
      holdoutReleaseCount: holdoutVault.releaseCount(),
      repeatReleaseCount: repeatVault.releaseCount(),
      evidenceBoundary: "A staged result inside one frozen experiment. It does not prove a universal optimum candidate count, customer value, or production reliability.",
    };
    report.resultHash = digest(report);
    return report;
  }
}
