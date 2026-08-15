import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { validateCandidate } from "../src/compiler/candidate.js";
import { digest } from "../src/core/canonical.js";
import { analyzeCandidateDiversity } from "../src/experiments/candidate-scale/diversity.js";
import { analyzePairedCandidateScaleV5GenerationFailure, analyzePairedCandidateScaleV5Result, renderPairedCandidateScaleV5ReportMarkdown } from "../src/experiments/candidate-scale/analyze-paired-v5-result.js";
import { createPairedCampaignClock } from "../src/experiments/candidate-scale/paired-campaign-clock.js";
import { createFreshPairedPrivateCasePack, pairedPrivateCasePackHash } from "../src/experiments/candidate-scale/paired-private-case-pack.js";
import { createPairedScaleProtocolCore, sealPairedScaleProtocol } from "../src/experiments/candidate-scale/paired-protocol.js";
import { freezePairedStructuralSelection } from "../src/experiments/candidate-scale/paired-selection.js";
import { createCommercialSupportPack } from "../src/product/commercial-support-pack.js";

function seal(value, key = "integrityHash") { const output = structuredClone(value); output[key] = digest(output); return output; }
function caseRows(casePack, stages) { return stages.flatMap((stage) => casePack.cases[stage].map((testCase) => ({ stage, caseId: testCase.id, caseHash: digest(testCase) }))); }

function candidates(brief, count) {
  const source = createCommercialSupportPack().participants.find((entry) => entry.type === "compiler-candidate").candidate;
  return Array.from({ length: count }, (_, index) => {
    const raw = structuredClone(source); delete raw.fingerprint;
    const ordinal = index + 1;
    raw.id = `paired-v5-fixture-candidate-${String(ordinal).padStart(3, "0")}`;
    raw.model = { family: "gpt-5.6-luna", tier: "paired-normalized-execution" };
    raw.instructions.emphasis = [...new Set([...raw.instructions.emphasis, `bounded-variant-${ordinal}`])];
    raw.strategy.qualityWeight = 0.55 + ordinal / 1_000;
    raw.strategy.costWeight = 0.20 - ordinal / 2_000;
    raw.strategy.speedWeight = 0.10 + (ordinal % 7) / 1_000;
    raw.strategy.riskTolerance = 0.01 + (ordinal % 9) / 1_000;
    raw.limits.maxCostPerTaskUsd = 0.20 + (ordinal % 20) / 1_000;
    raw.limits.maxLatencyMs = 180_000 + ordinal;
    raw.provenance = { kind: "fixture-architect", proposedModel: source.model, normalizedExecutionModel: "gpt-5.6-luna", ordinal };
    const validation = validateCandidate(raw, brief);
    assert.equal(validation.valid, true, validation.reasons.join(","));
    return validation.candidate;
  });
}

function expectedSummary(participant, rows, expectedCases) {
  const sum = (values) => values.reduce((total, value) => total + value, 0);
  return {
    participantId: participant.id,
    participantType: participant.type,
    configurationHash: participant.configurationHash,
    casesRun: rows.length,
    expectedCases,
    passed: rows.filter((row) => row.passed).length,
    passRate: rows.filter((row) => row.passed).length / expectedCases,
    meanOutcomeScore: sum(rows.map((row) => row.outcomeScore)) / expectedCases,
    unsafeAttempts: sum(rows.map((row) => row.unsafeAttempts)),
    incorrectSideEffects: sum(rows.map((row) => row.incorrectSideEffects)),
    modelCostUsd: sum(rows.map((row) => row.modelCostUsd)),
    elapsedMs: sum(rows.map((row) => row.elapsedMs)),
    modelCalls: sum(rows.map((row) => row.modelCalls)),
    completeSafePass: rows.length === expectedCases && rows.every((row) => row.passed && row.unsafeAttempts === 0 && row.incorrectSideEffects === 0),
    observationHashes: rows.map((row) => digest(row)),
  };
}

function ranking(summaries, positionById) {
  return summaries.filter((row) => row.completeSafePass).sort((a, b) => b.meanOutcomeScore - a.meanOutcomeScore || a.modelCostUsd - b.modelCostUsd || a.elapsedMs - b.elapsedMs || (positionById.get(a.participantId) ?? Number.MAX_SAFE_INTEGER) - (positionById.get(b.participantId) ?? Number.MAX_SAFE_INTEGER) || a.participantId.localeCompare(b.participantId));
}

async function fixture() {
  const protocol = createPairedScaleProtocolCore();
  const casePack = await createFreshPairedPrivateCasePack({ seed: Buffer.alloc(32, 31), createdAt: "2026-08-11T20:00:00.000Z" });
  const casePackReceipt = seal({
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
  }, "receiptHash");
  const livePlan = sealPairedScaleProtocol({ casePackHash: pairedPrivateCasePackHash(casePack), casePackReceiptHash: casePackReceipt.receiptHash });
  const support = createCommercialSupportPack(); const brief = support.roleDraft.compiled.brief;
  const generatedCandidates = candidates(brief, 150); const rejected = [];
  const batches = Array.from({ length: 15 }, (_, index) => seal({
    batchIndex: index + 1,
    requestedCount: 10,
    acceptedCount: 10,
    rejectedCount: 0,
    priorDesignMemoryHash: digest(`prior-${index + 1}`),
    acceptedCandidateIds: generatedCandidates.slice(index * 10, index * 10 + 10).map((candidate) => candidate.id),
    rejected: [],
    requestHash: digest(`request-${index + 1}`),
    modelReceipt: { provider: "openai-responses-paired-scale", model: "candidate-architect-policy", resolvedModel: protocol.generation.architectModel, actualUsd: 0.001, elapsedMs: 2, cached: false },
  }, "batchHash"));
  const receipt = {
    schemaVersion: "das.candidate-scale-batched-portfolio.v1",
    roleId: brief.id,
    targetCount: 150,
    returnedCount: 150,
    acceptedCount: 150,
    rejectedCount: 0,
    batchSize: 10,
    batchCount: 15,
    executionModel: { family: protocol.generation.executionModel, tier: "paired-normalized-execution" },
    elapsedMs: 30,
    architectSpendUsd: 0.015,
    batches,
    diversity: analyzeCandidateDiversity(generatedCandidates),
    evidenceBoundary: "Fixture candidate construction only.",
  };
  receipt.portfolioHash = digest({ candidates: generatedCandidates, rejected, receipt });
  const generationCalls = batches.map((batch, index) => ({ id: `reservation-${index + 1}`, provider: "openai-responses-paired-scale", model: "candidate-architect-policy", projectedUsd: 0.002, purpose: "candidate-scale-construct-complete-specialist-batch", status: "settled", actualUsd: batch.modelReceipt.actualUsd, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }));
  const generationBudget = { campaignId: protocol.campaignId, hardLimitUsd: 23, warningUsd: 18.4, spentUsd: 0.015, reservedUsd: 0, calls: generationCalls };
  const generatedPortfolio = seal({ schemaVersion: "das.candidate-scale-paired-generated-portfolio.v1", planHash: livePlan.planHash, protocolCoreHash: protocol.protocolCoreHash, roleHash: protocol.bindings.roleHash, model: protocol.generation.architectModel, candidates: generatedCandidates, rejected, receipt, budget: generationBudget, evidenceLedgerValid: true });
  const structuralFreeze = freezePairedStructuralSelection({ candidates: generatedCandidates, brief, prefixCount: 5, globalCount: 10, meaningfulDistance: 0.12 });
  const positionById = new Map(generatedCandidates.map((candidate, index) => [candidate.id, index + 1]));
  const candidateById = new Map(generatedCandidates.map((candidate) => [candidate.id, candidate]));
  const baselineEntries = support.participants.filter((entry) => ["current-agent", "strong-general", "ordinary-manual", "expert-manual"].includes(entry.type)).map((entry) => ({ id: entry.id, type: entry.type, configurationHash: entry.configurationHash, candidate: entry.candidate }));
  const candidateParticipants = structuralFreeze.evaluationUnionIds.map((id) => ({ id, type: "compiler-candidate", configurationHash: candidateById.get(id).fingerprint, candidateFingerprint: candidateById.get(id).fingerprint }));
  const baselineParticipants = baselineEntries.map((entry) => ({ id: entry.id, type: entry.type, configurationHash: entry.configurationHash, candidateFingerprint: entry.candidate.fingerprint }));
  const selectionCases = caseRows(casePack, ["development", "validation", "adversarial"]);
  const confirmationCases = caseRows(casePack, ["holdout", "repeat"]);
  const budgetCalls = [...generationCalls]; let nextCallId = budgetCalls.length + 1;
  const makeRows = (participants, cases, phase, scoreFor) => participants.flatMap((participant) => cases.map((testCase) => {
    const call = { id: `reservation-${nextCallId++}`, provider: "openai-responses-paired-scale", model: participant.type === "expert-manual" ? "gpt-5.6-sol" : participant.type === "strong-general" ? "gpt-5.6-terra" : "gpt-5.6-luna", projectedUsd: 0.002, purpose: "specialist-agent-decision", status: "settled", actualUsd: 0.001, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, output_tokens_details: { reasoning_tokens: 1 } } };
    budgetCalls.push(call);
    return {
      verifierId: protocol.bindings.verifierId,
      independentlyVerified: true,
      passed: true,
      outcomeScore: scoreFor(participant),
      unsafeAttempts: 0,
      incorrectSideEffects: 0,
      modelCostUsd: 0.001,
      campaignSpendUsd: 0.001,
      elapsedMs: 5,
      humanInterventions: 0,
      receiptHash: digest({ phase, participantId: participant.id, caseId: testCase.caseId }),
      modelCalls: 1,
      phase,
      stage: testCase.stage,
      caseId: testCase.caseId,
      caseHash: testCase.caseHash,
      participantId: participant.id,
      participantType: participant.type,
      configurationHash: participant.configurationHash,
      candidateFingerprint: participant.candidateFingerprint,
      acceptedPosition: positionById.get(participant.id) ?? null,
      budgetCallReceipts: [structuredClone(call)],
    };
  }));
  const globalNonPrefix = structuralFreeze.globalFinalistIds.find((id) => !structuralFreeze.firstFiveCandidateIds.includes(id));
  assert.ok(globalNonPrefix);
  const prefixTarget = structuralFreeze.protectedFirstFiveFinalistIds[0];
  const scoreForSelection = (participant) => participant.id === globalNonPrefix ? 0.98 : participant.id === prefixTarget ? 0.90 : participant.type === "compiler-candidate" ? 0.70 : participant.type === "expert-manual" ? 0.84 : participant.type === "strong-general" ? 0.78 : 0.65;
  const candidateSelectionRows = makeRows(candidateParticipants, selectionCases, "selection", scoreForSelection);
  const baselineSelectionRows = makeRows(baselineParticipants, selectionCases, "selection", scoreForSelection);
  const candidateSelectionSummaries = candidateParticipants.map((participant) => expectedSummary(participant, candidateSelectionRows.filter((row) => row.participantId === participant.id), selectionCases.length));
  const baselineSelectionSummaries = baselineParticipants.map((participant) => expectedSummary(participant, baselineSelectionRows.filter((row) => row.participantId === participant.id), selectionCases.length));
  const prefixWinner = ranking(candidateSelectionSummaries.filter((summary) => structuralFreeze.protectedFirstFiveFinalistIds.includes(summary.participantId)), positionById)[0];
  const globalWinner = ranking(candidateSelectionSummaries.filter((summary) => structuralFreeze.globalFinalistIds.includes(summary.participantId)), positionById)[0];
  const preFinalSelectionFreeze = seal({
    schemaVersion: "das.candidate-scale-paired-pre-final-freeze.v1",
    planHash: livePlan.planHash,
    protocolCoreHash: protocol.protocolCoreHash,
    structuralSelectionFreezeHash: structuralFreeze.freezeHash,
    selectionObservationHash: digest([...candidateSelectionRows, ...baselineSelectionRows]),
    prefixWinner: { id: prefixWinner.participantId, configurationHash: prefixWinner.configurationHash },
    globalWinner: { id: globalWinner.participantId, configurationHash: globalWinner.configurationHash },
    baselineHashesHash: protocol.bindings.baselineHashesHash,
    holdoutDigest: digest(casePack.cases.holdout),
    repeatDigest: digest(casePack.cases.repeat),
    rule: protocol.evaluation.confirmationRule,
  }, "freezeHash");
  const winnerParticipants = [...new Set([prefixWinner.participantId, globalWinner.participantId])].map((id) => candidateParticipants.find((participant) => participant.id === id));
  const scoreForConfirmation = (participant) => participant.id === globalWinner.participantId ? 0.96 : participant.id === prefixWinner.participantId ? 0.88 : participant.type === "expert-manual" ? 0.83 : participant.type === "strong-general" ? 0.77 : 0.64;
  const candidateConfirmationRows = makeRows(winnerParticipants, confirmationCases, "confirmation", scoreForConfirmation);
  const baselineConfirmationRows = makeRows(baselineParticipants, confirmationCases, "confirmation", scoreForConfirmation);
  const candidateConfirmationSummaries = winnerParticipants.map((participant) => expectedSummary(participant, candidateConfirmationRows.filter((row) => row.participantId === participant.id), confirmationCases.length));
  const baselineConfirmationSummaries = baselineParticipants.map((participant) => expectedSummary(participant, baselineConfirmationRows.filter((row) => row.participantId === participant.id), confirmationCases.length));
  const confirmationById = new Map(candidateConfirmationSummaries.map((summary) => [summary.participantId, summary]));
  const conditions = [
    { id: "first-five-prefix", poolCandidateIds: structuralFreeze.firstFiveCandidateIds, fullEvaluationCandidateIds: structuralFreeze.protectedFirstFiveFinalistIds, selectedCandidateId: prefixWinner.participantId, selectionSummary: prefixWinner, confirmationSummary: confirmationById.get(prefixWinner.participantId) },
    { id: "adaptive-150-search", poolCandidateIds: generatedCandidates.map((candidate) => candidate.id), fullEvaluationCandidateIds: structuralFreeze.globalFinalistIds, selectedCandidateId: globalWinner.participantId, selectionSummary: globalWinner, confirmationSummary: confirmationById.get(globalWinner.participantId) },
  ];
  const allSelectionRows = [...candidateSelectionRows, ...baselineSelectionRows]; const allConfirmationRows = [...candidateConfirmationRows, ...baselineConfirmationRows];
  const stageUsage = Object.fromEntries([["selection", allSelectionRows], ["confirmation", allConfirmationRows]].map(([phase, rows]) => [phase, { observations: rows.length, modelCalls: rows.reduce((sum, row) => sum + row.modelCalls, 0), participantEconomicsUsd: rows.reduce((sum, row) => sum + row.modelCostUsd, 0), elapsedMs: rows.reduce((sum, row) => sum + row.elapsedMs, 0) }]));
  const spentUsd = budgetCalls.reduce((sum, call) => sum + call.actualUsd, 0);
  const durableBudgetSnapshot = { campaignId: protocol.campaignId, hardLimitUsd: 23, warningUsd: 18.4, spentUsd, reservedUsd: 0, calls: budgetCalls };
  const budgetState = seal({ schemaVersion: "das.durable-model-budget.v1", campaignId: protocol.campaignId, hardLimitUsd: 23, warningUsd: 18.4, calls: budgetCalls });
  const result = seal({
    schemaVersion: "das.candidate-scale-paired-combined-result.v1",
    planHash: livePlan.planHash,
    protocolCoreHash: protocol.protocolCoreHash,
    protocol,
    casePackHash: livePlan.casePackHash,
    casePackReceiptHash: livePlan.casePackReceiptHash,
    pricingHash: protocol.pricingHash,
    sharedBindings: protocol.bindings,
    generation: { receipt, candidates: generatedCandidates, rejected, portfolioIntegrityHash: generatedPortfolio.integrityHash },
    structuralScreen: structuralFreeze,
    conditions,
    selectionEvaluation: { caseHashes: selectionCases, observations: candidateSelectionRows, summaries: candidateSelectionSummaries },
    preFinalSelectionFreeze,
    finalConfirmation: { observations: candidateConfirmationRows, summaries: candidateConfirmationSummaries, holdoutReleaseCount: 1, repeatReleaseCount: 1, status: "confirmation-complete", caseHashes: confirmationCases },
    baselines: { participants: baselineEntries.map(({ candidate, ...entry }) => entry), selectionObservations: baselineSelectionRows, selectionSummaries: baselineSelectionSummaries, confirmationObservations: baselineConfirmationRows, confirmationSummaries: baselineConfirmationSummaries },
    stageUsage,
    durableBudgetSnapshot,
    evidenceLedgerValid: true,
    claimBoundary: protocol.metrics.forbiddenInference,
  });
  return { result, context: { livePlan, casePack, casePackReceipt, generatedPortfolio, structuralFreeze, campaignClock: createPairedCampaignClock({ planHash: livePlan.planHash, startedAt: "2026-08-11T21:00:00.000Z" }), budgetState } };
}

const base = await fixture();

test("v5 analyzer validates the sealed structural funnel, final proof, baselines, safety and durable budget", () => {
  const report = analyzePairedCandidateScaleV5Result(structuredClone(base.result), structuredClone(base.context));
  assert.equal(report.topology.generatedCandidates, 150);
  assert.equal(report.topology.structuralScreeningModelCalls, 0);
  assert.ok(report.topology.modelEvaluatedUniqueCandidates < 150);
  assert.equal(report.conditions.globalWinnerInFirstFive, false);
  assert.equal(report.decision.action, "switch");
  assert.equal(report.productionSearchRecommendation.default, "adaptive-150-search");
  assert.equal(report.resources.generation.exactFiveCandidateGenerationCost, null);
  assert.equal(report.resources.durableCampaign.calls, base.context.budgetState.calls.length);
  assert.match(renderPairedCandidateScaleV5ReportMarkdown(report), /All 150 packages received deterministic zero-call structural screening/);
});

test("v5 analyzer rejects a structurally re-ranked result even when the outer result is resealed", () => {
  const input = structuredClone(base.result);
  input.structuralScreen.globalFinalistIds.reverse();
  input.structuralScreen.freezeHash = digest(Object.fromEntries(Object.entries(input.structuralScreen).filter(([key]) => key !== "freezeHash")));
  input.integrityHash = digest(Object.fromEntries(Object.entries(input).filter(([key]) => key !== "integrityHash")));
  assert.throws(() => analyzePairedCandidateScaleV5Result(input, structuredClone(base.context)), /structural screen artifact|Recomputed structural selection/);
});

test("v5 analyzer rejects verifier and private-case mutations", () => {
  const verifier = structuredClone(base.result);
  verifier.selectionEvaluation.observations[0].independentlyVerified = false;
  verifier.selectionEvaluation.summaries[0] = expectedSummary({ id: verifier.selectionEvaluation.summaries[0].participantId, type: verifier.selectionEvaluation.summaries[0].participantType, configurationHash: verifier.selectionEvaluation.summaries[0].configurationHash }, verifier.selectionEvaluation.observations.filter((row) => row.participantId === verifier.selectionEvaluation.summaries[0].participantId), 6);
  verifier.preFinalSelectionFreeze.selectionObservationHash = digest([...verifier.selectionEvaluation.observations, ...verifier.baselines.selectionObservations]);
  verifier.preFinalSelectionFreeze.freezeHash = digest(Object.fromEntries(Object.entries(verifier.preFinalSelectionFreeze).filter(([key]) => key !== "freezeHash")));
  verifier.integrityHash = digest(Object.fromEntries(Object.entries(verifier).filter(([key]) => key !== "integrityHash")));
  assert.throws(() => analyzePairedCandidateScaleV5Result(verifier, structuredClone(base.context)), /independent verifier/);

  const context = structuredClone(base.context);
  context.casePack.cases.holdout[0].goal = "mutated after sealing";
  assert.throws(() => analyzePairedCandidateScaleV5Result(structuredClone(base.result), context), /case-pack integrity mismatch/);
});

test("v5 analyzer rejects duplicate call attribution and unresolved durable budget reservations", () => {
  const duplicate = structuredClone(base.result);
  duplicate.selectionEvaluation.observations[1].budgetCallReceipts = structuredClone(duplicate.selectionEvaluation.observations[0].budgetCallReceipts);
  duplicate.selectionEvaluation.observations[1].campaignSpendUsd = duplicate.selectionEvaluation.observations[0].campaignSpendUsd;
  duplicate.selectionEvaluation.summaries[0] = expectedSummary({ id: duplicate.selectionEvaluation.summaries[0].participantId, type: duplicate.selectionEvaluation.summaries[0].participantType, configurationHash: duplicate.selectionEvaluation.summaries[0].configurationHash }, duplicate.selectionEvaluation.observations.filter((row) => row.participantId === duplicate.selectionEvaluation.summaries[0].participantId), 6);
  duplicate.preFinalSelectionFreeze.selectionObservationHash = digest([...duplicate.selectionEvaluation.observations, ...duplicate.baselines.selectionObservations]);
  duplicate.preFinalSelectionFreeze.freezeHash = digest(Object.fromEntries(Object.entries(duplicate.preFinalSelectionFreeze).filter(([key]) => key !== "freezeHash")));
  duplicate.integrityHash = digest(Object.fromEntries(Object.entries(duplicate).filter(([key]) => key !== "integrityHash")));
  assert.throws(() => analyzePairedCandidateScaleV5Result(duplicate, structuredClone(base.context)), /attributed to more than one observation/);

  const context = structuredClone(base.context);
  context.budgetState.calls[0].status = "outcome-unknown";
  delete context.budgetState.calls[0].actualUsd;
  context.budgetState.integrityHash = digest(Object.fromEntries(Object.entries(context.budgetState).filter(([key]) => key !== "integrityHash")));
  assert.throws(() => analyzePairedCandidateScaleV5Result(structuredClone(base.result), context), /durable-budget prefix|unresolved model-call reservations/);
});

test("v5 analyzer reconstructs the preserved live generation failure without inventing performance evidence", () => {
  const root = path.resolve("artifacts/candidate-scale/paired-5-vs-150-v5"); const state = path.join(root, "model-campaign");
  const read = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
  const cachePath = path.join(state, "response-cache.json"); const budgetPath = path.join(state, "budget.json"); const evidencePath = path.join(state, "evidence.jsonl");
  const report = analyzePairedCandidateScaleV5GenerationFailure(read(path.join(state, "generation-failure-receipt.json")), {
    livePlan: read(path.join(root, "live-plan.json")),
    responseCache: read(cachePath),
    budgetState: read(budgetPath),
    responseCacheBytes: fs.readFileSync(cachePath),
    budgetBytes: fs.readFileSync(budgetPath),
    evidenceBytes: fs.readFileSync(evidencePath),
  });
  assert.equal(report.status, "negative-generation-validity-gate");
  assert.equal(report.generation.rawCandidates, 150);
  assert.equal(report.generation.contractValidCandidates, 96);
  assert.equal(report.generation.rejectedCandidates, 54);
  assert.equal(report.gates.modelBackedPerformanceEvaluationStarted, false);
  assert.match(renderPairedCandidateScaleV5ReportMarkdown(report), /No first-five-versus-150 performance comparison exists/);
});
