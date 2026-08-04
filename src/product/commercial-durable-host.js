import { assertCommercialActivationReceipt, assertCommercialSpecialistBundle } from "./commercial-specialist-lifecycle.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function clean(value, maximum) { return String(value ?? "").trim().slice(0, maximum); }

export function createDurableCommercialSpecialistHost({ bundle, activation, invoker, ledger, reconcileUnknown, operations = null }) {
  assertCommercialSpecialistBundle(bundle);
  assertCommercialActivationReceipt(activation, { bundle });
  requireCondition(invoker?.bundleHash === bundle.bundleHash && typeof invoker.invoke === "function" && typeof invoker.requestHash === "function" && typeof invoker.authorizeRetry === "function", "Durable host requires the invoker for the exact activated bundle");
  requireCondition(ledger?.bundleHash === bundle.bundleHash && ledger.activationHash === activation.activationHash, "Durable ledger does not belong to this activation");
  requireCondition(typeof reconcileUnknown === "function", "Durable host requires an independent unknown-outcome reconciler");
  requireCondition(!operations || (typeof operations.assertMayRun === "function" && typeof operations.ingestRun === "function"), "Commercial operations must expose run gating and verified ingestion");
  const inFlight = new Map();

  return Object.freeze({
    roleId: bundle.role.id,
    bundleHash: bundle.bundleHash,
    activationHash: activation.activationHash,
    operationsStatus() { return operations ? operations.status() : null; },
    status(requestId) { return ledger.get(requestId); },
    list() { return ledger.list(); },
    async submit(input = {}) {
      const requestId = clean(input.requestId, 160);
      const goal = clean(input.goal, 4_000);
      requireCondition(requestId && goal, "A bounded request id and ordinary goal are required");
      const requestHash = invoker.requestHash({ requestId, goal });
      const existing = ledger.get(requestId);
      requireCondition(!existing || existing.requestHash === requestHash, "Request id was already used for a different goal");
      if (existing?.status === "completed") return existing;
      if (operations) operations.assertMayRun();
      if (existing?.status === "outcome-unknown") throw new Error("Commercial run outcome is unknown; reconcile external state before any retry");
      if (existing?.status === "incorrect-outcome") throw new Error("Commercial run has an independently verified incorrect outcome and cannot retry automatically");
      if (inFlight.has(requestId)) return inFlight.get(requestId);
      const reserved = ledger.reserve({ requestId, requestHash });
      if (reserved.status === "pending" && reserved.processEpoch !== ledger.processEpoch) throw new Error("Commercial run belongs to another live process");
      const promise = (async () => {
        let result;
        try {
          result = await invoker.invoke({ requestId, goal });
        } catch (error) {
          ledger.markUnknown({ requestId, requestHash, reason: error instanceof Error ? error.message : String(error) });
          throw error;
        }
        const completed = ledger.complete({ requestId, requestHash, result });
        try {
          if (operations) operations.ingestRun(result);
        } catch (error) {
          throw new Error(`Commercial run completed and was durably recorded, but lifecycle monitoring failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally { inFlight.delete(requestId); }
        return completed;
      })();
      inFlight.set(requestId, promise);
      return promise;
    },
    async reconcile(requestId) {
      const record = ledger.get(requestId);
      requireCondition(record?.status === "outcome-unknown", "Only an unknown commercial run can be reconciled");
      const resolution = await reconcileUnknown({ record, bundle, activation });
      const resolved = ledger.resolveUnknown({ requestId, resolution, expectedVerifierId: bundle.verifier.binding });
      if (resolved.status === "retry-authorized") invoker.authorizeRetry({ requestId, requestHash: record.requestHash, resolution });
      return resolved;
    },
  });
}
