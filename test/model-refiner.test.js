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

test("model refiner can preserve the parent's exact model during a configuration repair", async () => {
  const parent = generateCandidatePortfolio(realisticProcurementBrief)[0];
  const child = structuredClone(parent);
  child.model = { family: "different-model", tier: "expensive" };
  child.instructions.emphasis = [...child.instructions.emphasis, "distinguish a reproducible failure from a how-to question"];
  const provider = { id: "fake", projectCost: () => .01, generate: async () => ({ output: { candidates: [child] }, actualUsd: .001, usage: {}, resolvedModel: "fake-model" }) };
  const gateway = new MeteredModelGateway({ provider, budget: new BudgetGuard({ hardLimitUsd: 1 }), cache: new ModelResponseCache(), evidence: new EvidenceLedger() });
  const result = await new ModelCandidateRefiner({ gateway }).refine({ brief: realisticProcurementBrief, parent, preserveModel: true, developmentFailures: [{ caseId: "visible-case", missingOutcomes: ["engineering-escalation"] }] });
  assert.deepEqual(result.candidate.model, parent.model);
  assert.equal(result.candidate.provenance.modelPreserved, true);
});

test("model refiner can append a repair while protecting every passing instruction and the exact context", async () => {
  const parent = generateCandidatePortfolio(realisticProcurementBrief)[0];
  const child = structuredClone(parent);
  child.instructions.emphasis = [...parent.instructions.emphasis, "distinguish reproducible failure from how-to guidance"];
  child.context.selection = "model tried to replace this";
  const provider = { id: "fake", projectCost: () => .01, generate: async () => ({ output: { candidates: [child] }, actualUsd: .001, usage: {}, resolvedModel: "fake-model" }) };
  const gateway = new MeteredModelGateway({ provider, budget: new BudgetGuard({ hardLimitUsd: 1 }), cache: new ModelResponseCache(), evidence: new EvidenceLedger() });
  const result = await new ModelCandidateRefiner({ gateway }).refine({ brief: realisticProcurementBrief, parent, preserveInstructionItems: true, preserveContext: true, developmentFailures: [{ caseId: "visible-case" }] });
  assert.deepEqual(result.candidate.context, parent.context);
  assert.equal(parent.instructions.emphasis.every((item) => result.candidate.instructions.emphasis.includes(item)), true);
  assert.equal(result.candidate.provenance.instructionItemsPreserved, true);
  assert.equal(result.candidate.provenance.contextPreserved, true);
});

test("model refiner rejects a repair that deletes a protected passing instruction", async () => {
  const parent = generateCandidatePortfolio(realisticProcurementBrief)[0];
  const child = structuredClone(parent);
  child.instructions.emphasis = ["replacement that drops the parent rules"];
  const provider = { id: "fake", projectCost: () => .01, generate: async () => ({ output: { candidates: [child] }, actualUsd: .001, usage: {}, resolvedModel: "fake-model" }) };
  const gateway = new MeteredModelGateway({ provider, budget: new BudgetGuard({ hardLimitUsd: 1 }), cache: new ModelResponseCache(), evidence: new EvidenceLedger() });
  await assert.rejects(() => new ModelCandidateRefiner({ gateway }).refine({ brief: realisticProcurementBrief, parent, preserveInstructionItems: true, developmentFailures: [{ caseId: "visible-case" }] }), /removed a protected passing instruction/);
});
