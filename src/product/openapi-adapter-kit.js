import { digest } from "../core/canonical.js";

const READ_METHODS = new Set(["get", "head"]);
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head"]);
const SECRET_REF = /^[A-Z][A-Z0-9_]{5,120}$/;

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function clean(value, maximum = 240) { return String(value ?? "").trim().slice(0, maximum); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function stable(value) { return JSON.parse(JSON.stringify(value)); }
function cleanStringList(value, label) {
  requireCondition(value === undefined || Array.isArray(value), `${label} must be an array`);
  const normalized = [...new Set((value ?? []).map((item) => clean(item, 240)).filter(Boolean))].sort();
  requireCondition(normalized.length === (value ?? []).length, `${label} cannot contain empty or duplicate values`);
  return normalized;
}

function rejectExternalReferences(value, location = "spec") {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectExternalReferences(item, `${location}[${index}]`));
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref") requireCondition(typeof child === "string" && child.startsWith("#/"), `External OpenAPI reference is forbidden at ${location}`);
    else rejectExternalReferences(child, `${location}.${key}`);
  }
}

function jsonPointer(value, pointer) {
  if (pointer === "" || pointer === "/") return value;
  requireCondition(typeof pointer === "string" && pointer.startsWith("/"), `Invalid JSON pointer: ${pointer}`);
  return pointer.slice(1).split("/").reduce((current, segment) => current?.[segment.replace(/~1/g, "/").replace(/~0/g, "~")], value);
}

function resolveComponentObject(value, spec, allowedPrefixes, trail = []) {
  if (!value?.$ref) return value ?? {};
  requireCondition(Object.keys(value).length === 1 && allowedPrefixes.some((prefix) => value.$ref.startsWith(prefix)), `Unsupported local OpenAPI component reference: ${value.$ref}`);
  requireCondition(!trail.includes(value.$ref), `Cyclic OpenAPI component reference: ${value.$ref}`);
  const target = jsonPointer(spec, value.$ref.slice(1));
  requireCondition(target, `Missing OpenAPI component reference: ${value.$ref}`);
  return resolveComponentObject(target, spec, allowedPrefixes, [...trail, value.$ref]);
}

function safeBaseUrl(value) {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  requireCondition(url.protocol === "https:" || (url.protocol === "http:" && local), "OpenAPI adapter requires HTTPS or an explicit localhost test server");
  requireCondition(!url.username && !url.password && !url.search && !url.hash, "OpenAPI base URL cannot contain credentials, query, or fragment");
  return url.toString().replace(/\/$/, "");
}

function dereferenceSchema(schema, spec, trail = [], depth = 0) {
  requireCondition(depth <= 32, "OpenAPI schema reference depth exceeded");
  if (!isObject(schema)) return schema ?? {};
  if (schema.$ref) {
    requireCondition(Object.keys(schema).length === 1, "OpenAPI $ref siblings are not accepted in the bounded importer");
    requireCondition(schema.$ref.startsWith("#/components/schemas/"), "Only local component schema references are supported");
    requireCondition(!trail.includes(schema.$ref), `Cyclic OpenAPI schema reference: ${schema.$ref}`);
    const name = decodeURIComponent(schema.$ref.slice("#/components/schemas/".length));
    const target = spec.components?.schemas?.[name];
    requireCondition(target, `Missing OpenAPI component schema: ${name}`);
    return dereferenceSchema(target, spec, [...trail, schema.$ref], depth + 1);
  }
  const output = {};
  for (const [key, value] of Object.entries(schema)) {
    if (["example", "examples", "default"].includes(key)) continue;
    if (key === "properties") output.properties = Object.fromEntries(Object.entries(value ?? {}).map(([name, child]) => [name, dereferenceSchema(child, spec, trail, depth + 1)]));
    else if (key === "items") output.items = dereferenceSchema(value, spec, trail, depth + 1);
    else if (["allOf", "anyOf", "oneOf"].includes(key)) output[key] = (value ?? []).map((child) => dereferenceSchema(child, spec, trail, depth + 1));
    else if (["type", "format", "enum", "required", "additionalProperties", "minimum", "maximum", "minLength", "maxLength", "pattern", "minItems", "maxItems", "nullable"].includes(key)) output[key] = stable(value);
  }
  return output;
}

function locateOperations(spec) {
  const operations = new Map();
  for (const [route, pathItem] of Object.entries(spec.paths ?? {})) {
    requireCondition(route.startsWith("/"), `OpenAPI route must start with /: ${route}`);
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      requireCondition(operation?.operationId, `Every imported OpenAPI operation needs operationId: ${method.toUpperCase()} ${route}`);
      requireCondition(!operations.has(operation.operationId), `Duplicate OpenAPI operationId: ${operation.operationId}`);
      operations.set(operation.operationId, { route, method: method.toLowerCase(), operation, pathParameters: pathItem.parameters ?? [] });
    }
  }
  return operations;
}

function parameterSchema(parameters, location, spec) {
  const selected = parameters.map((parameter) => resolveComponentObject(parameter, spec, ["#/components/parameters/"])).filter((parameter) => parameter.in === location);
  if (!selected.length) return { type: "object", properties: {}, required: [], additionalProperties: false };
  return {
    type: "object",
    properties: Object.fromEntries(selected.map((parameter) => [parameter.name, dereferenceSchema(parameter.schema ?? {}, spec)])),
    required: selected.filter((parameter) => parameter.required === true || location === "path").map((parameter) => parameter.name),
    additionalProperties: false,
  };
}

function inputSchemaFor(found, spec, mode) {
  const parameters = [...found.pathParameters, ...(found.operation.parameters ?? [])];
  const requestBody = resolveComponentObject(found.operation.requestBody, spec, ["#/components/requestBodies/"]);
  const body = requestBody?.content?.["application/json"]?.schema;
  const properties = {
    path: parameterSchema(parameters, "path", spec),
    query: parameterSchema(parameters, "query", spec),
    headers: parameterSchema(parameters, "header", spec),
  };
  if (body) properties.body = dereferenceSchema(body, spec);
  if (mode === "write") properties.idempotencyKey = { type: "string", minLength: 8, maxLength: 200 };
  return { type: "object", properties, required: [...(body && requestBody?.required ? ["body"] : []), ...(mode === "write" ? ["idempotencyKey"] : [])], additionalProperties: false };
}

function schemaAtPointer(schema, pointer) {
  requireCondition(typeof pointer === "string" && pointer.startsWith("/"), `Invalid input-schema pointer: ${pointer}`);
  let current = schema;
  for (const segment of pointer.slice(1).split("/")) {
    const name = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    const direct = current?.properties?.[name];
    const composed = [...(current?.allOf ?? []), ...(current?.anyOf ?? []), ...(current?.oneOf ?? [])].map((child) => child?.properties?.[name]).find(Boolean);
    requireCondition(direct || composed, `Input-schema pointer is outside the bounded input: ${pointer}`);
    current = direct ?? composed;
  }
  return current;
}

function authFor(found, spec, credentialRefs) {
  const requirements = found.operation.security ?? spec.security ?? [];
  if (!requirements.length) return [];
  requireCondition(requirements.length === 1, `Operation ${found.operation.operationId} must select one bounded security requirement`);
  const requirement = requirements[0];
  return Object.keys(requirement).map((schemeName) => {
    const scheme = spec.components?.securitySchemes?.[schemeName];
    const configured = credentialRefs?.[schemeName];
    requireCondition(scheme, `Missing OpenAPI security scheme: ${schemeName}`);
    if (scheme.type === "apiKey") {
      requireCondition(SECRET_REF.test(configured ?? ""), `Security scheme ${schemeName} needs an environment credential reference`);
      requireCondition(scheme.in === "header" && clean(scheme.name), `Only header OpenAPI apiKey schemes are supported: ${schemeName}`);
      return { schemeName, kind: "api-key-header", headerName: clean(scheme.name, 120), credentialRef: configured };
    }
    if (scheme.type === "http" && String(scheme.scheme).toLowerCase() === "bearer") {
      requireCondition(SECRET_REF.test(configured ?? ""), `Security scheme ${schemeName} needs an environment credential reference`);
      return { schemeName, kind: "bearer-header", headerName: "Authorization", credentialRef: configured };
    }
    if (scheme.type === "oauth2") {
      requireCondition(SECRET_REF.test(configured ?? ""), `OAuth2 scheme ${schemeName} needs a customer-managed access-token reference`);
      return { schemeName, kind: "oauth2-bearer-header", headerName: "Authorization", credentialRef: configured, tokenLifecycle: "customer-managed-resolved-per-request" };
    }
    if (scheme.type === "http" && String(scheme.scheme).toLowerCase() === "basic") {
      requireCondition(isObject(configured) && SECRET_REF.test(configured.usernameRef ?? "") && SECRET_REF.test(configured.passwordRef ?? ""), `Basic scheme ${schemeName} needs usernameRef and passwordRef environment references`);
      return { schemeName, kind: "basic-header", headerName: "Authorization", credentialRefs: [configured.usernameRef, configured.passwordRef] };
    }
    throw new Error(`Unsupported bounded OpenAPI security scheme: ${schemeName}`);
  });
}

function normalizeVerification(value, operations, writeInputSchema, spec) {
  requireCondition(value?.readOperationId && operations.has(value.readOperationId), "Every write needs an existing read operation for independent outcome verification");
  const readFound = operations.get(value.readOperationId);
  requireCondition(READ_METHODS.has(readFound.method), "Outcome verification must use a read-only OpenAPI operation");
  requireCondition(Array.isArray(value.inputMap) && value.inputMap.length > 0, "Outcome verification needs an explicit write-input to read-input map");
  requireCondition(Array.isArray(value.assertions) && value.assertions.length > 0, "Outcome verification needs at least one external-state assertion");
  const readInputSchema = inputSchemaFor(readFound, spec, "read");
  const inputMap = value.inputMap.map((mapping) => {
    requireCondition(["path", "query", "headers"].includes(mapping.targetSection) && clean(mapping.targetName) && typeof mapping.writeInputPointer === "string", "Invalid outcome-verifier input map");
    requireCondition(readInputSchema.properties?.[mapping.targetSection]?.properties?.[mapping.targetName], `Outcome verifier target is outside the read operation: ${mapping.targetSection}.${mapping.targetName}`);
    schemaAtPointer(writeInputSchema, mapping.writeInputPointer);
    return { targetSection: mapping.targetSection, targetName: clean(mapping.targetName, 120), writeInputPointer: mapping.writeInputPointer };
  });
  const assertions = value.assertions.map((assertion) => {
    requireCondition(typeof assertion.actualPointer === "string", "Outcome assertion needs actualPointer");
    const modes = [Object.hasOwn(assertion, "equals"), typeof assertion.equalsWriteInputPointer === "string"];
    requireCondition(modes.filter(Boolean).length === 1, "Outcome assertion needs exactly one expected-value source");
    if (typeof assertion.equalsWriteInputPointer === "string") schemaAtPointer(writeInputSchema, assertion.equalsWriteInputPointer);
    return Object.hasOwn(assertion, "equals") ? { actualPointer: assertion.actualPointer, equals: stable(assertion.equals) } : { actualPointer: assertion.actualPointer, equalsWriteInputPointer: assertion.equalsWriteInputPointer };
  });
  requireCondition(writeInputSchema.type === "object", "Invalid write input schema");
  return { readOperationId: value.readOperationId, inputMap, assertions };
}

export function compileOpenApiAdapterPlan({ spec, adapterId, adapterVersion = "1.0.0", baseUrl, operationBindings, credentialRefs = {}, maximumResponseBytes = 1_000_000, timeoutMs = 15_000 }) {
  requireCondition(isObject(spec) && /^3\.\d+\.\d+/.test(spec.openapi ?? ""), "Bounded importer supports OpenAPI 3.x JSON objects");
  rejectExternalReferences(spec);
  requireCondition(clean(adapterId) && /^\d+\.\d+\.\d+/.test(adapterVersion), "Adapter needs a stable id and semantic version");
  requireCondition(Array.isArray(operationBindings) && operationBindings.length > 0, "Select at least one exact OpenAPI operation");
  requireCondition(Number.isInteger(maximumResponseBytes) && maximumResponseBytes >= 1024 && maximumResponseBytes <= 10_000_000, "Response byte limit must be between 1KB and 10MB");
  requireCondition(Number.isInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 120_000, "Timeout must be between 100ms and 120s");
  const operations = locateOperations(spec);
  const seenNames = new Set();
  const selected = operationBindings.map((binding) => {
    const found = operations.get(binding.operationId);
    requireCondition(found, `Unknown OpenAPI operationId: ${binding.operationId}`);
    const inferredMode = READ_METHODS.has(found.method) ? "read" : "write";
    requireCondition(binding.mode === inferredMode, `Operation ${binding.operationId} must be explicitly bound as ${inferredMode}`);
    const exposedName = clean(binding.exposedName || binding.operationId, 160);
    requireCondition(exposedName && !seenNames.has(exposedName), `Duplicate exposed operation name: ${exposedName}`);
    seenNames.add(exposedName);
    if (inferredMode === "write") requireCondition(clean(binding.authorityAction) && clean(binding.idempotencyHeader), `Write ${binding.operationId} needs authorityAction and idempotencyHeader`);
    const inputSchema = inputSchemaFor(found, spec, inferredMode);
    return {
      operationId: binding.operationId,
      exposedName,
      method: found.method.toUpperCase(),
      route: found.route,
      mode: inferredMode,
      authorityAction: inferredMode === "write" ? clean(binding.authorityAction, 160) : null,
      idempotencyHeader: inferredMode === "write" ? clean(binding.idempotencyHeader, 120) : null,
      auth: authFor(found, spec, credentialRefs),
      inputSchema,
      boundedInputSchemaHash: digest(inputSchema),
      verification: inferredMode === "write" ? normalizeVerification(binding.verification, operations, inputSchema, spec) : null,
      requiredContextSources: cleanStringList(binding.requiredContextSources, `Operation ${binding.operationId} requiredContextSources`),
    };
  });
  const selectedIds = new Set(selected.map((item) => item.operationId));
  for (const operation of selected.filter((item) => item.mode === "write")) requireCondition(selectedIds.has(operation.verification.readOperationId), `Verifier read operation must also be explicitly selected: ${operation.verification.readOperationId}`);
  const plan = {
    schemaVersion: "das.openapi-adapter-plan.v1",
    adapterId: clean(adapterId, 160),
    adapterVersion,
    status: "executable-bounded-contract",
    openApi: { version: spec.openapi, title: clean(spec.info?.title, 200), sourceHash: digest(spec), externalReferencesAllowed: false },
    baseUrl: safeBaseUrl(baseUrl ?? spec.servers?.[0]?.url),
    operations: selected,
    limits: { maximumResponseBytes, timeoutMs },
    evidenceBoundary: "Executable bounded OpenAPI adapter contract for an explicitly selected operation subset. It does not infer business success, prove a customer workflow, support arbitrary authentication, or establish production reliability.",
  };
  plan.planHash = digest(plan);
  return Object.freeze(plan);
}

export function assertOpenApiAdapterPlan(plan) {
  requireCondition(plan?.schemaVersion === "das.openapi-adapter-plan.v1" && plan.planHash === digest(withoutHash(plan, "planHash")), "OpenAPI adapter plan integrity mismatch");
  requireCondition(plan.status === "executable-bounded-contract" && plan.operations?.length > 0 && plan.operations.every((item) => item.boundedInputSchemaHash === digest(item.inputSchema)), "OpenAPI adapter plan operation contract changed");
  safeBaseUrl(plan.baseUrl);
  return true;
}

function validateSchema(value, schema, location = "input") {
  if (!schema || Object.keys(schema).length === 0) return;
  if (schema.nullable && value === null) return;
  for (const child of schema.allOf ?? []) validateSchema(value, child, location);
  if (schema.anyOf?.length) requireCondition(schema.anyOf.some((child) => { try { validateSchema(value, child, location); return true; } catch { return false; } }), `${location} does not match any allowed schema`);
  if (schema.oneOf?.length) requireCondition(schema.oneOf.filter((child) => { try { validateSchema(value, child, location); return true; } catch { return false; } }).length === 1, `${location} must match exactly one allowed schema`);
  if (schema.enum) requireCondition(schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value)), `${location} is outside the allowed enum`);
  if (schema.type === "object") {
    requireCondition(isObject(value), `${location} must be an object`);
    for (const key of schema.required ?? []) requireCondition(Object.hasOwn(value, key), `${location}.${key} is required`);
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) requireCondition(Object.hasOwn(schema.properties ?? {}, key), `${location}.${key} is not allowed`);
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (Object.hasOwn(value, key)) validateSchema(value[key], child, `${location}.${key}`);
  } else if (schema.type === "array") {
    requireCondition(Array.isArray(value), `${location} must be an array`);
    if (schema.minItems != null) requireCondition(value.length >= schema.minItems, `${location} has too few items`);
    if (schema.maxItems != null) requireCondition(value.length <= schema.maxItems, `${location} has too many items`);
    value.forEach((item, index) => validateSchema(item, schema.items ?? {}, `${location}[${index}]`));
  } else if (schema.type === "string") {
    requireCondition(typeof value === "string", `${location} must be a string`);
    if (schema.minLength != null) requireCondition(value.length >= schema.minLength, `${location} is too short`);
    if (schema.maxLength != null) requireCondition(value.length <= schema.maxLength, `${location} is too long`);
    if (schema.pattern) requireCondition(new RegExp(schema.pattern).test(value), `${location} has an invalid format`);
  } else if (schema.type === "integer") requireCondition(Number.isInteger(value), `${location} must be an integer`);
  else if (schema.type === "number") requireCondition(Number.isFinite(value), `${location} must be a number`);
  else if (schema.type === "boolean") requireCondition(typeof value === "boolean", `${location} must be a boolean`);
}

async function boundedResponse(response, maximumBytes) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  requireCondition(bytes.byteLength <= maximumBytes, "OpenAPI adapter response exceeds the byte limit");
  const text = new TextDecoder().decode(bytes);
  if (!text) return null;
  try { return JSON.parse(text); } catch { throw new Error("OpenAPI adapter expected a JSON response"); }
}

export function createOpenApiAdapterRuntime({ plan, fetchImpl = fetch, secretResolver, allowedAuthorityActions = [], externalStateReader = null }) {
  assertOpenApiAdapterPlan(plan);
  requireCondition(typeof fetchImpl === "function" && typeof secretResolver === "function", "OpenAPI runtime needs fetch and customer-local secret resolver functions");
  const operations = new Map(plan.operations.map((operation) => [operation.exposedName, operation]));
  const byId = new Map(plan.operations.map((operation) => [operation.operationId, operation]));
  const authority = new Set(allowedAuthorityActions);

  async function invoke(operation, input, { verificationRead = false } = {}) {
    validateSchema(input, operation.inputSchema);
    if (operation.mode === "write") requireCondition(authority.has(operation.authorityAction), `Missing authority: ${operation.authorityAction}`);
    if (verificationRead) requireCondition(operation.mode === "read", "Outcome verifier cannot execute a write");
    let route = operation.route;
    for (const [name, value] of Object.entries(input.path ?? {})) route = route.replaceAll(`{${name}}`, encodeURIComponent(String(value)));
    requireCondition(!/{[^}]+}/.test(route), `Missing path parameter for ${operation.operationId}`);
    const url = new URL(`${plan.baseUrl}${route}`);
    for (const [name, value] of Object.entries(input.query ?? {})) if (value != null) url.searchParams.append(name, String(value));
    const headers = { Accept: "application/json", ...(input.body !== undefined ? { "Content-Type": "application/json" } : {}) };
    for (const [name, value] of Object.entries(input.headers ?? {})) headers[name] = String(value);
    for (const auth of operation.auth) {
      if (auth.kind === "basic-header") {
        const [username, password] = await Promise.all(auth.credentialRefs.map((reference) => secretResolver(reference)));
        requireCondition(typeof username === "string" && username.length > 0 && typeof password === "string" && password.length > 0, `Basic credential references are unavailable: ${auth.schemeName}`);
        headers[auth.headerName] = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
      } else {
        const secret = await secretResolver(auth.credentialRef);
        requireCondition(typeof secret === "string" && secret.length > 0, `Credential reference is unavailable: ${auth.credentialRef}`);
        headers[auth.headerName] = ["bearer-header", "oauth2-bearer-header"].includes(auth.kind) ? `Bearer ${secret}` : secret;
      }
    }
    if (operation.mode === "write") headers[operation.idempotencyHeader] = input.idempotencyKey;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), plan.limits.timeoutMs);
    let response;
    try { response = await fetchImpl(url, { method: operation.method, headers, body: input.body === undefined ? undefined : JSON.stringify(input.body), signal: controller.signal, redirect: "error" }); }
    finally { clearTimeout(timer); }
    const output = await boundedResponse(response, plan.limits.maximumResponseBytes);
    if (!response.ok) {
      const error = new Error(`OpenAPI operation ${operation.operationId} returned HTTP ${response.status}`);
      error.status = response.status;
      error.output = output;
      throw error;
    }
    return output;
  }

  async function reconcile(exposedName, writeInput) {
    const write = operations.get(exposedName);
    requireCondition(write?.mode === "write", `Unknown write operation: ${exposedName}`);
    const read = byId.get(write.verification.readOperationId);
    const readInput = { path: {}, query: {}, headers: {} };
    for (const mapping of write.verification.inputMap) readInput[mapping.targetSection][mapping.targetName] = jsonPointer(writeInput, mapping.writeInputPointer);
    try {
      const external = await invoke(read, readInput, { verificationRead: true });
      const checks = write.verification.assertions.map((assertion) => {
        const expected = Object.hasOwn(assertion, "equals") ? assertion.equals : jsonPointer(writeInput, assertion.equalsWriteInputPointer);
        const actual = jsonPointer(external, assertion.actualPointer);
        return { actualPointer: assertion.actualPointer, passed: JSON.stringify(actual) === JSON.stringify(expected) };
      });
      return Object.freeze({ classification: checks.every((item) => item.passed) ? "completed" : "incorrect", independent: true, independentBusinessOutcomeProof: false, verifierKind: "action-plane-readback-through-openapi", operationId: read.operationId, checks });
    } catch (error) {
      if (error?.status === 404) return Object.freeze({ classification: "not-started", independent: true, independentBusinessOutcomeProof: false, verifierKind: "action-plane-readback-through-openapi", operationId: read.operationId, checks: [] });
      return Object.freeze({ classification: "unknown", independent: true, independentBusinessOutcomeProof: false, verifierKind: "action-plane-readback-through-openapi", operationId: read.operationId, checks: [], error: clean(error?.message, 240) });
    }
  }

  return Object.freeze({
    adapterId: plan.adapterId,
    planHash: plan.planHash,
    definitions: () => plan.operations.map((operation) => ({ name: operation.exposedName, mode: operation.mode, requiredAuthority: operation.authorityAction, requiredContextSources: [...operation.requiredContextSources], inputSchema: structuredClone(operation.inputSchema), boundedInputSchemaHash: operation.boundedInputSchemaHash })),
    requiredAction: (name) => operations.get(name)?.authorityAction ?? null,
    async execute(name, input) { const operation = operations.get(name); requireCondition(operation, `Operation is outside the adapter allowlist: ${name}`); return { id: `${plan.adapterId}:${name}:${digest({ input, at: Date.now() })}`, output: await invoke(operation, input) }; },
    reconcile,
    externalState() {
      requireCondition(typeof externalStateReader === "function", `Adapter ${plan.adapterId} has no independent external-state reader`);
      const snapshot = externalStateReader();
      requireCondition(snapshot && typeof snapshot === "object" && typeof snapshot.then !== "function", `Adapter ${plan.adapterId} external-state reader must return a synchronous object snapshot`);
      return stable(snapshot);
    },
  });
}

export function composeBoundedAdapterRuntimes({ runtimes, externalStateReader = null }) {
  requireCondition(Array.isArray(runtimes) && runtimes.length > 0, "At least one bounded adapter runtime is required");
  const byAdapter = new Map();
  const byTool = new Map();
  const definitions = [];
  for (const runtime of runtimes) {
    requireCondition(runtime?.adapterId && typeof runtime.definitions === "function" && typeof runtime.execute === "function" && typeof runtime.requiredAction === "function" && typeof runtime.reconcile === "function" && typeof runtime.externalState === "function", "Every composed adapter must implement the complete bounded runtime contract");
    requireCondition(!byAdapter.has(runtime.adapterId), `Duplicate adapter id: ${runtime.adapterId}`);
    byAdapter.set(runtime.adapterId, runtime);
    for (const definition of runtime.definitions()) {
      requireCondition(definition?.name && !byTool.has(definition.name), `Duplicate bounded tool name: ${definition?.name}`);
      byTool.set(definition.name, runtime);
      definitions.push(stable(definition));
    }
  }
  const adapterIds = [...byAdapter.keys()].sort();
  return Object.freeze({
    adapterId: `composed:${digest(adapterIds).slice(0, 16)}`,
    componentAdapterIds: adapterIds,
    definitions: () => stable(definitions),
    requiredAction(name) { return byTool.get(name)?.requiredAction(name) ?? null; },
    async execute(name, input, context) {
      const runtime = byTool.get(name);
      requireCondition(runtime, `Operation is outside every composed adapter allowlist: ${name}`);
      return runtime.execute(name, input, context);
    },
    async reconcile(name, input, context) {
      const runtime = byTool.get(name);
      requireCondition(runtime, `Unknown composed write operation: ${name}`);
      return runtime.reconcile(name, input, context);
    },
    externalState() {
      if (externalStateReader) {
        const aggregate = externalStateReader();
        requireCondition(aggregate && typeof aggregate === "object" && typeof aggregate.then !== "function", "Composed external-state reader must return a synchronous object snapshot");
        return stable(aggregate);
      }
      return Object.fromEntries(adapterIds.map((adapterId) => [adapterId, byAdapter.get(adapterId).externalState()]));
    },
  });
}

export function bindOpenApiPlanToCommercialDescriptor({ descriptor, systemId, plan }) {
  assertOpenApiAdapterPlan(plan);
  requireCondition(descriptor?.schemaVersion === "das.commercial-customer-binding.v1" && descriptor.descriptorHash === digest(withoutHash(descriptor, "descriptorHash")), "Commercial binding descriptor integrity mismatch");
  const updated = structuredClone(descriptor);
  const system = updated.systems.find((item) => item.systemId === systemId);
  requireCondition(system, `Commercial binding system is missing: ${systemId}`);
  const imported = new Map(plan.operations.map((operation) => [operation.exposedName, operation]));
  requireCondition(imported.size === system.operations.length && system.operations.every((operation) => imported.has(operation.exposedName)), "OpenAPI plan must exactly cover the commercial system operation set");
  system.adapterId = plan.adapterId;
  system.adapterVersion = plan.adapterVersion;
  system.status = "executable";
  system.credentialRefs = [...new Set(plan.operations.flatMap((operation) => operation.auth.flatMap((auth) => auth.credentialRefs ?? [auth.credentialRef])))].sort();
  system.operations = system.operations.map((operation) => {
    const importedOperation = imported.get(operation.exposedName);
    requireCondition(importedOperation.mode === operation.mode, `OpenAPI mode differs from commercial intake: ${operation.exposedName}`);
    return {
      ...operation,
      customerOperation: importedOperation.operationId,
      status: "executable",
      authorityAction: importedOperation.authorityAction ?? "",
      boundedInputSchemaHash: importedOperation.boundedInputSchemaHash,
      idempotency: importedOperation.mode === "write" ? "implemented" : "not-applicable",
      reconcileUnknown: importedOperation.mode === "write" ? "implemented" : "not-applicable",
    };
  });
  updated.evidenceBoundary = "The exact commercial system operation set is now bound to an executable bounded OpenAPI transport and reconciliation plan. The goal-level independent verifier and mandatory acceptance campaign remain separate and unproved.";
  delete updated.descriptorHash;
  updated.descriptorHash = digest(updated);
  return Object.freeze(updated);
}
