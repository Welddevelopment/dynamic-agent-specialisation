import test from "node:test";
import assert from "node:assert/strict";
import { BudgetGuard } from "../src/core/budget.js";
import { EvidenceLedger } from "../src/core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../src/core/model-gateway.js";
import { ModelCandidateArchitect, candidatePortfolioResponseFormat } from "../src/compiler/model-architect.js";
import { ModelDecisionEngine } from "../src/runtime/model-decision-engine.js";
import { procurementRole } from "../src/roles/procurement.js";
import { generateCandidatePortfolio } from "../src/compiler/generator.js";

function fakeGateway(outputs) {
  const queue = outputs.map((output) => structuredClone(output));
  const provider = { id: "fake", projectCost: () => .01, generate: async () => ({ output: queue.shift(), actualUsd: .001, usage: { inputTokens: 1, outputTokens: 1 } }) };
  return new MeteredModelGateway({ provider, budget: new BudgetGuard({ hardLimitUsd: 1 }), cache: new ModelResponseCache(), evidence: new EvidenceLedger() });
}

test("model architect accepts complete candidates and rejects excess authority", async () => {
  const candidates = generateCandidatePortfolio(procurementRole.brief);
  const unsafe = structuredClone(candidates[0]);
  unsafe.id = "unsafe";
  unsafe.authority.allowedActions = ["send-money"];
  const architect = new ModelCandidateArchitect({ gateway: fakeGateway([{ candidates: [...candidates, unsafe] }]), minimumCandidates: 4 });
  const result = await architect.propose({ brief: procurementRole.brief, knowledgeEntries: [], priorSpecialists: [] });
  assert.equal(result.candidates.length, 4);
  assert.equal(result.rejected.length, 1);
  assert.ok(result.rejected[0].reasons.includes("excess-authority:send-money"));
});

test("model architect schema fixes bounded role, tools, authority, verifier, and candidate count", () => {
  const format = candidatePortfolioResponseFormat(procurementRole.brief, 2);
  const candidate = format.schema.properties.candidates.items;
  assert.equal(format.type, "json_schema");
  assert.equal(format.schema.properties.candidates.minItems, 2);
  assert.equal(format.schema.properties.candidates.maxItems, 2);
  assert.deepEqual(candidate.properties.roleId.enum, [procurementRole.brief.id]);
  assert.deepEqual(candidate.properties.tools.items.enum, procurementRole.brief.environment.tools);
  assert.deepEqual(candidate.properties.authority.properties.allowedActions.items.enum, procurementRole.brief.authority.allowedActions);
  assert.deepEqual(candidate.properties.verifier.properties.binding.enum, [procurementRole.brief.successCriteria.verifierId]);
  assert.equal(candidate.additionalProperties, false);
});

test("model decision engine validates structured tool decisions", async () => {
  const engine = new ModelDecisionEngine({ gateway: fakeGateway([{ kind: "tool", name: "read-inventory", input: {} }]) });
  const decision = await engine.next({ candidate: generateCandidatePortfolio(procurementRole.brief)[0], goal: "restock", turn: 1, observations: [], memory: [], tools: [{ name: "read-inventory" }] });
  assert.equal(decision.kind, "tool");
  assert.equal(decision.name, "read-inventory");
});

test("model decision engine rejects malformed output", async () => {
  const engine = new ModelDecisionEngine({ gateway: fakeGateway([{ kind: "tool", name: 7, input: null }]) });
  await assert.rejects(() => engine.next({ candidate: generateCandidatePortfolio(procurementRole.brief)[0], goal: "restock", turn: 1, observations: [], memory: [], tools: [] }), /invalid tool decision/);
});
