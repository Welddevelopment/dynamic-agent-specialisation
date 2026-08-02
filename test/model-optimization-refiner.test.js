import test from "node:test";
import assert from "node:assert/strict";
import { ModelOptimizationRefiner } from "../src/compiler/model-optimization-refiner.js";
import { createPiece3SupportBaselines } from "../src/evaluation/piece3-support-baselines.js";
import { realisticSupportBrief } from "../src/roles/realistic-support.js";
import { tenPercentCostAndSpeedContract } from "../src/optimization/improvement-contract.js";

test("optimization refiner preserves model and binds revision to observable diagnosis", async () => {
  const parent = createPiece3SupportBaselines()[1];
  const proposed = structuredClone(parent);
  delete proposed.fingerprint;
  proposed.instructions.emphasis = ["Use a compact per-ticket evidence checklist and avoid rereading unchanged sources."];
  const gateway = { async generate() { return { output: { candidates: [proposed] }, provider: "fake", model: "candidate-optimization-policy", resolvedModel: "fake-model", actualUsd: 0, elapsedMs: 1 }; } };
  const refiner = new ModelOptimizationRefiner({ gateway });
  const result = await refiner.refine({ brief: realisticSupportBrief, parent, diagnosis: { missedObjectives: [{ metric: "medianElapsedMs" }], pairedCaseMeasurements: [] }, contract: tenPercentCostAndSpeedContract({ id: "target", baselineId: parent.id }), round: 1 });
  assert.deepEqual(result.candidate.model, parent.model);
  assert.equal(result.candidate.id, `${parent.id}:opt-1`);
  assert.equal(result.candidate.provenance.contractId, "target");
  assert.ok(result.differences.includes("instructions"));
});
