import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { digest } from "../../core/canonical.js";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function readConfig() {
  requireCondition(process.env.DAS028_PROCESS_CONFIG_B64, "DAS-028 worker config is missing");
  const value = JSON.parse(Buffer.from(process.env.DAS028_PROCESS_CONFIG_B64, "base64url").toString("utf8"));
  requireCondition(value?.schemaVersion === "das.das028-process-worker-config.v1", "DAS-028 worker config schema is unsupported");
  return value;
}

const CONFIG = readConfig();
const ROLE = CONFIG.role;
const MAX_REQUEST_BYTES = 512 * 1024;
let currentControl = null;
let requestsReceived = 0;
let observerWrites = 0;

function responseHeaders(extra = {}) {
  return {
    "content-type": "application/json",
    "x-das-server-identity": CONFIG.serverIdentityHash,
    "x-das-process-instance": CONFIG.processInstanceId,
    "cache-control": "no-store",
    connection: "close",
    ...extra,
  };
}

function sendJson(res, status, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, responseHeaders({ "content-length": String(body.length), ...headers }));
  res.end(body);
}

function sendMalformed(res) {
  const body = Buffer.from("{not-json");
  res.writeHead(200, responseHeaders({ "content-length": String(body.length) }));
  res.end(body);
}

function sendOversize(res) {
  sendJson(res, 200, { padding: "x".repeat(300_000) });
}

function sendConflictingLength(res) {
  const body = Buffer.from(JSON.stringify({ status: "unsafe-conflicting-framing" }));
  res.writeHead(200, responseHeaders({ "content-length": String(body.length), "transfer-encoding": "chunked" }));
  res.end(body);
}

async function readJson(req) {
  requireCondition(!(req.headers["content-length"] && req.headers["transfer-encoding"]), "request has conflicting length and transfer encoding");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    requireCondition(size <= MAX_REQUEST_BYTES, "request body exceeds the exact ceiling");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  requireCondition(value && typeof value === "object" && !Array.isArray(value), "request body must be one JSON object");
  return value;
}

function identity() {
  return {
    schemaVersion: "das.das028-process-identity.v1",
    role: ROLE,
    packageIdentityHash: CONFIG.packageIdentityHash,
    serverIdentityHash: CONFIG.serverIdentityHash,
    processInstanceId: CONFIG.processInstanceId,
    pid: process.pid,
    loopbackOnly: true,
    protocol: "http-local-only",
    tls: false,
  };
}

function state() {
  requireCondition(currentControl?.stateFile, `${ROLE} process has no configured disposable state`);
  return JSON.parse(fs.readFileSync(currentControl.stateFile, "utf8"));
}

function saveState(value) {
  requireCondition(ROLE === "action", "observer process attempted to write business state");
  const temporary = `${currentControl.stateFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, currentControl.stateFile);
  fs.chmodSync(currentControl.stateFile, 0o600);
}

function leaseHandle(req) {
  const placement = CONFIG.authenticationPlacement;
  if (placement.kind === "api-key-header") return req.headers[String(placement.wireName).toLowerCase()] ?? null;
  const authorization = req.headers.authorization ?? "";
  const match = /^DASLease\s+(daslh_[A-Za-z0-9_-]+)$/.exec(authorization);
  return match?.[1] ?? null;
}

async function verifyLease(req) {
  const handle = leaseHandle(req);
  if (!handle) return { status: 401, ok: false, reason: "opaque lease handle missing" };
  const response = await fetch(`${CONFIG.secretEndpoint.origin}/verify`, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle, alias: CONFIG.credentialAlias, plane: ROLE, packageIdentityHash: CONFIG.packageIdentityHash }),
  });
  requireCondition(response.headers.get("x-das-server-identity") === CONFIG.secretEndpoint.serverIdentityHash, "secret process identity drifted");
  const body = await response.json();
  return { status: response.status, ...body };
}

function operationHeader(req) {
  const value = req.headers["x-das-operation-identity"];
  requireCondition(typeof value === "string" && /^[a-f0-9]{64}$/.test(value), "operation identity header is missing or invalid");
  return value;
}

function exactOpenApiPath(operation, assignedWork) {
  return operation.parameters.filter((parameter) => parameter.in === "path").reduce((route, parameter) => route.replace(`{${parameter.name}}`, encodeURIComponent(String(assignedWork[parameter.name]))), operation.route);
}

function exactOpenApiInputs(operation, assignedWork, conflictField) {
  const query = {};
  const headers = {};
  const body = {};
  for (const parameter of operation.parameters) {
    const value = assignedWork[parameter.name] ?? (parameter.in === "header" && parameter.name === "Idempotency-Key" ? assignedWork[conflictField] : undefined);
    if (value === undefined) continue;
    if (parameter.in === "query") query[parameter.name] = String(value);
    if (parameter.in === "header") headers[parameter.name.toLowerCase()] = String(value);
  }
  for (const key of Object.keys(operation.bodySchema?.properties ?? {})) if (Object.hasOwn(assignedWork, key)) body[key] = assignedWork[key];
  return { query, headers, body };
}

function sameObject(left, right) {
  return digest(left) === digest(right);
}

function assertOpenApiRequest(req, url, body, operation, assignedWork, conflictField) {
  requireCondition(req.method === operation.method && operationHeader(req) === operation.operationIdentityHash, "OpenAPI method or operation identity drifted");
  requireCondition(url.pathname === exactOpenApiPath(operation, assignedWork), "OpenAPI request path drifted");
  const expected = exactOpenApiInputs(operation, assignedWork, conflictField);
  requireCondition(sameObject(Object.fromEntries(url.searchParams.entries()), expected.query), "OpenAPI request query serialization drifted");
  for (const [name, value] of Object.entries(expected.headers)) requireCondition(req.headers[name] === value, `OpenAPI request header ${name} drifted`);
  if (!["GET", "HEAD"].includes(operation.method)) requireCondition(sameObject(body, expected.body), "OpenAPI request body serialization drifted");
}

function assertMcpRequest(req, body, operation, assignedWork) {
  requireCondition(req.method === "POST" && operationHeader(req) === operation.operationIdentityHash, "MCP method or operation identity drifted");
  requireCondition(body.serverId === operation.serverId && body.serverVersion === operation.serverVersion && body.toolsListHash === operation.toolsListHash && body.tool === operation.operationName && body.inputSchemaHash === operation.operationIdentityHash, "MCP server, version, tool or schema drifted");
  const expected = {};
  for (const key of Object.keys(operation.inputSchema.properties)) if (Object.hasOwn(assignedWork, key)) expected[key] = assignedWork[key];
  requireCondition(sameObject(body.arguments, expected), "MCP argument serialization drifted");
}

function matchOperation(req, url, body, operations, assignedWork, conflictField = null) {
  const operationIdentityHash = operationHeader(req);
  const operation = operations.find((candidate) => candidate.operationIdentityHash === operationIdentityHash);
  requireCondition(operation, "request selected an operation outside the exact process contract");
  if (operation.family === "openapi") assertOpenApiRequest(req, url, body, operation, assignedWork, conflictField);
  else {
    requireCondition(url.pathname === "/mcp/call", "MCP request path drifted");
    assertMcpRequest(req, body, operation, assignedWork);
  }
  return operation;
}

function createBusinessRecord(control, current) {
  const world = CONFIG.world;
  const assigned = structuredClone(control.assignedWork);
  const record = {
    ...assigned,
    [world.resultIdentityField]: `${CONFIG.packageIdentityHash.slice(0, 12)}-result-${current.businessWrites + 1}`,
    [world.statusField]: world.completionStatus,
  };
  if (control.controlId === "partial") delete record[world.partialField];
  if (control.controlId === "incorrect") record[world.incorrectField] = structuredClone(world.incorrectValue);
  return record;
}

async function actionRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/identity" && req.method === "GET") return sendJson(res, 200, identity());
  requestsReceived += 1;
  const lease = await verifyLease(req);
  if (!lease.ok) return sendJson(res, lease.status === 401 ? 401 : 403, { error: lease.reason });
  requireCondition(currentControl, "action server has no frozen control");
  const body = await readJson(req);
  const operations = [CONFIG.actionContract.writeOperation, CONFIG.actionContract.reconciliationOperation];
  const operation = matchOperation(req, url, body, operations, currentControl.assignedWork, CONFIG.actionContract.conflictKeyFields[0]);
  const isWrite = operation.operationIdentityHash === CONFIG.actionContract.writeOperation.operationIdentityHash;
  if (!isWrite) return sendJson(res, 200, { status: "read", matches: state().records });

  if (currentControl.networkFault === "malformed-response") return sendMalformed(res);
  if (currentControl.networkFault === "oversize-response") return sendOversize(res);
  if (currentControl.networkFault === "conflicting-framing") return sendConflictingLength(res);
  if (currentControl.networkFault === "delay-before-commit") {
    let closed = false;
    res.once("close", () => { closed = true; });
    await new Promise((resolve) => setTimeout(resolve, currentControl.delayMs));
    if (closed || res.destroyed) return;
  }

  if (["not-started", "unknown", "unavailable"].includes(currentControl.controlId)) {
    return sendJson(res, 202, { status: "accepted-no-commit", transportAttemptId: digest({ packageIdentityHash: CONFIG.packageIdentityHash, control: currentControl.controlId }) });
  }
  const current = state();
  const record = createBusinessRecord(currentControl, current);
  current.records.push(record);
  current.businessWrites += 1;
  current.requests.push({ role: "action", operationIdentityHash: operation.operationIdentityHash, requestBodyHash: digest(body), recordedAtRevision: current.revision + 1 });
  if (currentControl.controlId === "duplicate") {
    current.records.push({ ...record, [CONFIG.world.resultIdentityField]: `${CONFIG.packageIdentityHash.slice(0, 12)}-result-${current.businessWrites + 1}` });
    current.businessWrites += 1;
  }
  if (currentControl.controlId === "collateral") {
    current.unrelatedStateDigest = `${CONFIG.world.protectedStateDigest}:mutated`;
    current.additionalChanges.push({ kind: "protected-unrelated-state", id: `protected-${CONFIG.packageIdentityHash.slice(0, 12)}` });
  }
  current.revision += 1;
  saveState(current);
  if (currentControl.controlId === "lost-response") {
    req.socket.destroy();
    return;
  }
  return sendJson(res, 201, { status: "created", transportAttemptId: digest({ packageIdentityHash: CONFIG.packageIdentityHash, control: currentControl.controlId, revision: current.revision }) });
}

function observerResponse(operation, phase) {
  const current = state();
  const controlId = currentControl.controlId;
  if (phase === "after" && controlId === "unavailable") return { availability: "unavailable", reason: "fictional independent observer unavailable" };
  if (phase === "after" && controlId === "unknown") return { availability: "unknown", reason: "fictional independent observer could not establish state" };
  const observedAt = phase === "after" && controlId === "stale" ? 900 : 1_000;
  const isProtected = operation.operationName === CONFIG.observerContract.operations[1].operationName;
  if (isProtected) {
    return {
      kind: "protected-state",
      snapshotGeneratedAt: observedAt,
      caughtUpThrough: observedAt,
      changedEntities: phase === "before" ? [] : [
        ...current.records.map((record) => ({ kind: CONFIG.world.allowedChangedEntityKind, id: record[CONFIG.world.resultIdentityField] })),
        ...current.additionalChanges,
      ],
      unrelatedStateDigest: phase === "before" ? CONFIG.world.protectedStateDigest : current.unrelatedStateDigest,
    };
  }
  return {
    kind: "outcome",
    snapshotGeneratedAt: observedAt,
    caughtUpThrough: observedAt,
    matches: phase === "before" ? [] : current.records,
  };
}

async function observerRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/identity" && req.method === "GET") return sendJson(res, 200, identity());
  requestsReceived += 1;
  const lease = await verifyLease(req);
  if (!lease.ok) return sendJson(res, lease.status === 401 ? 401 : 403, { error: lease.reason });
  requireCondition(currentControl, "observer server has no frozen control");
  const body = await readJson(req);
  const operation = matchOperation(req, url, body, CONFIG.observerContract.operations, currentControl.assignedWork);
  const phase = req.headers["x-das-observation-phase"];
  requireCondition(["before", "after"].includes(phase), "observer phase header is invalid");
  if (currentControl.networkFault === "observer-malformed-response") return sendMalformed(res);
  if (currentControl.networkFault === "observer-oversize-response") return sendOversize(res);
  if (currentControl.networkFault === "observer-delay") await new Promise((resolve) => setTimeout(resolve, currentControl.delayMs));
  return sendJson(res, 200, observerResponse(operation, phase));
}

const handles = new Map();
const secretMaterial = ROLE === "secret" ? crypto.randomBytes(32) : null;

function issueHandle(message) {
  requireCondition(ROLE === "secret", "only the secret process may issue handles");
  requireCondition(CONFIG.aliases[message.plane] === message.alias && message.packageIdentityHash === CONFIG.packageIdentityHash, "secret process rejected alias, plane or package widening");
  const nonce = crypto.randomBytes(24).toString("base64url");
  const signature = crypto.createHmac("sha256", secretMaterial).update(`${message.alias}:${message.plane}:${message.packageIdentityHash}:${nonce}`).digest("base64url");
  const handle = `daslh_${nonce}${signature}`;
  handles.set(handle, { alias: message.alias, plane: message.plane, packageIdentityHash: message.packageIdentityHash, remainingUses: message.plane === "observer" ? 4 : 1, expiresAt: Date.now() + 10_000 });
  return { handle, handleHash: digest(handle) };
}

async function secretRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/identity" && req.method === "GET") return sendJson(res, 200, identity());
  if (url.pathname !== "/verify" || req.method !== "POST") return sendJson(res, 404, { error: "not-found" });
  const body = await readJson(req);
  const lease = handles.get(body.handle);
  if (!lease) return sendJson(res, 403, { ok: false, reason: "opaque lease handle unknown" });
  if (lease.expiresAt < Date.now()) {
    handles.delete(body.handle);
    return sendJson(res, 403, { ok: false, reason: "opaque lease handle expired" });
  }
  if (lease.alias !== body.alias || lease.plane !== body.plane || lease.packageIdentityHash !== body.packageIdentityHash) return sendJson(res, 403, { ok: false, reason: "opaque lease handle scope mismatch" });
  lease.remainingUses -= 1;
  if (lease.remainingUses <= 0) handles.delete(body.handle);
  return sendJson(res, 200, { ok: true, handleHash: digest(body.handle), remainingUses: Math.max(0, lease.remainingUses) });
}

const handler = ROLE === "secret" ? secretRequest : ROLE === "action" ? actionRequest : observerRequest;
const server = http.createServer((req, res) => {
  Promise.resolve(handler(req, res)).catch((error) => {
    if (res.headersSent || res.destroyed) return req.socket.destroy();
    const reason = String(error?.message ?? error).replace(/[\r\n]/g, " ").slice(0, 240);
    sendJson(res, 400, { error: reason }, { "x-das-error-reason": reason });
  });
});

server.on("clientError", (_error, socket) => socket.destroy());
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.send?.({ type: "ready", address, identity: identity() });
});

process.on("message", async (message) => {
  const requestId = message?.requestId;
  try {
    if (message.type === "issue-handle") return process.send?.({ type: "reply", requestId, ok: true, value: issueHandle(message) });
    if (message.type === "configure") {
      requireCondition(ROLE !== "secret", "secret process cannot receive a business control");
      currentControl = structuredClone(message.control);
      return process.send?.({ type: "reply", requestId, ok: true, value: { configured: true, processInstanceId: CONFIG.processInstanceId } });
    }
    if (message.type === "stats") return process.send?.({ type: "reply", requestId, ok: true, value: { requestsReceived, observerWrites, handleCount: handles.size, pid: process.pid } });
    if (message.type === "shutdown") {
      return server.close(() => {
        process.send?.({ type: "reply", requestId, ok: true, value: { closed: true } });
        process.exit(0);
      });
    }
    throw new Error("unsupported worker IPC message");
  } catch (error) {
    process.send?.({ type: "reply", requestId, ok: false, error: String(error?.message ?? error).slice(0, 500) });
  }
});

process.on("disconnect", () => server.close(() => process.exit(0)));
