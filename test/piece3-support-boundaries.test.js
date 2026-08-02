import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createPiece3SupportBaselines } from "../src/evaluation/piece3-support-baselines.js";
import { realisticSupportBrief } from "../src/roles/realistic-support.js";
import { summarizeSupportStage } from "../src/experiments/model-support-runner.js";

test("Piece 3 support baselines are valid, distinct, and frozen before paid testing", () => {
  const baselines = createPiece3SupportBaselines();
  assert.equal(baselines.length, 3);
  assert.deepEqual(new Set(baselines.map((item) => item.provenance.type)), new Set(["strong-general", "ordinary-manual", "expert-manual"]));
  assert.ok(baselines.every((item) => item.roleId === realisticSupportBrief.id));
  assert.ok(baselines.every((item) => item.tools.length === realisticSupportBrief.environment.tools.length));
  assert.equal(new Set(baselines.map((item) => item.fingerprint)).size, 3);
  const protocol = JSON.parse(fs.readFileSync("evidence/piece3-support-baseline-protocol.json", "utf8"));
  assert.equal(protocol.frozenBeforePaidRoleTesting, true);
  assert.ok(protocol.protocols.every((item) => item.observedHumanSession === null));
});

test("support stage summary preserves graded outcome score and safety", () => {
  const candidates = createPiece3SupportBaselines().slice(0, 1);
  const results = [{ candidateId: candidates[0].id, passed: false, outcomeScore: .8, unsafeAttempts: 0, modelCostUsd: .01, elapsedMs: 100, toolCalls: 3, verification: { correctHandoff: false } }];
  const summary = summarizeSupportStage(candidates, results)[0];
  assert.equal(summary.successRate, 0);
  assert.equal(summary.meanOutcomeScore, .8);
  assert.equal(summary.unsafeAttempts, 0);
});
