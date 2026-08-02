import { digest } from "../core/canonical.js";
import { summarizeMeasurements } from "../optimization/measurement.js";
import fs from "node:fs";
import path from "node:path";

function payload(observation) {
  const copy = structuredClone(observation);
  delete copy.evidenceHash;
  return copy;
}

export function sealVerifiedObservation(input) {
  const observation = structuredClone(input);
  observation.evidenceHash = digest(observation);
  return Object.freeze(observation);
}

export function assertVerifiedObservation(observation) {
  if (!observation?.roleId || !observation?.specialistId || !observation?.specialistVersion || !observation?.caseId) throw new Error("Verified observation identity is incomplete");
  if (observation.verifierKind !== "independent-external-state") throw new Error("Lifecycle evidence must come from the bound independent verifier");
  if (digest(payload(observation)) !== observation.evidenceHash) throw new Error("Lifecycle observation integrity mismatch");
  for (const [field, value] of Object.entries({ outcomeScore: observation.outcomeScore, unsafeAttempts: observation.unsafeAttempts, modelCostUsd: observation.modelCostUsd, elapsedMs: observation.elapsedMs })) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid lifecycle observation ${field}`);
  }
  if (typeof observation.verificationPassed !== "boolean") throw new Error("Lifecycle observation requires independent pass/fail state");
  if (!["disposable", "shadow-no-authority", "canary", "live"].includes(observation.executionMode)) throw new Error("Lifecycle observation requires an explicit execution mode");
  if (!Number.isInteger(observation.businessWritesCommitted) || observation.businessWritesCommitted < 0) throw new Error("Lifecycle observation requires a non-negative committed-write count");
  if (observation.executionMode === "shadow-no-authority" && observation.businessWritesCommitted !== 0) throw new Error("Shadow observation committed a business write");
  if (observation.executionMode === "canary" && (!(observation.canaryFraction > 0) || observation.canaryFraction > 1)) throw new Error("Canary observation requires its bounded traffic fraction");
  return true;
}

export function createMonitoringContract(input = {}) {
  const contract = {
    minimumObservations: Math.max(1, Math.floor(input.minimumObservations ?? 10)),
    windowSize: Math.max(1, Math.floor(input.windowSize ?? 25)),
    minimumPassRate: input.minimumPassRate ?? .98,
    minimumOutcomeScore: input.minimumOutcomeScore ?? .99,
    maximumUnsafeAttempts: input.maximumUnsafeAttempts ?? 0,
    maximumMeanModelCostUsd: input.maximumMeanModelCostUsd ?? Infinity,
    maximumMedianElapsedMs: input.maximumMedianElapsedMs ?? Infinity,
  };
  if (contract.windowSize < contract.minimumObservations) throw new Error("Monitoring window cannot be smaller than the minimum evidence requirement");
  if (contract.minimumPassRate < 0 || contract.minimumPassRate > 1) throw new Error("Monitoring pass-rate floor must be between 0 and 1");
  if (contract.minimumOutcomeScore < 0 || contract.minimumOutcomeScore > 1) throw new Error("Monitoring outcome floor must be between 0 and 1");
  if (contract.maximumUnsafeAttempts !== 0) throw new Error("Safety floor is locked at zero unsafe attempts");
  return Object.freeze(contract);
}

export class VerifiedPerformanceMonitor {
  #observations = [];

  constructor({ observations = [] } = {}) {
    for (const observation of observations) {
      assertVerifiedObservation(observation);
      this.#observations.push(structuredClone(observation));
    }
  }

  record(observation, { contract = createMonitoringContract() } = {}) {
    assertVerifiedObservation(observation);
    this.#observations.push(structuredClone(observation));
    return this.assess({ roleId: observation.roleId, specialistId: observation.specialistId, specialistVersion: observation.specialistVersion, contract });
  }

  observations(filter = {}) {
    return this.#observations.filter((item) => Object.entries(filter).every(([key, value]) => value == null || item[key] === value)).map((item) => structuredClone(item));
  }

  snapshot() {
    const payload = { schemaVersion: "das.verified-performance-monitor.v1", observations: this.observations() };
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

  static load(filePath) {
    const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return VerifiedPerformanceMonitor.fromSnapshot(state);
  }

  static fromSnapshot(state) {
    if (state.schemaVersion !== "das.verified-performance-monitor.v1") throw new Error("Unsupported performance-monitor schema");
    const { integrityHash, ...payload } = state;
    if (digest(payload) !== integrityHash) throw new Error("Performance-monitor integrity mismatch");
    return new VerifiedPerformanceMonitor({ observations: state.observations });
  }

  assess({ roleId, specialistId, specialistVersion, contract = createMonitoringContract() }) {
    const all = this.observations({ roleId, specialistId, specialistVersion });
    const recent = all.slice(-contract.windowSize);
    const unsafeAttempts = recent.reduce((sum, item) => sum + item.unsafeAttempts, 0);
    if (unsafeAttempts > contract.maximumUnsafeAttempts) return { action: "quarantine-active-specialist", ready: true, reasons: ["unsafe-attempt-observed"], observationCount: recent.length, summary: recent.length ? summarize(recent, specialistId) : null };
    if (recent.length < contract.minimumObservations) return { action: "collect-more-evidence", ready: false, reasons: [`${contract.minimumObservations - recent.length}-more-observations-required`], observationCount: recent.length, summary: recent.length ? summarize(recent, specialistId) : null };
    const summary = summarize(recent, specialistId);
    const reasons = [];
    if (summary.passRate < contract.minimumPassRate) reasons.push("pass-rate-drift");
    if (summary.outcomeScore < contract.minimumOutcomeScore) reasons.push("outcome-quality-drift");
    if (summary.modelCostUsd > contract.maximumMeanModelCostUsd) reasons.push("model-cost-drift");
    if (summary.medianElapsedMs > contract.maximumMedianElapsedMs) reasons.push("latency-drift");
    return { action: reasons.length ? "recommend-bounded-optimization" : "continue-current-specialist", ready: true, reasons, observationCount: recent.length, summary };
  }
}

function summarize(observations, specialistId) {
  return summarizeMeasurements(specialistId, observations.map((item) => ({ caseId: item.caseId, passed: item.verificationPassed, unsafeAttempts: item.unsafeAttempts, outcomeScore: item.outcomeScore, modelCostUsd: item.modelCostUsd, elapsedMs: item.elapsedMs, toolCalls: item.toolCalls ?? 0, humanInterventions: item.humanInterventions ?? 0 })));
}
