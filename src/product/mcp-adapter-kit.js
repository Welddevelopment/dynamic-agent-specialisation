import { digest } from "../core/canonical.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function stable(value) { return JSON.parse(JSON.stringify(value)); }
function clean(value, maximum = 240) { return String(value ?? "").trim().slice(0, maximum); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }

function cleanStringList(value, label) {
  requireCondition(value === undefined || Array.isArray(value), `${label} must be an array`);
  const normalized = [...new Set((value ?? []).map((item) => clean(item)).filter(Boolean))].sort();
  requireCondition(normalized.length === (value ?? []).length, `${label} cannot contain empty or duplicate values`);
  return normalized;
}

function boundedSchema(schema, depth = 0) {
  requireCondition(depth <= 32 && isObject(schema), "MCP tool input needs a bounded JSON schema object");
  requireCondition(!schema.$ref, "MCP tool input cannot depend on an unresolved schema reference");
  const allowed = new Set(["type", "properties", "required", "additionalProperties", "items", "allOf", "anyOf", "oneOf", "enum", "minimum", "maximum", "minLength", "maxLength", "pattern", "minItems", "maxItems", "nullable"]);
  const output = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!allowed.has(key)) continue;
    if (key === "properties") output.properties = Object.fromEntries(Object.entries(value ?? {}).map(([name, child]) => [name, boundedSchema(child, depth + 1)]));
    else if (key === "items") output.items = boundedSchema(value, depth + 1);
    else if (["allOf", "anyOf", "oneOf"].includes(key)) output[key] = (value ?? []).map((child) => boundedSchema(child, depth + 1));
    else output[key] = stable(value);
  }
  requireCondition(output.type || output.allOf || output.anyOf || output.oneOf, "MCP tool input schema has no bounded type");
  return output;
}

function jsonPointer(value, pointer) {
  requireCondition(typeof pointer === "string" && pointer.startsWith("/"), `Invalid JSON pointer: ${pointer}`);
  return pointer.slice(1).split("/").reduce((current, segment) => current?.[segment.replace(/~1/g, "/").replace(/~0/g, "~")], value);
}

function schemaAtPointer(schema, pointer) {
  let current = schema;
  for (const segment of pointer.slice(1).split("/")) {
    const name = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    const direct = current?.properties?.[name];
    const composed = [...(current?.allOf ?? []), ...(current?.anyOf ?? []), ...(current?.oneOf ?? [])].map((child) => child?.properties?.[name]).find(Boolean);
    requireCondition(direct || composed, `MCP input pointer is outside the bounded input: ${pointer}`);
    current = direct ?? composed;
  }
  return current;
}

function validate(value, schema, location = "input") {
  if (schema.nullable && value === null) return;
  for (const child of schema.allOf ?? []) validate(value, child, location);
  if (schema.anyOf?.length) requireCondition(schema.anyOf.some((child) => { try { validate(value, child, location); return true; } catch { return false; } }), `${location} does not match any allowed schema`);
  if (schema.oneOf?.length) requireCondition(schema.oneOf.filter((child) => { try { validate(value, child, location); return true; } catch { return false; } }).length === 1, `${location} must match exactly one allowed schema`);
  if (schema.enum) requireCondition(schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value)), `${location} is outside the allowed enum`);
  if (schema.type === "object") {
    requireCondition(isObject(value), `${location} must be an object`);
    for (const key of schema.required ?? []) requireCondition(Object.hasOwn(value, key), `${location}.${key} is required`);
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) requireCondition(Object.hasOwn(schema.properties ?? {}, key), `${location}.${key} is not allowed`);
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (Object.hasOwn(value, key)) validate(value[key], child, `${location}.${key}`);
  } else if (schema.type === "array") {
    requireCondition(Array.isArray(value), `${location} must be an array`);
    if (schema.minItems != null) requireCondition(value.length >= schema.minItems, `${location} has too few items`);
    if (schema.maxItems != null) requireCondition(value.length <= schema.maxItems, `${location} has too many items`);
    value.forEach((item, index) => validate(item, schema.items ?? {}, `${location}[${index}]`));
  } else if (schema.type === "string") {
    requireCondition(typeof value === "string", `${location} must be a string`);
    if (schema.minLength != null) requireCondition(value.length >= schema.minLength, `${location} is too short`);
    if (schema.maxLength != null) requireCondition(value.length <= schema.maxLength, `${location} is too long`);
    if (schema.pattern) requireCondition(new RegExp(schema.pattern).test(value), `${location} has an invalid format`);
  } else if (schema.type === "integer") requireCondition(Number.isInteger(value), `${location} must be an integer`);
  else if (schema.type === "number") requireCondition(Number.isFinite(value), `${location} must be a number`);
  else if (schema.type === "boolean") requireCondition(typeof value === "boolean", `${location} must be a boolean`);
}

function resultObject(result, toolName) {
  requireCondition(result && result.isError !== true, `MCP tool returned an error: ${toolName}`);
  requireCondition(isObject(result.structuredContent), `MCP tool ${toolName} must return bounded structuredContent`);
  return stable(result.structuredContent);
}

export function compileMcpAdapterPlan({ serverId, serverVersion = "unknown", adapterVersion = "1.0.0", toolsList, operationBindings }) {
  requireCondition(clean(serverId) && Array.isArray(toolsList?.tools), "MCP adapter needs an identified tools/list response");
  requireCondition(/^\d+\.\d+\.\d+$/.test(adapterVersion), "MCP adapter needs a semantic adapter version independent of the server version");
  requireCondition(Array.isArray(operationBindings) && operationBindings.length > 0, "Select at least one exact MCP tool");
  const listed = new Map();
  for (const tool of toolsList.tools) {
    requireCondition(clean(tool?.name) && !listed.has(tool.name), `Duplicate or missing MCP tool name: ${tool?.name}`);
    listed.set(tool.name, { name: tool.name, description: clean(tool.description, 600), inputSchema: boundedSchema(tool.inputSchema ?? {}) });
  }
  const selectedNames = new Set(operationBindings.map((item) => item.toolName));
  const exposed = new Set();
  const operations = operationBindings.map((binding) => {
    const tool = listed.get(binding.toolName);
    requireCondition(tool, `MCP tool is not present in the pinned tools/list response: ${binding.toolName}`);
    requireCondition(["read", "write"].includes(binding.mode), `MCP tool ${binding.toolName} needs an explicit read or write classification`);
    const exposedName = clean(binding.exposedName || binding.toolName, 160);
    requireCondition(exposedName && !exposed.has(exposedName), `Duplicate exposed MCP operation: ${exposedName}`);
    exposed.add(exposedName);
    let verification = null;
    if (binding.mode === "write") {
      requireCondition(clean(binding.authorityAction) && clean(binding.idempotencyField), `MCP write ${binding.toolName} needs authority and an idempotency input field`);
      requireCondition(tool.inputSchema.properties?.[binding.idempotencyField] && (tool.inputSchema.required ?? []).includes(binding.idempotencyField), `MCP write ${binding.toolName} must require its idempotency field in the pinned input schema`);
      const supplied = binding.verification;
      requireCondition(supplied?.readToolName && selectedNames.has(supplied.readToolName), `MCP write ${binding.toolName} needs an explicitly selected read tool for reconciliation`);
      const readTool = listed.get(supplied.readToolName);
      const readBinding = operationBindings.find((item) => item.toolName === supplied.readToolName);
      requireCondition(readTool && readBinding?.mode === "read", `MCP reconciliation tool must be classified read-only: ${supplied.readToolName}`);
      requireCondition(Array.isArray(supplied.inputMap) && supplied.inputMap.length > 0 && Array.isArray(supplied.assertions) && supplied.assertions.length > 0, `MCP write ${binding.toolName} needs explicit reconciliation mappings and assertions`);
      verification = {
        readToolName: supplied.readToolName,
        inputMap: supplied.inputMap.map((mapping) => {
          requireCondition(clean(mapping.targetName) && typeof mapping.writeInputPointer === "string", "Invalid MCP reconciliation input map");
          requireCondition(readTool.inputSchema.properties?.[mapping.targetName], `MCP reconciliation target is outside the read tool: ${mapping.targetName}`);
          schemaAtPointer(tool.inputSchema, mapping.writeInputPointer);
          return { targetName: clean(mapping.targetName, 120), writeInputPointer: mapping.writeInputPointer };
        }),
        assertions: supplied.assertions.map((assertion) => {
          requireCondition(typeof assertion.actualPointer === "string", "MCP reconciliation assertion needs actualPointer");
          const literal = Object.hasOwn(assertion, "equals");
          const pointer = typeof assertion.equalsWriteInputPointer === "string";
          requireCondition(literal !== pointer, "MCP reconciliation assertion needs exactly one expected-value source");
          if (pointer) schemaAtPointer(tool.inputSchema, assertion.equalsWriteInputPointer);
          return literal ? { actualPointer: assertion.actualPointer, equals: stable(assertion.equals) } : { actualPointer: assertion.actualPointer, equalsWriteInputPointer: assertion.equalsWriteInputPointer };
        }),
      };
    }
    return {
      toolName: tool.name,
      exposedName,
      mode: binding.mode,
      authorityAction: binding.mode === "write" ? clean(binding.authorityAction, 160) : null,
      idempotencyField: binding.mode === "write" ? clean(binding.idempotencyField, 120) : null,
      requiredContextSources: cleanStringList(binding.requiredContextSources, `MCP tool ${binding.toolName} requiredContextSources`),
      inputSchema: tool.inputSchema,
      boundedInputSchemaHash: digest(tool.inputSchema),
      verification,
    };
  });
  const plan = {
    schemaVersion: "das.mcp-adapter-plan.v1",
    adapterId: `mcp:${clean(serverId, 160)}`,
    adapterVersion,
    server: { id: clean(serverId, 160), version: clean(serverVersion, 120), toolsListHash: digest(toolsList) },
    status: "executable-bounded-contract",
    operations,
    evidenceBoundary: "Executable contract for an explicitly selected subset of one pinned customer-local MCP server. Write tools require authority, idempotency and read-back reconciliation. It does not trust arbitrary MCP tools, prove the server implementation, infer business success or establish production reliability.",
  };
  plan.planHash = digest(plan);
  return Object.freeze(plan);
}

export function assertMcpAdapterPlan(plan) {
  requireCondition(plan?.schemaVersion === "das.mcp-adapter-plan.v1" && plan.planHash === digest(withoutHash(plan, "planHash")), "MCP adapter plan integrity mismatch");
  requireCondition(/^\d+\.\d+\.\d+$/.test(plan.adapterVersion ?? "") && plan.status === "executable-bounded-contract" && plan.operations?.length > 0 && plan.operations.every((item) => item.boundedInputSchemaHash === digest(item.inputSchema)), "MCP adapter operation contract changed");
  return true;
}

export function bindMcpPlanToCommercialDescriptor({ descriptor, systemId, plan }) {
  assertMcpAdapterPlan(plan);
  requireCondition(descriptor?.schemaVersion === "das.commercial-customer-binding.v1" && descriptor.descriptorHash === digest(withoutHash(descriptor, "descriptorHash")), "Commercial binding descriptor integrity mismatch");
  const updated = structuredClone(descriptor);
  const system = updated.systems.find((item) => item.systemId === systemId);
  requireCondition(system, `Commercial binding system is missing: ${systemId}`);
  const imported = new Map(plan.operations.map((operation) => [operation.exposedName, operation]));
  requireCondition(imported.size === system.operations.length && system.operations.every((operation) => imported.has(operation.exposedName)), "MCP plan must exactly cover the commercial system operation set");
  system.adapterId = plan.adapterId;
  system.adapterVersion = plan.adapterVersion;
  system.status = "executable";
  system.credentialRefs = [];
  system.operations = system.operations.map((operation) => {
    const importedOperation = imported.get(operation.exposedName);
    requireCondition(importedOperation.mode === operation.mode, `MCP mode differs from commercial intake: ${operation.exposedName}`);
    return {
      ...operation,
      customerOperation: importedOperation.toolName,
      status: "executable",
      authorityAction: importedOperation.authorityAction ?? "",
      boundedInputSchemaHash: importedOperation.boundedInputSchemaHash,
      idempotency: importedOperation.mode === "write" ? "implemented" : "not-applicable",
      reconcileUnknown: importedOperation.mode === "write" ? "implemented" : "not-applicable",
    };
  });
  updated.evidenceBoundary = "The exact commercial system operation set is now bound to an executable bounded customer-local MCP transport and reconciliation plan. MCP transport access remains customer-local; the role-level independent verifier and mandatory acceptance campaign remain separate and unproved.";
  delete updated.descriptorHash;
  updated.descriptorHash = digest(updated);
  return Object.freeze(updated);
}

export function createMcpAdapterRuntime({ plan, callTool, allowedAuthorityActions = [], externalStateReader }) {
  assertMcpAdapterPlan(plan);
  requireCondition(typeof callTool === "function", "MCP adapter runtime needs a customer-local callTool function");
  const operations = new Map(plan.operations.map((item) => [item.exposedName, item]));
  const byToolName = new Map(plan.operations.map((item) => [item.toolName, item]));
  const authority = new Set(allowedAuthorityActions);
  async function invoke(operation, input, { verificationRead = false } = {}) {
    validate(input, operation.inputSchema);
    if (operation.mode === "write") requireCondition(authority.has(operation.authorityAction), `Missing authority: ${operation.authorityAction}`);
    if (verificationRead) requireCondition(operation.mode === "read", "MCP outcome verifier cannot execute a write");
    return resultObject(await callTool({ name: operation.toolName, arguments: stable(input) }), operation.toolName);
  }
  return Object.freeze({
    adapterId: plan.adapterId,
    planHash: plan.planHash,
    definitions: () => plan.operations.map((item) => ({ name: item.exposedName, mode: item.mode, requiredAuthority: item.authorityAction, requiredContextSources: [...item.requiredContextSources], inputSchema: stable(item.inputSchema), boundedInputSchemaHash: item.boundedInputSchemaHash })),
    requiredAction(name) { return operations.get(name)?.authorityAction ?? null; },
    async execute(name, input) {
      const operation = operations.get(name);
      requireCondition(operation, `Operation is outside the MCP adapter allowlist: ${name}`);
      return { id: `${plan.adapterId}:${name}:${digest({ input, at: Date.now() })}`, output: await invoke(operation, input) };
    },
    async reconcile(name, writeInput) {
      const write = operations.get(name);
      requireCondition(write?.mode === "write", `Unknown MCP write operation: ${name}`);
      const read = byToolName.get(write.verification.readToolName);
      const input = Object.fromEntries(write.verification.inputMap.map((mapping) => [mapping.targetName, jsonPointer(writeInput, mapping.writeInputPointer)]));
      try {
        const external = await invoke(read, input, { verificationRead: true });
        const checks = write.verification.assertions.map((assertion) => {
          const expected = Object.hasOwn(assertion, "equals") ? assertion.equals : jsonPointer(writeInput, assertion.equalsWriteInputPointer);
          return { actualPointer: assertion.actualPointer, passed: JSON.stringify(jsonPointer(external, assertion.actualPointer)) === JSON.stringify(expected) };
        });
        return Object.freeze({
          classification: checks.every((item) => item.passed) ? "completed" : "incorrect",
          independent: true,
          independentBusinessOutcomeProof: false,
          verifierKind: "action-plane-readback-through-mcp",
          operationId: read.toolName,
          checks,
          evidenceBoundary: "This readback uses the action adapter's MCP plan, transport and credential boundary. It may prevent a blind duplicate retry, but it is not separate business-outcome proof.",
        });
      } catch (error) {
        return Object.freeze({
          classification: "unknown",
          independent: true,
          independentBusinessOutcomeProof: false,
          verifierKind: "action-plane-readback-through-mcp",
          operationId: read.toolName,
          checks: [],
          error: clean(error?.message),
          evidenceBoundary: "This readback uses the action adapter's MCP plan, transport and credential boundary. It may prevent a blind duplicate retry, but it is not separate business-outcome proof.",
        });
      }
    },
    externalState() {
      requireCondition(typeof externalStateReader === "function", `MCP adapter ${plan.adapterId} has no independent external-state reader`);
      const snapshot = externalStateReader();
      requireCondition(snapshot && typeof snapshot === "object" && typeof snapshot.then !== "function", "MCP external-state reader must return a synchronous object snapshot");
      return stable(snapshot);
    },
  });
}
