import fs from "node:fs";
import path from "node:path";
import { createImprovementContract } from "../optimization/improvement-contract.js";

const profiles = {
  early: { maximumConsecutiveRoundsWithoutMaterialProgress: 1, minimumMaterialProgress: .02, minimumEstimatedSuccessProbability: .35 },
  balanced: { maximumConsecutiveRoundsWithoutMaterialProgress: 2, minimumMaterialProgress: .01, minimumEstimatedSuccessProbability: .15 },
  persistent: { maximumConsecutiveRoundsWithoutMaterialProgress: 4, minimumMaterialProgress: .002, minimumEstimatedSuccessProbability: .03 },
};

function defaultState() {
  return { schemaVersion: 1, enabled: false, draft: null, activeRun: null, completedRuns: [], events: [] };
}

function boundedNumber(value, { name, min, max }) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return number;
}

export function consoleInputToContract(input) {
  const objectiveInput = Array.isArray(input.objectives) ? input.objectives.filter((item) => item.enabled !== false) : [];
  const objectives = objectiveInput.map((item) => ({
    metric: item.metric,
    direction: item.direction,
    minimumRelativeImprovement: boundedNumber(item.minimumRelativeImprovement, { name: `${item.metric} improvement`, min: 0, max: .95 }),
  }));
  const persistence = input.persistence ?? "balanced";
  if (!profiles[persistence]) throw new Error("Unknown search persistence profile");
  return createImprovementContract({
    id: input.id ?? `optional-improvement-${Date.now()}`,
    baselineId: input.baselineId,
    objectives,
    qualityFloor: {
      minimumPassRate: boundedNumber(input.minimumPassRate ?? 1, { name: "Minimum pass rate", min: 0, max: 1 }),
      minimumOutcomeScoreRatio: boundedNumber(input.minimumOutcomeScoreRatio ?? 1, { name: "Minimum outcome score", min: 0, max: 2 }),
      maximumUnsafeAttempts: 0,
    },
    limits: {
      maximumRounds: boundedNumber(input.maximumRounds ?? 4, { name: "Maximum rounds", min: 1, max: 50 }),
      maximumRefinementsPerRound: boundedNumber(input.maximumRefinementsPerRound ?? 2, { name: "Refinements per round", min: 1, max: 10 }),
      maximumModelSpendUsd: boundedNumber(input.maximumModelSpendUsd, { name: "Hard model budget", min: 0, max: 100_000 }),
      maximumWallClockMs: boundedNumber(input.maximumWallClockMinutes, { name: "Maximum runtime", min: 1, max: 10_080 }) * 60_000,
      minimumRepeatedObservations: boundedNumber(input.minimumRepeatedObservations ?? 3, { name: "Minimum repeats", min: 1, max: 100 }),
    },
    stopPolicy: { ...profiles[persistence] },
  });
}

export class ImprovementConsoleStore {
  constructor({ filePath = null, runner = null, now = () => new Date().toISOString() } = {}) {
    this.filePath = filePath;
    this.runner = runner;
    this.now = now;
    this.state = this.#load();
  }
  #load() {
    if (!this.filePath || !fs.existsSync(this.filePath)) return defaultState();
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    return { ...defaultState(), ...parsed };
  }
  #save() {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }
  #event(type, detail = {}) {
    this.state.events.push({ at: this.now(), type, ...structuredClone(detail) });
    if (this.state.events.length > 1_000) this.state.events.splice(0, this.state.events.length - 1_000);
  }
  configure(input) {
    const contract = consoleInputToContract(input);
    this.state.enabled = Boolean(input.enabled);
    this.state.draft = { contract, persistence: input.persistence ?? "balanced", configuredAt: this.now() };
    this.#event("improvement.configuration-saved", { enabled: this.state.enabled, contractId: contract.id });
    this.#save();
    return this.snapshot();
  }
  disable() {
    this.state.enabled = false;
    this.#event("improvement.disabled", { activeRunUnaffected: Boolean(this.state.activeRun) });
    this.#save();
    return this.snapshot();
  }
  async start({ confirmation }) {
    if (!this.state.enabled || !this.state.draft) throw new Error("Optional improvement is not enabled and configured");
    if (confirmation !== "START_OPTIONAL_IMPROVEMENT") throw new Error("Explicit start confirmation is required");
    if (this.state.activeRun) throw new Error("An improvement run is already active");
    if (!this.runner) throw new Error("No role-specific improvement runner is attached yet");
    const runId = `improvement-${Date.now()}`;
    this.state.activeRun = { id: runId, status: "starting", contract: this.state.draft.contract, startedAt: this.now(), events: [] };
    this.#event("improvement.started", { runId });
    this.#save();
    try {
      const result = await this.runner({ contract: this.state.draft.contract, onEvent: (event) => this.recordRunEvent(runId, event) });
      this.state.completedRuns.unshift({ ...this.state.activeRun, status: result.status, stoppedAt: this.now(), result });
      this.state.activeRun = null;
      this.#event("improvement.stopped", { runId, reason: result.stopReason });
      this.#save();
      return this.snapshot();
    } catch (error) {
      this.state.completedRuns.unshift({ ...this.state.activeRun, status: "failed", stoppedAt: this.now(), error: error.message });
      this.state.activeRun = null;
      this.#event("improvement.failed", { runId, error: error.message });
      this.#save();
      throw error;
    }
  }
  recordRunEvent(runId, event) {
    if (!this.state.activeRun || this.state.activeRun.id !== runId) throw new Error("Run is not active");
    this.state.activeRun.events.push({ at: this.now(), ...structuredClone(event) });
    this.state.activeRun.status = event.status ?? this.state.activeRun.status;
    this.#save();
  }
  snapshot() { return structuredClone(this.state); }
}
