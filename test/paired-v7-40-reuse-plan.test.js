import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { digest } from "../src/core/canonical.js";
import { createPairedV740ReusePlan } from "../src/experiments/candidate-scale/paired-v7-40-reuse-plan.js";
import { createPairedV7ProtocolCore, PAIRED_V7_ARTIFACT_ROOT } from "../src/experiments/candidate-scale/paired-v7-protocol.js";
import { PAIRED_V7_40_EXTENSION_ROOT } from "../src/experiments/candidate-scale/paired-v7-40-extension.js";

function read(filePath) { return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8")); }
function seal(value, key) { const copy = structuredClone(value); delete copy[key]; copy[key] = digest(copy); return copy; }

function emptyFixture() {
  const root = path.resolve(PAIRED_V7_ARTIFACT_ROOT);
  const protocol = createPairedV7ProtocolCore();
  const extensionPlan = read(path.join(PAIRED_V7_40_EXTENSION_ROOT, "live-plan.json"));
  const basePlan = read(path.join(root, "live-plan.json"));
  const portfolio = read(path.join(root, "model-campaign/generated-portfolio.json"));
  const baseResult = seal({ planHash: basePlan.planHash, generation: { portfolioIntegrityHash: portfolio.integrityHash }, selectionEvaluation: { observations: [] }, baselines: { selectionObservations: [], confirmationObservations: [] }, finalConfirmation: { observations: [] }, evidenceLedgerValid: true }, "integrityHash");
  const baseAnalysis = seal({ schemaVersion: "das.candidate-scale-paired-v7-analysis.v1", resultHash: baseResult.integrityHash, evidenceIntegrity: { durableBudget: "reconciled-no-unresolved-reservations" } }, "analysisHash");
  return { extensionPlan, basePlan, baseResult, baseAnalysis, portfolio, casePack: read(path.join(root, "private-case-pack.json")), protocol };
}

test("zero-cost planner identifies the exact missing 40-arm work without authorizing it", () => {
  const fixture = emptyFixture();
  const plan = createPairedV740ReusePlan(fixture);
  assert.equal(plan.selection.frozenCandidateFinalists, 7);
  assert.equal(plan.selection.baselines, 4);
  assert.equal(plan.selection.missingCandidateObservations.length, 42);
  assert.equal(plan.selection.missingBaselineObservations.length, 24);
  assert.equal(plan.maximumAdditionalObservationsBeforeEarlySafetyStops, 91);
  assert.equal(plan.paidExecutionAuthorized, false);
  assert.equal(plan.reusePlanHash, digest(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "reusePlanHash"))));
});

test("planner reuses only an exact bound observation and honors its safety stop", () => {
  const fixture = emptyFixture();
  const participantId = fixture.extensionPlan.finalistIds[0];
  const candidate = fixture.portfolio.candidates.find((entry) => entry.id === participantId);
  const testCase = fixture.casePack.cases.development[0];
  const row = {
    phase: "selection", stage: "development", participantId, participantType: "compiler-candidate",
    configurationHash: candidate.fingerprint, candidateFingerprint: candidate.fingerprint,
    acceptedPosition: fixture.portfolio.candidates.findIndex((entry) => entry.id === participantId) + 1,
    caseId: testCase.id, caseHash: digest(testCase), verifierId: fixture.protocol.bindings.verifierId,
    independentlyVerified: true, receiptHash: digest("test-observation"), unsafeAttempts: 1, incorrectSideEffects: 0,
  };
  fixture.baseResult = seal({ ...fixture.baseResult, selectionEvaluation: { observations: [row] } }, "integrityHash");
  fixture.baseAnalysis = seal({ ...fixture.baseAnalysis, resultHash: fixture.baseResult.integrityHash }, "analysisHash");
  const plan = createPairedV740ReusePlan(fixture);
  assert.equal(plan.selection.reusableObservations.length, 1);
  assert.equal(plan.selection.safetyStopped.filter((entry) => entry.participantId === participantId).length, 5);
  assert.equal(plan.selection.missingCandidateObservations.filter((entry) => entry.participantId === participantId).length, 0);
});

test("planner rejects analysis that is not bound to the exact result", () => {
  const fixture = emptyFixture();
  fixture.baseAnalysis = seal({ ...fixture.baseAnalysis, resultHash: digest("different-result") }, "analysisHash");
  assert.throws(() => createPairedV740ReusePlan(fixture), /analysis of this exact combined result/);
});
