import test from "node:test";
import assert from "node:assert/strict";
import { BudgetGuard } from "../src/core/budget.js";
import { MeteredModelGateway, ModelResponseCache } from "../src/core/model-gateway.js";
import { EvidenceLedger } from "../src/core/evidence.js";
import { ModelCandidateRefiner } from "../src/compiler/model-refiner.js";
import { generateCandidatePortfolio } from "../src/compiler/generator.js";
import { realisticProcurementBrief } from "../src/roles/realistic-procurement.js";

test("model refiner binds provenance to visible failure and preserves validation", async () => {
  const parent = generateCandidatePortfolio(realisticProcurementBrief)[0];
  const child = structuredClone(parent);
  child.instructions.emphasis = [...child.instructions.emphasis, "bind writes to task batch"];
  const provider = { id: "fake", projectCost: () => .01, generate: async () => ({ output: { candidates: [child] }, actualUsd: .001, usage: {}, resolvedModel: "fake-model" }) };
  const gateway = new MeteredModelGateway({ provider, budget: new BudgetGuard({ hardLimitUsd: 1 }), cache: new ModelResponseCache(), evidence: new EvidenceLedger() });
  const result = await new ModelCandidateRefiner({ gateway }).refine({ brief: realisticProcurementBrief, parent, developmentFailures: [{ caseId: "visible-case", checks: { noOutOfScopeWrites: false } }] });
  assert.equal(result.candidate.id, `${parent.id}:refined-1`);
  assert.equal(result.candidate.provenance.kind, "compiler-refinement");
  assert.deepEqual(result.candidate.provenance.failureEvidence.map((item) => item.caseId), ["visible-case"]);
  assert.ok(result.differences.includes("instructions"));
});
