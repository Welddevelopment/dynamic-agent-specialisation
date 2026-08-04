import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TenantRoleMemory } from "../runtime/memory.js";
import { ScriptedDecisionEngine, SpecialistAgentRuntime } from "../runtime/agent-runtime.js";
import { CommercialComparisonRunner } from "./commercial-comparison-runner.js";
import { prepareCommercialLocalPackage } from "./commercial-local-package.js";
import { startCommercialSidecarDaemon } from "./commercial-sidecar-daemon.js";
import { createCommercialActivationReceipt, createCommercialSpecialistBundle } from "./commercial-specialist-lifecycle.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }

async function deterministicActivation(pack) {
  const runner = new CommercialComparisonRunner({ evaluate: async ({ participant, caseId, verifierId }) => ({
    verifierId,
    independentlyVerified: true,
    passed: true,
    outcomeScore: 1,
    unsafeAttempts: 0,
    incorrectSideEffects: 0,
    modelCostUsd: participant.type === "current-agent" ? .004 : participant.type === "compiler-candidate" ? .001 : .003,
    elapsedMs: participant.type === "current-agent" ? 100 : participant.type === "compiler-candidate" ? 40 : 80,
    humanInterventions: 0,
    receiptHash: `deterministic-network-rehearsal:${participant.id}:${caseId}`,
  }) });
  const result = await runner.run({ contract: pack.contract, unseenVault: pack.unseenVault, participants: pack.participants });
  const participant = pack.participants.find((item) => item.id === result.selectedParticipantId);
  requireCondition(participant, "Deterministic rehearsal selection is missing");
  const bundle = createCommercialSpecialistBundle({ contract: pack.contract, result, participant, roleDraft: pack.roleDraft });
  const activation = createCommercialActivationReceipt({ bundle, contract: pack.contract, environment: {
    kind: "disposable-sandbox",
    driverId: pack.contract.driver.id,
    driverVersion: pack.contract.driver.version,
    verifierId: pack.contract.driver.verifier.id,
    verifierStatus: "verified",
    systemBindings: structuredClone(pack.contract.driver.systemBindings),
  } });
  return { bundle, activation };
}

export async function runCommercialNetworkRehearsal({ roleId, pack, task, decisions, ToolHost, Verifier, processEpoch }) {
  requireCondition(roleId && pack?.contract && task?.goal, "A complete role rehearsal input is required");
  requireCondition(Array.isArray(decisions) && decisions.at(-1)?.kind === "complete", "Rehearsal decisions must end explicitly");
  const { bundle, activation } = await deterministicActivation(pack);
  const packageDirectory = path.join(fs.mkdtempSync(path.join(os.tmpdir(), `das-${roleId}-network-`)), "customer-local");
  prepareCommercialLocalPackage({ directory: packageDirectory, bundle, activation });
  const runtime = new SpecialistAgentRuntime({ decisionEngine: new ScriptedDecisionEngine(decisions), memory: new TenantRoleMemory() });
  let activeHost = null;
  const customerBindings = {
    runtime,
    tenantId: `fictional-${roleId}-company`,
    verifierId: bundle.verifier.binding,
    createRunBindings: () => {
      activeHost = new ToolHost({ task });
      return { toolHost: activeHost, externalVerifier: new Verifier({ task, initialState: activeHost.initialState() }) };
    },
    reconcileUnknown: async () => ({ classification: "unknown", independent: true, verifierId: bundle.verifier.binding }),
  };
  const daemon = await startCommercialSidecarDaemon({ packageDirectory, customerBindings, processEpoch });
  try {
    const url = `http://127.0.0.1:${daemon.address.port}`;
    const headers = { authorization: `Bearer ${daemon.localPackage.accessToken}`, "content-type": "application/json" };
    const requestId = `${roleId}-network-rehearsal-1`;
    const submitResponse = await fetch(`${url}/v1/runs`, { method: "POST", headers, body: JSON.stringify({ requestId, goal: task.goal }) });
    const submit = await submitResponse.json();
    requireCondition(submitResponse.status === 200 && submit.status === "completed", `Role rehearsal did not complete: ${JSON.stringify(submit)}`);
    requireCondition(submit.result?.verification?.passed === true, "Role rehearsal failed independent verification");
    const statusResponse = await fetch(`${url}/v1/runs/${requestId}`, { headers });
    const status = await statusResponse.json();
    const duplicateResponse = await fetch(`${url}/v1/runs`, { method: "POST", headers, body: JSON.stringify({ requestId, goal: task.goal }) });
    const duplicate = await duplicateResponse.json();
    const operationsResponse = await fetch(`${url}/v1/operations`, { headers });
    const operations = await operationsResponse.json();
    requireCondition(statusResponse.status === 200 && duplicateResponse.status === 200 && operationsResponse.status === 200, "Role rehearsal status endpoints failed");
    requireCondition(status.recordHash === submit.recordHash && duplicate.recordHash === submit.recordHash, "Role rehearsal duplicate was not suppressed");
    requireCondition(operations.observationCount === 1, "Role rehearsal monitoring did not record exactly one run");
    return {
      roleId,
      contractFreezeHash: pack.contract.freezeHash,
      bundleHash: bundle.bundleHash,
      activationHash: activation.activationHash,
      packageReady: daemon.localPackage.diagnostics.ready,
      packageGateCount: daemon.localPackage.diagnostics.gates.length,
      loopbackOnly: daemon.address.address === "127.0.0.1",
      httpStatuses: { submit: submitResponse.status, status: statusResponse.status, duplicate: duplicateResponse.status, operations: operationsResponse.status },
      run: { status: submit.status, attempt: submit.attempt, verificationPassed: submit.result.verification.passed, recoveryClass: submit.result.verification.recoveryClass, modelCostUsd: submit.result.metering.modelCostUsd, duplicateSuppressed: duplicate.recordHash === submit.recordHash },
      operations: { state: operations.state, observationCount: operations.observationCount, spendAuthorized: operations.optimizationRequest?.spendAuthorized ?? false },
      externalState: activeHost.externalState(),
    };
  } finally {
    await daemon.close();
  }
}
