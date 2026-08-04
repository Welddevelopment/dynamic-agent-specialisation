import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { closeEveryTicketSupportStrategy, doNothingSupportStrategy, evaluateSupportStrategy, referenceSupportStrategy } from "../evaluation/realistic-support-strategies.js";
import { doNothingStrategy, orderEveryDemandStrategy, referenceProcurementStrategy } from "../evaluation/realistic-procurement-strategies.js";
import { assignEveryLeadRevopsStrategy, doNothingRevopsStrategy, evaluateRevopsStrategy, referenceRevopsStrategy } from "../evaluation/realistic-revops-strategies.js";
import { ContinuousSpecializationCoordinator } from "../lifecycle/continuous-coordinator.js";
import { createReplacementContract, SafeReplacementController } from "../lifecycle/replacement-controller.js";
import { LifecycleTrafficDispatcher } from "../lifecycle/traffic-dispatcher.js";
import { createMonitoringContract, VerifiedPerformanceMonitor } from "../lifecycle/verified-monitor.js";
import { tenPercentCostAndSpeedContract } from "../optimization/improvement-contract.js";
import { CommercialComparisonRunner } from "./commercial-comparison-runner.js";
import { activatePromotedCommercialBundle, authorizeCommercialRollback, seedCommercialLifecycleRegistry } from "./commercial-lifecycle-bridge.js";
import { createCommercialLifecycleRunner } from "./commercial-lifecycle-runner.js";
import { createCommercialProcurementPack } from "./commercial-procurement-pack.js";
import { createCommercialSupportPack } from "./commercial-support-pack.js";
import { createCommercialRevopsPack } from "./commercial-revops-pack.js";
import { createCommercialActivationReceipt, createCommercialSpecialistBundle } from "./commercial-specialist-lifecycle.js";
import { RealisticProcurementCompany, RealisticProcurementVerifier } from "../worlds/realistic-procurement-company.js";
import { commercialProcurementCases } from "./commercial-procurement-cases.js";
import { commercialSupportCases } from "../worlds/realistic-support-cases.js";
import { commercialRevopsCases } from "../worlds/realistic-revops-cases.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }

async function evaluateProcurement(strategy, task) {
  const world = new RealisticProcurementCompany({ task, loseWriteResponseFor: task.executionFault });
  const verifier = new RealisticProcurementVerifier({ task, initialState: world.initial });
  let resolution;
  try { resolution = await strategy.run(world, task); }
  catch (error) { resolution = { kind: "error", blocker: error.message, reconciled: false }; }
  const verification = await verifier.verify({ externalState: world.externalState(), resolution });
  return { caseId: task.id, resolution, verification, externalState: world.externalState() };
}

const roleConfigurations = Object.freeze([
  {
    key: "procurement", createPack: createCommercialProcurementPack, cases: commercialProcurementCases,
    evaluate: evaluateProcurement, reference: referenceProcurementStrategy, weak: doNothingStrategy, regression: orderEveryDemandStrategy,
    regressionCase: commercialProcurementCases.development[0],
    actions: ["purchaseOrders", "stockTransfers"],
    countSandboxWrites: ({ state }) => state.purchaseOrders.filter((item) => item.status === "draft").length + state.stockTransfers.filter((item) => item.status === "draft").length,
    unsafeChecks: ["noUnauthorizedSupplier", "deadlinesMet", "withinTaskSpend", "draftOnly", "noDuplicateKeys", "noOutOfScopeWrites", "noUnnecessaryActions", "protectedUnchanged", "noDeniedAttempts"],
  },
  {
    key: "support", createPack: createCommercialSupportPack, cases: commercialSupportCases,
    evaluate: evaluateSupportStrategy, reference: referenceSupportStrategy, weak: doNothingSupportStrategy, regression: closeEveryTicketSupportStrategy,
    regressionCase: commercialSupportCases.adversarial[0],
    actions: ["responses", "credits", "escalations", "incidentLinks", "merges", "closures"],
    unsafeChecks: ["noDeniedAttempts", "noOutOfScopeWrites", "noDuplicateKeys", "protectedStateUnchanged"],
  },
  {
    key: "revops", createPack: createCommercialRevopsPack, cases: commercialRevopsCases,
    evaluate: evaluateRevopsStrategy, reference: referenceRevopsStrategy, weak: doNothingRevopsStrategy, regression: assignEveryLeadRevopsStrategy,
    regressionCase: commercialRevopsCases.adversarial[0],
    actions: ["ownerAssignments", "accountLinks", "leadMerges", "followUpTasks", "dispositions", "escalations"],
    unsafeChecks: ["noDeniedAttempts", "noOutOfScopeWrites", "noDuplicateKeys", "protectedStateUnchanged"],
  },
]);

function environment(pack) {
  return { kind: "disposable-sandbox", driverId: pack.driver.id, driverVersion: pack.driver.version, verifierId: pack.driver.verifier.id, verifierStatus: "verified", systemBindings: structuredClone(pack.driver.systemBindings) };
}

async function fixtureBundle({ createPack, preferredType }) {
  const pack = createPack();
  const runner = new CommercialComparisonRunner({ evaluate: async ({ participant, caseId, verifierId }) => {
    const preferred = participant.type === preferredType;
    return {
      verifierId, independentlyVerified: true, passed: true, outcomeScore: 1, unsafeAttempts: 0, incorrectSideEffects: 0,
      modelCostUsd: preferred ? .001 : .004, elapsedMs: preferred ? 20 : 100, humanInterventions: 0,
      receiptHash: `lifecycle-fixture:${preferredType}:${participant.id}:${caseId}`,
    };
  } });
  const result = await runner.run({ contract: pack.contract, unseenVault: pack.unseenVault, participants: pack.participants });
  const participant = pack.participants.find((item) => item.id === result.selectedParticipantId);
  requireCondition(participant?.type === preferredType, `Lifecycle fixture did not select ${preferredType}`);
  const bundle = createCommercialSpecialistBundle({ contract: pack.contract, result, participant, roleDraft: pack.roleDraft });
  return { pack, bundle };
}

function runnerFor({ config, pack, strategy }) {
  return createCommercialLifecycleRunner({
    roleId: pack.roleDraft.compiled.brief.id,
    verifierId: pack.driver.verifier.id,
    evaluate: config.evaluate,
    strategyFor: () => strategy,
    actionCollections: config.actions,
    countSandboxWrites: config.countSandboxWrites,
    unsafeCheckNames: config.unsafeChecks,
  });
}

function repeatedCase(source, id) {
  return { ...structuredClone(source), id };
}

async function rehearseRole(config, outputDirectory) {
  const activeFixture = await fixtureBundle({ createPack: config.createPack, preferredType: "current-agent" });
  const challengerFixture = await fixtureBundle({ createPack: config.createPack, preferredType: "compiler-candidate" });
  requireCondition(activeFixture.pack.contract.freezeHash === challengerFixture.pack.contract.freezeHash, "Lifecycle fixture contracts diverged");
  const pack = activeFixture.pack;
  const activeBundle = activeFixture.bundle;
  const challengerBundle = challengerFixture.bundle;
  const seeded = seedCommercialLifecycleRegistry({ activeBundle, alternativeBundles: [challengerBundle], brief: pack.roleDraft.compiled.brief, clock: () => "2026-08-05T01:00:00.000Z" });
  const activeActivation = createCommercialActivationReceipt({ bundle: activeBundle, contract: pack.contract, environment: environment(pack) });

  const healthyRunner = runnerFor({ config, pack, strategy: config.reference });
  const weakRunner = runnerFor({ config, pack, strategy: config.weak });
  const challengerRunner = runnerFor({ config, pack, strategy: config.reference });
  const regressionRunner = runnerFor({ config, pack, strategy: config.regression });
  const coordinator = new ContinuousSpecializationCoordinator({ registry: seeded.registry, now: () => "2026-08-05T01:01:00.000Z" });
  coordinator.configureRole({
    roleId: seeded.role.id,
    enabled: true,
    monitoringContract: createMonitoringContract({ minimumObservations: 2, windowSize: 2, minimumPassRate: 1, minimumOutcomeScore: 1 }),
    improvementContract: tenPercentCostAndSpeedContract({ id: `${config.key}-zero-cost-recomparison`, baselineId: activeBundle.selected.candidate.id, maximumRounds: 1, maximumModelSpendUsd: 0 }),
  });
  const healthyTask = config.cases.development[0];
  const driftTask = config.cases.development[1] ?? config.cases.development[0];
  coordinator.ingest(await healthyRunner({ candidate: activeBundle.selected.candidate, taskId: healthyTask.id, task: healthyTask, executionMode: "live" }));
  const drift = coordinator.ingest(await weakRunner({ candidate: activeBundle.selected.candidate, taskId: driftTask.id, task: driftTask, executionMode: "live" }));
  requireCondition(drift.request?.status === "awaiting-explicit-start", `${config.key} drift did not create a bounded recomparison request`);
  requireCondition(drift.request.improvementContract.limits.maximumModelSpendUsd === 0, `${config.key} rehearsal unexpectedly authorized model spend`);

  const replacement = new SafeReplacementController({
    registry: seeded.registry,
    role: seeded.role,
    compatibility: seeded.compatibility,
    contract: createReplacementContract({ minimumOfflineObservations: 2, minimumShadowObservations: 2, minimumCanaryObservations: 2, maximumCanaryFraction: .25 }),
    now: () => "2026-08-05T01:02:00.000Z",
  });
  const offlineObservations = [];
  for (const task of config.cases.validation.slice(0, 2)) offlineObservations.push(await challengerRunner({ candidate: challengerBundle.selected.candidate, taskId: task.id, task, executionMode: "disposable" }));
  requireCondition(offlineObservations.length === 2, `${config.key} needs two distinct offline cases`);
  replacement.stage({ candidate: challengerBundle.selected.candidate, offlineObservations, evidenceReferences: [{ kind: "bounded-recomparison-request", id: drift.request.id }, { kind: "commercial-bundle", hash: challengerBundle.bundleHash }] });
  replacement.beginShadow(challengerBundle.selected.candidate.id);
  const dispatcher = new LifecycleTrafficDispatcher({
    registry: seeded.registry,
    replacementController: replacement,
    runActive: weakRunner,
    runChallenger: challengerRunner,
    now: () => "2026-08-05T01:03:00.000Z",
  });
  for (let index = 0; index < 2; index += 1) {
    const source = config.cases.development[index % config.cases.development.length];
    const task = repeatedCase(source, `${source.id}-shadow-${index + 1}`);
    await dispatcher.dispatch({ challengerId: challengerBundle.selected.candidate.id, taskId: task.id, task });
  }
  replacement.authorizeCanary({ candidateId: challengerBundle.selected.candidate.id, fraction: .25, authorizedBy: "fictional-accountable-owner" });
  const canaryDispatches = [];
  for (let index = 0; index < 8; index += 1) {
    const source = config.cases.development[index % config.cases.development.length];
    const task = repeatedCase(source, `${source.id}-canary-${index + 1}`);
    canaryDispatches.push(await dispatcher.dispatch({ challengerId: challengerBundle.selected.candidate.id, taskId: task.id, task }));
  }
  const promoted = replacement.promote(challengerBundle.selected.candidate.id);
  const promotedActivation = activatePromotedCommercialBundle({ registry: seeded.registry, bundle: challengerBundle, contract: challengerFixture.pack.contract, environment: environment(challengerFixture.pack), previousActivation: activeActivation });

  const regressionSource = config.regressionCase;
  const regressionTask = repeatedCase(regressionSource, `${regressionSource.id}-post-promotion-regression`);
  const regressionObservation = await regressionRunner({ candidate: challengerBundle.selected.candidate, taskId: regressionTask.id, task: regressionTask, executionMode: "live" });
  const regressionMonitor = new VerifiedPerformanceMonitor();
  const regressionAssessment = regressionMonitor.record(regressionObservation, { contract: createMonitoringContract({ minimumObservations: 1, windowSize: 1, minimumPassRate: 1, minimumOutcomeScore: 1 }) });
  requireCondition(regressionAssessment.action !== "continue-current-specialist", `${config.key} regression control unexpectedly passed`);
  const rolledBack = replacement.rollback({ candidateId: challengerBundle.selected.candidate.id, monitoringAssessment: regressionAssessment, requestedBy: "independent-commercial-monitor" });
  const rollbackAuthorization = authorizeCommercialRollback({ activeActivation: promotedActivation, targetBundle: activeBundle });

  const roleDirectory = path.join(outputDirectory, config.key);
  fs.mkdirSync(roleDirectory, { recursive: true });
  coordinator.save(path.join(roleDirectory, "continuous-state.json"));
  replacement.save(path.join(roleDirectory, "replacement-state.json"));
  dispatcher.save(path.join(roleDirectory, "traffic-state.json"));
  seeded.registry.save(path.join(roleDirectory, "registry-after-rollback.json"));
  fs.writeFileSync(path.join(roleDirectory, "activation-chain.json"), `${JSON.stringify({ activeActivation, promotedActivation, rollbackAuthorization }, null, 2)}\n`, { mode: 0o600 });

  const canaryRuns = canaryDispatches.filter((item) => item.route === "bounded-canary");
  return {
    role: config.key,
    roleId: seeded.role.id,
    branch: "verified-drift-request-offline-shadow-canary-promotion-regression-rollback",
    activeCandidateId: activeBundle.selected.candidate.id,
    challengerCandidateId: challengerBundle.selected.candidate.id,
    requestId: drift.request.id,
    requestSpendLimitUsd: drift.request.improvementContract.limits.maximumModelSpendUsd,
    offline: { observations: offlineObservations.length, allPassed: offlineObservations.every((item) => item.verificationPassed && item.unsafeAttempts === 0) },
    shadow: { observations: replacement.state(challengerBundle.selected.candidate.id).shadowObservations.length, customerWritesCommitted: dispatcher.decisions().filter((item) => item.lifecycleStage === "shadow-running").reduce((sum, item) => sum + item.challengerObservation.businessWritesCommitted, 0) },
    canary: { authorizedFraction: .25, totalDispatches: canaryDispatches.length, challengerDispatches: canaryRuns.length, maximumShareRespected: canaryDispatches.every((_, index) => canaryDispatches.slice(0, index + 1).filter((item) => item.route === "bounded-canary").length <= Math.floor((index + 1) * .25)) },
    promotion: { recordHash: promoted.selection.recordHash, activationHash: promotedActivation.activationHash },
    regression: { action: regressionAssessment.action, verificationPassed: regressionObservation.verificationPassed, unsafeAttempts: regressionObservation.unsafeAttempts },
    rollback: { restoredCandidateId: rolledBack.selection.selected.candidate.id, rollbackHash: rollbackAuthorization.rollbackHash },
    modelCalls: 0,
    paidModelSpendUsd: 0,
  };
}

export async function runCommercialLevel15Rehearsal({ outputDirectory }) {
  requireCondition(outputDirectory, "Commercial Level 1.5 rehearsal requires an explicit output directory");
  const resolved = path.resolve(outputDirectory);
  fs.mkdirSync(resolved, { recursive: true });
  const roles = [];
  for (const config of roleConfigurations) roles.push(await rehearseRole(config, resolved));
  const summary = {
    schemaVersion: "das.commercial-level15-rehearsal.v1",
    status: "completed",
    roles,
    checks: {
      allThreeRolesJoined: roles.length === 3,
      everyRoleDetectedRealVerifierDrift: roles.every((role) => role.requestId && role.regression.action !== "continue-current-specialist"),
      noShadowCustomerWrites: roles.every((role) => role.shadow.customerWritesCommitted === 0),
      boundedCanaryShareRespected: roles.every((role) => role.canary.maximumShareRespected && role.canary.challengerDispatches === 2),
      everyRolePromotedThenRolledBack: roles.every((role) => role.rollback.restoredCandidateId === role.activeCandidateId),
      noModelCallsOrSpend: roles.every((role) => role.modelCalls === 0 && role.paidModelSpendUsd === 0),
    },
    evidenceBoundary: [
      "All role actions and verification ran in fresh disposable synthetic worlds.",
      "The active and challenger bundle-selection receipts are deterministic lifecycle fixtures, not model-performance evidence.",
      "The prepared challengers were not newly generated by a model-backed optimization campaign.",
      "This proves joined local lifecycle mechanics across three commercial roles, not customer value, production reliability, or full model-backed Level 1.5 completion.",
    ],
  };
  summary.summaryHash = digest(summary);
  fs.writeFileSync(path.join(resolved, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  return summary;
}
