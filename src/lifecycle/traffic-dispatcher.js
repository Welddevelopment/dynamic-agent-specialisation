import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { assertVerifiedObservation } from "./verified-monitor.js";

function assertObservation({ observation, candidate, taskId, mode, canaryFraction = null }) {
  assertVerifiedObservation(observation);
  if (observation.specialistId !== candidate.id || observation.specialistVersion !== candidate.version) throw new Error("Runner observation belongs to the wrong specialist");
  if (observation.caseId !== taskId) throw new Error("Runner observation belongs to the wrong task");
  if (observation.executionMode !== mode) throw new Error(`Runner observation must use ${mode} mode`);
  if (mode === "shadow-no-authority" && observation.businessWritesCommitted !== 0) throw new Error("Shadow runner committed a business write");
  if (mode === "canary" && observation.canaryFraction !== canaryFraction) throw new Error("Canary runner used the wrong authorized traffic fraction");
}

export class LifecycleTrafficDispatcher {
  #decisions = new Map();
  #events = [];

  constructor({ registry, replacementController, runActive, runChallenger, now = () => new Date().toISOString(), state = null }) {
    if (typeof runActive !== "function" || typeof runChallenger !== "function") throw new Error("Lifecycle dispatcher requires active and challenger runners");
    this.registry = registry;
    this.replacementController = replacementController;
    this.runActive = runActive;
    this.runChallenger = runChallenger;
    this.now = now;
    if (state) this.#restore(state);
  }

  async dispatch({ challengerId, taskId, task }) {
    if (!challengerId || !taskId) throw new Error("Dispatch requires a challenger and stable task ID");
    const prior = this.#decisions.get(`${challengerId}:${taskId}`);
    if (prior) return { ...structuredClone(prior), replayed: true };
    const challengerState = this.replacementController.state(challengerId);
    if (!challengerState) throw new Error("Unknown replacement challenger");
    const current = this.registry.latest(challengerState.candidate.roleId);
    if (!current) throw new Error("No active specialist exists for dispatch role");
    const lifecycleSnapshot = this.replacementController.snapshot();
    if (lifecycleSnapshot.activeRecordHash !== current.recordHash) throw new Error("Replacement lifecycle is stale relative to the active registry");

    let decision;
    if (challengerState.stage === "shadow-running") decision = await this.#shadow({ current, challengerState, taskId, task });
    else if (challengerState.stage === "canary-running") decision = await this.#canary({ current, challengerState, challengerId, taskId, task });
    else if (["promoted", "rolled-back", "quarantined"].includes(challengerState.stage)) decision = await this.#activeOnly({ current, challengerState, taskId, task });
    else throw new Error(`Traffic cannot run while challenger is in ${challengerState.stage}`);

    decision = { schemaVersion: "das.lifecycle-dispatch.v1", challengerId, taskId, lifecycleStage: challengerState.stage, activeRecordHash: current.recordHash, decidedAt: this.now(), ...decision };
    decision.decisionHash = digest(decision);
    this.#decisions.set(`${challengerId}:${taskId}`, structuredClone(decision));
    this.#events.push({ at: this.now(), type: "traffic.dispatched", challengerId, taskId, route: decision.route, decisionHash: decision.decisionHash });
    return structuredClone(decision);
  }

  decisions() { return structuredClone([...this.#decisions.values()]); }
  events() { return structuredClone(this.#events); }

  snapshot() {
    const payload = { schemaVersion: "das.lifecycle-traffic.v1", decisions: this.decisions(), events: this.events() };
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
    return new LifecycleTrafficDispatcher({ ...options, state });
  }

  async #shadow({ current, challengerState, taskId, task }) {
    const activeObservation = await this.runActive({ candidate: structuredClone(current.selected.candidate), taskId, task: structuredClone(task), executionMode: "live" });
    assertObservation({ observation: activeObservation, candidate: current.selected.candidate, taskId, mode: "live" });
    const shadowObservation = await this.runChallenger({ candidate: structuredClone(challengerState.candidate), taskId, task: structuredClone(task), executionMode: "shadow-no-authority" });
    assertObservation({ observation: shadowObservation, candidate: challengerState.candidate, taskId, mode: "shadow-no-authority" });
    this.replacementController.recordShadow(challengerState.candidate.id, shadowObservation);
    return { route: "active-plus-zero-authority-shadow", executedCandidateId: current.selected.candidate.id, activeObservation, challengerObservation: shadowObservation };
  }

  async #canary({ current, challengerState, challengerId, taskId, task }) {
    const fraction = challengerState.canary?.fraction;
    if (!(fraction > 0)) throw new Error("Canary stage lacks an authorized traffic fraction");
    const priorCanaries = this.decisions().filter((item) => item.challengerId === challengerId && item.lifecycleStage === "canary-running");
    const challengerRuns = priorCanaries.filter((item) => item.route === "bounded-canary").length;
    const nextTotal = priorCanaries.length + 1;
    const challengerAllowed = challengerRuns < Math.floor(nextTotal * fraction);
    if (!challengerAllowed) {
      const activeObservation = await this.runActive({ candidate: structuredClone(current.selected.candidate), taskId, task: structuredClone(task), executionMode: "live" });
      assertObservation({ observation: activeObservation, candidate: current.selected.candidate, taskId, mode: "live" });
      return { route: "active-canary-control", executedCandidateId: current.selected.candidate.id, activeObservation, challengerObservation: null, authorizedCanaryFraction: fraction };
    }
    const challengerObservation = await this.runChallenger({ candidate: structuredClone(challengerState.candidate), taskId, task: structuredClone(task), executionMode: "canary", canaryFraction: fraction });
    assertObservation({ observation: challengerObservation, candidate: challengerState.candidate, taskId, mode: "canary", canaryFraction: fraction });
    this.replacementController.recordCanary(challengerState.candidate.id, challengerObservation);
    return { route: "bounded-canary", executedCandidateId: challengerState.candidate.id, activeObservation: null, challengerObservation, authorizedCanaryFraction: fraction };
  }

  async #activeOnly({ current, challengerState, taskId, task }) {
    const activeObservation = await this.runActive({ candidate: structuredClone(current.selected.candidate), taskId, task: structuredClone(task), executionMode: "live" });
    assertObservation({ observation: activeObservation, candidate: current.selected.candidate, taskId, mode: "live" });
    return { route: challengerState.stage === "promoted" ? "promoted-active" : "proven-active", executedCandidateId: current.selected.candidate.id, activeObservation, challengerObservation: null };
  }

  #restore(state) {
    if (state.schemaVersion !== "das.lifecycle-traffic.v1") throw new Error("Unsupported lifecycle traffic schema");
    const { integrityHash, ...payload } = state;
    if (digest(payload) !== integrityHash) throw new Error("Lifecycle traffic integrity mismatch");
    for (const decision of state.decisions ?? []) {
      const copy = structuredClone(decision);
      const expected = copy.decisionHash;
      delete copy.decisionHash;
      if (digest(copy) !== expected) throw new Error("Lifecycle traffic decision integrity mismatch");
      this.#decisions.set(`${decision.challengerId}:${decision.taskId}`, structuredClone(decision));
    }
    this.#events = structuredClone(state.events ?? []);
  }
}
