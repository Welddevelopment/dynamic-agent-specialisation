import test from "node:test";
import assert from "node:assert/strict";
import { validateCandidate } from "../src/compiler/candidate.js";
import { createPiece4RevopsBaselines } from "../src/evaluation/piece4-revops-baselines.js";
import { realisticRevopsBrief } from "../src/roles/realistic-revops.js";

test("RevOps baselines are valid, distinct and use the same complete boundary", () => {
  const baselines = createPiece4RevopsBaselines();
  assert.equal(baselines.length, 3);
  assert.deepEqual(baselines.map((item) => item.model.family), ["gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6-sol"]);
  assert.equal(new Set(baselines.map((item) => item.fingerprint)).size, 3);
  for (const candidate of baselines) {
    assert.equal(validateCandidate(candidate, realisticRevopsBrief).valid, true);
    assert.deepEqual(candidate.tools, realisticRevopsBrief.environment.tools);
    assert.deepEqual(candidate.context.sources, realisticRevopsBrief.environment.contextSources);
    assert.equal(candidate.verifier.binding, realisticRevopsBrief.successCriteria.verifierId);
  }
});
