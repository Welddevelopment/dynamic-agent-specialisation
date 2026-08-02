import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { createMonitoringContract, VerifiedPerformanceMonitor } from "./verified-monitor.js";

export class ContinuousSpecializationCoordinator {
  #configs = new Map();
  #requests = [];
  #halts = new Map();
  #events = [];

  constructor({ registry, monitor = new VerifiedPerformanceMonitor(), runner = null, now = () => new Date().toISOString(), state = null }) {
    this.registry = registry;
    this.monitor = monitor;
    this.runner = runner;
    this.now = now;
    if (state) this.#restore(state);
  }

  configureRole({ roleId, enabled = false, monitoringContract = createMonitoringContract(), improvementContract }) {
    if (!roleId || !this.registry.latest(roleId)) throw new Error("Continuous improvement requires a registered role specialist");
    if (!improvementContract?.id || !Number.isFinite(improvementContract.limits?.maximumModelSpendUsd)) throw new Error("A bounded improvement contract is required");
    const config = { roleId, enabled: Boolean(enabled), monitoringContract: structuredClone(monitoringContract), improvementContract: structuredClone(improvementContract), configuredAt: this.now() };
    this.#configs.set(roleId, config);
    this.#event("continuous-improvement.configured", { roleId, enabled: config.enabled, improvementContractId: improvementContract.id, hardBudgetUsd: improvementContract.limits.maximumModelSpendUsd });
    return structuredClone(config);
  }

  ingest(observation) {
    if (!["live", "canary"].includes(observation.executionMode)) throw new Error("Active monitoring accepts only live or canary execution evidence");
    const active = this.registry.latest(observation.roleId);
    if (!active) throw new Error("No registered specialist for observation role");
    if (active.selected.candidate.id !== observation.specialistId || active.selected.candidate.version !== observation.specialistVersion) throw new Error("Observation does not belong to the active specialist version");
    if (this.#halts.has(observation.roleId)) throw new Error("Role is halted pending a proven replacement or rollback");
    const config = this.#configs.get(observation.roleId);
    const contract = config?.monitoringContract ?? createMonitoringContract();
    const assessment = this.monitor.record(observation, { contract });
    this.#event("performance.observed", { roleId: observation.roleId, specialistId: observation.specialistId, evidenceHash: observation.evidenceHash, action: assessment.action, reasons: assessment.reasons });
    if (assessment.action === "quarantine-active-specialist") {
      const halt = { roleId: observation.roleId, specialistId: observation.specialistId, specialistVersion: observation.specialistVersion, activeRecordHash: active.recordHash, assessment: structuredClone(assessment), haltedAt: this.now() };
      this.#halts.set(observation.roleId, halt);
      this.#event("specialist.halted", halt);
      return { assessment, halt: structuredClone(halt), request: null };
    }
    if (assessment.action !== "recommend-bounded-optimization") return { assessment, halt: null, request: null };
    if (!config?.enabled) {
      this.#event("optimization.alert-only", { roleId: observation.roleId, reasons: assessment.reasons, note: "Optional optimization is disabled" });
      return { assessment, halt: null, request: null };
    }
    const existing = this.#requests.find((request) => request.roleId === observation.roleId && request.activeRecordHash === active.recordHash && ["awaiting-explicit-start", "running"].includes(request.status));
    if (existing) return { assessment, halt: null, request: structuredClone(existing) };
    const request = {
      id: `optimization-${digest({ roleId: observation.roleId, activeRecordHash: active.recordHash, assessment, contractId: config.improvementContract.id }).slice(0, 16)}`,
      roleId: observation.roleId,
      activeRecordHash: active.recordHash,
      baselineCandidateId: active.selected.candidate.id,
      status: "awaiting-explicit-start",
      trigger: structuredClone(assessment),
      improvementContract: structuredClone(config.improvementContract),
      createdAt: this.now(),
      result: null,
    };
    this.#requests.push(request);
    this.#event("optimization.request-created", { requestId: request.id, roleId: request.roleId, hardBudgetUsd: request.improvementContract.limits.maximumModelSpendUsd, reasons: assessment.reasons });
    return { assessment, halt: null, request: structuredClone(request) };
  }

  async start(requestId, { confirmation }) {
    const request = this.#requests.find((item) => item.id === requestId);
    if (!request || request.status !== "awaiting-explicit-start") throw new Error("Optimization request is not awaiting start");
    if (confirmation !== "START_BOUNDED_OPTIMIZATION") throw new Error("Explicit optimization confirmation is required");
    if (!this.runner) throw new Error("No verified role-specific optimization runner is attached");
    const current = this.registry.latest(request.roleId);
    if (current.recordHash !== request.activeRecordHash) throw new Error("Active specialist changed after the optimization request was created");
    request.status = "running";
    request.startedAt = this.now();
    this.#event("optimization.started", { requestId, roleId: request.roleId, hardBudgetUsd: request.improvementContract.limits.maximumModelSpendUsd });
    try {
      const result = await this.runner({ request: structuredClone(request), baselineSelection: current });
      request.result = structuredClone(result);
      request.status = result?.provisionalWinner ? "challenger-awaiting-offline-gate" : "completed-without-challenger";
      request.completedAt = this.now();
      this.#event("optimization.completed", { requestId, status: request.status, stopReason: result?.stopReason ?? null, provisionalWinnerId: result?.provisionalWinner?.candidate?.id ?? null });
      return structuredClone(request);
    } catch (error) {
      request.status = "failed";
      request.error = error instanceof Error ? error.message : String(error);
      request.completedAt = this.now();
      this.#event("optimization.failed", { requestId, error: request.error });
      throw error;
    }
  }

  resumeRole({ roleId, authorizedBy }) {
    if (!authorizedBy) throw new Error("Resuming a halted specialist role requires accountable authorization");
    const halt = this.#halts.get(roleId);
    if (!halt) throw new Error("Role is not halted");
    const current = this.registry.latest(roleId);
    if (current.recordHash === halt.activeRecordHash) throw new Error("Halted specialist cannot resume until the registry selects a different proven record");
    this.#halts.delete(roleId);
    this.#event("specialist.role-resumed", { roleId, authorizedBy, restoredCandidateId: current.selected.candidate.id, recordHash: current.recordHash });
    return { resumed: true, roleId, candidateId: current.selected.candidate.id };
  }

  requests() { return structuredClone(this.#requests); }
  halts() { return structuredClone([...this.#halts.values()]); }
  events() { return structuredClone(this.#events); }

  snapshot() {
    const payload = { schemaVersion: "das.continuous-specialization.v1", configs: [...this.#configs.values()].map((item) => structuredClone(item)), requests: this.requests(), halts: this.halts(), events: this.events(), monitor: this.monitor.snapshot() };
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

  static load(filePath, { registry, runner = null, now = () => new Date().toISOString() }) {
    const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const monitor = VerifiedPerformanceMonitor.fromSnapshot(state.monitor);
    return new ContinuousSpecializationCoordinator({ registry, monitor, runner, now, state });
  }

  #event(type, detail) { this.#events.push({ at: this.now(), type, ...structuredClone(detail) }); }
  #restore(state) {
    if (state.schemaVersion !== "das.continuous-specialization.v1") throw new Error("Unsupported continuous-specialization schema");
    const { integrityHash, ...payload } = state;
    if (digest(payload) !== integrityHash) throw new Error("Continuous-specialization integrity mismatch");
    this.#configs = new Map((state.configs ?? []).map((config) => [config.roleId, structuredClone(config)]));
    this.#requests = structuredClone(state.requests ?? []);
    this.#halts = new Map((state.halts ?? []).map((halt) => [halt.roleId, structuredClone(halt)]));
    this.#events = structuredClone(state.events ?? []);
  }
}
