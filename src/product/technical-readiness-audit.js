import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DurableSpecialistRegistry } from "../compiler/durable-registry.js";
import { digest } from "../core/canonical.js";
import { assertProspectiveFleetCampaignPlan } from "../fleet/prospective-fleet-campaign.js";
import { assertCommercialComparisonFreeze } from "./commercial-comparison.js";
import { assertCommercialModelCampaignPlan } from "./commercial-lifecycle-handoff.js";
import { assertCommercialPostcomparisonGate } from "./commercial-postcomparison-gate.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function readJson(root, relativePath) { return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8")); }
function sha256File(filePath) { return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }
function assertRecordHash(record, key, label) { requireCondition(record?.[key] && digest(withoutHash(record, key)) === record[key], `${label} integrity mismatch`); }
function allTrue(record) { return Object.values(record ?? {}).every((value) => value === true); }

function verifyLevel1(root) {
  const closeout = readJson(root, "artifacts/level1/technical-closeout-v1.json");
  requireCondition(closeout.schemaVersion === "das.level1-technical-closeout.v1", "Unsupported Level 1 closeout");
  requireCondition(closeout.verdict?.boundedLevel1TechnicalMechanismComplete === true && closeout.verdict?.fullExternalEvidenceContractComplete === false, "Level 1 closeout boundary changed");
  requireCondition(closeout.selections?.length === 3 && allTrue(closeout.technicalChecks), "Level 1 technical checks are incomplete");
  requireCondition(closeout.humanEffort?.realProspectiveHumanSessions === 0 && Object.values(closeout.evidenceGaps ?? {}).every((value) => value === false), "Level 1 external-evidence boundary changed");
  const registryPath = path.join(root, "artifacts/level1/registry-v1.json");
  requireCondition(sha256File(registryPath) === closeout.registry.sha256, "Level 1 registry file differs from closeout");
  const registry = DurableSpecialistRegistry.load(registryPath);
  requireCondition(closeout.selections.every((item) => registry.latest(item.roleId)?.recordHash === item.recordHash), "Level 1 selected registry records changed");
  for (const reference of closeout.sourceEvidence) {
    const file = path.join(root, reference.path);
    requireCondition(fs.existsSync(file) && sha256File(file) === reference.sha256, `Level 1 evidence reference changed: ${reference.path}`);
  }
  return {
    status: "technical-mechanism-complete",
    selectedRoles: closeout.selections.length,
    compilerCreatedWinners: closeout.selections.filter((item) => item.decision === "activate-compiler-specialist").length,
    retainedExistingWinners: closeout.selections.filter((item) => item.decision === "retain-existing-specialist").length,
    historicalPaidModelSpendUsd: closeout.paidModelSpend.cumulativeSpentUsd,
    externalEvidenceComplete: false,
  };
}

function verifyCommercial(root) {
  const roles = ["procurement", "support", "revops"];
  for (const role of roles) {
    const contract = readJson(root, `artifacts/commercial/${role}-v1/comparison-contract.json`);
    const plan = readJson(root, `artifacts/commercial/${role}-v1/model-campaign-plan.json`);
    const receipt = readJson(root, `artifacts/commercial/${role}-v1/preflight-receipt.json`);
    assertCommercialComparisonFreeze(contract);
    assertCommercialModelCampaignPlan(plan);
    assertRecordHash(receipt, "receiptHash", `${role} commercial preflight`);
    requireCondition(receipt.contractFreezeHash === contract.freezeHash && plan.contractFreezeHash === contract.freezeHash, `${role} commercial plan chain changed`);
    requireCondition(receipt.deterministicReference?.successRate === 1 && receipt.shortcutControls?.every((item) => item.successRate < 1), `${role} commercial preflight is not discriminating`);
    requireCondition(receipt.unseenReleaseCount === 0 && receipt.modelCalls === 0 && receipt.spendUsd === 0, `${role} commercial preflight boundary changed`);
  }
  const procurement = readJson(root, "artifacts/commercial/procurement-v1/network-activation-rehearsal.json");
  assertRecordHash(procurement, "receiptHash", "procurement network rehearsal");
  requireCondition(procurement.run?.verificationPassed === true && procurement.run?.duplicateSuppressed === true && procurement.modelCalls === 0, "Procurement network rehearsal is incomplete");
  const multiRole = readJson(root, "artifacts/commercial/multi-role-network-activation-rehearsal.json");
  assertRecordHash(multiRole, "receiptHash", "multi-role network rehearsal");
  requireCondition(multiRole.roles?.length === 2 && multiRole.roles.every((item) => item.packageReady && item.loopbackOnly && item.run?.verificationPassed && item.run?.duplicateSuppressed && item.deniedAttempts === 0), "Support/RevOps network rehearsal is incomplete");
  return { status: "three-fictional-role-packs-locally-runnable", roles, packagedNetworkRehearsals: 3, freshCommercialModelComparisonsCompleted: 0, customerActivations: 0 };
}

function verifyLevel15(root) {
  const summary = readJson(root, "artifacts/commercial/level15-rehearsal-v1/summary.json");
  assertRecordHash(summary, "summaryHash", "Level 1.5 rehearsal");
  requireCondition(summary.status === "completed" && allTrue(summary.checks) && summary.roles?.length === 3, "Level 1.5 deterministic lifecycle is incomplete");
  const preflight = readJson(root, "artifacts/commercial/postcomparison-gates-v1/preflight-receipt.json");
  assertRecordHash(preflight, "receiptHash", "post-comparison preflight");
  requireCondition(allTrue(preflight.checks) && preflight.modelCalls === 0 && preflight.paidModelSpendUsd === 0, "Post-comparison preflight boundary changed");
  for (const role of ["procurement", "support", "revops"]) assertCommercialPostcomparisonGate(readJson(root, `artifacts/commercial/postcomparison-gates-v1/${role}-gate-contract.json`));
  return { status: "deterministic-mechanism-complete", rolesExercised: 3, empiricalFreshModelLifecycleComplete: false, customerLifecycleComplete: false };
}

function verifyLevel2(root) {
  const roleGap = readJson(root, "artifacts/fleet/bounded-level2-role-gap-return-v1/summary.json");
  assertRecordHash(roleGap, "summaryHash", "Level 2 role-gap return");
  requireCondition(roleGap.status === "original-broad-goal-completed" && roleGap.modelCalls === 0 && roleGap.paidModelSpendUsd === 0, "Level 2 deterministic return is incomplete");
  const generality = readJson(root, "artifacts/fleet/bounded-level2-generality-v1/summary.json");
  assertRecordHash(generality, "summaryHash", "Level 2 generality matrix");
  requireCondition(generality.status === "completed" && allTrue(generality.checks), "Level 2 generality matrix is incomplete");
  const intake = readJson(root, "artifacts/fleet/intake-v1/summary.json");
  assertRecordHash(intake, "summaryHash", "Fleet Intake");
  requireCondition(intake.status === "completed" && intake.modelCalls === 0, "Fleet Intake is incomplete");
  const prospectivePlan = readJson(root, "artifacts/fleet/prospective-model-campaign-v1/plan.json");
  assertProspectiveFleetCampaignPlan(prospectivePlan);
  const prospectivePreflight = readJson(root, "artifacts/fleet/prospective-model-campaign-v1/summary.json");
  assertRecordHash(prospectivePreflight, "summaryHash", "prospective Level 2 preflight");
  requireCondition(prospectivePreflight.status === "ready-awaiting-explicit-paid-approval" && allTrue(prospectivePreflight.checks), "Prospective Level 2 preflight is incomplete");
  const empiricalSummaryExists = fs.existsSync(path.join(root, "artifacts/fleet/prospective-model-campaign-v1/model-run/summary.json"));
  requireCondition(empiricalSummaryExists === false, "An empirical Level 2 artifact exists and needs a separate evidence audit");
  return { status: "bounded-deterministic-mechanism-complete", planningProfiles: 5, prospectiveRunnerReady: true, empiricalFreshModelFleetComplete: false, customerFleetComplete: false };
}

export function createTechnicalReadinessAudit({ repositoryRoot = "." } = {}) {
  const root = path.resolve(repositoryRoot);
  const audit = {
    schemaVersion: "das.technical-readiness-audit.v1",
    generatedAt: new Date().toISOString(),
    level1: verifyLevel1(root),
    commercial: verifyCommercial(root),
    level15: verifyLevel15(root),
    level2: verifyLevel2(root),
    externalGates: {
      prospectiveHumanSetupStudy: "not-completed",
      freshCommercialModelComparison: "not-completed-separate-paid-approval-required",
      empiricalLevel15Lifecycle: "not-completed-separate-paid-approval-required",
      prospectiveModelBackedLevel2: "not-completed-separate-paid-approval-required",
      customerDeployment: "not-completed",
      productionReliability: "not-established",
      marketDemand: "not-established",
    },
    verdict: "All currently claimed zero-cost local mechanisms and their evidence chains pass integrity checks. The remaining technical evidence gates require separately approved model campaigns; customer, production and market claims require external evidence.",
  };
  audit.auditHash = digest(audit);
  return audit;
}

export function assertTechnicalReadinessAudit(audit) {
  requireCondition(audit?.schemaVersion === "das.technical-readiness-audit.v1", "Unsupported technical readiness audit");
  requireCondition(audit.auditHash && digest(withoutHash(audit, "auditHash")) === audit.auditHash, "Technical readiness audit integrity mismatch");
  return true;
}
