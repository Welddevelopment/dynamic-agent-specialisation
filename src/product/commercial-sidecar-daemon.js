import { pathToFileURL } from "node:url";
import path from "node:path";
import { createDurableCommercialSpecialistHost } from "./commercial-durable-host.js";
import { createCommercialLocalSidecar, createCommercialSidecarDispatcher } from "./commercial-local-sidecar.js";
import { loadCommercialLocalPackage } from "./commercial-local-package.js";
import { CommercialSpecialistOperations, createCommercialOperationsContract } from "./commercial-operations.js";
import { DurableCommercialRunLedger } from "./commercial-run-ledger.js";
import { createCommercialSpecialistInvoker } from "./commercial-specialist-interop.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function clean(value, maximum = 4_000) { return String(value ?? "").trim().slice(0, maximum); }

export function validateCommercialCustomerBindings(bindings, { bundle }) {
  requireCondition(bindings && typeof bindings === "object", "Customer binding factory returned no bindings");
  requireCondition(bindings.runtime && typeof bindings.runtime.run === "function", "Customer bindings need the specialist runtime");
  requireCondition(typeof bindings.createRunBindings === "function", "Customer bindings need a per-run tool-host and verifier factory");
  requireCondition(typeof bindings.reconcileUnknown === "function", "Customer bindings need an independent unknown-outcome reconciler");
  requireCondition(clean(bindings.tenantId, 160), "Customer bindings must fix one tenant id");
  requireCondition(!bindings.verifierId || bindings.verifierId === bundle.verifier.binding, "Customer binding verifier does not match the activated specialist");
  return Object.freeze({
    ready: true,
    tenantId: clean(bindings.tenantId, 160),
    verifierId: bundle.verifier.binding,
    runtime: bindings.runtime,
    createRunBindings: bindings.createRunBindings,
    reconcileUnknown: bindings.reconcileUnknown,
  });
}

export async function createCommercialSidecarRuntime({ packageDirectory, customerBindings, processEpoch = `commercial-sidecar-${process.pid}-${Date.now()}`, operationsContract = createCommercialOperationsContract() }) {
  const localPackage = loadCommercialLocalPackage({ directory: packageDirectory });
  const bindings = validateCommercialCustomerBindings(customerBindings, { bundle: localPackage.bundle });
  const invoker = createCommercialSpecialistInvoker({
    bundle: localPackage.bundle,
    activation: localPackage.activation,
    runtime: bindings.runtime,
    createRunBindings: bindings.createRunBindings,
    tenantId: bindings.tenantId,
  });
  const ledger = new DurableCommercialRunLedger({ filePath: localPackage.ledgerPath, roleId: localPackage.bundle.role.id, bundleHash: localPackage.bundle.bundleHash, activationHash: localPackage.activation.activationHash, processEpoch });
  const operations = new CommercialSpecialistOperations({ bundle: localPackage.bundle, activation: localPackage.activation, filePath: localPackage.operationsPath, contract: operationsContract });
  operations.reconcileLedger(ledger.list());
  const host = createDurableCommercialSpecialistHost({ bundle: localPackage.bundle, activation: localPackage.activation, invoker, ledger, operations, reconcileUnknown: bindings.reconcileUnknown });
  const dispatch = createCommercialSidecarDispatcher({ host, bundle: localPackage.bundle, activation: localPackage.activation, accessToken: localPackage.accessToken });
  return Object.freeze({ localPackage, bindings, invoker, ledger, operations, host, dispatch });
}

export async function startCommercialSidecarDaemon(options) {
  const assembled = await createCommercialSidecarRuntime(options);
  const sidecar = createCommercialLocalSidecar({ dispatch: assembled.dispatch });
  const hostname = assembled.localPackage.config.hostname;
  const requestedPort = options.port ?? assembled.localPackage.config.port;
  requireCondition(Number.isInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65_535, "Sidecar port must be an integer from 0 to 65535");
  const address = await sidecar.listen({ hostname, port: requestedPort });
  return Object.freeze({
    ...assembled,
    sidecar,
    address,
    publicStatus: {
      schemaVersion: "das.commercial-sidecar-daemon-status.v1",
      roleId: assembled.localPackage.bundle.role.id,
      bundleHash: assembled.localPackage.bundle.bundleHash,
      activationHash: assembled.localPackage.activation.activationHash,
      hostname: address.address,
      port: address.port,
      operations: assembled.operations.status(),
      credentialPolicy: "The access token and customer credentials are not printed or returned in public status.",
    },
    close: () => sidecar.close(),
  });
}

export async function loadCommercialCustomerBindings({ modulePath, localPackage }) {
  const resolved = path.resolve(modulePath);
  const module = await import(`${pathToFileURL(resolved).href}?loaded=${Date.now()}`);
  requireCondition(typeof module.createCommercialCustomerBindings === "function", "Customer module must export createCommercialCustomerBindings");
  const bindings = await module.createCommercialCustomerBindings({ bundle: structuredClone(localPackage.bundle), activation: structuredClone(localPackage.activation), packageRoot: localPackage.root });
  return validateCommercialCustomerBindings(bindings, { bundle: localPackage.bundle });
}
