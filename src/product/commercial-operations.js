import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { sealVerifiedObservation, VerifiedPerformanceMonitor, createMonitoringContract } from "../lifecycle/verified-monitor.js";
import { assertCommercialSpecialistRunReceipt } from "./commercial-specialist-interop.js";
import { assertCommercialActivationReceipt, assertCommercialSpecialistBundle } from "./commercial-specialist-lifecycle.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }

export function createCommercialOperationsContract(input = {}) {
  const monitoring = createMonitoringContract({
    minimumObservations: input.minimumObservations ?? 10,
    windowSize: input.windowSize ?? 25,
    minimumPassRate: input.minimumPassRate ?? .98,
    minimumOutcomeScore: input.minimumOutcomeScore ?? .99,
    maximumUnsafeAttempts: 0,
    maximumMeanModelCostUsd: input.maximumMeanModelCostUsd ?? Infinity,
    maximumMedianElapsedMs: input.maximumMedianElapsedMs ?? Infinity,
  });
  const contract = {
    schemaVersion: "das.commercial-operations-contract.v1",
    monitoring,
    incorrectSideEffectPolicy: "halt-immediately",
    optimizationPolicy: "request-only-no-auto-spend",
  };
  contract.contractHash = digest(contract);
  return Object.freeze(contract);
}

export class CommercialSpecialistOperations {
  constructor({ bundle, activation, filePath, contract = createCommercialOperationsContract(), now = () => new Date().toISOString(), state = null }) {
    assertCommercialSpecialistBundle(bundle);
    assertCommercialActivationReceipt(activation, { bundle });
    requireCondition(filePath, "Commercial operations needs an owner-controlled state path");
    requireCondition(contract?.contractHash === digest(withoutHash(contract, "contractHash")), "Commercial operations contract integrity mismatch");
    this.bundle = bundle;
    this.activation = activation;
    this.filePath = path.resolve(filePath);
    this.contract = structuredClone(contract);
    this.now = now;
    this.monitor = new VerifiedPerformanceMonitor();
    this.receipts = new Map();
    this.events = [];
    this.halt = null;
    this.optimizationRequest = null;
    if (state) this.#restore(state);
    else if (fs.existsSync(this.filePath)) this.#restore(JSON.parse(fs.readFileSync(this.filePath, "utf8")));
  }

  assertMayRun() {
    if (this.halt) throw new Error(`Activated specialist is halted: ${this.halt.reason}`);
    return true;
  }

  ingestRun(receipt) {
    assertCommercialSpecialistRunReceipt(receipt, { bundle: this.bundle, activation: this.activation });
    const prior = this.receipts.get(receipt.runReceiptHash);
    if (prior) return structuredClone(prior);
    requireCondition(receipt.verification, "An unverified commercial run cannot become lifecycle evidence");
    const unsafeAttempts = receipt.verification.unsafeAttempts + receipt.verification.incorrectSideEffects;
    const observation = sealVerifiedObservation({
      roleId: this.bundle.role.id,
      specialistId: this.bundle.selected.candidate.id,
      specialistVersion: this.bundle.selected.candidate.version,
      caseId: receipt.requestId,
      verifierKind: "independent-external-state",
      verifierBinding: receipt.verification.verifierId,
      verificationPassed: receipt.verification.passed,
      outcomeScore: receipt.verification.outcomeScore,
      unsafeAttempts,
      modelCostUsd: receipt.metering.modelCostUsd,
      elapsedMs: receipt.metering.modelElapsedMs,
      toolCalls: 0,
      humanInterventions: receipt.status === "handoff" ? 1 : 0,
      runtimeStatus: receipt.status,
      runId: receipt.requestId,
      executionMode: "live",
      businessWritesCommitted: receipt.execution.businessWritesCommitted,
    });
    const assessment = this.monitor.record(observation, { contract: this.contract.monitoring });
    const record = { receiptHash: receipt.runReceiptHash, observation, assessment, ingestedAt: this.now() };
    this.receipts.set(receipt.runReceiptHash, record);
    this.events.push({ at: this.now(), type: "commercial-run.observed", requestId: receipt.requestId, receiptHash: receipt.runReceiptHash, action: assessment.action, reasons: assessment.reasons });
    if (unsafeAttempts > 0 || assessment.action === "quarantine-active-specialist") {
      this.halt = { reason: receipt.verification.incorrectSideEffects > 0 ? "incorrect-side-effect-observed" : "unsafe-attempt-observed", requestId: receipt.requestId, receiptHash: receipt.runReceiptHash, assessment: structuredClone(assessment), haltedAt: this.now() };
      this.events.push({ at: this.now(), type: "commercial-specialist.halted", ...structuredClone(this.halt) });
    } else if (assessment.action === "recommend-bounded-optimization" && !this.optimizationRequest) {
      this.optimizationRequest = {
        id: `commercial-recomparison-${digest({ activationHash: this.activation.activationHash, assessment }).slice(0, 16)}`,
        status: "awaiting-explicit-approval",
        activeBundleHash: this.bundle.bundleHash,
        activeActivationHash: this.activation.activationHash,
        reasons: structuredClone(assessment.reasons),
        assessment: structuredClone(assessment),
        createdAt: this.now(),
        spendAuthorized: false,
      };
      this.events.push({ at: this.now(), type: "commercial-recomparison.requested", requestId: this.optimizationRequest.id, reasons: this.optimizationRequest.reasons });
    }
    this.save();
    return structuredClone(record);
  }

  reconcileLedger(records = []) {
    const results = [];
    for (const record of records) if (record?.status === "completed" && record.result) results.push(this.ingestRun(record.result));
    return results;
  }

  status() {
    return {
      schemaVersion: "das.commercial-operations-status.v1",
      roleId: this.bundle.role.id,
      bundleHash: this.bundle.bundleHash,
      activationHash: this.activation.activationHash,
      state: this.halt ? "halted" : this.optimizationRequest ? "recomparison-recommended" : "operating",
      observationCount: this.receipts.size,
      halt: structuredClone(this.halt),
      optimizationRequest: structuredClone(this.optimizationRequest),
      latestAssessment: [...this.receipts.values()].at(-1)?.assessment ?? null,
      evidenceBoundary: "Customer-local independently verified runtime monitoring. Recomparison requires separate explicit approval and cannot auto-spend or auto-promote.",
    };
  }

  snapshot() {
    const payload = {
      schemaVersion: "das.commercial-operations.v1",
      roleId: this.bundle.role.id,
      bundleHash: this.bundle.bundleHash,
      activationHash: this.activation.activationHash,
      contract: structuredClone(this.contract),
      receipts: [...this.receipts.values()].map((item) => structuredClone(item)),
      events: structuredClone(this.events),
      halt: structuredClone(this.halt),
      optimizationRequest: structuredClone(this.optimizationRequest),
    };
    return { ...payload, integrityHash: digest(payload) };
  }

  save() {
    const state = this.snapshot();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = path.join(path.dirname(this.filePath), `.${path.basename(this.filePath)}.${digest(this.activation.activationHash).slice(0, 12)}.tmp`);
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
    fs.chmodSync(this.filePath, 0o600);
    return state;
  }

  #restore(state) {
    requireCondition(state?.schemaVersion === "das.commercial-operations.v1", "Unsupported commercial operations state");
    requireCondition(state.integrityHash && digest(withoutHash(state, "integrityHash")) === state.integrityHash, "Commercial operations integrity mismatch");
    requireCondition(state.roleId === this.bundle.role.id && state.bundleHash === this.bundle.bundleHash && state.activationHash === this.activation.activationHash, "Commercial operations state belongs to another activation");
    requireCondition(state.contract?.contractHash === this.contract.contractHash, "Commercial operations contract changed after activation");
    this.monitor = new VerifiedPerformanceMonitor({ observations: (state.receipts ?? []).map((item) => item.observation) });
    this.receipts = new Map((state.receipts ?? []).map((item) => [item.receiptHash, structuredClone(item)]));
    this.events = structuredClone(state.events ?? []);
    this.halt = structuredClone(state.halt ?? null);
    this.optimizationRequest = structuredClone(state.optimizationRequest ?? null);
  }
}
