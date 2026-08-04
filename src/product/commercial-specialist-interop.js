import { digest } from "../core/canonical.js";
import { assertCommercialActivationReceipt, assertCommercialSpecialistBundle } from "./commercial-specialist-lifecycle.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function clean(value, maximum) { return String(value ?? "").trim().slice(0, maximum); }

function publicVerification(verification) {
  if (!verification) return null;
  const unsafeAttempts = Array.isArray(verification.unsafeSideEffects)
    ? verification.unsafeSideEffects.length
    : verification.checks?.noDeniedAttempts === false ? 1 : Number(verification.unsafeAttempts ?? 0);
  const incorrectSideEffects = Number(verification.incorrectSideEffects ?? (verification.recoveryClass === "incorrect-side-effect" ? 1 : 0));
  return {
    passed: verification.passed === true,
    verifierId: clean(verification.verifierId, 240) || null,
    independent: verification.independent === true,
    recoveryClass: clean(verification.recoveryClass, 120) || null,
    outcomeScore: Number(verification.outcomeScore ?? (verification.passed ? 1 : 0)),
    unsafeAttempts: Number.isFinite(unsafeAttempts) && unsafeAttempts >= 0 ? unsafeAttempts : 0,
    incorrectSideEffects: Number.isFinite(incorrectSideEffects) && incorrectSideEffects >= 0 ? incorrectSideEffects : 0,
    checks: verification.checks && typeof verification.checks === "object" ? structuredClone(verification.checks) : null,
  };
}

function publicRunResult({ result, requestId, requestHash, bundle, activation, toolHost }) {
  const observations = Array.isArray(result?.session?.observations) ? result.session.observations : [];
  const businessWritesCommitted = typeof toolHost?.requiredAction === "function"
    ? observations.filter((item) => item?.tool && toolHost.requiredAction(item.tool)).length
    : 0;
  const record = {
    schemaVersion: "das.commercial-specialist-run.v1",
    requestId,
    requestHash,
    roleId: bundle.role.id,
    bundleHash: bundle.bundleHash,
    activationHash: activation.activationHash,
    status: clean(result?.status, 80) || "blocked",
    reason: clean(result?.reason, 400) || null,
    blocker: clean(result?.blocker, 400) || null,
    verification: publicVerification(result?.verification),
    execution: { businessWritesCommitted },
    metering: {
      modelCostUsd: Number(result?.session?.modelCostUsd ?? 0),
      elapsedMs: Number(result?.session?.elapsedMs ?? 0),
      modelElapsedMs: Number(result?.session?.modelElapsedMs ?? result?.session?.elapsedMs ?? 0),
    },
    evidenceBoundary: "Sanitized host result. Raw observations, tool payloads, credentials and customer records remain inside the customer-controlled runtime.",
  };
  record.runReceiptHash = digest(record);
  return Object.freeze(record);
}

export function createCommercialSpecialistInvoker({ bundle, activation, runtime, createRunBindings, tenantId }) {
  assertCommercialSpecialistBundle(bundle);
  assertCommercialActivationReceipt(activation, { bundle });
  requireCondition(runtime && typeof runtime.run === "function", "A specialist runtime is required");
  requireCondition(typeof createRunBindings === "function", "A customer-local run-binding factory is required");
  const fixedTenantId = clean(tenantId, 160);
  requireCondition(fixedTenantId, "The specialist host must bind one tenant before invocation");
  const requests = new Map();

  function requestHash(input = {}) {
    const requestId = clean(input.requestId, 160);
    const goal = clean(input.goal, 4_000);
    requireCondition(requestId && goal, "A bounded request id and ordinary goal are required");
    return digest({ requestId, goal, roleId: bundle.role.id, tenantId: fixedTenantId });
  }

  return Object.freeze({
    roleId: bundle.role.id,
    bundleHash: bundle.bundleHash,
    activationHash: activation.activationHash,
    requestHash,
    authorizeRetry({ requestId, requestHash: expectedHash, resolution }) {
      requireCondition(resolution?.classification === "not-started" && resolution.independent === true && resolution.verifierId === bundle.verifier.binding, "Retry requires an independently verified not-started resolution");
      const prior = requests.get(clean(requestId, 160));
      requireCondition(!prior || prior.requestHash === expectedHash, "Retry authorization does not match the prior request");
      requests.delete(clean(requestId, 160));
      return true;
    },
    async invoke(input = {}) {
      const requestId = clean(input.requestId, 160);
      const goal = clean(input.goal, 4_000);
      requireCondition(requestId && goal, "A bounded request id and ordinary goal are required");
      const requestHash = digest({ requestId, goal, roleId: bundle.role.id, tenantId: fixedTenantId });
      const prior = requests.get(requestId);
      requireCondition(!prior || prior.requestHash === requestHash, "Request id was already used for a different goal");
      if (prior) return prior.promise;

      const promise = (async () => {
        const bindings = await createRunBindings({ requestId, requestHash, goal, tenantId: fixedTenantId, bundle, activation });
        requireCondition(bindings?.toolHost && bindings?.externalVerifier, "The customer-local binding factory did not supply the tool host and independent verifier");
        requireCondition(bindings.externalVerifier.id === bundle.verifier.binding, "The supplied verifier does not match the activated specialist");
        const result = await runtime.run({ tenantId: fixedTenantId, candidate: bundle.selected.candidate, goal, toolHost: bindings.toolHost, externalVerifier: bindings.externalVerifier });
        return publicRunResult({ result, requestId, requestHash, bundle, activation, toolHost: bindings.toolHost });
      })();
      requests.set(requestId, { requestHash, promise });
      return promise;
    },
  });
}

export function assertCommercialSpecialistRunReceipt(receipt, { bundle = null, activation = null } = {}) {
  requireCondition(receipt?.schemaVersion === "das.commercial-specialist-run.v1", "Unsupported commercial specialist run receipt");
  const copy = structuredClone(receipt);
  const expected = copy.runReceiptHash;
  delete copy.runReceiptHash;
  requireCondition(expected && digest(copy) === expected, "Commercial specialist run receipt integrity mismatch");
  requireCondition(receipt.requestId && receipt.requestHash && receipt.roleId && receipt.bundleHash && receipt.activationHash, "Commercial specialist run receipt identity is incomplete");
  requireCondition(Number.isFinite(receipt.metering?.modelCostUsd) && receipt.metering.modelCostUsd >= 0, "Commercial run cost is invalid");
  requireCondition(Number.isFinite(receipt.metering?.modelElapsedMs) && receipt.metering.modelElapsedMs >= 0, "Commercial run model latency is invalid");
  requireCondition(Number.isInteger(receipt.execution?.businessWritesCommitted) && receipt.execution.businessWritesCommitted >= 0, "Commercial run write count is invalid");
  if (receipt.verification) {
    requireCondition(receipt.verification.independent === true && receipt.verification.verifierId, "Commercial run verification is not independently bound");
    for (const [label, value] of [["outcome score", receipt.verification.outcomeScore], ["unsafe attempts", receipt.verification.unsafeAttempts], ["incorrect side effects", receipt.verification.incorrectSideEffects]]) requireCondition(Number.isFinite(value) && value >= 0, `Commercial run ${label} is invalid`);
    requireCondition(receipt.verification.outcomeScore <= 1, "Commercial run outcome score cannot exceed one");
  }
  if (bundle) {
    assertCommercialSpecialistBundle(bundle);
    requireCondition(receipt.roleId === bundle.role.id && receipt.bundleHash === bundle.bundleHash, "Commercial run receipt belongs to another specialist bundle");
    if (receipt.verification) requireCondition(receipt.verification.verifierId === bundle.verifier.binding, "Commercial run receipt uses the wrong verifier");
  }
  if (activation) {
    assertCommercialActivationReceipt(activation, bundle ? { bundle } : undefined);
    requireCondition(receipt.activationHash === activation.activationHash, "Commercial run receipt belongs to another activation");
  }
  return true;
}

export function createLangGraphSpecialistNode({ invoker, goalField = "goal", requestIdField = "requestId", resultField = "specialistResult" }) {
  requireCondition(invoker && typeof invoker.invoke === "function", "A commercial specialist invoker is required");
  for (const field of [goalField, requestIdField, resultField]) requireCondition(clean(field, 120), "LangGraph field names cannot be empty");
  return async function commercialSpecialistNode(state = {}) {
    const result = await invoker.invoke({ requestId: state[requestIdField], goal: state[goalField] });
    return { [resultField]: result };
  };
}

function mcpToolName(roleId) {
  return `das_run_${roleId}`.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96);
}

export function createCommercialSpecialistMcpAdapter({ bundle, invoker }) {
  assertCommercialSpecialistBundle(bundle);
  requireCondition(invoker?.bundleHash === bundle.bundleHash && typeof invoker.invoke === "function", "MCP adapter requires the activated invoker for this exact specialist bundle");
  const name = mcpToolName(bundle.role.id);
  const tool = Object.freeze({
    name,
    title: bundle.role.title,
    description: `Run the activated ${bundle.role.title} against its customer-local tools and independent external-state verifier.`,
    inputSchema: {
      type: "object",
      properties: {
        requestId: { type: "string", minLength: 1, maxLength: 160, description: "Stable idempotency key generated by the host." },
        goal: { type: "string", minLength: 1, maxLength: 4_000, description: "The ordinary business goal for the activated specialist." },
      },
      required: ["requestId", "goal"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  });

  async function callTool(params = {}) {
    if (params.name !== name) return { content: [{ type: "text", text: `Unknown specialist tool: ${clean(params.name, 120)}` }], isError: true };
    const args = params.arguments;
    if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some((key) => !["requestId", "goal"].includes(key))) return { content: [{ type: "text", text: "Tool input must contain only requestId and goal." }], isError: true };
    try {
      const result = await invoker.invoke(args);
      return { content: [{ type: "text", text: `${bundle.role.title}: ${result.status}${result.reason ? ` — ${result.reason}` : ""}` }], structuredContent: result, isError: false };
    } catch (error) {
      return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
    }
  }

  return Object.freeze({
    tool,
    listTools() { return { tools: [tool] }; },
    callTool,
    async handleJsonRpc(request = {}) {
      const response = { jsonrpc: "2.0", id: request.id ?? null };
      if (request.method === "tools/list") return { ...response, result: { tools: [tool] } };
      if (request.method === "tools/call") return { ...response, result: await callTool(request.params) };
      return { ...response, error: { code: -32601, message: `Method not found: ${clean(request.method, 120)}` } };
    },
  });
}

export function commercialInteropManifest({ bundle, activation, mcpAdapter }) {
  assertCommercialSpecialistBundle(bundle);
  assertCommercialActivationReceipt(activation, { bundle });
  requireCondition(mcpAdapter?.tool?.name, "An MCP adapter is required");
  const manifest = {
    schemaVersion: "das.commercial-interop-manifest.v1",
    roleId: bundle.role.id,
    bundleHash: bundle.bundleHash,
    activationHash: activation.activationHash,
    supportedHosts: {
      directJavaScript: { mode: "invoker", status: "implemented" },
      langGraphJavaScript: { mode: "state-graph-node", status: "implemented", outputField: "specialistResult" },
      mcp: { mode: "tools-list-and-call-adapter", status: "implemented", toolName: mcpAdapter.tool.name, transport: "customer-supplied" },
      crewAI: { mode: "connect-through-mcp", status: "requires-customer-wiring" },
    },
    authorityOwner: "DAS activated bundle and customer-local runtime",
    verifierOwner: "Customer-local independent verifier",
    credentialPolicy: "Credentials are neither accepted nor exported by the interop layer.",
    evidenceBoundary: "The direct, LangGraph-node and transport-neutral MCP contracts are locally implemented. No external framework package or remote MCP transport was installed or deployed in this checkpoint.",
  };
  manifest.manifestHash = digest(manifest);
  return Object.freeze(manifest);
}
