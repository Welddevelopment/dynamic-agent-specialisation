import { digest } from "../core/canonical.js";

const HASH = /^[a-f0-9]{64}$/;
const ALIAS = /^[A-Z][A-Z0-9_]{5,120}$/;
const HANDLE = /^daslh_[A-Za-z0-9_-]{32,180}$/;
const SECRET_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\bBasic\s+[A-Za-z0-9+/=]{8,}|\bsk-[A-Za-z0-9_-]{8,}|-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----|\b(?:password|secret|token|api[-_]?key)\s*[:=]\s*["']?[^\s,"'}]{6,})/i;
const MAX_RESPONSE_BYTES = 256 * 1024;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

function clean(value, maximum = 240) {
  return String(value ?? "").trim().slice(0, maximum);
}

function assertNoSecrets(value, label) {
  requireCondition(!SECRET_VALUE.test(JSON.stringify(value)), `${label} contains credential material`);
}

function exactHash(value, label) {
  requireCondition(HASH.test(value ?? ""), `${label} must be an exact SHA-256 identity`);
  return value;
}

function exactAlias(value, label) {
  requireCondition(ALIAS.test(value ?? ""), `${label} must be one environment-reference alias`);
  return value;
}

function assertSafeJson(value, depth = 0, state = { nodes: 0 }) {
  requireCondition(depth <= 20 && ++state.nodes <= 10_000, "Local-process JSON exceeds structural limits");
  if (Array.isArray(value)) {
    requireCondition(value.length <= 1_000, "Local-process JSON array exceeds structural limits");
    value.forEach((child) => assertSafeJson(child, depth + 1, state));
    return;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    requireCondition(keys.length <= 500, "Local-process JSON object exceeds structural limits");
    for (const key of keys) {
      requireCondition(!["__proto__", "prototype", "constructor"].includes(key), "Local-process JSON contains an unsafe object key");
      assertSafeJson(value[key], depth + 1, state);
    }
  }
}

function endpointRecord({ role, packageIdentityHash, serverIdentityHash, processInstanceId, host, port, protocol = "http:", revision = 1, pid = null }) {
  requireCondition(["action", "observer", "secret"].includes(role), "Local-process endpoint role is unsupported");
  exactHash(packageIdentityHash, "Local-process package identity");
  exactHash(serverIdentityHash, "Local-process server identity");
  requireCondition(clean(processInstanceId, 200), "Local-process endpoint needs a process instance identity");
  requireCondition(host === "127.0.0.1", "Local-process transport permits only exact 127.0.0.1; DNS and host substitution are blocked");
  requireCondition(protocol === "http:", "DAS-028 is HTTP-local only and must not claim TLS");
  requireCondition(Number.isInteger(port) && port >= 1024 && port <= 65535, "Local-process endpoint port is invalid");
  requireCondition(Number.isInteger(revision) && revision >= 1, "Local-process endpoint revision is invalid");
  const endpoint = {
    schemaVersion: "das.customer-local-process-endpoint.v1",
    role,
    packageIdentityHash,
    serverIdentityHash,
    processInstanceId: clean(processInstanceId, 200),
    host,
    port,
    protocol,
    origin: `${protocol}//${host}:${port}`,
    revision,
    pid: Number.isInteger(pid) && pid > 0 ? pid : null,
    loopbackOnly: true,
    tls: false,
    tlsVerified: false,
    redirectsAllowed: false,
    customerEnvironmentAccepted: false,
    activationReady: false,
  };
  endpoint.endpointHash = digest(endpoint);
  assertNoSecrets(endpoint, "Local-process endpoint");
  return Object.freeze(endpoint);
}

export function createCustomerLocalProcessEndpoint(input) {
  return endpointRecord(input);
}

export function assertCustomerLocalProcessEndpoint(endpoint, expected = {}) {
  requireCondition(endpoint?.schemaVersion === "das.customer-local-process-endpoint.v1" && endpoint.endpointHash === digest(withoutHash(endpoint, "endpointHash")), "Local-process endpoint integrity mismatch");
  const canonical = endpointRecord(endpoint);
  requireCondition(canonical.endpointHash === endpoint.endpointHash, "Local-process endpoint widened host, protocol, TLS, redirect, execution, or activation state");
  for (const [key, value] of Object.entries(expected)) requireCondition(endpoint[key] === value, `Local-process endpoint ${key} differs from the exact expected identity`);
  return true;
}

async function boundedJsonResponse(response, { endpoint, maximumResponseBytes = MAX_RESPONSE_BYTES, expectedStatuses = [200] }) {
  const safeReason = clean(response.headers.get("x-das-error-reason"), 240);
  requireCondition(expectedStatuses.includes(response.status), `Local-process ${endpoint.role} server returned HTTP ${response.status}${safeReason ? `: ${safeReason}` : ""}`);
  requireCondition(response.url.startsWith(`${endpoint.origin}/`), "Local-process response came from another host or port");
  requireCondition(response.headers.get("x-das-server-identity") === endpoint.serverIdentityHash, "Local-process stable server identity drifted");
  requireCondition(response.headers.get("x-das-process-instance") === endpoint.processInstanceId, "Local-process response came from an unadopted process replacement");
  const contentType = response.headers.get("content-type") ?? "";
  requireCondition(/^application\/json(?:;|$)/i.test(contentType), "Local-process response is not declared JSON");
  const contentLength = response.headers.get("content-length");
  const transferEncoding = response.headers.get("transfer-encoding");
  requireCondition(!(contentLength && transferEncoding), "Local-process response has conflicting length and transfer encoding");
  if (contentLength !== null) requireCondition(Number.isInteger(Number(contentLength)) && Number(contentLength) >= 0 && Number(contentLength) <= maximumResponseBytes, "Local-process response exceeds the exact size ceiling");
  const bytes = new Uint8Array(await response.arrayBuffer());
  requireCondition(bytes.byteLength <= maximumResponseBytes, "Local-process response exceeds the exact size ceiling");
  let value;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("Local-process response contains malformed JSON"); }
  assertSafeJson(value);
  assertNoSecrets(value, "Local-process response");
  return value;
}

function fetchWithTimeout(url, init, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("local-process transport timeout")), timeoutMs);
  return fetchImpl(url, { ...init, redirect: "error", signal: controller.signal }).finally(() => clearTimeout(timer));
}

function exactUrl(endpoint, relative) {
  assertCustomerLocalProcessEndpoint(endpoint);
  requireCondition(typeof relative === "string" && relative.startsWith("/") && !relative.startsWith("//") && !relative.includes("\\"), "Local-process path is invalid");
  const url = new URL(relative, endpoint.origin);
  requireCondition(url.protocol === "http:" && url.hostname === "127.0.0.1" && Number(url.port) === endpoint.port && url.username === "" && url.password === "" && url.hash === "", "Local-process URL escaped the exact loopback endpoint");
  return url;
}

function addAuthentication(headers, placement, handle) {
  requireCondition(HANDLE.test(handle ?? ""), "Local secret interface returned an invalid opaque handle");
  const output = new Headers(headers);
  if (placement.kind === "bearer") {
    requireCondition(!output.has("authorization"), "Business request attempted to replace the authentication handle");
    output.set("authorization", `DASLease ${handle}`);
  } else if (placement.kind === "api-key-header") {
    requireCondition(clean(placement.wireName, 120) && !/[\r\n:]/.test(placement.wireName), "Local-process API-key header placement is invalid");
    requireCondition(!output.has(placement.wireName), "Business request attempted to replace the authentication handle");
    output.set(placement.wireName, handle);
  } else {
    requireCondition(placement.kind === "mcp-lease-header", "Local-process authentication placement is unsupported");
    output.set("authorization", `DASLease ${handle}`);
  }
  return output;
}

export function createCustomerLocalSecretLeaseResolver({ secretClient, alias, plane, packageIdentityHash }) {
  requireCondition(secretClient && typeof secretClient.issueHandle === "function", "Customer-local secret resolver requires a separate secret-process interface");
  exactAlias(alias, "Secret resolver alias");
  requireCondition(["action", "observer"].includes(plane), "Secret resolver plane is unsupported");
  exactHash(packageIdentityHash, "Secret resolver package identity");
  return async function resolveCredentialLease(request) {
    requireCondition(request?.alias === alias && request?.plane === plane && request?.packageIdentityHash === packageIdentityHash, "Secret resolver rejected an alias, plane, or package widening");
    let used = false;
    return Object.freeze({
      alias,
      plane,
      packageIdentityHash,
      persistable: false,
      loggable: false,
      async use(operation) {
        requireCondition(!used && typeof operation === "function", "Opaque customer-local credential lease is single-use");
        used = true;
        const issued = await secretClient.issueHandle({ alias, plane, packageIdentityHash });
        requireCondition(HANDLE.test(issued?.handle ?? "") && HASH.test(issued?.handleHash ?? "") && issued.handleHash === digest(issued.handle), "Secret process returned an invalid opaque handle receipt");
        return operation(issued.handle);
      },
    });
  };
}

function validateOpenApiRequest(request, operation, sourceBaseUrl = null) {
  requireCondition(request?.family === "openapi" && request.method === operation.method && request.operationIdentityHash === operation.operationIdentityHash, "OpenAPI local transport method or operation identity widened");
  requireCondition(request.route.startsWith("/") && !request.route.includes("{") && !request.route.includes("}"), "OpenAPI local transport route is unresolved");
  if (sourceBaseUrl !== null) requireCondition(request.baseUrl === sourceBaseUrl, "OpenAPI local transport source base identity widened");
  return true;
}

function validateMcpRequest(request, operation) {
  const operationIdentityHash = request?.operationIdentityHash ?? request?.inputSchemaHash;
  requireCondition(request?.family === "mcp-tools-list" && request.serverId === operation.serverId && request.serverVersion === operation.serverVersion && request.toolsListHash === operation.toolsListHash && request.tool === operation.operationName && request.inputSchemaHash === operation.operationIdentityHash && operationIdentityHash === operation.operationIdentityHash, "MCP local transport server, tool, or schema widened");
  return true;
}

function openApiRequestUrl(endpoint, request) {
  const url = exactUrl(endpoint, request.route);
  for (const [name, value] of Object.entries(request.query ?? {})) url.searchParams.append(name, String(value));
  return url;
}

async function performActionRequest({ endpoint, request, handle, placement, timeoutMs, maximumResponseBytes, fetchImpl }) {
  let issued = false;
  try {
    if (request.family === "openapi") {
      const url = openApiRequestUrl(endpoint, request);
      const headers = addAuthentication({ "content-type": "application/json", "x-das-operation-identity": request.operationIdentityHash, ...request.headers }, placement, handle);
      issued = true;
      const response = await fetchWithTimeout(url, { method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? undefined : JSON.stringify(request.body ?? {}) }, timeoutMs, fetchImpl);
      const value = await boundedJsonResponse(response, { endpoint, maximumResponseBytes, expectedStatuses: [200, 201, 202] });
      return { status: value.status ?? `http-${response.status}`, transportAttemptId: value.transportAttemptId ?? digest({ endpointHash: endpoint.endpointHash, operationIdentityHash: request.operationIdentityHash }), responseShapeHash: digest(value) };
    }
    const url = exactUrl(endpoint, "/mcp/call");
    const operationIdentityHash = request.operationIdentityHash ?? request.inputSchemaHash;
    const headers = addAuthentication({ "content-type": "application/json", "x-das-operation-identity": operationIdentityHash }, placement, handle);
    issued = true;
    const response = await fetchWithTimeout(url, { method: "POST", headers, body: JSON.stringify(request) }, timeoutMs, fetchImpl);
    const value = await boundedJsonResponse(response, { endpoint, maximumResponseBytes, expectedStatuses: [200, 201, 202] });
    return { status: value.status ?? `http-${response.status}`, transportAttemptId: value.transportAttemptId ?? digest({ endpointHash: endpoint.endpointHash, operationIdentityHash }), responseShapeHash: digest(value) };
  } catch (error) {
    if (error?.name === "AbortError" || String(error?.message).includes("timeout")) {
      const timeout = new Error("local-process transport timeout before a trusted response");
      timeout.responseLost = issued;
      throw timeout;
    }
    if (/returned HTTP 401|returned HTTP 403/.test(String(error?.message))) throw error;
    const wrapped = new Error(`local-process action response unavailable: ${error?.message ?? error}`);
    wrapped.responseLost = issued;
    throw wrapped;
  }
}

async function performReadRequest({ endpoint, request, handle, placement, timeoutMs, maximumResponseBytes, fetchImpl }) {
  if (request.family === "openapi") {
    const url = openApiRequestUrl(endpoint, request);
    const headers = addAuthentication({ "x-das-operation-identity": request.operationIdentityHash, ...request.headers }, placement, handle);
    const response = await fetchWithTimeout(url, { method: request.method, headers }, timeoutMs, fetchImpl);
    return boundedJsonResponse(response, { endpoint, maximumResponseBytes, expectedStatuses: [200] });
  }
  const url = exactUrl(endpoint, "/mcp/call");
  const operationIdentityHash = request.operationIdentityHash ?? request.inputSchemaHash;
  const headers = addAuthentication({ "content-type": "application/json", "x-das-operation-identity": operationIdentityHash, ...(request.headers ?? {}) }, placement, handle);
  const response = await fetchWithTimeout(url, { method: "POST", headers, body: JSON.stringify(request) }, timeoutMs, fetchImpl);
  return boundedJsonResponse(response, { endpoint, maximumResponseBytes, expectedStatuses: [200] });
}

export function createCustomerLocalActionProcessTransport({ endpoint, writeOperation, reconciliationOperation, sourceBaseUrl = null, authenticationPlacement, timeoutMs, maximumResponseBytes = MAX_RESPONSE_BYTES, fetchImpl = fetch }) {
  assertCustomerLocalProcessEndpoint(endpoint, { role: "action" });
  requireCondition(typeof fetchImpl === "function", "Action local-process transport requires fetch");
  requireCondition(Number.isInteger(timeoutMs) && timeoutMs >= 25 && timeoutMs <= 30_000, "Action local-process timeout is invalid");
  return Object.freeze({
    async execute({ request, lease, authorityReceipt, packageIdentityHash }) {
      requireCondition(packageIdentityHash === endpoint.packageIdentityHash && authorityReceipt?.allowed === true && authorityReceipt.packageIdentityHash === packageIdentityHash, "Action local-process transport lacks exact current authority");
      if (request.family === "openapi") validateOpenApiRequest(request, writeOperation, sourceBaseUrl); else validateMcpRequest(request, writeOperation);
      return lease.use((handle) => performActionRequest({ endpoint, request, handle, placement: authenticationPlacement, timeoutMs, maximumResponseBytes, fetchImpl }));
    },
    async read({ request, lease, packageIdentityHash }) {
      requireCondition(packageIdentityHash === endpoint.packageIdentityHash, "Action reconciliation crossed package identity");
      if (request.family === "openapi") validateOpenApiRequest(request, reconciliationOperation, sourceBaseUrl); else validateMcpRequest(request, reconciliationOperation);
      return lease.use((handle) => performReadRequest({ endpoint, request, handle, placement: authenticationPlacement, timeoutMs, maximumResponseBytes, fetchImpl }));
    },
    endpoint,
  });
}

function serializeObserverOperation(operation, assignedWork) {
  if (operation.family === "mcp-tools-list") {
    const args = {};
    for (const key of Object.keys(operation.inputSchema.properties)) if (Object.hasOwn(assignedWork, key)) args[key] = assignedWork[key];
    requireCondition(operation.inputSchema.required.every((field) => Object.hasOwn(args, field)), `Observer MCP operation ${operation.operationName} lacks exact assigned-work input`);
    return { family: operation.family, serverId: operation.serverId, serverVersion: operation.serverVersion, toolsListHash: operation.toolsListHash, tool: operation.operationName, inputSchemaHash: operation.operationIdentityHash, operationIdentityHash: operation.operationIdentityHash, arguments: args };
  }
  let route = operation.route;
  const query = {};
  const headers = {};
  for (const parameter of operation.parameters) {
    const value = assignedWork[parameter.name];
    if (parameter.required) requireCondition(value !== undefined, `Observer OpenAPI operation ${operation.operationName} lacks ${parameter.name}`);
    if (value === undefined) continue;
    if (parameter.in === "path") route = route.replace(`{${parameter.name}}`, encodeURIComponent(String(value)));
    else if (parameter.in === "query") query[parameter.name] = value;
    else headers[parameter.name] = value;
  }
  requireCondition(!/[{}]/.test(route), `Observer OpenAPI operation ${operation.operationName} has unresolved route input`);
  return { family: "openapi", operationIdentityHash: operation.operationIdentityHash, method: operation.method, route, query, headers, body: null };
}

export function createCustomerLocalObserverProcessTransport({ endpoint, operations, authenticationPlacement, timeoutMs, maximumResponseBytes = MAX_RESPONSE_BYTES, fetchImpl = fetch }) {
  assertCustomerLocalProcessEndpoint(endpoint, { role: "observer" });
  requireCondition(Array.isArray(operations) && operations.length > 0 && operations.every((operation) => ["GET", "HEAD", undefined].includes(operation.method)), "Observer local-process transport requires exact read-only operations");
  const operationByHash = new Map(operations.map((operation) => [operation.operationIdentityHash, operation]));
  requireCondition(operationByHash.size === operations.length, "Observer local-process operations contain duplicate identities");
  return Object.freeze({
    async observe({ phase, assignedWork, operations: requestedOperations, lease, observationNotBeforeMs, packageIdentityHash }) {
      requireCondition(packageIdentityHash === endpoint.packageIdentityHash && ["before", "after"].includes(phase), "Observer local-process request widened package or phase");
      requireCondition(Array.isArray(requestedOperations) && requestedOperations.length === operations.length && requestedOperations.every((operation) => operationByHash.has(operation.operationIdentityHash)), "Observer local-process operation set widened");
      return lease.use(async (handle) => {
        const responses = [];
        for (const operation of operations) {
          const request = serializeObserverOperation(operation, assignedWork);
          if (request.family === "openapi") validateOpenApiRequest(request, operation); else validateMcpRequest(request, operation);
          const phaseHeaders = { ...(request.headers ?? {}), "x-das-observation-phase": phase, "x-das-observation-fence": String(observationNotBeforeMs ?? "") };
          const response = await performReadRequest({ endpoint, request: { ...request, headers: phaseHeaders }, handle, placement: authenticationPlacement, timeoutMs, maximumResponseBytes, fetchImpl });
          if (["unknown", "unavailable"].includes(response.availability)) return { availability: response.availability, reason: response.reason };
          responses.push(response);
        }
        const outcome = responses.find((response) => response.kind === "outcome");
        const protectedState = responses.find((response) => response.kind === "protected-state");
        requireCondition(outcome && protectedState, "Observer local-process response omitted outcome or protected-state evidence");
        return {
          snapshotGeneratedAt: Math.min(outcome.snapshotGeneratedAt, protectedState.snapshotGeneratedAt),
          caughtUpThrough: Math.min(outcome.caughtUpThrough, protectedState.caughtUpThrough),
          matches: structuredClone(outcome.matches),
          changedEntities: structuredClone(protectedState.changedEntities),
          unrelatedStateDigest: protectedState.unrelatedStateDigest,
        };
      });
    },
    endpoint,
    readOnly: true,
    writeOperations: Object.freeze([]),
  });
}

export async function probeCustomerLocalProcessEndpoint({ endpoint, fetchImpl = fetch, timeoutMs = 2_000 }) {
  assertCustomerLocalProcessEndpoint(endpoint);
  const response = await fetchWithTimeout(exactUrl(endpoint, "/identity"), { method: "GET" }, timeoutMs, fetchImpl);
  const identity = await boundedJsonResponse(response, { endpoint, maximumResponseBytes: 16_384, expectedStatuses: [200] });
  requireCondition(identity.role === endpoint.role && identity.packageIdentityHash === endpoint.packageIdentityHash && identity.serverIdentityHash === endpoint.serverIdentityHash && identity.processInstanceId === endpoint.processInstanceId, "Local-process identity challenge failed");
  requireCondition(identity.pid === endpoint.pid, "Local-process identity challenge returned another process");
  return Object.freeze(identity);
}

export async function adoptCustomerLocalProcessReplacement({ current, replacement, fetchImpl = fetch }) {
  assertCustomerLocalProcessEndpoint(current);
  assertCustomerLocalProcessEndpoint(replacement, { role: current.role, packageIdentityHash: current.packageIdentityHash, serverIdentityHash: current.serverIdentityHash });
  requireCondition(replacement.processInstanceId !== current.processInstanceId && replacement.port !== current.port && replacement.pid !== current.pid, "Local-process replacement reused the prior process or port");
  requireCondition(replacement.revision === current.revision + 1, "Local-process replacement revision is not the exact successor");
  await probeCustomerLocalProcessEndpoint({ endpoint: replacement, fetchImpl });
  return replacement;
}

export function createCustomerLocalProcessTransportReceipt({ packageIdentityHash, actionEndpoint, observerEndpoint, secretEndpoint, actionAlias, observerAlias, runtimeReceiptHash }) {
  [actionEndpoint, observerEndpoint, secretEndpoint].forEach((endpoint) => assertCustomerLocalProcessEndpoint(endpoint, { packageIdentityHash }));
  requireCondition(new Set([actionEndpoint.pid, observerEndpoint.pid, secretEndpoint.pid]).size === 3, "Secret, action and observer must be separate local processes");
  requireCondition(new Set([actionEndpoint.port, observerEndpoint.port, secretEndpoint.port]).size === 3, "Secret, action and observer must use separate local ports");
  requireCondition(actionEndpoint.serverIdentityHash !== observerEndpoint.serverIdentityHash && actionEndpoint.processInstanceId !== observerEndpoint.processInstanceId, "Action and observer process identities collapsed");
  exactAlias(actionAlias, "Action process alias");
  exactAlias(observerAlias, "Observer process alias");
  requireCondition(actionAlias !== observerAlias, "Action and observer credential aliases collapsed");
  exactHash(runtimeReceiptHash, "Generated runtime receipt");
  const receipt = {
    schemaVersion: "das.customer-local-process-transport-receipt.v1",
    packageIdentityHash,
    runtimeReceiptHash,
    actionEndpointHash: actionEndpoint.endpointHash,
    observerEndpointHash: observerEndpoint.endpointHash,
    secretEndpointHash: secretEndpoint.endpointHash,
    actionAlias,
    observerAlias,
    processCount: 3,
    distinctPorts: 3,
    credentialValuesPresent: false,
    opaqueHandlesOnly: true,
    loopbackOnly: true,
    protocol: "http-local-only",
    tls: false,
    customerEnvironmentAccepted: false,
    customerExecutionReady: false,
    activationReady: false,
    evidenceBoundary: "Three customer-shaped fictional localhost processes with alias/handle-only authentication. This is not TLS, a hostile OS boundary, a real provider, customer acceptance, deployment or activation.",
  };
  receipt.receiptHash = digest(receipt);
  assertNoSecrets(receipt, "Local-process transport receipt");
  return Object.freeze(receipt);
}

export const CUSTOMER_LOCAL_PROCESS_MAX_RESPONSE_BYTES = MAX_RESPONSE_BYTES;
