import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { DurableSpecialistRegistry } from "../compiler/durable-registry.js";
import { ContinuousSpecializationCoordinator } from "../lifecycle/continuous-coordinator.js";
import { createMonitoringContract, sealVerifiedObservation, VerifiedPerformanceMonitor } from "../lifecycle/verified-monitor.js";
import { createReplacementContract, SafeReplacementController } from "../lifecycle/replacement-controller.js";
import { tenPercentCostAndSpeedContract } from "../optimization/improvement-contract.js";
import { realisticProcurementBrief } from "../roles/realistic-procurement.js";
import { realisticSupportBrief } from "../roles/realistic-support.js";
import { realisticRevopsBrief } from "../roles/realistic-revops.js";

const outputDirectory = path.resolve("artifacts/level15/rehearsal-v1");
fs.mkdirSync(outputDirectory, { recursive: true });
const registry = DurableSpecialistRegistry.load(path.resolve("artifacts/level1/registry-v1.json"));
const briefs = [realisticProcurementBrief, realisticSupportBrief, realisticRevopsBrief];
const briefByRole = Object.fromEntries(briefs.map((brief) => [brief.id, brief]));
const compatibility = (brief) => ({ roleTags: brief.environment.tags, environmentTags: brief.environment.tags, policyHash: digest(brief.policies), authorityHash: digest(brief.authority), toolsHash: digest(brief.environment.tools), verifierBinding: brief.successCriteria.verifierId });
const current = (roleId) => registry.latest(roleId).selected.candidate;

function observation(candidate, caseId, overrides = {}) {
  return sealVerifiedObservation({ roleId: candidate.roleId, specialistId: candidate.id, specialistVersion: candidate.version, caseId, verifierKind: "independent-external-state", verificationPassed: true, outcomeScore: 1, unsafeAttempts: 0, modelCostUsd: .01, elapsedMs: 1_000, toolCalls: 5, humanInterventions: 0, executionMode: "live", businessWritesCommitted: 0, ...overrides });
}
const offlineObservation = (candidate, caseId) => observation(candidate, caseId, { executionMode: "disposable" });
const shadowObservation = (candidate, caseId) => observation(candidate, caseId, { executionMode: "shadow-no-authority" });
const canaryObservation = (candidate, caseId) => observation(candidate, caseId, { executionMode: "canary", canaryFraction: .1 });

const coordinator = new ContinuousSpecializationCoordinator({ registry, now: () => "2026-08-02T22:00:00.000Z" });
for (const brief of briefs) coordinator.configureRole({
  roleId: brief.id,
  enabled: true,
  monitoringContract: createMonitoringContract({ minimumObservations: 3, windowSize: 3, minimumPassRate: 1, minimumOutcomeScore: .95, maximumMeanModelCostUsd: .03, maximumMedianElapsedMs: 3_000 }),
  improvementContract: tenPercentCostAndSpeedContract({ id: `level15-${brief.id}`, baselineId: current(brief.id).id, maximumModelSpendUsd: 1 }),
});

const procurement = current(realisticProcurementBrief.id);
const procurementAssessments = [1, 2, 3].map((number) => coordinator.ingest(observation(procurement, `procurement-healthy-${number}`)).assessment);
if (procurementAssessments.at(-1).action !== "continue-current-specialist") throw new Error("Healthy procurement specialist should continue");

const support = current(realisticSupportBrief.id);
coordinator.ingest(observation(support, "support-drift-1"));
coordinator.ingest(observation(support, "support-drift-2"));
const supportDrift = coordinator.ingest(observation(support, "support-drift-3", { verificationPassed: false, outcomeScore: .7 }));
if (supportDrift.request?.status !== "awaiting-explicit-start") throw new Error("Support drift should create a bounded request");

const supportSelection = registry.latest(realisticSupportBrief.id);
const supportChallenger = supportSelection.alternatives.find((entry) => entry.candidate.id === "support-baseline-strong-general-terra")?.candidate;
if (!supportChallenger) throw new Error("Support challenger is missing from the preserved alternatives");
const lifecycle = new SafeReplacementController({ registry, role: { id: realisticSupportBrief.id, brief: realisticSupportBrief }, compatibility: compatibility(realisticSupportBrief), contract: createReplacementContract({ minimumOfflineObservations: 2, minimumShadowObservations: 2, minimumCanaryObservations: 2, maximumCanaryFraction: .1 }), now: () => "2026-08-02T22:05:00.000Z" });
lifecycle.stage({ candidate: supportChallenger, offlineObservations: [offlineObservation(supportChallenger, "support-offline-1"), offlineObservation(supportChallenger, "support-offline-2")] });
lifecycle.beginShadow(supportChallenger.id);
lifecycle.recordShadow(supportChallenger.id, shadowObservation(supportChallenger, "support-shadow-1"));
lifecycle.recordShadow(supportChallenger.id, shadowObservation(supportChallenger, "support-shadow-2"));
lifecycle.authorizeCanary({ candidateId: supportChallenger.id, fraction: .1, authorizedBy: "fictional-company-owner" });
lifecycle.recordCanary(supportChallenger.id, canaryObservation(supportChallenger, "support-canary-1"));
lifecycle.recordCanary(supportChallenger.id, canaryObservation(supportChallenger, "support-canary-2"));
const promoted = lifecycle.promote(supportChallenger.id);
if (promoted.selection.selected.candidate.id !== supportChallenger.id) throw new Error("Support challenger promotion failed");
const postPromotionMonitor = new VerifiedPerformanceMonitor();
const regression = postPromotionMonitor.record(observation(supportChallenger, "support-live-unsafe", { verificationPassed: false, outcomeScore: 0, unsafeAttempts: 1 }));
const rolledBack = lifecycle.rollback({ candidateId: supportChallenger.id, monitoringAssessment: regression, requestedBy: "verified-performance-monitor" });
if (rolledBack.selection.selected.candidate.id !== support.id) throw new Error("Support rollback did not restore the prior proven specialist");

const revops = current(realisticRevopsBrief.id);
const revopsHalt = coordinator.ingest(observation(revops, "revops-live-unsafe", { verificationPassed: false, outcomeScore: 0, unsafeAttempts: 1 }));
if (!revopsHalt.halt) throw new Error("Unsafe RevOps observation did not halt the specialist");

coordinator.save(path.join(outputDirectory, "continuous-state.json"));
lifecycle.save(path.join(outputDirectory, "support-replacement-state.json"));
registry.save(path.join(outputDirectory, "registry-after-rehearsal.json"));
const summary = {
  schemaVersion: "das.level15-three-role-rehearsal.v1",
  status: "completed",
  paidModelSpendUsd: 0,
  roles: {
    procurement: { branch: "healthy-continuation", finalAction: procurementAssessments.at(-1).action, observations: 3 },
    support: { branch: "drift-request-shadow-canary-promotion-regression-rollback", requestId: supportDrift.request.id, requestStatus: supportDrift.request.status, challengerId: supportChallenger.id, promotedVersion: promoted.selection.selectionVersion, rollbackVersion: rolledBack.selection.selectionVersion, restoredCandidateId: rolledBack.selection.selected.candidate.id },
    revops: { branch: "unsafe-active-halt", haltedCandidateId: revopsHalt.halt.specialistId, action: revopsHalt.assessment.action },
  },
  checks: {
    healthySpecialistContinues: procurementAssessments.at(-1).action === "continue-current-specialist",
    driftCreatesBoundedUnstartedRequest: supportDrift.request.status === "awaiting-explicit-start" && supportDrift.request.improvementContract.limits.maximumModelSpendUsd === 1,
    challengerCannotSkipGates: lifecycle.events().some((event) => event.type === "challenger.shadow-started") && lifecycle.events().some((event) => event.type === "challenger.canary-authorized"),
    regressionRollsBack: rolledBack.selection.selected.candidate.id === support.id,
    unsafeActiveSpecialistHalts: revopsHalt.assessment.action === "quarantine-active-specialist",
    allStatePersisted: ["continuous-state.json", "support-replacement-state.json", "registry-after-rehearsal.json"].every((file) => fs.existsSync(path.join(outputDirectory, file))),
  },
  boundary: ["deterministic synthetic lifecycle rehearsal", "observations are constructed fixtures, not model or customer outcomes", "no production scheduler or real traffic", "no human-engineer study", "no Level 1.5 completion claim from this artifact alone"],
};
summary.summaryHash = digest(summary);
fs.writeFileSync(path.join(outputDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
