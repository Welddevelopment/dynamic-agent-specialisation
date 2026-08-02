import { digest } from "../core/canonical.js";
import { assertVerifiedObservation } from "./verified-monitor.js";
import { summarizeMeasurements } from "../optimization/measurement.js";
import fs from "node:fs";
import path from "node:path";

export function createReplacementContract(input = {}) {
  const contract = {
    minimumOfflineObservations: Math.max(1, Math.floor(input.minimumOfflineObservations ?? 3)),
    minimumShadowObservations: Math.max(1, Math.floor(input.minimumShadowObservations ?? 5)),
    minimumCanaryObservations: Math.max(1, Math.floor(input.minimumCanaryObservations ?? 5)),
    maximumCanaryFraction: input.maximumCanaryFraction ?? .1,
    minimumPassRate: input.minimumPassRate ?? 1,
    minimumOutcomeScore: input.minimumOutcomeScore ?? 1,
    maximumUnsafeAttempts: 0,
  };
  if (!(contract.maximumCanaryFraction > 0 && contract.maximumCanaryFraction <= .25)) throw new Error("Canary fraction must be above zero and no more than 25%");
  if (contract.minimumPassRate < 0 || contract.minimumPassRate > 1 || contract.minimumOutcomeScore < 0 || contract.minimumOutcomeScore > 1) throw new Error("Replacement quality floors must be between zero and one");
  return Object.freeze(contract);
}

export class SafeReplacementController {
  #challengers = new Map();
  #events = [];

  constructor({ registry, role, compatibility, contract = createReplacementContract(), now = () => new Date().toISOString(), state = null }) {
    this.registry = registry;
    this.role = role;
    this.compatibility = compatibility;
    this.contract = contract;
    this.now = now;
    if (!registry.latest(role.id)) throw new Error("Replacement lifecycle requires an active registry selection");
    if (state) this.#restore(state);
  }

  stage({ candidate, offlineObservations, evidenceReferences = [] }) {
    const current = this.registry.latest(this.role.id);
    if (candidate.roleId !== this.role.id) throw new Error("Challenger role mismatch");
    if (candidate.fingerprint === current.selected.candidate.fingerprint) throw new Error("Current specialist cannot challenge itself");
    const summary = this.#summarize(candidate, offlineObservations, "offline", this.contract.minimumOfflineObservations, "disposable");
    this.#assertGate(summary, "offline");
    const state = { candidate: structuredClone(candidate), stage: "offline-passed", offline: summary, shadowObservations: [], canaryObservations: [], evidenceReferences: structuredClone(evidenceReferences), canary: null, promotedFrom: null };
    this.#challengers.set(candidate.id, state);
    this.#event("challenger.offline-passed", { candidateId: candidate.id, summary });
    return this.state(candidate.id);
  }

  beginShadow(candidateId) {
    const challenger = this.#requireStage(candidateId, "offline-passed");
    challenger.stage = "shadow-running";
    this.#event("challenger.shadow-started", { candidateId });
    return this.state(candidateId);
  }

  recordShadow(candidateId, observation) {
    const challenger = this.#requireStage(candidateId, "shadow-running");
    this.#assertObservation(challenger.candidate, observation, "shadow-no-authority");
    challenger.shadowObservations.push(structuredClone(observation));
    if (observation.unsafeAttempts > 0) this.#quarantine(challenger, "unsafe-shadow-observation");
    return this.state(candidateId);
  }

  authorizeCanary({ candidateId, fraction, authorizedBy }) {
    const challenger = this.#requireStage(candidateId, "shadow-running");
    if (!authorizedBy) throw new Error("Canary requires an accountable human authorization");
    if (!(fraction > 0 && fraction <= this.contract.maximumCanaryFraction)) throw new Error("Requested canary fraction exceeds the bounded contract");
    const summary = this.#summarize(challenger.candidate, challenger.shadowObservations, "shadow", this.contract.minimumShadowObservations, "shadow-no-authority");
    this.#assertGate(summary, "shadow");
    challenger.shadow = summary;
    challenger.canary = { fraction, authorizedBy, authorizedAt: this.now() };
    challenger.stage = "canary-running";
    this.#event("challenger.canary-authorized", { candidateId, fraction, authorizedBy, summary });
    return this.state(candidateId);
  }

  recordCanary(candidateId, observation) {
    const challenger = this.#requireStage(candidateId, "canary-running");
    this.#assertObservation(challenger.candidate, observation, "canary");
    if (observation.canaryFraction > challenger.canary.fraction) throw new Error("Canary observation exceeds the authorized traffic fraction");
    challenger.canaryObservations.push(structuredClone(observation));
    if (observation.unsafeAttempts > 0) this.#quarantine(challenger, "unsafe-canary-observation");
    return this.state(candidateId);
  }

  promote(candidateId) {
    const challenger = this.#requireStage(candidateId, "canary-running");
    const summary = this.#summarize(challenger.candidate, challenger.canaryObservations, "canary", this.contract.minimumCanaryObservations, "canary");
    this.#assertGate(summary, "canary");
    const previous = this.registry.latest(this.role.id);
    const record = this.registry.registerSelection({
      role: this.role,
      selectedCandidate: challenger.candidate,
      alternatives: [{ candidate: previous.selected.candidate, evidence: previous.selected.evidence }, ...previous.alternatives],
      decision: "activate-compiler-specialist",
      evidence: { candidateId: challenger.candidate.id, successRate: summary.passRate, unsafeAttempts: summary.unsafeAttempts, lifecycle: { offline: challenger.offline, shadow: challenger.shadow, canary: summary } },
      compatibility: this.compatibility,
      evidenceReferences: challenger.evidenceReferences,
    });
    challenger.canarySummary = summary;
    challenger.promotedFrom = previous;
    challenger.stage = "promoted";
    this.#event("challenger.promoted", { candidateId, selectionVersion: record.selectionVersion, recordHash: record.recordHash });
    return { state: this.state(candidateId), selection: record };
  }

  rollback({ candidateId, monitoringAssessment, requestedBy }) {
    const challenger = this.#requireStage(candidateId, "promoted");
    if (!requestedBy) throw new Error("Rollback requires an accountable requester or monitor identity");
    if (!["quarantine-active-specialist", "recommend-bounded-optimization"].includes(monitoringAssessment?.action)) throw new Error("Rollback requires independently monitored regression evidence");
    const previous = challenger.promotedFrom;
    const record = this.registry.registerSelection({
      role: this.role,
      selectedCandidate: previous.selected.candidate,
      alternatives: [{ candidate: challenger.candidate, evidence: { candidateId: challenger.candidate.id, lifecycleRegression: monitoringAssessment } }, ...previous.alternatives],
      decision: "rollback-to-proven-specialist",
      evidence: previous.selected.evidence,
      compatibility: this.compatibility,
      evidenceReferences: previous.evidenceReferences,
    });
    challenger.stage = "rolled-back";
    challenger.rollback = { requestedBy, at: this.now(), monitoringAssessment: structuredClone(monitoringAssessment), restoredRecordHash: record.recordHash };
    this.#event("challenger.rolled-back", { candidateId, requestedBy, restoredCandidateId: previous.selected.candidate.id });
    return { state: this.state(candidateId), selection: record };
  }

  state(candidateId) { const state = this.#challengers.get(candidateId); return state ? structuredClone(state) : null; }
  events() { return structuredClone(this.#events); }
  snapshot() {
    const payload = { schemaVersion: "das.replacement-lifecycle.v1", roleId: this.role.id, activeRecordHash: this.registry.latest(this.role.id)?.recordHash ?? null, challengers: [...this.#challengers.values()].map((item) => structuredClone(item)), events: this.events() };
    return { ...payload, integrityHash: digest(payload) };
  }

  save(filePath) {
    const state = this.snapshot();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, filePath);
    return state;
  }

  static load(filePath, options) {
    const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return new SafeReplacementController({ ...options, state });
  }

  #summarize(candidate, observations, stage, minimum, executionMode) {
    if (observations.length < minimum) throw new Error(`${stage} requires at least ${minimum} verified observations`);
    for (const observation of observations) this.#assertObservation(candidate, observation, executionMode);
    return summarizeMeasurements(candidate.id, observations.map((item) => ({ caseId: item.caseId, passed: item.verificationPassed, unsafeAttempts: item.unsafeAttempts, outcomeScore: item.outcomeScore, modelCostUsd: item.modelCostUsd, elapsedMs: item.elapsedMs, toolCalls: item.toolCalls ?? 0, humanInterventions: item.humanInterventions ?? 0 })));
  }
  #assertGate(summary, stage) {
    if (summary.unsafeAttempts > this.contract.maximumUnsafeAttempts) throw new Error(`${stage} safety gate failed`);
    if (summary.passRate < this.contract.minimumPassRate) throw new Error(`${stage} pass-rate gate failed`);
    if (summary.outcomeScore < this.contract.minimumOutcomeScore) throw new Error(`${stage} outcome gate failed`);
  }
  #assertObservation(candidate, observation, executionMode) {
    assertVerifiedObservation(observation);
    if (observation.roleId !== this.role.id || observation.specialistId !== candidate.id || observation.specialistVersion !== candidate.version) throw new Error("Lifecycle observation does not match challenger");
    if (observation.executionMode !== executionMode) throw new Error(`Lifecycle observation must use ${executionMode} mode`);
  }
  #requireStage(candidateId, stage) {
    const challenger = this.#challengers.get(candidateId);
    if (!challenger) throw new Error("Unknown challenger");
    if (challenger.stage !== stage) throw new Error(`Challenger must be in ${stage}, not ${challenger.stage}`);
    return challenger;
  }
  #quarantine(challenger, reason) {
    challenger.stage = "quarantined";
    challenger.quarantineReason = reason;
    this.#event("challenger.quarantined", { candidateId: challenger.candidate.id, reason });
  }
  #event(type, detail) { this.#events.push({ at: this.now(), type, ...structuredClone(detail) }); }
  #restore(state) {
    if (state.schemaVersion !== "das.replacement-lifecycle.v1" || state.roleId !== this.role.id) throw new Error("Replacement lifecycle state does not match this role");
    const { integrityHash, ...payload } = state;
    if (digest(payload) !== integrityHash) throw new Error("Replacement lifecycle integrity mismatch");
    if (state.activeRecordHash !== this.registry.latest(this.role.id)?.recordHash) throw new Error("Replacement lifecycle active selection does not match the registry");
    for (const challenger of state.challengers ?? []) {
      if (challenger.candidate?.roleId !== this.role.id) throw new Error("Persisted challenger role mismatch");
      this.#challengers.set(challenger.candidate.id, structuredClone(challenger));
    }
    this.#events = structuredClone(state.events ?? []);
  }
}
