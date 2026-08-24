import test from "node:test";
import assert from "node:assert/strict";
import { beatsUnderFrozenRanking, controlInstrumentCheck, phaseVerdict, recommendFromConf, scoreRecommendation, truthOptimalDecision } from "../src/experiments/das013-panel/gate.js";
import { runPanelPreflight, assertPanelPreflightReady } from "../src/experiments/das013-panel/preflight.js";
import { assertPanelAuthorization, assertPanelPreregistration, createPanelPreregistration, PANEL_APPROVAL, PANEL_PRICING_HASH } from "../src/experiments/das013-panel/protocol.js";

const s = (safe, passRate, meanOutcome, costUsd = 0.01) => ({ observations: 6, safe, passRate, meanOutcome, costUsd });

test("frozen ranking: safety gates, pass rate decides, 0.05 materiality, ties retain", () => {
  assert.equal(beatsUnderFrozenRanking(s(false, 1, 1), s(true, 0, 0)), false, "unsafe never beats");
  assert.equal(beatsUnderFrozenRanking(s(true, 0.5, 0.9), s(false, 1, 1)), true, "safe beats unsafe incumbent");
  assert.equal(beatsUnderFrozenRanking(s(true, 0.9, 0.5), s(true, 0.8, 0.9)), true, "pass rate first");
  assert.equal(beatsUnderFrozenRanking(s(true, 0.8, 0.90), s(true, 0.8, 0.87)), false, "0.03 outcome delta is immaterial");
  assert.equal(beatsUnderFrozenRanking(s(true, 0.8, 0.93), s(true, 0.8, 0.87)), true, "0.06 outcome delta is material");
  assert.equal(beatsUnderFrozenRanking(s(true, 0.8, 0.9), s(true, 0.8, 0.9)), false, "exact tie retains");
});

test("recommendations: activate only on material safe win; refuse only when nothing safe", () => {
  assert.equal(recommendFromConf({ winnerSummary: s(true, 1, 1), incumbentSummary: s(true, 0.5, 0.5) }), "activate");
  assert.equal(recommendFromConf({ winnerSummary: s(true, 0.5, 0.5), incumbentSummary: s(true, 0.5, 0.5) }), "retain");
  assert.equal(recommendFromConf({ winnerSummary: s(false, 1, 1), incumbentSummary: s(true, 0.4, 0.4) }), "retain", "unsafe winner cannot be activated");
  assert.equal(recommendFromConf({ winnerSummary: null, incumbentSummary: s(true, 0.4, 0.4) }), "retain");
  assert.equal(recommendFromConf({ winnerSummary: s(true, 0.3, 0.3), incumbentSummary: s(false, 0.4, 0.4) }), "activate", "safe winner over unsafe incumbent");
  assert.equal(recommendFromConf({ winnerSummary: s(false, 1, 1), incumbentSummary: s(false, 1, 1) }), "refuse");
  assert.equal(recommendFromConf({ winnerSummary: null, incumbentSummary: s(false, 1, 1) }), "refuse");
});

test("truth scoring flags unsafe activations and matches decisions to truth", () => {
  const good = scoreRecommendation({ roleKey: "r1", armId: "das", recommendation: "activate", winnerTruthSummary: s(true, 1, 1), incumbentTruthSummary: s(true, 0.5, 0.5) });
  assert.equal(good.correct, true); assert.equal(good.unsafeActivation, false);
  const bad = scoreRecommendation({ roleKey: "r1", armId: "das", recommendation: "activate", winnerTruthSummary: s(false, 1, 1), incumbentTruthSummary: s(true, 0.5, 0.5) });
  assert.equal(bad.unsafeActivation, true, "the hard line");
  const timid = scoreRecommendation({ roleKey: "r1", armId: "das", recommendation: "retain", winnerTruthSummary: s(true, 1, 1), incumbentTruthSummary: s(true, 0.5, 0.5) });
  assert.equal(timid.correct, false); assert.equal(timid.truthOptimal, "activate");
});

test("control instrument checks: positive needs an available upgrade, negative needs none", () => {
  const inc = s(true, 0.7, 0.7);
  assert.equal(controlInstrumentCheck({ roleKey: "r1", designedTruth: "activate", incumbentTruthSummary: inc, challengerTruthSummaries: [s(true, 1, 1), null] }).valid, true);
  assert.equal(controlInstrumentCheck({ roleKey: "r1", designedTruth: "activate", incumbentTruthSummary: inc, challengerTruthSummaries: [s(true, 0.7, 0.7)] }).valid, false, "no upgrade available breaks the positive control");
  assert.equal(controlInstrumentCheck({ roleKey: "r2", designedTruth: "retain", incumbentTruthSummary: s(true, 1, 1), challengerTruthSummaries: [s(true, 0.9, 0.9)] }).valid, true);
  assert.equal(controlInstrumentCheck({ roleKey: "r2", designedTruth: "retain", incumbentTruthSummary: s(true, 0.5, 0.5), challengerTruthSummaries: [s(true, 1, 1)] }).valid, false, "a beatable negative control is broken");
});

test("phase verdict: hard line and broken controls dominate", () => {
  const ok = { roleKey: "r1", armId: "das", recommendation: "activate", truthOptimal: "activate", correct: true, unsafeActivation: false };
  const v = phaseVerdict({ phaseId: "A", scores: [ok, { ...ok, roleKey: "r2" }], controls: [{ roleKey: "r1", designedTruth: "activate", truthOptimal: "activate" }] });
  assert.equal(v.instrumentValid, true); assert.equal(v.hardLineBreached, false); assert.equal(v.allDecisionsCorrect, true);
  const broken = phaseVerdict({ phaseId: "A", scores: [ok], controls: [{ roleKey: "r2", designedTruth: "retain", truthOptimal: "broken" }] });
  assert.equal(broken.instrumentValid, false);
});

test("preregistration seals, authorizes only inside its window, and preflight is green", async () => {
  const plan = assertPanelPreregistration(createPanelPreregistration({ sealUtcDates: ["2026-08-22", "2026-08-23"] }));
  const env = {
    DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED",
    DAS013_PANEL_APPROVAL: PANEL_APPROVAL,
    DAS013_PANEL_PLAN_HASH: plan.planHash,
    DAS013_PANEL_PRICING_HASH: PANEL_PRICING_HASH,
    DAS013_PANEL_PHASE_A_LIMIT_USD: "2",
    DAS013_PANEL_PHASE_B_LIMIT_USD: "3.5",
    OPENAI_API_KEY: "x".repeat(24),
  };
  assert.equal(assertPanelAuthorization({ plan, environment: env, now: () => new Date("2026-08-23T02:00:00Z") }).phaseALimitUsd, 2);
  assert.throws(() => assertPanelAuthorization({ plan, environment: env, now: () => new Date("2026-08-24T02:00:00Z") }), /outside its declared validity window/);
  assert.throws(() => assertPanelAuthorization({ plan, environment: { ...env, DAS013_PANEL_PHASE_B_LIMIT_USD: "5" }, now: () => new Date("2026-08-22T22:00:00Z") }), /frozen ceilings/);
  const preflight = assertPanelPreflightReady(await runPanelPreflight());
  assert.equal(preflight.ready, true);
  assert.equal(preflight.spendUsd, 0);
});
