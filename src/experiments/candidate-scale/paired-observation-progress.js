import { digest } from "../../core/canonical.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }

export function createPairedObservationProgress({ planHash, startedAt = new Date().toISOString() }) {
  return { schemaVersion: "das.candidate-scale-paired-observation-progress.v1", planHash, startedAt, entries: [] };
}

export function pairedObservationProgressKey({ planHash, phase, participantId, configurationHash, caseId, caseHash }) {
  return digest({ planHash, phase, participantId, configurationHash, caseId, caseHash });
}

export function assertPairedObservationProgress(progress, { planHash }) {
  requireCondition(progress?.schemaVersion === "das.candidate-scale-paired-observation-progress.v1" && progress.planHash === planHash, "Paired evaluation progress plan/schema mismatch");
  requireCondition(Number.isFinite(Date.parse(progress.startedAt)), "Paired evaluation progress needs a durable start time");
  const copy = structuredClone(progress); const expected = copy.integrityHash; delete copy.integrityHash;
  if (expected) requireCondition(digest(copy) === expected, "Paired evaluation progress integrity mismatch");
  for (const entry of progress.entries) requireCondition(entry.observationHash === digest(entry.observation), "Paired evaluation observation progress entry changed");
  return true;
}

export function sealPairedObservationProgress(progress) {
  const value = structuredClone(progress); delete value.integrityHash; value.integrityHash = digest(value); return value;
}

export function resumePairedObservation(progress, progressKey) {
  const entry = progress.entries.find((item) => item.progressKey === progressKey);
  if (!entry) return null;
  requireCondition(entry.observationHash === digest(entry.observation), "Paired resumed observation changed");
  return structuredClone(entry.observation);
}

export function recordPairedObservation(progress, progressKey, observation) {
  requireCondition(!progress.entries.some((entry) => entry.progressKey === progressKey), "Paired observation progress key already exists");
  progress.entries.push({ progressKey, observation: structuredClone(observation), observationHash: digest(observation) });
}

export function assertPairedEvaluationWallClock(progress, maximumWallClockMs, now = Date.now()) {
  requireCondition(now - Date.parse(progress.startedAt) <= maximumWallClockMs, "Paired evaluation reached its durable wall-clock limit");
}

