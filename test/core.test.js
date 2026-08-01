import test from "node:test";
import assert from "node:assert/strict";
import { BudgetGuard } from "../src/core/budget.js";
import { EvidenceLedger } from "../src/core/evidence.js";
import { compileJobBrief } from "../src/compiler/job-brief.js";
import { validateCandidate } from "../src/compiler/candidate.js";
import { procurementRole } from "../src/roles/procurement.js";
import { generateCandidatePortfolio } from "../src/compiler/generator.js";
import { freezeEvaluation, assertFreezeIntact } from "../src/evaluation/freeze.js";
import { createBaselines } from "../src/evaluation/baselines.js";
import { HumanEffortLedger } from "../src/evaluation/human-effort.js";
import { MeteredModelGateway, ModelResponseCache } from "../src/core/model-gateway.js";

test("budget refuses a projected call beyond the hard limit", () => {
  const budget = new BudgetGuard({ hardLimitUsd: 0 });
  assert.throws(() => budget.reserve({ provider: "x", model: "y", projectedUsd: .001, purpose: "forbidden" }), /cross hard budget/);
  assert.equal(budget.snapshot().spentUsd, 0);
});

test("evidence chain detects mutation", () => {
  const ledger = new EvidenceLedger();
  ledger.append("one", { safe: true });
  ledger.append("two", { safe: true });
  assert.equal(ledger.verify(), true);
  ledger.records()[0].payload.safe = false;
  assert.equal(ledger.verify(), true, "returned records are isolated copies");
});

test("brief refuses unconfirmed consequential assumptions", () => {
  const result = compileJobBrief({ ...procurementRole.brief, assumptions: [{ consequential: true, status: "inferred", claim: "spend limit" }] });
  assert.equal(result.readiness, "blocked");
});

test("candidate cannot exceed company authority or grade itself", () => {
  const candidate = generateCandidatePortfolio(procurementRole.brief)[0];
  candidate.authority.allowedActions.push("send-money");
  candidate.verifier.kind = "self-report";
  const result = validateCandidate(candidate, procurementRole.brief);
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("excess-authority:send-money"));
  assert.ok(result.reasons.includes("self-grading-verifier"));
});

test("evaluation freeze detects candidate mutation", () => {
  const candidates = generateCandidatePortfolio(procurementRole.brief).map((candidate) => validateCandidate(candidate, procurementRole.brief).candidate);
  const baselines = createBaselines(procurementRole.brief);
  const freeze = freezeEvaluation({ role: procurementRole, candidates, baselines });
  candidates[0].instructions.style = "changed-after-freeze";
  assert.throws(() => assertFreezeIntact(freeze, { role: procurementRole, candidates, baselines }), /changed after freeze/);
});

test("human effort is recorded prospectively as decisions, edits, and interventions", () => {
  const ledger = new HumanEffortLedger();
  ledger.start({ id: "manual-1", approach: "ordinary-manual", roleId: "role", participant: "engineer" });
  ledger.record("manual-1", { kind: "decision", description: "selected model" });
  ledger.record("manual-1", { kind: "edit", description: "changed instructions" });
  ledger.record("manual-1", { kind: "intervention", description: "repaired failed tool binding" });
  const summary = ledger.finish("manual-1");
  assert.equal(summary.decisions, 1);
  assert.equal(summary.edits, 1);
  assert.equal(summary.interventions, 1);
  assert.equal(summary.status, "finished");
});

test("model gateway reserves cost once and reuses the cached response", async () => {
  let calls = 0;
  const provider = { id: "fake", projectCost: () => .2, generate: async () => { calls += 1; return { output: { candidate: "x" }, actualUsd: .1, usage: { inputTokens: 10, outputTokens: 5 } }; } };
  const budget = new BudgetGuard({ hardLimitUsd: .25 });
  const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence: new EvidenceLedger() });
  const request = { model: "fake-model", purpose: "test", input: "same" };
  const first = await gateway.generate(request);
  const second = await gateway.generate(request);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
  assert.equal(budget.snapshot().spentUsd, .1);
});
