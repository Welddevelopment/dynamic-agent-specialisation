import { digest } from "../../core/canonical.js";
import { ScriptedDecisionEngine, SpecialistAgentRuntime } from "../../runtime/agent-runtime.js";
import { TenantRoleMemory } from "../../runtime/memory.js";
import { attestorForSealedEntryPoints } from "../../evaluation/execution-attestation.js";
import { PANEL_ROSTER } from "./roster.js";
import { createPanelPreregistration, createPanelRoleBundle, panelConfReleaseRole, panelTruthReleaseRole } from "./protocol.js";

/** Zero-spend preflight across all five panel roles. No model, no network, no money. */

const asTask = (payload, index, prefix) => ({ id: `${prefix}-${index + 1}`, ...structuredClone(payload) });

async function runScripted(role, task, decisions, maxTurns = 48) {
  const world = role.worldFactory(task);
  const verifier = role.verifierFactory(task, world.initial);
  const runtime = new SpecialistAgentRuntime({ decisionEngine: new ScriptedDecisionEngine(structuredClone(decisions)), memory: new TenantRoleMemory(), maxTurns });
  const result = await runtime.run({ tenantId: `panel-preflight:${role.key}:${task.id}`, candidate: role.incumbent, goal: task.goal, toolHost: world, externalVerifier: verifier });
  if (result.verification) return result.verification;
  return verifier.verify({ externalState: world.externalState(), session: result.session, resolution: { kind: "error", blocker: result.reason ?? result.status } });
}

export async function runPanelPreflight({ sealUtcDates = ["2026-08-22", "2026-08-23"], repositoryRoot = process.cwd() } = {}) {
  const plan = createPanelPreregistration({ sealUtcDates });
  const attestor = await attestorForSealedEntryPoints(plan.armEntryPoints, { repositoryRoot });
  const perRole = [];
  for (const role of PANEL_ROSTER) {
    const bundle = createPanelRoleBundle(role.key);
    const allTasks = [
      ...role.developmentCases.map((row) => structuredClone(row)),
      ...role.confirmationPayloads.map((payload, index) => asTask(payload, index, `${role.key}-conf`)),
      ...role.truthPayloads.map((payload, index) => asTask(payload, index, `${role.key}-truth`)),
    ];
    let referencePasses = 0, doNothingFails = 0;
    for (const task of allTasks) {
      if ((await runScripted(role, task, role.referenceDecisions(task))).passed) referencePasses += 1;
      const nothing = await runScripted(role, task, [{ kind: "complete" }, { kind: "complete" }]);
      if (!nothing.passed) doNothingFails += 1;
    }
    const planText = JSON.stringify(plan);
    const leaks = [...role.confirmationPayloads, ...role.truthPayloads].map((payload) => payload.batchId).filter((batchId) => planText.includes(`"${batchId}"`));
    const confDry = bundle.confirmationVault.release({ freezeHash: "dry", role: panelConfReleaseRole(role.brief), candidateHashes: { d: 1 }, baselineHashes: { d: 1 } });
    const truthDry = bundle.truthVault.release({ freezeHash: "dry", role: panelTruthReleaseRole(role.brief), candidateHashes: { d: 1 }, baselineHashes: { d: 1 } });
    perRole.push({
      roleKey: role.key,
      referencePasses, caseCount: allTasks.length,
      doNothingFails,
      sealedTiersDoNotLeakIntoPlan: leaks.length === 0,
      confReleasable: confDry.length === role.confirmationPayloads.length,
      truthReleasable: truthDry.length === role.truthPayloads.length,
      expertSealed: Boolean(role.expert.fingerprint),
    });
  }
  const checks = {
    referenceSolvesEveryCaseEveryRole: perRole.every((row) => row.referencePasses === row.caseCount),
    doNothingFailsEverywhere: perRole.every((row) => row.doNothingFails === row.caseCount),
    noSealedTierLeaksIntoPlan: perRole.every((row) => row.sealedTiersDoNotLeakIntoPlan),
    everyVaultReleasableWithExactRole: perRole.every((row) => row.confReleasable && row.truthReleasable),
    expertsSealed: perRole.every((row) => row.expertSealed),
    entryPointsResolve: attestor.resolutionState === "resolved",
    armsAreDistinctCode: plan.distinctArmEntryPoints === true,
    zeroSpend: true,
  };
  const report = { schemaVersion: "das.das013-panel-preflight.v1", planHash: plan.planHash, checks, perRole, modelCallsMade: 0, spendUsd: 0, ready: Object.values(checks).every(Boolean) };
  return Object.freeze({ ...report, preflightHash: digest(report) });
}

export function assertPanelPreflightReady(report) {
  const failed = Object.entries(report.checks).filter(([, value]) => !value).map(([name]) => name);
  if (failed.length) throw new Error(`Panel preflight failed: ${failed.join(", ")}`);
  return report;
}
