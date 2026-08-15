import assert from "node:assert/strict";
import test from "node:test";
import { DAS024_VALID_FIXTURES } from "../src/experiments/das024-authoring/fixtures.js";
import {
  runDAS025FixtureRehearsal,
  runDAS025PluginProjectRehearsal,
} from "../src/experiments/das025-plugin-project/rehearsal.js";

test("DAS-025 fresh OpenAPI fixture keeps generation separate from explicit fictional qualification", async () => {
  const result = await runDAS025FixtureRehearsal(DAS024_VALID_FIXTURES[0]);
  assert.equal(result.reconstruction.freshDAS024Session, true);
  assert.equal(result.scaffold.generatedExecutableFunctions, 0);
  assert.equal(result.implementation.packageSpecificExecutableFiles, 0);
  assert.equal(result.qualification.controlsPassed, 10);
  assert.equal(result.qualification.controlsRequired, 10);
  assert.equal(result.qualification.observerWrites, 0);
  assert.equal(result.qualification.lostResponseWrites, 1);
  assert.equal(result.qualification.lostResponseReplays, 0);
  assert.equal(result.qualification.freshProcessRecovery, true);
  assert.equal(result.qualification.executableCustomerOperations, 0);
  assert.equal(result.qualification.runtimeAuthorityGranted, false);
  assert.equal(result.qualification.activationReady, false);
  assert.equal(result.integrityAttacks.every((entry) => entry.passed), true);
});

test("DAS-025 OpenAPI and MCP rehearsal uses the same generator and unchanged ten-control funnel", async () => {
  const result = await runDAS025PluginProjectRehearsal({ writeArtifacts: false });
  assert.equal(result.fixtureCount, 2);
  assert.deepEqual(result.sourceKinds, ["mcp-tools-list", "openapi"]);
  assert.equal(result.controlsPassed, 20);
  assert.equal(result.controlsRequired, 20);
  assert.equal(result.integrityAttacksPassed, result.integrityAttacksRequired);
  assert.equal(result.protectedGatesPreserved, true);
  assert.equal(result.packageSpecificExecutableFiles, 0);
  assert.equal(result.packageSpecificExecutableLines, 0);
  assert.equal(result.observerWrites, 0);
  assert.equal(result.lostResponseReplays, 0);
  assert.equal(result.modelCalls, 0);
  assert.equal(result.spendUsd, 0);
});
