import { digest } from "../core/canonical.js";
import { normalizeCommercialIntake } from "./commercial-intake.js";

const HTTP_METHODS = new Set(["get", "head", "post", "put", "patch", "delete"]);
const READ_METHODS = new Set(["get", "head"]);
const MAX_IMPORTED_OPERATIONS = 100;
const SECRET_KEY = /(^|[-_])(api[-_]?key|password|passwd|secret|access[-_]?token|refresh[-_]?token|private[-_]?key|credential)($|[-_])/i;
const SECRET_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\bBasic\s+[A-Za-z0-9+/=]{8,}|\bsk-[A-Za-z0-9_-]{8,}|-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----)/i;

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function stable(value) { return JSON.parse(JSON.stringify(value)); }
function clean(value, maximum = 500) { return String(value ?? "").trim().slice(0, maximum); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }
function unique(values) { return [...new Set(values)]; }

function assertNoCredentialMaterial(value, location = "source") {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoCredentialMaterial(item, `${location}[${index}]`));
  if (typeof value === "string") {
    requireCondition(!SECRET_VALUE.test(value), `Credential material is forbidden in system import sources: ${location}`);
    try {
      const url = new URL(value);
      const secretParameter = [...url.searchParams.keys()].some((key) => SECRET_KEY.test(key));
      requireCondition(!url.username && !url.password && !secretParameter, `Credential-bearing URL is forbidden in system import sources: ${location}`);
    } catch (error) {
      if (error?.message?.startsWith("Credential-bearing URL")) throw error;
    }
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key) && child != null && !isObject(child) && !Array.isArray(child)) {
      requireCondition(!clean(child), `Credential values are forbidden in system import sources: ${location}.${key}`);
    }
    assertNoCredentialMaterial(child, `${location}.${key}`);
  }
}

function normalizeProvenance(value, sourceKind) {
  requireCondition(isObject(value), "System import needs explicit local source provenance");
  const acquisition = clean(value.acquisition, 80);
  requireCondition(["customer-upload", "customer-local-export", "customer-local-mcp-tools-list", "engineer-local-fixture"].includes(acquisition), "Unsupported system-import provenance acquisition");
  const label = clean(value.label, 240);
  requireCondition(label, "System import provenance needs a source label");
  assertNoCredentialMaterial({ label, note: clean(value.note, 500) }, "provenance");
  return Object.freeze({ sourceKind, acquisition, label, note: clean(value.note, 500), customerSupplied: acquisition.startsWith("customer-") });
}

function rejectExternalReferences(value, location = "document") {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectExternalReferences(item, `${location}[${index}]`));
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref") requireCondition(typeof child === "string" && child.startsWith("#/"), `External schema reference is forbidden at ${location}`);
    else rejectExternalReferences(child, `${location}.${key}`);
  }
}

function jsonPointer(value, pointer) {
  requireCondition(typeof pointer === "string" && pointer.startsWith("#/"), `Invalid local schema reference: ${pointer}`);
  return pointer.slice(2).split("/").reduce((current, segment) => current?.[segment.replace(/~1/g, "/").replace(/~0/g, "~")], value);
}

function boundedOpenApiSchema(schema, spec, trail = [], depth = 0) {
  requireCondition(depth <= 32, "OpenAPI proposal schema depth exceeded");
  if (!isObject(schema)) return {};
  if (schema.$ref) {
    requireCondition(Object.keys(schema).length === 1 && schema.$ref.startsWith("#/components/schemas/"), "Only exact local OpenAPI component schema references are supported");
    requireCondition(!trail.includes(schema.$ref), `Cyclic OpenAPI schema reference: ${schema.$ref}`);
    const target = jsonPointer(spec, schema.$ref);
    requireCondition(target, `Missing OpenAPI component schema: ${schema.$ref}`);
    return boundedOpenApiSchema(target, spec, [...trail, schema.$ref], depth + 1);
  }
  return boundedSchemaObject(schema, (child) => boundedOpenApiSchema(child, spec, trail, depth + 1));
}

function boundedMcpSchema(schema, depth = 0) {
  requireCondition(depth <= 32 && isObject(schema), "MCP proposal needs a bounded JSON input schema");
  requireCondition(!schema.$ref, "MCP proposal cannot contain unresolved schema references");
  return boundedSchemaObject(schema, (child) => boundedMcpSchema(child, depth + 1));
}

function boundedSchemaObject(schema, descend) {
  const allowed = new Set(["type", "properties", "required", "additionalProperties", "items", "allOf", "anyOf", "oneOf", "enum", "minimum", "maximum", "minLength", "maxLength", "pattern", "minItems", "maxItems", "nullable"]);
  const output = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!allowed.has(key)) continue;
    if (key === "properties") output.properties = Object.fromEntries(Object.entries(value ?? {}).map(([name, child]) => [name, descend(child)]));
    else if (key === "items") output.items = descend(value);
    else if (["allOf", "anyOf", "oneOf"].includes(key)) output[key] = (value ?? []).map((child) => descend(child));
    else output[key] = stable(value);
  }
  requireCondition(output.type || output.allOf || output.anyOf || output.oneOf || Object.keys(output).length === 0, "Imported schema has no bounded type");
  return output;
}

function resolveOpenApiParameter(parameter, spec) {
  if (!parameter?.$ref) return parameter ?? {};
  requireCondition(Object.keys(parameter).length === 1 && parameter.$ref.startsWith("#/components/parameters/"), `Unsupported OpenAPI parameter reference: ${parameter.$ref}`);
  const resolved = jsonPointer(spec, parameter.$ref);
  requireCondition(resolved, `Missing OpenAPI parameter reference: ${parameter.$ref}`);
  return resolved;
}

function openApiInputSchema({ operation, pathParameters }, spec) {
  const parameters = [...pathParameters, ...(operation.parameters ?? [])].map((item) => resolveOpenApiParameter(item, spec));
  const properties = {};
  for (const location of ["path", "query", "header"]) {
    const selected = parameters.filter((item) => item.in === location);
    if (!selected.length) continue;
    properties[location === "header" ? "headers" : location] = {
      type: "object",
      properties: Object.fromEntries(selected.map((item) => [item.name, boundedOpenApiSchema(item.schema ?? {}, spec)])),
      required: selected.filter((item) => item.required === true || location === "path").map((item) => item.name),
      additionalProperties: false,
    };
  }
  const requestBody = operation.requestBody?.$ref ? jsonPointer(spec, operation.requestBody.$ref) : operation.requestBody;
  const bodySchema = requestBody?.content?.["application/json"]?.schema;
  if (bodySchema) properties.body = boundedOpenApiSchema(bodySchema, spec);
  return {
    type: "object",
    properties,
    required: bodySchema && requestBody?.required === true ? ["body"] : [],
    additionalProperties: false,
  };
}

function selectedNames(allNames, requested, label) {
  requireCondition(requested === undefined || Array.isArray(requested), `${label} selection must be an array`);
  const normalized = requested === undefined ? [...allNames] : unique(requested.map((item) => clean(item, 240)).filter(Boolean));
  requireCondition(normalized.length === (requested ?? normalized).length, `${label} selection cannot contain empty or duplicate names`);
  requireCondition(normalized.length > 0, `Select at least one ${label}`);
  requireCondition(normalized.length <= MAX_IMPORTED_OPERATIONS, `${label} import exceeds the ${MAX_IMPORTED_OPERATIONS}-operation proposal limit`);
  const available = new Set(allNames);
  for (const name of normalized) requireCondition(available.has(name), `Unknown selected ${label}: ${name}`);
  return normalized;
}

function proposalOperation({ sourceKind, sourceHash, sourceName, exposedName, description, proposedMode, classificationBasis, inputSchema, existingContextSources }) {
  const contextSources = unique([
    ...existingContextSources,
    `${sourceKind}:${sourceHash.slice(0, 16)}:${sourceName}`,
  ]).sort();
  return Object.freeze({
    sourceName,
    proposedExposedName: exposedName,
    description: clean(description, 700),
    modeProposal: { value: proposedMode, basis: classificationBasis, customerReviewRequired: true },
    inputSchema,
    boundedInputSchemaHash: digest(inputSchema),
    proposedContextSources: contextSources,
    authority: { status: "not-granted", action: null, customerDecisionRequired: proposedMode !== "read" },
    credentials: { status: "not-collected", references: [] },
    adapter: { status: "not-implemented", verified: false },
    independentVerification: { status: "not-implemented", requiredBeforeExecution: proposedMode !== "read" },
    acceptance: { status: "not-run" },
    executable: false,
  });
}

function openApiProposal({ document, selection, sourceHash, existingContextSources, systemId }) {
  requireCondition(isObject(document) && /^3\.\d+(?:\.\d+)?/.test(document.openapi ?? ""), "Onboarding import supports OpenAPI 3.x JSON objects only");
  requireCondition(isObject(document.paths), "OpenAPI proposal needs a paths object");
  rejectExternalReferences(document);
  const servers = (document.servers ?? []).map((item) => {
    requireCondition(typeof item?.url === "string", "OpenAPI server needs a URL");
    const url = new URL(item.url);
    requireCondition(!url.username && !url.password && !url.search && !url.hash, "OpenAPI server URL cannot contain credentials, query, or fragment");
    return url.origin;
  });
  const operations = new Map();
  for (const [route, pathItem] of Object.entries(document.paths)) {
    requireCondition(route.startsWith("/") && isObject(pathItem), `Invalid OpenAPI path: ${route}`);
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      requireCondition(clean(operation?.operationId, 240), `Every proposed OpenAPI operation needs operationId: ${method.toUpperCase()} ${route}`);
      requireCondition(!operations.has(operation.operationId), `Duplicate OpenAPI operationId: ${operation.operationId}`);
      operations.set(operation.operationId, { method: method.toLowerCase(), route, operation, pathParameters: pathItem.parameters ?? [] });
    }
  }
  const chosen = selectedNames([...operations.keys()], selection?.operationIds, "OpenAPI operation");
  return {
    sourceMetadata: { version: clean(document.openapi, 40), title: clean(document.info?.title, 240), serverOrigins: unique(servers).sort() },
    operations: chosen.map((operationId) => {
      const found = operations.get(operationId);
      const mode = READ_METHODS.has(found.method) ? "read" : "write";
      return proposalOperation({
        sourceKind: "openapi",
        sourceHash,
        sourceName: operationId,
        exposedName: `${systemId}:${operationId}`,
        description: found.operation.summary || found.operation.description || `${found.method.toUpperCase()} ${found.route}`,
        proposedMode: mode,
        classificationBasis: `openapi-http-method:${found.method.toUpperCase()}`,
        inputSchema: openApiInputSchema(found, document),
        existingContextSources,
      });
    }),
  };
}

function mcpModeProposal(tool) {
  if (tool.annotations?.readOnlyHint === true) return { mode: "read", basis: "untrusted-mcp-annotation:readOnlyHint=true" };
  if (tool.annotations?.destructiveHint === true || tool.annotations?.readOnlyHint === false) return { mode: "write", basis: "untrusted-mcp-annotation:write-capable" };
  return { mode: "review-required", basis: "mcp-tools-list-does-not-prove-read-or-write-semantics" };
}

function mcpProposal({ toolsList, serverId, serverVersion, selection, sourceHash, existingContextSources, systemId }) {
  requireCondition(clean(serverId, 160) && Array.isArray(toolsList?.tools), "MCP proposal needs a server id and pinned tools/list response");
  const tools = new Map();
  for (const tool of toolsList.tools) {
    const name = clean(tool?.name, 240);
    requireCondition(name && !tools.has(name), `Duplicate or missing MCP tool name: ${tool?.name}`);
    tools.set(name, tool);
  }
  const chosen = selectedNames([...tools.keys()], selection?.toolNames, "MCP tool");
  return {
    sourceMetadata: { serverId: clean(serverId, 160), serverVersion: clean(serverVersion, 120) || "unknown", toolsListPinned: true },
    operations: chosen.map((toolName) => {
      const tool = tools.get(toolName);
      const classification = mcpModeProposal(tool);
      return proposalOperation({
        sourceKind: "mcp-tools-list",
        sourceHash,
        sourceName: toolName,
        exposedName: `${systemId}:${toolName}`,
        description: tool.description,
        proposedMode: classification.mode,
        classificationBasis: classification.basis,
        inputSchema: boundedMcpSchema(tool.inputSchema ?? {}),
        existingContextSources,
      });
    }),
  };
}

function exactImportInputs({ intake: input, systemId, source, provenance, selection }) {
  const intake = normalizeCommercialIntake(input);
  const system = intake.systems.find((item) => item.id === systemId);
  requireCondition(system, `Onboarding system is missing: ${systemId}`);
  requireCondition(isObject(source) && ["openapi", "mcp-tools-list"].includes(source.kind), "Unsupported onboarding system-import source kind");
  const sourceDocument = source.kind === "openapi" ? source.document : source.toolsList;
  requireCondition(isObject(sourceDocument), "System import source must be a parsed local JSON object");
  assertNoCredentialMaterial(sourceDocument);
  const sourceHash = digest(sourceDocument);
  const normalizedProvenance = normalizeProvenance(provenance, source.kind);
  const compiled = source.kind === "openapi"
    ? openApiProposal({ document: source.document, selection, sourceHash, existingContextSources: system.contextSources, systemId })
    : mcpProposal({ toolsList: source.toolsList, serverId: source.serverId, serverVersion: source.serverVersion, selection, sourceHash, existingContextSources: system.contextSources, systemId });
  return { intake, system, sourceHash, normalizedProvenance, compiled };
}

export function proposeOnboardingSystemImport(input) {
  const { intake, system, sourceHash, normalizedProvenance, compiled } = exactImportInputs(input);
  const proposal = {
    schemaVersion: "das.onboarding-system-import-proposal.v1",
    proposalId: `system-import:${intake.sessionId}:${system.id}:${sourceHash.slice(0, 16)}`,
    sessionId: intake.sessionId,
    intakeHash: digest(intake),
    systemId: system.id,
    systemSnapshotHash: digest(system),
    status: "proposal-awaiting-customer-review-and-engineering-binding",
    source: { kind: normalizedProvenance.sourceKind, sourceHash, provenance: normalizedProvenance, ...compiled.sourceMetadata },
    operations: compiled.operations,
    proposedContextSources: unique(compiled.operations.flatMap((item) => item.proposedContextSources)).sort(),
    gates: {
      customerReview: "required",
      consequentialAssumptionReview: "required",
      authority: "not-granted",
      credentials: "not-collected",
      executableAdapter: "not-implemented",
      independentVerifier: "not-implemented",
      acceptance: "not-run",
      comparisonExecution: "blocked",
      controlledActivation: "blocked",
    },
    authorizations: { modelSpend: false, execution: false, customerWrites: false, activation: false },
    generatedBusinessSuccessCriteria: false,
    nextActions: [
      "Customer reviews the proposed operation subset, read/write classifications and consequential assumptions.",
      "Engineer binds only approved operations through the existing bounded OpenAPI or MCP adapter compiler.",
      "Customer supplies credential references locally; this proposal never stores credential values or references.",
      "Engineer implements direct independent external-state verification and unknown-outcome reconciliation.",
      "The exact binding must pass structural diagnostics and every mandatory acceptance case before comparison execution can be considered ready.",
    ],
    evidenceBoundary: "Pinned schema proposal only. It can reduce setup work by proposing bounded operations and context. It grants no authority, stores no credentials, implements no adapter or verifier, invents no success criteria, authorizes no model spend, and cannot execute or activate anything.",
  };
  proposal.proposalHash = digest(proposal);
  return Object.freeze(proposal);
}

export function assertOnboardingSystemImportProposal({ proposal, intake, source }) {
  requireCondition(proposal?.schemaVersion === "das.onboarding-system-import-proposal.v1" && proposal.proposalHash === digest(withoutHash(proposal, "proposalHash")), "Onboarding system-import proposal integrity mismatch");
  const normalized = normalizeCommercialIntake(intake);
  const system = normalized.systems.find((item) => item.id === proposal.systemId);
  requireCondition(system && proposal.sessionId === normalized.sessionId && proposal.intakeHash === digest(normalized) && proposal.systemSnapshotHash === digest(system), "Onboarding system-import proposal no longer matches the exact saved intake");
  const sourceDocument = source?.kind === "openapi" ? source.document : source?.kind === "mcp-tools-list" ? source.toolsList : null;
  requireCondition(source?.kind === proposal.source.kind && sourceDocument && proposal.source.sourceHash === digest(sourceDocument), "Onboarding system-import source no longer matches its pinned hash");
  if (source?.kind === "mcp-tools-list") {
    requireCondition(clean(source.serverId, 160) === proposal.source.serverId && (clean(source.serverVersion, 120) || "unknown") === proposal.source.serverVersion, "Onboarding MCP source identity no longer matches its pinned server id and version");
  }
  requireCondition(proposal.status === "proposal-awaiting-customer-review-and-engineering-binding", "System import cannot claim executable status");
  requireCondition(proposal.gates.authority === "not-granted" && proposal.gates.executableAdapter === "not-implemented" && proposal.gates.independentVerifier === "not-implemented" && proposal.gates.acceptance === "not-run", "System import proposal widened a readiness gate");
  requireCondition(Object.values(proposal.authorizations).every((value) => value === false) && proposal.generatedBusinessSuccessCriteria === false, "System import proposal contains unauthorized authority or generated success criteria");
  requireCondition(proposal.operations.every((operation) => operation.executable === false && operation.authority.status === "not-granted" && operation.authority.action === null && operation.credentials.references.length === 0 && operation.adapter.verified === false && operation.independentVerification.status === "not-implemented"), "System import operation widened authority or implementation status");
  return true;
}

export function onboardingSystemImportReviewDraft({ proposal, intake, source }) {
  assertOnboardingSystemImportProposal({ proposal, intake, source });
  return Object.freeze({
    schemaVersion: "das.onboarding-system-import-review.v1",
    proposalHash: proposal.proposalHash,
    sessionId: proposal.sessionId,
    intakeHash: proposal.intakeHash,
    systemId: proposal.systemId,
    status: "customer-review-required",
    operationChoices: proposal.operations.map((operation) => ({
      sourceName: operation.sourceName,
      proposedExposedName: operation.proposedExposedName,
      proposedMode: operation.modeProposal.value,
      classificationBasis: operation.modeProposal.basis,
      boundedInputSchemaHash: operation.boundedInputSchemaHash,
      approved: null,
      confirmedMode: null,
      authorityDecision: "not-made",
      includeContextSources: [],
    })),
    contextChoices: proposal.proposedContextSources.map((sourceId) => ({ sourceId, approved: null, implementationStatus: "not-connected" })),
    blocksExecutableComparison: true,
    evidenceBoundary: proposal.evidenceBoundary,
  });
}
