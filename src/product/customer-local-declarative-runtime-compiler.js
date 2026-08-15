import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import {
  assertCustomerLocalTransportImplementationWorkPack,
} from "./customer-local-transport-implementation-assistance.js";

const HASH = /^[a-f0-9]{64}$/;
const ALIAS = /^[A-Z][A-Z0-9_]{5,120}$/;
const SECRET_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\bBasic\s+[A-Za-z0-9+/=]{8,}|\bsk-[A-Za-z0-9_-]{8,}|-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----|\b(?:password|secret|token|api[-_]?key)\s*[:=]\s*["']?[^\s,"'}]{6,})/i;
const SAFE_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH"]);
const SAFE_SCHEMA_TYPES = new Set(["string", "integer", "number", "boolean"]);
const INJECTION = /(?:ignore (?:all |the |any )?(?:previous|prior|safety|policy)|grant (?:unlimited|all|root|admin)|bypass (?:approval|policy|safety)|mark (?:the )?(?:adapter|verifier|package|sandbox) (?:as )?(?:verified|active)|action response (?:is|as) proof)/i;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

function clean(value, maximum = 300) {
  return String(value ?? "").trim().slice(0, maximum);
}

function noSecrets(value, label) {
  requireCondition(!SECRET_VALUE.test(JSON.stringify(value)), `${label} contains possible credential material`);
}

function exactHash(value, label) {
  requireCondition(HASH.test(value ?? ""), `${label} must be an exact SHA-256 identity`);
  return value;
}

function exactAliases(values, label) {
  requireCondition(Array.isArray(values) && values.length > 0, `${label} needs at least one credential alias`);
  const aliases = values.map((value) => clean(value, 140));
  requireCondition(aliases.every((alias) => ALIAS.test(alias)) && new Set(aliases).size === aliases.length, `${label} must contain unique environment-reference aliases only`);
  return aliases;
}

function rawSourceDocument(source) {
  return source?.kind === "openapi" ? source.document : source?.kind === "mcp-tools-list" ? source.toolsList : null;
}

function rawSourceHash(source) {
  const document = rawSourceDocument(source);
  requireCondition(document && typeof document === "object", "Declarative runtime compiler requires exact pinned source material");
  return digest(document);
}

function assertBounded(value, depth = 0, state = { nodes: 0 }) {
  requireCondition(depth <= 20 && ++state.nodes <= 10_000, "Source/schema exceeds DAS-027 structural limits");
  if (Array.isArray(value)) {
    requireCondition(value.length <= 250, "Source/schema array exceeds DAS-027 limits");
    value.forEach((child) => assertBounded(child, depth + 1, state));
  } else if (value && typeof value === "object") {
    requireCondition(Object.keys(value).length <= 250, "Source/schema object exceeds DAS-027 limits");
    for (const [key, child] of Object.entries(value)) {
      requireCondition(!["__proto__", "prototype", "constructor"].includes(key), "Source/schema contains an unsafe object key");
      requireCondition(key !== "$ref", "DAS-027 does not compile schema references");
      assertBounded(child, depth + 1, state);
    }
  }
}

function normalizedPrimitiveSchema(schema, label) {
  requireCondition(schema && typeof schema === "object" && !Array.isArray(schema), `${label} schema is missing`);
  requireCondition(SAFE_SCHEMA_TYPES.has(schema.type), `${label} uses unsupported type ${schema.type ?? "unknown"}`);
  const allowed = new Set(["type", "enum", "pattern", "minLength", "minimum", "maximum", "description", "title", "default", "examples"]);
  requireCondition(Object.keys(schema).every((key) => allowed.has(key)), `${label} uses an unsupported schema keyword`);
  if (schema.enum !== undefined) requireCondition(Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.length <= 50 && schema.enum.every((item) => ["string", "number", "boolean"].includes(typeof item)), `${label} enum is unsupported`);
  if (schema.pattern !== undefined) {
    requireCondition(schema.type === "string" && typeof schema.pattern === "string" && schema.pattern.length <= 160, `${label} pattern is unsupported`);
    try { new RegExp(schema.pattern); } catch { throw new Error(`${label} pattern is invalid`); }
  }
  if (schema.minLength !== undefined) requireCondition(schema.type === "string" && Number.isInteger(schema.minLength) && schema.minLength >= 0 && schema.minLength <= 10_000, `${label} minLength is unsupported`);
  for (const key of ["minimum", "maximum"]) if (schema[key] !== undefined) requireCondition(["integer", "number"].includes(schema.type) && Number.isFinite(schema[key]), `${label} ${key} is unsupported`);
  return {
    type: schema.type,
    ...(schema.enum === undefined ? {} : { enum: structuredClone(schema.enum) }),
    ...(schema.pattern === undefined ? {} : { pattern: schema.pattern }),
    ...(schema.minLength === undefined ? {} : { minLength: schema.minLength }),
    ...(schema.minimum === undefined ? {} : { minimum: schema.minimum }),
    ...(schema.maximum === undefined ? {} : { maximum: schema.maximum }),
  };
}

function normalizedObjectSchema(schema, label) {
  requireCondition(schema?.type === "object" && schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties), `${label} requires one flat object schema`);
  requireCondition(schema.additionalProperties === false, `${label} must explicitly forbid additional properties`);
  const allowed = new Set(["type", "properties", "required", "additionalProperties", "description", "title"]);
  requireCondition(Object.keys(schema).every((key) => allowed.has(key)), `${label} uses unsupported object-schema behavior`);
  const properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => {
    requireCondition(clean(key, 120) === key && key.length > 0, `${label} contains an invalid property name`);
    return [key, normalizedPrimitiveSchema(value, `${label}.${key}`)];
  }));
  const required = [...(schema.required ?? [])];
  requireCondition(required.every((field) => Object.hasOwn(properties, field)) && new Set(required).size === required.length, `${label} required fields are invalid`);
  return { type: "object", properties, required, additionalProperties: false };
}

function openApiSecurity(document, label) {
  const schemes = document.components?.securitySchemes ?? {};
  const normalized = Object.entries(schemes).map(([name, scheme]) => {
    requireCondition(scheme && typeof scheme === "object" && !scheme.$ref, `${label} authentication uses an unsupported reference`);
    if (scheme.type === "apiKey") {
      requireCondition(["header", "query"].includes(scheme.in) && clean(scheme.name, 120), `${label} API-key scheme is unsupported`);
      return { name, type: "apiKey", in: scheme.in, wireName: scheme.name };
    }
    requireCondition(scheme.type === "http" && String(scheme.scheme).toLowerCase() === "bearer", `${label} uses custom/unsupported authentication`);
    return { name, type: "http", scheme: "bearer" };
  });
  requireCondition(normalized.length <= 1, `${label} supports at most one declarative authentication scheme`);
  return normalized;
}

function openApiOperation(source, operationName, expectedMode, label) {
  const document = source.document;
  requireCondition(document && /^3\.\d+(?:\.\d+)?$/.test(document.openapi ?? "") && document.paths, `${label} must be an OpenAPI 3.x document`);
  assertBounded(document);
  const matches = [];
  for (const [route, item] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(item ?? {})) {
      if (!["get", "head", "post", "put", "patch", "delete"].includes(method.toLowerCase())) continue;
      if (operation?.operationId === operationName) matches.push({ route, method: method.toUpperCase(), operation, pathParameters: item.parameters ?? [] });
    }
  }
  requireCondition(matches.length === 1, `${label} operation ${operationName} is missing or duplicated`);
  const match = matches[0];
  requireCondition(SAFE_METHODS.has(match.method), `${label} operation ${operationName} uses unsupported method ${match.method}`);
  requireCondition((expectedMode === "read") === ["GET", "HEAD"].includes(match.method), `${label} operation ${operationName} mode differs from the reviewed work pack`);
  const prose = clean(match.operation.summary || match.operation.description, 2_000);
  requireCondition(!INJECTION.test(prose), `${label} operation ${operationName} contains instruction-like source text`);
  const parameters = [...match.pathParameters, ...(match.operation.parameters ?? [])].map((parameter) => {
    requireCondition(parameter && !parameter.$ref && ["path", "query", "header"].includes(parameter.in) && clean(parameter.name, 120), `${label}.${operationName} uses an unsupported parameter`);
    return { name: parameter.name, in: parameter.in, required: parameter.required === true || parameter.in === "path", schema: normalizedPrimitiveSchema(parameter.schema, `${label}.${operationName}.${parameter.name}`) };
  });
  requireCondition(new Set(parameters.map((parameter) => `${parameter.in}:${parameter.name}`)).size === parameters.length, `${label}.${operationName} duplicates a parameter`);
  const bodySchema = match.operation.requestBody === undefined ? null : normalizedObjectSchema(match.operation.requestBody?.content?.["application/json"]?.schema, `${label}.${operationName}.body`);
  const responseShapes = Object.entries(match.operation.responses ?? {}).map(([status, response]) => ({ status, schemaHash: digest(response?.content?.["application/json"]?.schema ?? null) }));
  requireCondition(responseShapes.length > 0, `${label}.${operationName} requires declared response shapes`);
  return { family: "openapi", operationName, method: match.method, route: match.route, parameters, bodySchema, responseShapes, operationIdentityHash: digest({ operationName, method: match.method, route: match.route, parameters, bodySchema, responseShapes }) };
}

function mcpOperation(source, operationName, expectedMode, label) {
  requireCondition(clean(source.serverId, 160) && clean(source.serverVersion, 120) && Array.isArray(source.toolsList?.tools), `${label} requires a pinned MCP server and tools/list`);
  assertBounded(source.toolsList);
  const matches = source.toolsList.tools.filter((tool) => tool?.name === operationName);
  requireCondition(matches.length === 1, `${label} tool ${operationName} is missing or duplicated`);
  const tool = matches[0];
  const isRead = tool.annotations?.readOnlyHint === true;
  requireCondition((expectedMode === "read") === isRead, `${label} tool ${operationName} mode differs from the reviewed work pack`);
  requireCondition(!INJECTION.test(clean(tool.description, 2_000)), `${label} tool ${operationName} contains instruction-like source text`);
  const inputSchema = normalizedObjectSchema(tool.inputSchema, `${label}.${operationName}.input`);
  return { family: "mcp-tools-list", operationName, serverId: source.serverId, serverVersion: source.serverVersion, toolsListHash: digest(source.toolsList), inputSchema, operationIdentityHash: digest({ operationName, serverId: source.serverId, serverVersion: source.serverVersion, toolsListHash: digest(source.toolsList), inputSchema }) };
}

function exactOperation(source, operationName, expectedMode, label) {
  return source.kind === "openapi" ? openApiOperation(source, operationName, expectedMode, label) : mcpOperation(source, operationName, expectedMode, label);
}

function profileRecord({ workPack, ownerConfirmedBy, engineerConfirmedBy, timeoutMs, maximumRequestsPerMinute }) {
  requireCondition(workPack?.workPackHash === digest(withoutHash(workPack, "workPackHash")), "Execution profile requires an intact DAS-026 work pack");
  requireCondition(clean(ownerConfirmedBy, 180) && clean(engineerConfirmedBy, 180), "Execution profile requires exact owner and engineer confirmation identities");
  requireCondition(Number.isInteger(timeoutMs) && timeoutMs >= 50 && timeoutMs <= 30_000, "Execution timeout must be between 50 and 30000 ms");
  requireCondition(Number.isInteger(maximumRequestsPerMinute) && maximumRequestsPerMinute >= 1 && maximumRequestsPerMinute <= 120, "Request ceiling must be between 1 and 120 per minute");
  const profile = {
    schemaVersion: "das.customer-local-declarative-runtime-execution-profile.v1",
    workPackHash: workPack.workPackHash,
    packageIdentityHash: workPack.packageIdentityHash,
    ownerConfirmedBy: clean(ownerConfirmedBy, 180),
    engineerConfirmedBy: clean(engineerConfirmedBy, 180),
    authenticationMode: "opaque-customer-local-credential-lease",
    timeoutMs,
    maximumRequestsPerMinute,
    streamingAllowed: false,
    customTransformsAllowed: false,
    dynamicOperationSelectionAllowed: false,
    automaticRetries: 0,
    authorityHookPlacement: "immediately-before-action-transport",
    actionResponseMayProveOutcome: false,
    observerReadOnly: true,
    customerExecutionAuthorized: false,
    activationAuthorized: false,
    status: "owner-engineer-confirmed-disposable-only",
  };
  profile.profileHash = digest(profile);
  noSecrets(profile, "Declarative runtime execution profile");
  return Object.freeze(profile);
}

export function createDeclarativeRuntimeExecutionProfile(input) {
  return profileRecord(input);
}

function assertExecutionProfile(profile, workPack) {
  requireCondition(profile?.schemaVersion === "das.customer-local-declarative-runtime-execution-profile.v1" && profile.profileHash === digest(withoutHash(profile, "profileHash")), "Declarative runtime execution profile integrity mismatch");
  requireCondition(profile.workPackHash === workPack.workPackHash && profile.packageIdentityHash === workPack.packageIdentityHash, "Execution profile belongs to another work pack");
  const expected = profileRecord({ workPack, ownerConfirmedBy: profile.ownerConfirmedBy, engineerConfirmedBy: profile.engineerConfirmedBy, timeoutMs: profile.timeoutMs, maximumRequestsPerMinute: profile.maximumRequestsPerMinute });
  requireCondition(expected.profileHash === profile.profileHash, "Execution profile widened streaming, transforms, operations, retry, proof, execution, or activation");
}

function assertSourceChain({ draftSession, packageInputDraft, workPack, actionSource, observerSource }) {
  requireCondition(rawSourceHash(actionSource) === draftSession.sources.action.sourceHash && rawSourceHash(observerSource) === draftSession.sources.observer.sourceHash, "DAS-027 source bytes differ from the reviewed DAS-024 source identities");
  requireCondition(actionSource.kind === draftSession.sources.action.kind && observerSource.kind === draftSession.sources.observer.kind && actionSource.kind === workPack.measurements.sourceFamily, "DAS-027 source family differs from the reviewed work pack");
  requireCondition(packageInputDraft.draftHash === workPack.chainIdentity.das024DraftHash && workPack.packageIdentityHash === digest(workPack.chainIdentity), "DAS-027 work-pack chain identity mismatch");
  requireCondition(workPack.gates.exactReviewedChainBound === true && workPack.gates.transportImplemented === false && workPack.gates.customerExecutable === false, "DAS-027 requires an exact non-executable DAS-026 work pack");
  noSecrets({ actionSource, observerSource }, "DAS-027 source material");
}

function schemaFieldNames(operation) {
  if (operation.family === "mcp-tools-list") return Object.keys(operation.inputSchema.properties);
  return [...new Set([
    ...operation.parameters.map((parameter) => parameter.name),
    ...Object.keys(operation.bodySchema?.properties ?? {}),
  ])];
}

function renderSharedValidation() {
  return `
function fail(condition, message) { if (!condition) throw new Error(message); }
function validatePrimitive(value, schema, label) {
  if (schema.type === "string") fail(typeof value === "string", label + " must be a string");
  if (schema.type === "integer") fail(Number.isInteger(value), label + " must be an integer");
  if (schema.type === "number") fail(typeof value === "number" && Number.isFinite(value), label + " must be a finite number");
  if (schema.type === "boolean") fail(typeof value === "boolean", label + " must be a boolean");
  if (schema.enum) fail(schema.enum.some((candidate) => Object.is(candidate, value)), label + " is outside the exact enum");
  if (schema.pattern) fail(new RegExp(schema.pattern).test(value), label + " does not match the exact pattern");
  if (schema.minLength !== undefined) fail(value.length >= schema.minLength, label + " is shorter than the exact minimum");
  if (schema.minimum !== undefined) fail(value >= schema.minimum, label + " is below the exact minimum");
  if (schema.maximum !== undefined) fail(value <= schema.maximum, label + " is above the exact maximum");
}
function validateObject(value, schema, label) {
  fail(value && typeof value === "object" && !Array.isArray(value), label + " must be one object");
  const allowed = new Set(Object.keys(schema.properties));
  fail(Object.keys(value).every((key) => allowed.has(key)), label + " contains an unapproved field");
  fail(schema.required.every((key) => Object.hasOwn(value, key)), label + " omits a required field");
  for (const [key, child] of Object.entries(value)) validatePrimitive(child, schema.properties[key], label + "." + key);
}
async function withTimeout(promise, timeoutMs) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("declarative transport timeout")), timeoutMs); })]); }
  finally { if (timer) clearTimeout(timer); }
}
function createRateGate(maximumRequestsPerMinute, now) {
  const prior = [];
  return () => {
    const current = now();
    while (prior.length && prior[0] <= current - 60_000) prior.shift();
    fail(prior.length < maximumRequestsPerMinute, "declarative request ceiling reached");
    prior.push(current);
  };
}
async function exactLease(resolveCredentialLease, alias, plane, packageIdentityHash) {
  const lease = await resolveCredentialLease({ alias, plane, packageIdentityHash });
  fail(lease && lease.alias === alias && lease.plane === plane && lease.packageIdentityHash === packageIdentityHash && typeof lease.use === "function", plane + " credential resolver returned an invalid or widened lease");
  fail(lease.persistable === false && lease.loggable === false, plane + " credential lease must be non-persistable and non-loggable");
  return lease;
}`;
}

function actionSourceText(contract) {
  return `// Generated by DAS-027. Exact bounded disposable implementation; no customer authority or activation.\nconst CONTRACT = Object.freeze(${JSON.stringify(contract)});\n${renderSharedValidation()}
function operationSchema(operation, conflictField) {
  if (operation.family === "mcp-tools-list") return operation.inputSchema;
  const properties = {}; const required = [];
  for (const parameter of operation.parameters) {
    const mappedConflictHeader = parameter.in === "header" && parameter.name === "Idempotency-Key";
    const inputName = mappedConflictHeader ? conflictField : parameter.name;
    properties[inputName] = parameter.schema;
    if (parameter.required && !required.includes(inputName)) required.push(inputName);
  }
  for (const [key, schema] of Object.entries(operation.bodySchema?.properties ?? {})) properties[key] = schema;
  for (const key of operation.bodySchema?.required ?? []) if (!required.includes(key)) required.push(key);
  return { type: "object", properties, required, additionalProperties: false };
}
function serialize(operation, assignedWork, conflictField) {
  validateObject(assignedWork, operationSchema(operation, conflictField), "assignedWork");
  if (operation.family === "mcp-tools-list") return { family: operation.family, serverId: operation.serverId, serverVersion: operation.serverVersion, toolsListHash: operation.toolsListHash, tool: operation.operationName, inputSchemaHash: operation.operationIdentityHash, arguments: structuredClone(assignedWork) };
  let route = operation.route; const query = {}; const headers = {}; const body = {};
  for (const parameter of operation.parameters) {
    const value = assignedWork[parameter.name] ?? (parameter.in === "header" && parameter.name === "Idempotency-Key" ? assignedWork[conflictField] : undefined);
    if (parameter.required) fail(value !== undefined, "missing exact " + parameter.in + " parameter " + parameter.name);
    if (value === undefined) continue;
    validatePrimitive(value, parameter.schema, parameter.name);
    if (parameter.in === "path") route = route.replace("{" + parameter.name + "}", encodeURIComponent(String(value)));
    else if (parameter.in === "query") query[parameter.name] = value;
    else headers[parameter.name] = value;
  }
  for (const key of Object.keys(operation.bodySchema?.properties ?? {})) if (Object.hasOwn(assignedWork, key)) body[key] = assignedWork[key];
  if (operation.bodySchema) validateObject(body, operation.bodySchema, "request body");
  fail(!/[{}]/.test(route), "unresolved exact route parameter");
  return { family: operation.family, method: operation.method, baseUrl: CONTRACT.baseUrl, route, query, headers, body, operationIdentityHash: operation.operationIdentityHash };
}
export const IMPLEMENTATION_CONTRACT = CONTRACT;
export function createActionAdapter({ resolveCredentialLease, transport, authority, now = () => Date.now() }) {
  fail(typeof resolveCredentialLease === "function" && transport && typeof transport.execute === "function" && typeof transport.read === "function" && authority && typeof authority.assertExact === "function", "action adapter dependencies are incomplete");
  const rate = createRateGate(CONTRACT.maximumRequestsPerMinute, now);
  async function execute({ assignedWork, authorityContext }) {
    const conflictField = CONTRACT.conflictKeyFields[0];
    fail(CONTRACT.stableIdentityFields.every((field) => Object.hasOwn(assignedWork, field)), "assigned work omits stable identity");
    fail(Object.hasOwn(assignedWork, conflictField), "assigned work omits exact idempotency key");
    rate();
    const lease = await exactLease(resolveCredentialLease, CONTRACT.credentialAlias, "action", CONTRACT.packageIdentityHash);
    const request = serialize(CONTRACT.writeOperation, assignedWork, conflictField);
    const authorityReceipt = await authority.assertExact({ ...structuredClone(authorityContext), requiredAuthorityAction: CONTRACT.requiredAuthorityAction, operationIdentityHash: CONTRACT.writeOperation.operationIdentityHash, stableIdentity: Object.fromEntries(CONTRACT.stableIdentityFields.map((field) => [field, assignedWork[field]])), maximumWrites: 1, packageIdentityHash: CONTRACT.packageIdentityHash });
    fail(authorityReceipt?.allowed === true && authorityReceipt?.packageIdentityHash === CONTRACT.packageIdentityHash && authorityReceipt?.operationIdentityHash === CONTRACT.writeOperation.operationIdentityHash, "exact authority denied or mismatched");
    const response = await withTimeout(transport.execute({ request, lease, authorityReceipt, packageIdentityHash: CONTRACT.packageIdentityHash }), CONTRACT.timeoutMs);
    return { responseLost: false, response: { transportAttemptId: response?.transportAttemptId ?? null, responseStatus: response?.status ?? null, responseShapeHash: response?.responseShapeHash ?? null, actionResponseMayProveOutcome: false } };
  }
  async function reconcile({ assignedWork }) {
    rate();
    const lease = await exactLease(resolveCredentialLease, CONTRACT.credentialAlias, "action", CONTRACT.packageIdentityHash);
    const input = Object.fromEntries(CONTRACT.reconciliationBindings.map(({ from, to }) => [to, assignedWork[from]]));
    const request = serialize(CONTRACT.reconciliationOperation, input, CONTRACT.conflictKeyFields[0]);
    return withTimeout(transport.read({ request, lease, packageIdentityHash: CONTRACT.packageIdentityHash }), CONTRACT.timeoutMs);
  }
  return Object.freeze({ execute, reconcile, contract: CONTRACT });
}
`;
}

function observerSourceText(contract) {
  return `// Generated by DAS-027. Separate read-only observer implementation; no write surface.\nconst CONTRACT = Object.freeze(${JSON.stringify(contract)});\n${renderSharedValidation()}
export const IMPLEMENTATION_CONTRACT = CONTRACT;
export function createObserverAdapter({ resolveCredentialLease, transport, now = () => Date.now() }) {
  fail(typeof resolveCredentialLease === "function" && transport && typeof transport.observe === "function" && transport.execute === undefined && transport.write === undefined, "observer adapter requires one read-only transport");
  const rate = createRateGate(CONTRACT.maximumRequestsPerMinute, now);
  async function observe({ phase, assignedWork, observationNotBeforeMs = null, observerContractHash }) {
    fail(["before", "after"].includes(phase), "observer phase is invalid");
    fail(typeof observerContractHash === "string" && /^[a-f0-9]{64}$/.test(observerContractHash), "observer contract identity is invalid");
    fail(CONTRACT.stableIdentityFields.every((field) => Object.hasOwn(assignedWork, field)), "observer input omits stable identity");
    rate();
    const lease = await exactLease(resolveCredentialLease, CONTRACT.credentialAlias, "observer", CONTRACT.packageIdentityHash);
    const raw = await withTimeout(transport.observe({ phase, assignedWork: structuredClone(assignedWork), operations: structuredClone(CONTRACT.operations), lease, observationNotBeforeMs, packageIdentityHash: CONTRACT.packageIdentityHash }), CONTRACT.timeoutMs);
    if (raw?.availability === "unknown" || raw?.availability === "unavailable") return { availability: raw.availability, reason: raw.reason };
    fail(raw && Array.isArray(raw.matches) && Array.isArray(raw.changedEntities), "observer returned an ambiguous evidence shape");
    const evidence = { provenance: "observer-direct-external-state", observerContractHash, matches: structuredClone(raw.matches) };
    evidence[CONTRACT.snapshotGeneratedAtField] = raw.snapshotGeneratedAt;
    evidence[CONTRACT.caughtUpThroughField] = raw.caughtUpThrough;
    evidence[CONTRACT.changedEntitiesField] = structuredClone(raw.changedEntities);
    evidence[CONTRACT.unrelatedStateDigestField] = raw.unrelatedStateDigest;
    fail(Number.isFinite(evidence[CONTRACT.snapshotGeneratedAtField]) && Number.isFinite(evidence[CONTRACT.caughtUpThroughField]), "observer omitted exact freshness evidence");
    return evidence;
  }
  return Object.freeze({ observe, contract: CONTRACT, readOnly: true, writeOperations: [] });
}
`;
}

function lineCount(content) {
  return content.split("\n").filter((line) => line.trim()).length;
}

export function createCustomerLocalDeclarativeRuntimePlan({
  draftSession,
  packageInputDraft,
  generatedPackage,
  scaffoldPlan,
  scaffoldReceipt,
  workPack,
  actionSource,
  observerSource,
  executionProfile,
}) {
  assertCustomerLocalTransportImplementationWorkPack({ workPack, draftSession, packageInputDraft, generatedPackage, scaffoldPlan, scaffoldReceipt });
  assertSourceChain({ draftSession, packageInputDraft, workPack, actionSource, observerSource });
  assertExecutionProfile(executionProfile, workPack);
  requireCondition(actionSource.kind === observerSource.kind, "DAS-027 v1 requires one source family per exact action/observer pair");

  if (actionSource.kind === "openapi") {
    openApiSecurity(actionSource.document, "Action source");
    openApiSecurity(observerSource.document, "Observer source");
  }
  const writeName = workPack.actionTransport.write.operationName;
  const reconciliationName = workPack.actionTransport.reconciliationRead.operationName;
  const writeOperation = exactOperation(actionSource, writeName, "write", "Action source");
  const reconciliationOperation = exactOperation(actionSource, reconciliationName, "read", "Action source reconciliation");
  const observerOperations = workPack.observerTransport.operations.map((operation) => exactOperation(observerSource, operation.operationName, "read", "Observer source"));
  requireCondition(observerOperations.length > 0, "DAS-027 requires at least one separate observer operation");
  requireCondition(writeOperation.operationIdentityHash !== reconciliationOperation.operationIdentityHash && observerOperations.every((operation) => operation.operationIdentityHash !== writeOperation.operationIdentityHash), "Action, reconciliation and observer operations collapsed");
  requireCondition(workPack.actionTransport.idempotency.automaticRetries === 0 && workPack.actionTransport.idempotency.reconcileBeforeAnyRetry === true, "DAS-027 refuses a write without exact reconcile-before-retry semantics");
  requireCondition(workPack.evidenceMappings.actionEvidence.mayProveBusinessOutcome === false && workPack.observerTransport.readOnly === true, "DAS-027 requires independent read-only outcome proof");
  const conflictFields = [...workPack.actionTransport.idempotency.conflictKeyFields];
  requireCondition(conflictFields.length === 1 && schemaFieldNames(writeOperation).includes(conflictFields[0]), "DAS-027 requires one exact source-grounded idempotency field");

  const reconciliationBindings = workPack.actionTransport.reconciliation.inputBindings.map((binding) => {
    const [from, to, ...rest] = String(binding).split("->");
    requireCondition(clean(from, 120) && clean(to, 120) && rest.length === 0, "DAS-027 reconciliation binding is ambiguous");
    requireCondition(schemaFieldNames(writeOperation).includes(from) && schemaFieldNames(reconciliationOperation).includes(to), "DAS-027 reconciliation binding is not grounded in both exact schemas");
    return { from, to };
  });
  requireCondition(reconciliationBindings.length > 0, "DAS-027 requires exact reconciliation bindings");

  const actionAliases = exactAliases(workPack.actionTransport.credentialResolution.aliases, "Action aliases");
  const observerAliases = exactAliases(workPack.observerTransport.credentialResolution.aliases, "Observer aliases");
  requireCondition(actionAliases.length === 1 && observerAliases.length === 1 && actionAliases[0] !== observerAliases[0], "DAS-027 v1 requires one distinct credential alias per plane");

  const actionContract = {
    schemaVersion: "das.generated-declarative-action-runtime-contract.v1",
    packageIdentityHash: workPack.packageIdentityHash,
    workPackHash: workPack.workPackHash,
    executionProfileHash: executionProfile.profileHash,
    sourceKind: actionSource.kind,
    sourceHash: rawSourceHash(actionSource),
    baseUrl: actionSource.kind === "openapi" ? actionSource.baseUrl ?? actionSource.document.servers?.[0]?.url : null,
    credentialAlias: actionAliases[0],
    requiredAuthorityAction: workPack.actionTransport.preWriteAuthorityHook.requiredAuthorityAction,
    stableIdentityFields: [...workPack.actionTransport.stableIdentity.fields],
    conflictKeyFields: conflictFields,
    writeOperation,
    reconciliationOperation,
    reconciliationBindings,
    maximumRequestsPerMinute: executionProfile.maximumRequestsPerMinute,
    timeoutMs: executionProfile.timeoutMs,
    automaticRetries: 0,
    actionResponseMayProveOutcome: false,
    customerExecutionAuthorized: false,
    activationAuthorized: false,
  };
  actionContract.contractHash = digest(actionContract);
  const observerContract = {
    schemaVersion: "das.generated-declarative-observer-runtime-contract.v1",
    packageIdentityHash: workPack.packageIdentityHash,
    workPackHash: workPack.workPackHash,
    executionProfileHash: executionProfile.profileHash,
    sourceKind: observerSource.kind,
    sourceHash: rawSourceHash(observerSource),
    credentialAlias: observerAliases[0],
    operations: observerOperations,
    stableIdentityFields: [...packageInputDraft.observerProof.stableIdentity.fields],
    observerContractHash: generatedPackage.observerContract.contractHash,
    snapshotGeneratedAtField: packageInputDraft.observerProof.freshness.snapshotGeneratedAtField,
    caughtUpThroughField: packageInputDraft.observerProof.freshness.caughtUpThroughField,
    changedEntitiesField: packageInputDraft.observerProof.collateralRules.changedEntitiesField,
    unrelatedStateDigestField: packageInputDraft.observerProof.collateralRules.unrelatedStateDigestField,
    requiredExactFields: [...packageInputDraft.observerProof.outcomeRules.requiredExactFields],
    statusField: packageInputDraft.observerProof.outcomeRules.statusField,
    completionStatuses: [...packageInputDraft.observerProof.outcomeRules.completionStatuses],
    resultIdentityField: packageInputDraft.observerProof.duplicateRule.resultIdentityField,
    maximumRequestsPerMinute: executionProfile.maximumRequestsPerMinute,
    timeoutMs: executionProfile.timeoutMs,
    readOnly: true,
    writeOperations: [],
    actionResponseMayProveOutcome: false,
    customerExecutionAuthorized: false,
    activationAuthorized: false,
  };
  observerContract.contractHash = digest(observerContract);
  const files = new Map([
    ["package.json", `${JSON.stringify({ name: `das027-${workPack.packageIdentityHash.slice(0, 12)}`, private: true, type: "module" }, null, 2)}\n`],
    ["action-plugin/index.js", actionSourceText(actionContract)],
    ["observer-plugin/index.js", observerSourceText(observerContract)],
    ["action-contract.json", `${JSON.stringify(actionContract, null, 2)}\n`],
    ["observer-contract.json", `${JSON.stringify(observerContract, null, 2)}\n`],
  ]);
  const fileHashes = Object.fromEntries([...files].map(([relative, content]) => [relative, digest(content)]).sort(([a], [b]) => a.localeCompare(b)));
  const implementationIdentity = {
    schemaVersion: "das.customer-local-declarative-runtime-implementation.v1",
    packageIdentityHash: workPack.packageIdentityHash,
    workPackHash: workPack.workPackHash,
    executionProfileHash: executionProfile.profileHash,
    actionContractHash: actionContract.contractHash,
    observerContractHash: observerContract.contractHash,
    actionImplementationContentHash: fileHashes["action-plugin/index.js"],
    observerImplementationContentHash: fileHashes["observer-plugin/index.js"],
    fileHashes,
    supportedSubset: "flat-primitive-openapi-or-pinned-mcp-one-write-with-independent-observer-v1",
    executableInDisposableRuntime: true,
    customerEnvironmentImplemented: false,
    customerExecutionAuthorized: false,
    activationAuthorized: false,
  };
  implementationIdentity.implementationHash = digest(implementationIdentity);
  requireCondition(implementationIdentity.actionImplementationContentHash !== implementationIdentity.observerImplementationContentHash, "Generated action and observer implementation bytes collapsed");
  const plan = {
    schemaVersion: "das.customer-local-declarative-runtime-plan.v1",
    packageIdentityHash: workPack.packageIdentityHash,
    workPackHash: workPack.workPackHash,
    executionProfile,
    actionContract,
    observerContract,
    implementationIdentity,
    filePaths: [...files.keys()].sort(),
    measurements: {
      generatedFiles: files.size + 1,
      generatedExecutableFiles: 2,
      generatedExecutableLines: lineCount(files.get("action-plugin/index.js")) + lineCount(files.get("observer-plugin/index.js")),
      generatedExecutableOperations: 3 + observerOperations.length,
      manualPackageSpecificExecutableFiles: 0,
      manualPackageSpecificExecutableLines: 0,
      explicitOwnerEngineerConfirmedSectionsReused: workPack.provenanceSummary.ownerConfirmedBusinessSections + workPack.provenanceSummary.engineerConfirmedSafetyAndProofSections + 1,
      credentialValues: 0,
      modelCalls: 0,
      spendUsd: 0,
    },
    remainingBlockers: [
      "real-customer-local-provider-transport-not-supplied",
      "real-customer-local-credential-resolver-not-supplied",
      "real-customer-authority-source-not-supplied",
      "customer-environment-conformance-not-run",
      "mandatory-customer-acceptance-not-run",
      "comparison-readiness-unproved",
      "customer-execution-not-authorized",
      "activation-not-authorized",
    ],
    gates: {
      exactReviewedChainBound: true,
      generatedImplementationBytes: true,
      disposableExecutableCandidate: true,
      credentialValuesPresent: false,
      customerTransportBound: false,
      customerAuthorityGranted: false,
      customerEnvironmentConformance: false,
      customerExecutionReady: false,
      activationReady: false,
    },
    status: "compiled-disposable-implementation-candidate-unqualified",
    evidenceBoundary: "Actual generated action/observer bytes for the exact bounded disposable subset. No real customer transport, credential, authority, acceptance, execution or activation is established.",
  };
  plan.planHash = digest(plan);
  noSecrets({ plan, files: [...files] }, "DAS-027 generated implementation plan");
  return Object.freeze({ plan: Object.freeze(plan), files });
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

function writePrivate(file, content) {
  fs.writeFileSync(file, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.chmodSync(file, 0o600);
}

export function writeCustomerLocalDeclarativeRuntime({ directory, ...inputs }) {
  const root = path.resolve(directory);
  requireCondition(!fs.existsSync(root), "DAS-027 runtime compiler refuses to overwrite an existing directory");
  const generated = createCustomerLocalDeclarativeRuntimePlan(inputs);
  ensureDirectory(root);
  ensureDirectory(path.join(root, "action-plugin"));
  ensureDirectory(path.join(root, "observer-plugin"));
  for (const [relative, content] of generated.files) writePrivate(path.join(root, relative), content);
  const receipt = {
    schemaVersion: "das.customer-local-declarative-runtime-receipt.v1",
    planHash: generated.plan.planHash,
    packageIdentityHash: generated.plan.packageIdentityHash,
    workPackHash: generated.plan.workPackHash,
    executionProfileHash: generated.plan.executionProfile.profileHash,
    implementationHash: generated.plan.implementationIdentity.implementationHash,
    actionImplementationContentHash: generated.plan.implementationIdentity.actionImplementationContentHash,
    observerImplementationContentHash: generated.plan.implementationIdentity.observerImplementationContentHash,
    files: [...generated.files.keys()].sort().map((relative) => ({ relative, contentHash: digest(fs.readFileSync(path.join(root, relative), "utf8")), mode: "0600" })),
    measurements: generated.plan.measurements,
    status: "compiled-disposable-implementation-candidate-unqualified",
    customerEnvironmentImplemented: false,
    customerExecutionAuthorized: false,
    activationAuthorized: false,
    evidenceBoundary: generated.plan.evidenceBoundary,
  };
  receipt.receiptHash = digest(receipt);
  writePrivate(path.join(root, "runtime-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  return Object.freeze({ root, plan: generated.plan, receipt: Object.freeze(receipt) });
}

export function inspectCustomerLocalDeclarativeRuntime({ directory, expectedReceiptHash }) {
  const root = path.resolve(directory);
  const receiptFile = path.join(root, "runtime-receipt.json");
  requireCondition(fs.existsSync(receiptFile), "DAS-027 runtime receipt is missing");
  const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  requireCondition(receipt.receiptHash === digest(withoutHash(receipt, "receiptHash")), "DAS-027 runtime receipt integrity mismatch");
  if (expectedReceiptHash) requireCondition(receipt.receiptHash === expectedReceiptHash, "DAS-027 runtime receipt belongs to another implementation");
  requireCondition(receipt.customerEnvironmentImplemented === false && receipt.customerExecutionAuthorized === false && receipt.activationAuthorized === false, "DAS-027 runtime receipt widened a protected gate");
  const expectedFiles = new Set([...receipt.files.map((entry) => entry.relative), "runtime-receipt.json"]);
  const actualFiles = [];
  function walk(directory) {
    for (const name of fs.readdirSync(directory)) {
      const absolute = path.join(directory, name);
      const relative = path.relative(root, absolute);
      requireCondition(!fs.lstatSync(absolute).isSymbolicLink(), `DAS-027 runtime contains a symlink: ${relative}`);
      if (fs.statSync(absolute).isDirectory()) walk(absolute); else actualFiles.push(relative);
    }
  }
  walk(root);
  requireCondition(actualFiles.length === expectedFiles.size && actualFiles.every((relative) => expectedFiles.has(relative)), "DAS-027 runtime contains a file outside the exact allowlist");
  for (const entry of receipt.files) {
    const file = path.resolve(root, entry.relative);
    requireCondition(file.startsWith(`${root}${path.sep}`), "DAS-027 runtime receipt contains a path escape");
    requireCondition((fs.statSync(file).mode & 0o777) === 0o600 && digest(fs.readFileSync(file, "utf8")) === entry.contentHash, `DAS-027 generated implementation changed: ${entry.relative}`);
  }
  requireCondition(digest(fs.readFileSync(path.join(root, "action-plugin/index.js"), "utf8")) === receipt.actionImplementationContentHash, "DAS-027 action implementation identity changed");
  requireCondition(digest(fs.readFileSync(path.join(root, "observer-plugin/index.js"), "utf8")) === receipt.observerImplementationContentHash, "DAS-027 observer implementation identity changed");
  const packageManifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  requireCondition(packageManifest.private === true && packageManifest.type === "module" && packageManifest.scripts === undefined && packageManifest.dependencies === undefined, "DAS-027 runtime manifest added scripts or dependencies");
  const source = `${fs.readFileSync(path.join(root, "action-plugin/index.js"), "utf8")}\n${fs.readFileSync(path.join(root, "observer-plugin/index.js"), "utf8")}`;
  requireCondition(!/(?:\beval\s*\(|\bnew\s+Function\s*\(|\bimport\s*\()/m.test(source), "DAS-027 generated implementation contains dynamic execution");
  noSecrets({ receipt, source }, "DAS-027 generated implementation");
  return Object.freeze({ valid: true, receipt: Object.freeze(receipt) });
}
