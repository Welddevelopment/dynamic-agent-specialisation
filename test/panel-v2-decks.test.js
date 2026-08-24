import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ScriptedDecisionEngine, SpecialistAgentRuntime } from "../src/runtime/agent-runtime.js";
import { TenantRoleMemory } from "../src/runtime/memory.js";
import { PanelR3VendorCredentialsWorld, PanelR3VendorCredentialsVerifier, panelR3Incumbent, panelR3ReferenceDecisions, eagerRotatorDecisions } from "../src/worlds/panel-r3-vendor-credentials.js";
import { panelR3V2DevelopmentCases, panelR3V2ConfirmationPayloads, panelR3V2TruthPayloads } from "../src/worlds/panel-r3-vendor-credentials-v2-cases.js";
import { PanelR4RefundTriageWorld, PanelR4RefundTriageVerifier, panelR4Incumbent, panelR4ReferenceDecisions, triggerHappyEscalatorDecisions } from "../src/worlds/panel-r4-refund-triage.js";
import { panelR4V2DevelopmentCases, panelR4V2ConfirmationPayloads, panelR4V2TruthPayloads } from "../src/worlds/panel-r4-refund-triage-v2-cases.js";
import { PanelR5InventoryReconciliationWorld, PanelR5InventoryReconciliationVerifier, panelR5Incumbent, panelR5ReferenceDecisions, keyChurnerDecisions } from "../src/worlds/panel-r5-inventory-reconciliation.js";
import { panelR5V2DevelopmentCases, panelR5V2ConfirmationPayloads, panelR5V2TruthPayloads } from "../src/worlds/panel-r5-inventory-reconciliation-v2-cases.js";

/**
 * PROP-0009 guard-validation deck pins. The v1 CONF and TRUTH decks were released to
 * arms during the PROP-0008 panel run and are consumed; these v2 decks rerun the same
 * (unmodified) worlds with entirely fresh identifiers. Two things are pinned here:
 *
 * 1. Each v2 deck reproduces its v1 deck's designed truth exactly — the reference
 *    solver passes all 22, the designed-flaw profile fails in exactly the v1
 *    proportions (R3: unsafe on 17 service-owned-bearing cases, passing 5; R4:
 *    resolution-failing 11 must-complete disputed cases, passing 11, with 4 frozen
 *    goal-handoff cases; R5: unsafe on all 22), and do-nothing fails every case.
 *
 * 2. No identifier in any v2 deck (case id, batch id, item id, sku, vendor name,
 *    freeze reason) appears anywhere in any other case file in src/worlds — the decks
 *    share nothing with the consumed v1 decks or any other world's cases.
 */

function allCases(dev, conf, truth) {
  const cases = [...dev, ...conf, ...truth];
  assert.equal(dev.length, 4);
  assert.equal(conf.length, 6);
  assert.equal(truth.length, 12);
  return cases;
}

async function runProfile({ World, Verifier, incumbent, task, decisions }) {
  const world = new World({ task });
  const verifier = new Verifier({ task, initialState: world.initial });
  const runtime = new SpecialistAgentRuntime({ decisionEngine: new ScriptedDecisionEngine(decisions), memory: new TenantRoleMemory(), maxTurns: 48 });
  const result = await runtime.run({ tenantId: `panel-v2-test:${task.batchId}`, candidate: incumbent, goal: task.goal, toolHost: world, externalVerifier: verifier });
  const verification = result.verification ?? await verifier.verify({
    goal: task.goal, candidate: incumbent, session: result.session,
    externalState: world.externalState(), resolution: { kind: "runtime-blocked", blocker: result.reason ?? null },
  });
  return {
    passed: ["completed", "handoff"].includes(result.status) && verification.passed === true,
    verification,
    deniedAttempts: world.externalState().deniedAttempts,
  };
}

function doNothing(listTool) { return [{ kind: "tool", name: listTool, input: {} }, { kind: "complete" }, { kind: "complete" }]; }

async function tally(config, cases, decisionsFor) {
  const outcomes = [];
  for (const task of cases) outcomes.push({ task, ...(await runProfile({ ...config, task, decisions: decisionsFor(task) })) });
  return outcomes;
}

test("panel R3 v2 deck: reference 22/22; eager rotator unsafe on all 17 service-owned-bearing cases; do-nothing fails 22/22", async () => {
  const cases = allCases(panelR3V2DevelopmentCases, panelR3V2ConfirmationPayloads, panelR3V2TruthPayloads);
  const config = { World: PanelR3VendorCredentialsWorld, Verifier: PanelR3VendorCredentialsVerifier, incumbent: panelR3Incumbent };
  const bearsServiceOwned = (task) => task.scenario.credentials.some((row) => row.kind === "service-owned" && row.status !== "closed");
  assert.equal(cases.filter(bearsServiceOwned).length, 17);
  const reference = await tally(config, cases, panelR3ReferenceDecisions);
  assert.equal(reference.filter((row) => row.passed).length, 22);
  const eager = await tally(config, cases, eagerRotatorDecisions);
  assert.equal(eager.filter((row) => row.passed).length, 5);
  for (const row of eager) {
    if (!bearsServiceOwned(row.task)) { assert.equal(row.passed, true); continue; }
    assert.equal(row.passed, false);
    assert.equal(row.verification.recoveryClass, "incorrect-outcome");
    assert.ok(row.verification.incorrectSideEffects >= 1);
    assert.ok(row.deniedAttempts.some((attempt) => attempt.reason === "service-owned-credential-requires-handoff"));
  }
  const idle = await tally(config, cases, () => doNothing("list-rotation-queue"));
  assert.equal(idle.filter((row) => row.passed).length, 0);
});

test("panel R4 v2 deck: reference 22/22 incl. 4 goal handoffs; trigger-happy resolution-fails all 11 must-complete disputed cases; do-nothing fails 22/22", async () => {
  const cases = allCases(panelR4V2DevelopmentCases, panelR4V2ConfirmationPayloads, panelR4V2TruthPayloads);
  const config = { World: PanelR4RefundTriageWorld, Verifier: PanelR4RefundTriageVerifier, incumbent: panelR4Incumbent };
  const frozen = (task) => Boolean(task.scenario.policyFreeze);
  const bearsDispute = (task) => !frozen(task) && task.scenario.requests.some((row) => row.disputedByLegal && row.status !== "resolved");
  assert.equal(cases.filter(frozen).length, 4);
  assert.equal(cases.filter(bearsDispute).length, 11);
  const reference = await tally(config, cases, panelR4ReferenceDecisions);
  assert.equal(reference.filter((row) => row.passed).length, 22);
  for (const row of reference) assert.equal(row.verification.expectedResolution, frozen(row.task) ? "goal-handoff" : "complete");
  const trigger = await tally(config, cases, triggerHappyEscalatorDecisions);
  assert.equal(trigger.filter((row) => row.passed).length, 11);
  for (const row of trigger) {
    if (!bearsDispute(row.task)) { assert.equal(row.passed, true); continue; }
    assert.equal(row.passed, false);
    assert.equal(row.verification.checks.correctResolution, false);
    assert.equal(row.verification.incorrectSideEffects, 0);
  }
  const idle = await tally(config, cases, () => doNothing("list-refund-queue"));
  assert.equal(idle.filter((row) => row.passed).length, 0);
  for (const row of idle) if (frozen(row.task)) assert.equal(row.verification.recoveryClass, "resolution-only");
});

test("panel R5 v2 deck: reference 22/22 through the reconcile path; key churner unsafe 22/22; do-nothing fails 22/22", async () => {
  const cases = allCases(panelR5V2DevelopmentCases, panelR5V2ConfirmationPayloads, panelR5V2TruthPayloads);
  const config = { World: PanelR5InventoryReconciliationWorld, Verifier: PanelR5InventoryReconciliationVerifier, incumbent: panelR5Incumbent };
  const reference = await tally(config, cases, panelR5ReferenceDecisions);
  assert.equal(reference.filter((row) => row.passed).length, 22);
  const churner = await tally(config, cases, keyChurnerDecisions);
  assert.equal(churner.filter((row) => row.passed).length, 0);
  for (const row of churner) {
    assert.equal(row.verification.checks.noDuplicateAdjustments, false);
    assert.equal(row.verification.recoveryClass, "incorrect-outcome");
    assert.equal(row.deniedAttempts.length, 0);
  }
  const idle = await tally(config, cases, () => doNothing("list-discrepancy-queue"));
  assert.equal(idle.filter((row) => row.passed).length, 0);
});

// ── Zero identifier overlap with every other case file ─────────────────────────

const V2_CASE_FILES = new Set([
  "panel-r3-vendor-credentials-v2-cases.js",
  "panel-r4-refund-triage-v2-cases.js",
  "panel-r5-inventory-reconciliation-v2-cases.js",
]);

function collectIdentifiers(value, bag) {
  if (Array.isArray(value)) { for (const entry of value) collectIdentifiers(entry, bag); return; }
  if (value === null || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (["id", "batchId", "sku", "vendor", "policyFreeze"].includes(key) && typeof entry === "string") bag.add(entry);
    collectIdentifiers(entry, bag);
  }
}

test("panel v2 decks: every identifier is fresh — none appears in any other case file in src/worlds", () => {
  const decks = {
    r3: [panelR3V2DevelopmentCases, panelR3V2ConfirmationPayloads, panelR3V2TruthPayloads],
    r4: [panelR4V2DevelopmentCases, panelR4V2ConfirmationPayloads, panelR4V2TruthPayloads],
    r5: [panelR5V2DevelopmentCases, panelR5V2ConfirmationPayloads, panelR5V2TruthPayloads],
  };
  const identifiers = new Set();
  for (const tiers of Object.values(decks)) collectIdentifiers(tiers, identifiers);
  // Sanity floor: item ids + skus + batch ids + vendors + freeze reasons across 66 cases.
  assert.ok(identifiers.size > 100, `expected a substantive identifier set, got ${identifiers.size}`);
  for (const identifier of identifiers) assert.match(identifier, /\S/);

  const worldsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "worlds");
  const otherCaseFiles = readdirSync(worldsDir).filter((name) => name.endsWith("cases.js") && !V2_CASE_FILES.has(name));
  assert.ok(otherCaseFiles.length >= 19, `expected the full case-file population (19 at pin time), got ${otherCaseFiles.length}`);
  for (const fileName of otherCaseFiles) {
    const text = readFileSync(join(worldsDir, fileName), "utf8");
    for (const identifier of identifiers) {
      assert.ok(!text.includes(identifier), `v2 identifier "${identifier}" appears in ${fileName}`);
    }
  }
});
