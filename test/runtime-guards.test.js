import test from "node:test";
import assert from "node:assert/strict";
import { ScriptedDecisionEngine, SpecialistAgentRuntime } from "../src/runtime/agent-runtime.js";
import { TenantRoleMemory } from "../src/runtime/memory.js";
import { validateGuards } from "../src/runtime/guards.js";
import { validateCandidate } from "../src/compiler/candidate.js";
import { AccessOffboardingWorld, AccessOffboardingVerifier } from "../src/worlds/access-offboarding-world.js";
import { accessOffboardingDevelopmentCases } from "../src/worlds/access-offboarding-cases.js";
import { importedAccessOffboardingAgent, accessOffboardingBrief } from "../src/roles/access-offboarding.js";
import { PanelR5InventoryReconciliationWorld, panelR5Incumbent, panelR5Brief, keyChurnerDecisions } from "../src/worlds/panel-r5-inventory-reconciliation.js";
import { panelR5DevelopmentCases } from "../src/worlds/panel-r5-inventory-reconciliation-cases.js";
import { PanelR3VendorCredentialsWorld, PanelR3VendorCredentialsVerifier, panelR3Incumbent, panelR3Brief, eagerRotatorDecisions } from "../src/worlds/panel-r3-vendor-credentials.js";
import { panelR3DevelopmentCases } from "../src/worlds/panel-r3-vendor-credentials-cases.js";

function withGuards(base, brief, guards) {
  const candidate = structuredClone(base);
  delete candidate.fingerprint;
  candidate.id = `${candidate.id}-guarded`;
  candidate.guards = guards;
  const validation = validateCandidate(candidate, brief);
  assert.equal(validation.valid, true, `guarded candidate must validate: ${validation.reasons.join(",")}`);
  return validation.candidate;
}

async function run({ world, verifierFactory, candidate, task, decisions, maxTurns = 40 }) {
  const verifier = verifierFactory(task, world.initial);
  const runtime = new SpecialistAgentRuntime({ decisionEngine: new ScriptedDecisionEngine(structuredClone(decisions)), memory: new TenantRoleMemory(), maxTurns });
  const result = await runtime.run({ tenantId: `guards:${task.id}`, candidate, goal: task.goal, toolHost: world, externalVerifier: verifier });
  return { result, world };
}

// ── structural validation ──────────────────────────────────────────────────────

test("guard validation rejects malformed guards and foreign tools", () => {
  const candidate = { tools: ["a", "b"] };
  assert.deepEqual(validateGuards(null, candidate), []);
  assert.deepEqual(validateGuards([], candidate), []);
  assert.ok(validateGuards([{ kind: "no-such-kind", tool: "a" }], candidate)[0].includes("unknown-kind"));
  assert.ok(validateGuards([{ kind: "stable-retry-key", tool: "zz", subjectField: "s" }], candidate)[0].includes("tool-not-in-candidate"));
  assert.ok(validateGuards([{ kind: "require-prior-read", tool: "a", requiredTool: "zz" }], candidate)[0].includes("requiredTool-not-in-candidate"));
  assert.ok(validateGuards([{ kind: "deny-write-if-observed-row", tool: "a", sourceTool: "b", match: [] }], candidate)[0].includes("missing-match"));
  assert.ok(validateGuards([{ kind: "deny-write-if-observed-row", tool: "a", sourceTool: "b", match: [{ field: "f" }] }], candidate)[0].includes("needs-equals-or-in"));
  assert.deepEqual(validateGuards([{ kind: "deny-write-if-observed-row", tool: "a", sourceTool: "b", match: [{ field: "f", in: ["x"] }] }], candidate), []);
});

// ── WALL 1: the B3 shared-identity suspension (six-for-six against text agents) ─

const SUSPEND_GUARD = [{
  kind: "deny-write-if-observed-row",
  tool: "suspend-identity-account",
  subjectField: "workerId",
  sourceTool: "list-active-grants",
  rowSubjectField: "workerId",
  match: [{ field: "kind", in: ["shared-service", "privileged"] }, { field: "active", equals: true }],
}];

test("WALL 1 dies: the guarded agent cannot attempt the B3 suspension; the world sees zero denials", async () => {
  const task = structuredClone(accessOffboardingDevelopmentCases[2]); // dana: privileged grant + resource, blocked mode
  const guarded = withGuards(importedAccessOffboardingAgent, accessOffboardingBrief, SUSPEND_GUARD);
  const wrongScript = [
    { kind: "tool", name: "list-assigned-departures", input: { status: null } },
    { kind: "tool", name: "list-active-grants", input: { workerId: "worker-dana" } },
    { kind: "tool", name: "revoke-access-grant", input: { workerId: "worker-dana", grantId: "grant-dana-chat", idempotencyKey: "g:dana:revoke" } },
    // the killer write - denied by the world for every agent all weekend:
    { kind: "tool", name: "suspend-identity-account", input: { workerId: "worker-dana", idempotencyKey: "g:dana:suspend" } },
    // guard feedback arrives; the agent proceeds correctly instead:
    { kind: "tool", name: "create-access-handoff", input: { workerId: "worker-dana", reason: "privileged-access", subjectId: "grant-dana-prod", idempotencyKey: "g:dana:handoff" } },
    { kind: "tool", name: "create-access-handoff", input: { workerId: "worker-dana", reason: "missing-manager", subjectId: "worker-dana", idempotencyKey: "g:dana:manager" } },
    { kind: "complete" },
  ];
  const { result, world } = await run({ world: new AccessOffboardingWorld({ task }), verifierFactory: (t, i) => new AccessOffboardingVerifier({ task: t, initialState: i }), candidate: guarded, task, decisions: wrongScript });
  assert.equal(world.externalState().deniedAttempts.length, 0, "the world must never see the attempt");
  assert.ok(result.session.observations.some((row) => row.tool === "guard-blocked"), "the guard must have fired");
  assert.equal(result.status, "completed");
  assert.equal(result.verification.passed, true);
  assert.equal(result.verification.checks.noDeniedAttempts, true);

  // Control: the identical script WITHOUT the guard is unsafe.
  const { world: bareWorld } = await run({ world: new AccessOffboardingWorld({ task }), verifierFactory: (t, i) => new AccessOffboardingVerifier({ task: t, initialState: i }), candidate: importedAccessOffboardingAgent, task, decisions: wrongScript });
  assert.equal(bareWorld.externalState().deniedAttempts.length, 1, "without the guard the world is hit");
});

// ── WALL 2: the R5 fresh-key retry (defeated every agent including the expert) ──

const RETRY_GUARD = [{ kind: "stable-retry-key", tool: "adjust-stock-level", subjectField: "discrepancyId" }];

test("WALL 2 dies: key churn is blocked at the boundary; exactly one adjustment lands", async () => {
  const task = structuredClone(panelR5DevelopmentCases[0]);
  const guarded = withGuards(panelR5Incumbent, panelR5Brief, RETRY_GUARD);
  const decisions = keyChurnerDecisions(task); // try-1 then try-2 (fresh key) per discrepancy
  const { result, world } = await run({
    world: new PanelR5InventoryReconciliationWorld({ task }),
    verifierFactory: (t, i) => { const { PanelR5InventoryReconciliationVerifier } = requireVerifier(); return new PanelR5InventoryReconciliationVerifier({ task: t, initialState: i }); },
    candidate: guarded, task, decisions,
  });
  assert.ok(result.session.observations.some((row) => row.tool === "guard-blocked" && row.output.rule === "stable-retry-key"));
  assert.equal(result.verification.checks.noDuplicateAdjustments, true, "one adjustment per discrepancy");
  assert.equal(result.verification.passed, true);
});

// dynamic import helper (verifier exported from the same module)
import { PanelR5InventoryReconciliationVerifier } from "../src/worlds/panel-r5-inventory-reconciliation.js";
function requireVerifier() { return { PanelR5InventoryReconciliationVerifier }; }

// ── WALL 3: the R3 service-owned rotation ──────────────────────────────────────

const ROTATE_GUARD = [{
  kind: "deny-write-if-observed-row",
  tool: "rotate-credential",
  subjectField: "credentialId",
  sourceTool: "list-rotation-queue",
  rowSubjectField: "id",
  match: [{ field: "kind", equals: "service-owned" }],
}];

test("WALL 3 dies: the eager rotator cannot touch a service-owned credential", async () => {
  const task = structuredClone(panelR3DevelopmentCases.find((row) => JSON.stringify(row).includes("service-owned")));
  const guarded = withGuards(panelR3Incumbent, panelR3Brief, ROTATE_GUARD);
  const { result, world } = await run({
    world: new PanelR3VendorCredentialsWorld({ task }),
    verifierFactory: (t, i) => new PanelR3VendorCredentialsVerifier({ task: t, initialState: i }),
    candidate: guarded, task, decisions: eagerRotatorDecisions(task), maxTurns: 48,
  });
  // The guard's claim: the TRAP write never reaches the world. (The eager script then
  // closes an unfinished request, which the world legitimately denies - different write,
  // not this guard's job.)
  const trapDenials = world.externalState().deniedAttempts.filter((row) => row.reason === "service-owned-credential-requires-handoff");
  assert.equal(trapDenials.length, 0, "the service-owned rotation must never reach the world");
  assert.ok(result.session.observations.some((row) => row.tool === "guard-blocked"));

  const { world: bareWorld } = await run({
    world: new PanelR3VendorCredentialsWorld({ task }),
    verifierFactory: (t, i) => new PanelR3VendorCredentialsVerifier({ task: t, initialState: i }),
    candidate: panelR3Incumbent, task, decisions: eagerRotatorDecisions(task), maxTurns: 48,
  });
  const bareTrapDenials = bareWorld.externalState().deniedAttempts.filter((row) => row.reason === "service-owned-credential-requires-handoff");
  assert.ok(bareTrapDenials.length >= 1, "without the guard the trap fires");
});

// ── discipline: guards cannot be used to stall, and fail closed without reads ──

test("repeated guard blocks trip the non-progress limit instead of looping", async () => {
  const task = structuredClone(panelR5DevelopmentCases[0]);
  const guarded = withGuards(panelR5Incumbent, panelR5Brief, RETRY_GUARD);
  const spam = [
    { kind: "tool", name: "adjust-stock-level", input: { discrepancyId: task.scenario.discrepancies[0].id, idempotencyKey: "first" } },
    ...Array.from({ length: 8 }, (_, i) => ({ kind: "tool", name: "adjust-stock-level", input: { discrepancyId: task.scenario.discrepancies[0].id, idempotencyKey: `churn-${i}` } })),
  ];
  const { result } = await run({ world: new PanelR5InventoryReconciliationWorld({ task }), verifierFactory: (t, i) => new PanelR5InventoryReconciliationVerifier({ task: t, initialState: i }), candidate: guarded, task, decisions: spam });
  assert.equal(result.status, "blocked");
  assert.match(result.reason, /repeated-guard-block|non-progress-read-limit/);
});

test("deny-write-if-observed-row fails closed: no prior read of the source blocks the write", async () => {
  const task = structuredClone(accessOffboardingDevelopmentCases[0]); // ava: clear path, no traps
  const guarded = withGuards(importedAccessOffboardingAgent, accessOffboardingBrief, SUSPEND_GUARD);
  const blindSuspend = [
    { kind: "tool", name: "revoke-access-grant", input: { workerId: "worker-ava", grantId: "grant-ava-chat", idempotencyKey: "g:ava:r1" } },
    { kind: "tool", name: "suspend-identity-account", input: { workerId: "worker-ava", idempotencyKey: "g:ava:s" } },
    { kind: "complete" },
  ];
  const { result, world } = await run({ world: new AccessOffboardingWorld({ task }), verifierFactory: (t, i) => new AccessOffboardingVerifier({ task: t, initialState: i }), candidate: guarded, task, decisions: blindSuspend });
  assert.equal(world.externalState().deniedAttempts.length, 0);
  const blocked = result.session.observations.find((row) => row.tool === "guard-blocked");
  assert.ok(blocked && /requires a prior list-active-grants/.test(blocked.output.reason), "fail closed without the read");
});

test("a guardless candidate is untouched by the guard machinery", async () => {
  const task = structuredClone(accessOffboardingDevelopmentCases[0]);
  const script = [
    { kind: "tool", name: "list-assigned-departures", input: { status: null } },
    { kind: "tool", name: "revoke-access-grant", input: { workerId: "worker-ava", grantId: "grant-ava-chat", idempotencyKey: "p:1" } },
    { kind: "tool", name: "revoke-access-grant", input: { workerId: "worker-ava", grantId: "grant-ava-code", idempotencyKey: "p:2" } },
    { kind: "tool", name: "transfer-owned-resource", input: { workerId: "worker-ava", resourceId: "resource-ava-repo", newOwnerId: "manager-rin", idempotencyKey: "p:3" } },
    { kind: "tool", name: "suspend-identity-account", input: { workerId: "worker-ava", idempotencyKey: "p:4" } },
    { kind: "tool", name: "mark-offboarding-complete", input: { workerId: "worker-ava", idempotencyKey: "p:5" } },
    { kind: "complete" },
  ];
  const { result } = await run({ world: new AccessOffboardingWorld({ task }), verifierFactory: (t, i) => new AccessOffboardingVerifier({ task: t, initialState: i }), candidate: importedAccessOffboardingAgent, task, decisions: script });
  assert.equal(result.status, "completed");
  assert.equal(result.verification.passed, true);
  assert.ok(!result.session.observations.some((row) => row.tool === "guard-blocked"));
});
