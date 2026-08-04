import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { assertCommercialSpecialistRunReceipt } from "./commercial-specialist-interop.js";

const STATUSES = new Set(["pending", "completed", "outcome-unknown", "retry-authorized", "incorrect-outcome"]);
const RESOLUTIONS = new Set(["completed", "not-started", "incorrect", "unknown"]);

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }

function assertRecord(record) {
  requireCondition(record?.recordHash && digest(withoutHash(record, "recordHash")) === record.recordHash, `Commercial run record integrity mismatch: ${record?.requestId ?? "unknown"}`);
  requireCondition(STATUSES.has(record.status), `Unsupported commercial run status: ${record.status}`);
  return true;
}

function sealRecord(record) { return { ...record, recordHash: digest(record) }; }

function assertRunResult(result, { requestHash, bundleHash, activationHash }) {
  assertCommercialSpecialistRunReceipt(result);
  requireCondition(result.requestHash === requestHash && result.bundleHash === bundleHash && result.activationHash === activationHash, "Sanitized commercial run receipt does not belong to the reserved request and activation");
  return true;
}

export class DurableCommercialRunLedger {
  constructor({ filePath, roleId, bundleHash, activationHash, processEpoch = `process-${Date.now()}`, now = () => new Date().toISOString() }) {
    requireCondition(filePath, "Commercial run ledger needs a file path");
    this.filePath = path.resolve(filePath);
    this.roleId = String(roleId ?? "");
    this.bundleHash = String(bundleHash ?? "");
    this.activationHash = String(activationHash ?? "");
    this.processEpoch = String(processEpoch);
    this.now = now;
    requireCondition(this.roleId && this.bundleHash && this.activationHash, "Commercial run ledger must bind one activated specialist");
    this.records = new Map();
    if (fs.existsSync(this.filePath)) this.#load();
    this.#markInterruptedRunsUnknown();
  }

  #load() {
    const state = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    requireCondition(state?.schemaVersion === "das.commercial-run-ledger.v1", "Unsupported commercial run ledger");
    const expected = state.integrityHash;
    requireCondition(expected && digest(withoutHash(state, "integrityHash")) === expected, "Commercial run ledger integrity mismatch");
    requireCondition(state.roleId === this.roleId && state.bundleHash === this.bundleHash && state.activationHash === this.activationHash, "Commercial run ledger belongs to a different activated specialist");
    for (const record of state.records ?? []) { assertRecord(record); this.records.set(record.requestId, record); }
  }

  #markInterruptedRunsUnknown() {
    let changed = false;
    for (const [requestId, record] of this.records) {
      if (record.status !== "pending" || record.processEpoch === this.processEpoch) continue;
      const next = withoutHash(record, "recordHash");
      next.status = "outcome-unknown";
      next.updatedAt = this.now();
      next.interruption = { priorProcessEpoch: record.processEpoch, detectedByProcessEpoch: this.processEpoch };
      this.records.set(requestId, sealRecord(next));
      changed = true;
    }
    if (changed) this.#save();
  }

  #save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const state = {
      schemaVersion: "das.commercial-run-ledger.v1",
      roleId: this.roleId,
      bundleHash: this.bundleHash,
      activationHash: this.activationHash,
      records: [...this.records.values()].sort((a, b) => a.requestId.localeCompare(b.requestId)),
    };
    state.integrityHash = digest(state);
    const temporary = path.join(path.dirname(this.filePath), `.${path.basename(this.filePath)}.${digest(this.processEpoch).slice(0, 12)}.tmp`);
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
    fs.chmodSync(this.filePath, 0o600);
  }

  get(requestId) { const value = this.records.get(String(requestId)); return value ? structuredClone(value) : null; }
  list() { return [...this.records.values()].map((item) => structuredClone(item)); }

  reserve({ requestId, requestHash }) {
    const id = String(requestId ?? "");
    const hash = String(requestHash ?? "");
    requireCondition(id && hash, "A request id and request hash are required");
    const prior = this.records.get(id);
    requireCondition(!prior || prior.requestHash === hash, "Request id was already used for a different goal");
    if (prior && prior.status !== "retry-authorized") return structuredClone(prior);
    const timestamp = this.now();
    const record = sealRecord({
      schemaVersion: "das.commercial-run-record.v1",
      requestId: id,
      requestHash: hash,
      roleId: this.roleId,
      bundleHash: this.bundleHash,
      activationHash: this.activationHash,
      status: "pending",
      attempt: (prior?.attempt ?? 0) + 1,
      processEpoch: this.processEpoch,
      createdAt: prior?.createdAt ?? timestamp,
      updatedAt: timestamp,
      result: null,
      resolution: prior?.resolution ?? null,
    });
    this.records.set(id, record);
    this.#save();
    return structuredClone(record);
  }

  complete({ requestId, requestHash, result }) {
    const prior = this.records.get(String(requestId));
    requireCondition(prior?.status === "pending" && prior.requestHash === requestHash, "Only the exact pending commercial run can complete");
    assertRunResult(result, { requestHash, bundleHash: this.bundleHash, activationHash: this.activationHash });
    const next = withoutHash(prior, "recordHash");
    next.status = "completed";
    next.updatedAt = this.now();
    next.result = structuredClone(result);
    this.records.set(prior.requestId, sealRecord(next));
    this.#save();
    return this.get(prior.requestId);
  }

  markUnknown({ requestId, requestHash, reason }) {
    const prior = this.records.get(String(requestId));
    requireCondition(prior?.status === "pending" && prior.requestHash === requestHash, "Only the exact pending commercial run can become unknown");
    const next = withoutHash(prior, "recordHash");
    next.status = "outcome-unknown";
    next.updatedAt = this.now();
    next.interruption = { reason: String(reason ?? "runtime-error-after-reservation"), detectedByProcessEpoch: this.processEpoch };
    this.records.set(prior.requestId, sealRecord(next));
    this.#save();
    return this.get(prior.requestId);
  }

  resolveUnknown({ requestId, resolution, expectedVerifierId }) {
    const prior = this.records.get(String(requestId));
    requireCondition(prior?.status === "outcome-unknown", "Only an unknown commercial run can be reconciled");
    requireCondition(RESOLUTIONS.has(resolution?.classification), "Unknown-run reconciliation needs an exact classification");
    requireCondition(resolution.independent === true && resolution.verifierId === expectedVerifierId, "Unknown-run reconciliation must come from the activated independent verifier");
    if (resolution.classification === "completed") {
      requireCondition(resolution.result?.verification?.passed === true, "Completed reconciliation needs a verified sanitized run receipt");
      assertRunResult(resolution.result, { requestHash: prior.requestHash, bundleHash: this.bundleHash, activationHash: this.activationHash });
    }
    const next = withoutHash(prior, "recordHash");
    next.status = resolution.classification === "completed" ? "completed" : resolution.classification === "not-started" ? "retry-authorized" : resolution.classification === "incorrect" ? "incorrect-outcome" : "outcome-unknown";
    next.updatedAt = this.now();
    next.resolution = structuredClone(resolution);
    if (resolution.classification === "completed") next.result = structuredClone(resolution.result);
    this.records.set(prior.requestId, sealRecord(next));
    this.#save();
    return this.get(prior.requestId);
  }
}
