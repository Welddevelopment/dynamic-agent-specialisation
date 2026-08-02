import test from "node:test";
import assert from "node:assert/strict";
import { createPiece2ModelBaselines } from "../src/evaluation/piece2-baselines.js";

test("Piece 2 baselines are valid, distinct, full-tool comparisons", () => {
  const baselines = createPiece2ModelBaselines();
  assert.deepEqual(baselines.map((item) => item.id), ["baseline-strong-general-terra", "baseline-ordinary-manual-luna", "baseline-expert-manual-sol"]);
  assert.deepEqual(new Set(baselines.map((item) => item.model.family)).size, 3);
  assert.ok(baselines.every((item) => item.tools.length === baselines[0].tools.length));
  assert.ok(baselines.every((item) => item.fingerprint));
});
