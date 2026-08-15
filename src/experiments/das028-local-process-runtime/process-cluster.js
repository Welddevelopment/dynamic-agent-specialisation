import crypto from "node:crypto";
import { fork } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "../../core/canonical.js";
import {
  adoptCustomerLocalProcessReplacement,
  createCustomerLocalProcessEndpoint,
  createCustomerLocalProcessTransportReceipt,
  probeCustomerLocalProcessEndpoint,
} from "../../product/customer-local-process-transport.js";

const WORKER = fileURLToPath(new URL("./process-worker.js", import.meta.url));

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function writeNewPrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.chmodSync(file, 0o600);
}

class WorkerClient {
  constructor(child, ready, config) {
    this.child = child;
    this.ready = ready;
    this.config = config;
    this.sequence = 0;
    this.pending = new Map();
    child.on("message", (message) => {
      if (message?.type !== "reply") return;
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.value); else pending.reject(new Error(message.error));
    });
    child.on("exit", (code, signal) => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`DAS-028 ${config.role} process exited (${code ?? signal})`));
      }
      this.pending.clear();
    });
  }

  call(type, fields = {}, timeoutMs = 5_000) {
    requireCondition(this.child.connected, `DAS-028 ${this.config.role} process is disconnected`);
    const requestId = `${this.config.role}:${this.config.processInstanceId}:${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`DAS-028 ${this.config.role} IPC ${type} timed out`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.child.send({ type, requestId, ...structuredClone(fields) });
    });
  }

  async close() {
    if (!this.child.connected) return;
    try { await this.call("shutdown", {}, 2_000); }
    catch { this.child.kill("SIGTERM"); }
  }
}

async function startWorker(config) {
  const encoded = Buffer.from(JSON.stringify({ schemaVersion: "das.das028-process-worker-config.v1", ...config })).toString("base64url");
  const child = fork(WORKER, [], {
    env: { PATH: process.env.PATH ?? "", DAS028_PROCESS_CONFIG_B64: encoded },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4_000); });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`DAS-028 ${config.role} process did not become ready: ${stderr}`)), 5_000);
    const onMessage = (message) => {
      if (message?.type !== "ready") return;
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve(message);
    };
    const onExit = (code, signal) => {
      clearTimeout(timer);
      child.off("message", onMessage);
      reject(new Error(`DAS-028 ${config.role} process exited before ready (${code ?? signal}): ${stderr}`));
    };
    child.on("message", onMessage);
    child.once("exit", onExit);
  });
  requireCondition(ready.address?.address === "127.0.0.1" && Number.isInteger(ready.address?.port), `DAS-028 ${config.role} process did not bind exact loopback`);
  return new WorkerClient(child, ready, config);
}

function workerConfig({ role, packageIdentityHash, serverIdentityHash, processInstanceId, secretEndpoint = null, credentialAlias = null, authenticationPlacement = null, actionContract = null, observerContract = null, world = null, aliases = null }) {
  return {
    role,
    packageIdentityHash,
    serverIdentityHash,
    processInstanceId,
    secretEndpoint,
    credentialAlias,
    authenticationPlacement,
    actionContract,
    observerContract,
    world,
    aliases,
    customerEnvironmentAccepted: false,
    activationReady: false,
  };
}

function endpointFor(client, revision) {
  return createCustomerLocalProcessEndpoint({
    role: client.config.role,
    packageIdentityHash: client.config.packageIdentityHash,
    serverIdentityHash: client.config.serverIdentityHash,
    processInstanceId: client.config.processInstanceId,
    host: client.ready.address.address,
    port: client.ready.address.port,
    revision,
    pid: client.ready.identity.pid,
  });
}

function stableServerIdentity({ packageIdentityHash, role, sourceHash, roleHash }) {
  return digest({ schemaVersion: "das.das028-stable-process-server.v1", packageIdentityHash, role, sourceHash, roleHash });
}

function freshProcessInstance({ packageIdentityHash, role, revision }) {
  const safeRole = role === "secret" ? "vault" : role;
  return `${safeRole}-${revision}-${crypto.randomBytes(16).toString("hex")}-${packageIdentityHash.slice(0, 12)}`;
}

export async function startDAS028ProcessCluster({ packageIdentityHash, runtimeReceiptHash, sourceHash, roleHash, actionContract, observerContract, actionAlias, observerAlias, actionAuthenticationPlacement, observerAuthenticationPlacement, world }) {
  const stable = {
    secret: stableServerIdentity({ packageIdentityHash, role: "secret", sourceHash, roleHash }),
    action: stableServerIdentity({ packageIdentityHash, role: "action", sourceHash, roleHash }),
    observer: stableServerIdentity({ packageIdentityHash, role: "observer", sourceHash, roleHash }),
  };
  const revisions = { secret: 1, action: 1, observer: 1 };
  const secret = await startWorker(workerConfig({
    role: "secret",
    packageIdentityHash,
    serverIdentityHash: stable.secret,
    processInstanceId: freshProcessInstance({ packageIdentityHash, role: "secret", revision: revisions.secret }),
    aliases: { action: actionAlias, observer: observerAlias },
  }));
  const secretEndpoint = endpointFor(secret, revisions.secret);
  await probeCustomerLocalProcessEndpoint({ endpoint: secretEndpoint });

  async function startBusiness(role, revision) {
    return startWorker(workerConfig({
      role,
      packageIdentityHash,
      serverIdentityHash: stable[role],
      processInstanceId: freshProcessInstance({ packageIdentityHash, role, revision }),
      secretEndpoint,
      credentialAlias: role === "action" ? actionAlias : observerAlias,
      authenticationPlacement: role === "action" ? actionAuthenticationPlacement : observerAuthenticationPlacement,
      actionContract,
      observerContract,
      world,
    }));
  }

  let action = await startBusiness("action", revisions.action);
  let observer = await startBusiness("observer", revisions.observer);
  let actionEndpoint = endpointFor(action, revisions.action);
  let observerEndpoint = endpointFor(observer, revisions.observer);
  await Promise.all([
    probeCustomerLocalProcessEndpoint({ endpoint: actionEndpoint }),
    probeCustomerLocalProcessEndpoint({ endpoint: observerEndpoint }),
  ]);
  let currentControl = null;
  let restarts = 0;

  async function configure(control) {
    requireCondition(control?.stateFile && control?.controlId && control?.assignedWork, "DAS-028 process control is incomplete");
    currentControl = structuredClone(control);
    await Promise.all([action.call("configure", { control: currentControl }), observer.call("configure", { control: currentControl })]);
  }

  async function restartBusinessServers() {
    requireCondition(currentControl, "DAS-028 process cluster cannot restart before one exact control is configured");
    const priorAction = actionEndpoint;
    const priorObserver = observerEndpoint;
    await Promise.all([action.close(), observer.close()]);
    revisions.action += 1;
    revisions.observer += 1;
    action = await startBusiness("action", revisions.action);
    observer = await startBusiness("observer", revisions.observer);
    const replacementAction = endpointFor(action, revisions.action);
    const replacementObserver = endpointFor(observer, revisions.observer);
    actionEndpoint = await adoptCustomerLocalProcessReplacement({ current: priorAction, replacement: replacementAction });
    observerEndpoint = await adoptCustomerLocalProcessReplacement({ current: priorObserver, replacement: replacementObserver });
    await configure(currentControl);
    restarts += 1;
    return { priorAction, priorObserver, actionEndpoint, observerEndpoint };
  }

  const secretClient = Object.freeze({
    async issueHandle(request) { return secret.call("issue-handle", request); },
  });

  function stateSnapshot() {
    requireCondition(currentControl?.stateFile, "DAS-028 process cluster has no configured state");
    return JSON.parse(fs.readFileSync(currentControl.stateFile, "utf8"));
  }

  function endpoints() {
    return { action: actionEndpoint, observer: observerEndpoint, secret: secretEndpoint };
  }

  function receipt() {
    return createCustomerLocalProcessTransportReceipt({ packageIdentityHash, actionEndpoint, observerEndpoint, secretEndpoint, actionAlias, observerAlias, runtimeReceiptHash });
  }

  async function stats() {
    const [secretStats, actionStats, observerStats] = await Promise.all([secret.call("stats"), action.call("stats"), observer.call("stats")]);
    return { secret: secretStats, action: actionStats, observer: observerStats, restarts };
  }

  async function close() {
    await Promise.allSettled([action.close(), observer.close(), secret.close()]);
  }

  return Object.freeze({ configure, restartBusinessServers, secretClient, stateSnapshot, endpoints, receipt, stats, close });
}

export function initializeDAS028State({ stateFile, world }) {
  const initial = {
    schemaVersion: "das.das028-disposable-business-state.v1",
    records: [],
    businessWrites: 0,
    observerWrites: 0,
    unrelatedStateDigest: world.protectedStateDigest,
    additionalChanges: [],
    requests: [],
    revision: 0,
  };
  writeNewPrivate(stateFile, initial);
  return initial;
}
