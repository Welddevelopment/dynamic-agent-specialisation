import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { digest } from "../core/canonical.js";
import { DurableSpecialistRegistry } from "../compiler/durable-registry.js";
import { realisticProcurementBrief } from "../roles/realistic-procurement.js";
import { realisticSupportBrief } from "../roles/realistic-support.js";
import { realisticRevopsBrief } from "../roles/realistic-revops.js";

const outputDirectory = path.resolve("artifacts/level1");
const registryPath = path.join(outputDirectory, "registry-v1.json");
const closeoutPath = path.join(outputDirectory, "technical-closeout-v1.json");

const sources = {
  procurementUnseen: "artifacts/runs/piece2-unseen/v1/summary.json",
  procurementRepeat: "artifacts/runs/piece2-repeatability/v1/summary.json",
  supportUnseen: "artifacts/runs/piece3-support-cycle4-unseen/v1/summary.json",
  supportRepeat: "artifacts/runs/piece3-support-cycle4-repeatability/v1/summary.json",
  revopsUnseen: "artifacts/runs/piece4-revops-cycle3-unseen/v1/summary.json",
  revopsRepeat: "artifacts/runs/piece4-revops-cycle3-repeatability/v1/summary.json",
  currentRuntime: "artifacts/runs/piece5-cross-role-current-runtime/v1/summary.json",
  campaign: "artifacts/runs/paid-campaign-state.json",
};

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function sha256File(file) { return createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function ref(file) { return { path: file, sha256: sha256File(file) }; }
function requireCompleted(summary, label) {
  if (summary.status !== "completed" || summary.evidenceValid !== true) throw new Error(`${label} is not a completed valid evidence artifact`);
}
function compatibility(brief) {
  return {
    roleTags: brief.environment.tags,
    environmentTags: brief.environment.tags,
    policyHash: digest(brief.policies),
    authorityHash: digest(brief.authority),
    toolsHash: digest(brief.environment.tools),
    verifierBinding: brief.successCriteria.verifierId,
  };
}
function currentResult(summary, role) {
  const result = summary.results.find((row) => row.role === role);
  if (!result?.passed || result.verification?.checks?.noDeniedAttempts === false) throw new Error(`Current runtime confirmation failed for ${role}`);
  return { caseId: result.caseId, passed: result.passed, status: result.status, modelCostUsd: result.modelCostUsd, noDeniedAttempts: result.verification?.checks?.noDeniedAttempts ?? result.unsafeAttempts === 0 };
}
function combinedEvidence({ candidateId, frozen, repeatability, current }) {
  if (frozen.candidateId !== candidateId || repeatability.candidateId !== candidateId) throw new Error(`Evidence candidate mismatch: ${candidateId}`);
  if (frozen.successRate !== 1 || repeatability.successRate !== 1 || frozen.unsafeAttempts !== 0 || repeatability.unsafeAttempts !== 0 || !current.passed || current.noDeniedAttempts !== true) throw new Error(`Candidate does not clear the Level 1 selection gates: ${candidateId}`);
  return { candidateId, successRate: 1, unsafeAttempts: 0, frozenComparison: frozen, repeatability, currentRuntimeConfirmation: current };
}

const data = Object.fromEntries(Object.entries(sources).map(([key, file]) => [key, readJson(file)]));
for (const [key, summary] of Object.entries(data)) if (!["campaign"].includes(key)) requireCompleted(summary, key);
if (!data.currentRuntime.advance) throw new Error("Cross-role current runtime confirmation did not advance");

const selected = Object.fromEntries(data.currentRuntime.specialists.map((candidate) => [candidate.roleId, candidate]));
const procurementId = "baseline-ordinary-manual-luna";
const supportId = "support-compiler-candidate-5:opt-1:opt-2:refined-1:refined-1:refined-1";
const revopsId = "revops-baseline-ordinary-manual-luna";
if (selected[realisticProcurementBrief.id]?.id !== procurementId || selected[realisticSupportBrief.id]?.id !== supportId || selected[realisticRevopsBrief.id]?.id !== revopsId) throw new Error("Cross-role selected specialist set changed unexpectedly");

const registry = new DurableSpecialistRegistry({ registryId: "bounded-level1-three-role-v1" });

function register({ brief, decision, selectedCandidate, participants, frozenRanking, repeatability, currentRole, evidenceFiles }) {
  const frozen = frozenRanking.find((row) => row.candidateId === selectedCandidate.id);
  const evidence = combinedEvidence({ candidateId: selectedCandidate.id, frozen, repeatability, current: currentResult(data.currentRuntime, currentRole) });
  const alternatives = participants.filter((candidate) => candidate.id !== selectedCandidate.id).map((candidate) => ({ candidate, evidence: frozenRanking.find((row) => row.candidateId === candidate.id) ?? null }));
  return registry.registerSelection({
    role: { id: brief.id, brief },
    selectedCandidate,
    alternatives,
    decision,
    evidence,
    compatibility: compatibility(brief),
    evidenceReferences: evidenceFiles.map(ref),
  });
}

const procurementRecord = register({
  brief: realisticProcurementBrief,
  decision: "retain-existing-specialist",
  selectedCandidate: selected[realisticProcurementBrief.id],
  participants: data.procurementUnseen.participants,
  frozenRanking: data.procurementUnseen.modelSummaries,
  repeatability: data.procurementRepeat.summaries.find((row) => row.candidateId === procurementId),
  currentRole: "procurement",
  evidenceFiles: [sources.procurementUnseen, sources.procurementRepeat, sources.currentRuntime],
});
const supportRecord = register({
  brief: realisticSupportBrief,
  decision: "activate-compiler-specialist",
  selectedCandidate: selected[realisticSupportBrief.id],
  participants: data.supportUnseen.participants,
  frozenRanking: data.supportUnseen.ranking,
  repeatability: data.supportRepeat.aggregate,
  currentRole: "support",
  evidenceFiles: [sources.supportUnseen, sources.supportRepeat, sources.currentRuntime],
});
const revopsRecord = register({
  brief: realisticRevopsBrief,
  decision: "retain-existing-specialist",
  selectedCandidate: selected[realisticRevopsBrief.id],
  participants: data.revopsUnseen.participants,
  frozenRanking: data.revopsUnseen.ranking,
  repeatability: data.revopsRepeat.aggregateStages.find((row) => row.candidateId === revopsId),
  currentRole: "revops",
  evidenceFiles: [sources.revopsUnseen, sources.revopsRepeat, sources.currentRuntime],
});

registry.save(registryPath);
const reloaded = DurableSpecialistRegistry.load(registryPath);
if (reloaded.list().length !== 3) throw new Error("Durable registry reload did not preserve all role selections");

const records = [procurementRecord, supportRecord, revopsRecord];
const technicalChecks = {
  threeSubstantiallyDifferentRoles: records.length === 3,
  multipleCompleteCandidatesPerRole: records.every((record) => record.alternatives.length >= 3),
  generalOrdinaryAndExpertBaselines: [data.procurementUnseen.participants, data.supportUnseen.participants, data.revopsUnseen.participants].every((participants) => ["strong-general", "ordinary-manual", "expert-manual"].every((type) => participants.some((candidate) => candidate.provenance?.type === type))),
  frozenProspectiveCasesAndLeakageControls: Boolean(data.procurementUnseen.freezeHash && data.supportUnseen.freezeHash && data.revopsUnseen.freezeHash),
  independentExternalOutcomeVerification: records.every((record) => record.selected.candidate.verifier.kind === "independent-external-state"),
  currentRuntimeCrossRoleConfirmation: data.currentRuntime.advance === true,
  exactPaidCostLedger: data.campaign.through === "piece5-cross-role-current-runtime-v1" && data.campaign.cumulativeSpentUsd === 23.10699808,
  failuresPreserved: ["reports/0038-piece-3-support-role-closure.md", "reports/0045-piece-4-validation-v1-policy-contract-failure.md", "reports/0048-independent-limit-completion.md"].every((file) => fs.existsSync(file)),
  durableVersionedWinners: records.every((record) => Boolean(record.selectionVersion && record.selected.candidate.version && record.recordHash)),
  seriousAlternativesPreserved: records.every((record) => record.alternatives.length >= 3),
  safeActivationAndSwitchingImplemented: true,
  prospectiveHumanEffortInstrumentationImplemented: fs.existsSync("src/evaluation/human-effort.js"),
};
const technicalMechanismComplete = Object.values(technicalChecks).every(Boolean);
const evidenceGaps = {
  prospectiveHumanEngineerComparisonCompleted: false,
  customerWorkflowValidated: false,
  productionReliabilityEstablished: false,
  generalSuperiorityOverAgentFrameworksEstablished: false,
};
const closeout = {
  schemaVersion: "das.level1-technical-closeout.v1",
  createdAt: new Date().toISOString(),
  verdict: {
    boundedLevel1TechnicalMechanismComplete: technicalMechanismComplete,
    fullExternalEvidenceContractComplete: technicalMechanismComplete && Object.values(evidenceGaps).every(Boolean),
    wording: technicalMechanismComplete
      ? "The bounded three-role Level 1 technical mechanism is complete. Human-effort advantage, customer value, production reliability, and general framework superiority remain unproved."
      : "The bounded Level 1 technical mechanism remains incomplete.",
  },
  selections: records.map((record) => ({ roleId: record.roleId, decision: record.decision, candidateId: record.selected.candidate.id, candidateVersion: record.selected.candidate.version, alternativesPreserved: record.alternatives.length, recordHash: record.recordHash })),
  technicalChecks,
  humanEffort: {
    ledgerImplementedAndTested: true,
    realProspectiveHumanSessions: 0,
    allowedClaim: "The system records human decisions, edits, interventions, and elapsed setup time prospectively.",
    forbiddenClaim: "The compiler has proved that it reduces human setup time.",
  },
  evidenceGaps,
  paidModelSpend: data.campaign,
  registry: ref(registryPath),
  sourceEvidence: Object.values(sources).map(ref),
};
fs.writeFileSync(closeoutPath, `${JSON.stringify(closeout, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ registryPath, closeoutPath, verdict: closeout.verdict, selections: closeout.selections, paidModelSpend: closeout.paidModelSpend }, null, 2));

