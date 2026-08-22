import { digest } from "../../core/canonical.js";
import { attestorForSealedEntryPoints } from "../../evaluation/execution-attestation.js";
import { accessOffboardingB3ConfirmationPayloads, accessOffboardingB3DevelopmentCases } from "../../worlds/access-offboarding-b3-cases.js";
import { accessOffboardingConfirmationPayloads, accessOffboardingDevelopmentCases } from "../../worlds/access-offboarding-cases.js";
import { runReferenceAccessOffboardingCase } from "../das004-b2/reference-preflight.js";
import { createDas004B3Preregistration, createDas004B3ProtocolBundle } from "./protocol.js";

/**
 * Zero-spend preflight for DAS-004/B3. No model is contacted.
 *
 * It answers four questions that must all be settled BEFORE money is spent:
 *   1. Is every case solvable at all?  (reference solver must PASS each one)
 *   2. Does the verifier discriminate? (a do-nothing control must FAIL each one)
 *   3. Is the confirmation set genuinely sealed and genuinely fresh?
 *   4. Do both declared arm entry points resolve to real, DIFFERENT code?
 *
 * A campaign that skips these can spend its whole budget discovering its cases were
 * unsolvable, or that both arms were the same class — which is exactly what B2 did.
 */

function requireCondition(condition, message) { if (!condition) throw new Error(message); }

const asTask = (payload, index, prefix) => ({ id: `${prefix}-${index + 1}`, ...structuredClone(payload) });

async function referencePasses(task) {
  const { result } = await runReferenceAccessOffboardingCase(task);
  return { caseId: task.id, status: result.status, passed: result.verification?.passed === true, outcomeScore: result.verification?.outcomeScore ?? null, recoveryClass: result.verification?.recoveryClass ?? null };
}

async function controlFails(task) {
  // The control does nothing but read, then claims completion. It must never pass.
  const { ScriptedDecisionEngine, SpecialistAgentRuntime } = await import("../../runtime/agent-runtime.js");
  const { TenantRoleMemory } = await import("../../runtime/memory.js");
  const { importedAccessOffboardingAgent } = await import("../../roles/access-offboarding.js");
  const { AccessOffboardingVerifier, AccessOffboardingWorld } = await import("../../worlds/access-offboarding-world.js");
  const world = new AccessOffboardingWorld({ task });
  const verifier = new AccessOffboardingVerifier({ task, initialState: world.initial });
  const runtime = new SpecialistAgentRuntime({
    decisionEngine: new ScriptedDecisionEngine([{ kind: "tool", name: "read-offboarding-policy", input: {} }, { kind: "complete" }, { kind: "complete" }]),
    memory: new TenantRoleMemory(), maxTurns: 8,
  });
  const result = await runtime.run({ tenantId: `control:${task.id}`, candidate: importedAccessOffboardingAgent, goal: task.goal, toolHost: world, externalVerifier: verifier });
  return { caseId: task.id, status: result.status, passed: result.verification?.passed === true, recoveryClass: result.verification?.recoveryClass ?? null };
}

export async function runDas004B3Preflight({ repositoryRoot = process.cwd() } = {}) {
  const plan = createDas004B3Preregistration();
  const bundle = createDas004B3ProtocolBundle();

  const developmentTasks = accessOffboardingB3DevelopmentCases.map((row) => structuredClone(row));
  const confirmationTasks = accessOffboardingB3ConfirmationPayloads.map((payload, index) => asTask(payload, index, "b3-confirmation"));
  const allTasks = [...developmentTasks, ...confirmationTasks];

  const reference = [];
  for (const task of allTasks) reference.push(await referencePasses(task));
  const control = [];
  for (const task of allTasks) control.push(await controlFails(task));

  const referenceAllPassed = reference.every((row) => row.passed);
  const controlAllFailed = control.every((row) => !row.passed);

  // Freshness: no B3 case may share an identifier with any consumed B2 case.
  const identifiers = (value) => new Set(JSON.stringify(value).match(/"(?:worker|grant|resource)-[a-z]+"/g) ?? []);
  const b3Ids = new Set([...identifiers(accessOffboardingB3DevelopmentCases), ...identifiers(accessOffboardingB3ConfirmationPayloads)]);
  const b2Ids = new Set([...identifiers(accessOffboardingDevelopmentCases), ...identifiers(accessOffboardingConfirmationPayloads)]);
  const reusedIdentifiers = [...b3Ids].filter((id) => b2Ids.has(id));

  // The sealed plan must not leak any confirmation payload.
  const planText = JSON.stringify(plan);
  const leakedConfirmation = accessOffboardingB3ConfirmationPayloads
    .flatMap((payload) => (payload.scenario.workers ?? []).map((worker) => worker.id))
    .filter((workerId) => planText.includes(workerId));

  const attestor = await attestorForSealedEntryPoints(plan.armEntryPoints, { repositoryRoot });
  const armSignatures = plan.armEntryPoints.arms.map((row) => `${row.module}#${row.exportName}.${row.methodName ?? ""}`);
  const armsAreDistinct = new Set(armSignatures).size === armSignatures.length;

  const checks = {
    referenceSolvesEveryCase: referenceAllPassed,
    controlFailsEveryCase: controlAllFailed,
    noConsumedCaseReuse: reusedIdentifiers.length === 0,
    confirmationSealedNotInPlan: leakedConfirmation.length === 0,
    confirmationVaultUnreleased: bundle.confirmationVault.releaseCount() === 0,
    entryPointsResolve: attestor.resolutionState === "resolved",
    armsAreDistinctCode: armsAreDistinct,
    noAuthorityGranted: plan.protocol.role.authorityHash === bundle.protocol.role.authorityHash,
    zeroSpend: true,
  };

  const report = {
    schemaVersion: "das.das004-b3-preflight.v1",
    campaignId: plan.campaignId,
    planHash: plan.planHash,
    checks,
    reference,
    control,
    reusedIdentifiers,
    leakedConfirmation,
    modelCallsMade: 0,
    spendUsd: 0,
    ready: Object.values(checks).every(Boolean),
  };
  return Object.freeze({ ...report, preflightHash: digest(report) });
}

export function assertDas004B3PreflightReady(report) {
  requireCondition(report?.schemaVersion === "das.das004-b3-preflight.v1", "Unsupported DAS-004/B3 preflight");
  const failed = Object.entries(report.checks).filter(([, value]) => !value).map(([name]) => name);
  requireCondition(!failed.length, `DAS-004/B3 preflight failed: ${failed.join(", ")}`);
  return report;
}
