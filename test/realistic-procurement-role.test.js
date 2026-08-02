import test from "node:test";
import assert from "node:assert/strict";
import { validateCandidate } from "../src/compiler/candidate.js";
import { generateCandidatePortfolio } from "../src/compiler/generator.js";
import { realisticProcurementBrief } from "../src/roles/realistic-procurement.js";
import { RealisticProcurementCompany } from "../src/worlds/realistic-procurement-company.js";

test("realistic procurement brief and workplace expose the same bounded tools", () => {
  const worldTools = new RealisticProcurementCompany().definitions().map((tool) => tool.name);
  assert.deepEqual(worldTools, realisticProcurementBrief.environment.tools);
  assert.ok(new RealisticProcurementCompany().definitions().every((tool) => tool.description && tool.input));
});

test("deterministic candidates can be validated against realistic procurement boundary", () => {
  const candidates = generateCandidatePortfolio(realisticProcurementBrief);
  assert.ok(candidates.length >= 4);
  for (const candidate of candidates) assert.equal(validateCandidate(candidate, realisticProcurementBrief).valid, true);
});
