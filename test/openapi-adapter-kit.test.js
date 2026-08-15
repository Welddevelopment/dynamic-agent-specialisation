import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { bindOpenApiPlanToCommercialDescriptor, compileOpenApiAdapterPlan, composeBoundedAdapterRuntimes, createOpenApiAdapterRuntime } from "../src/product/openapi-adapter-kit.js";
import { createCommercialBindingScaffold } from "../src/product/commercial-binding-kit.js";
import { createCommercialSupportPack } from "../src/product/commercial-support-pack.js";
import { compileLocalOpenApiAdapterPackage } from "../src/product/openapi-adapter-files.js";
import { ScriptedDecisionEngine, SpecialistAgentRuntime } from "../src/runtime/agent-runtime.js";
import { TenantRoleMemory } from "../src/runtime/memory.js";
import { digest } from "../src/core/canonical.js";

const spec = {
  openapi: "3.1.0",
  info: { title: "Fictional Orders", version: "1.0.0" },
  servers: [{ url: "https://orders.example.test" }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    schemas: { DraftOrder: { type: "object", additionalProperties: false, required: ["id", "sku", "quantity"], properties: { id: { type: "string" }, sku: { type: "string" }, quantity: { type: "integer" }, hiddenExample: { type: "string", example: "must-not-copy" } } } },
  },
  paths: {
    "/orders": { post: { operationId: "createDraftOrder", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/DraftOrder" } } } }, responses: { "201": { description: "created" } } } },
    "/orders/{id}": {
      get: { operationId: "getOrder", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "found" } } },
      delete: { operationId: "deleteOrder", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "204": { description: "deleted" } } },
    },
  },
};

function plan() {
  return compileOpenApiAdapterPlan({
    spec,
    adapterId: "fictional-orders",
    credentialRefs: { bearerAuth: "FICTIONAL_ORDERS_TOKEN" },
    operationBindings: [
      { operationId: "getOrder", exposedName: "orders:get", mode: "read", requiredContextSources: ["orders-api"] },
      { operationId: "createDraftOrder", exposedName: "orders:create-draft", mode: "write", authorityAction: "draft-order", idempotencyHeader: "Idempotency-Key", requiredContextSources: ["orders-policy"], verification: { readOperationId: "getOrder", inputMap: [{ targetSection: "path", targetName: "id", writeInputPointer: "/body/id" }], assertions: [{ actualPointer: "/id", equalsWriteInputPointer: "/body/id" }, { actualPointer: "/sku", equalsWriteInputPointer: "/body/sku" }, { actualPointer: "/status", equals: "draft" }] } },
    ],
  });
}

function fakeServer() {
  const orders = new Map();
  const requests = [];
  let loseNextWriteResponse = false;
  return {
    orders, requests,
    loseNextWriteResponse() { loseNextWriteResponse = true; },
    async fetch(url, init) {
      requests.push({ url: String(url), method: init.method, authorization: init.headers.Authorization, idempotencyKey: init.headers["Idempotency-Key"] });
      const parsed = new URL(url);
      if (init.method === "POST" && parsed.pathname === "/orders") {
        const body = JSON.parse(init.body); orders.set(body.id, { ...body, status: "draft" });
        if (loseNextWriteResponse) { loseNextWriteResponse = false; throw new Error("simulated response loss after commit"); }
        return Response.json(orders.get(body.id), { status: 201 });
      }
      if (init.method === "GET" && parsed.pathname.startsWith("/orders/")) {
        const id = decodeURIComponent(parsed.pathname.slice("/orders/".length));
        return orders.has(id) ? Response.json(orders.get(id)) : Response.json({ error: "not found" }, { status: 404 });
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    },
  };
}

test("OpenAPI importer creates a bounded exact operation subset without credential values", () => {
  const compiled = plan();
  assert.equal(compiled.operations.length, 2);
  assert.equal(compiled.operations.some((item) => item.operationId === "deleteOrder"), false);
  assert.equal(JSON.stringify(compiled).includes("must-not-copy"), false);
  assert.equal(JSON.stringify(compiled).includes("actual-secret"), false);
  assert.match(compiled.operations.find((item) => item.mode === "write").boundedInputSchemaHash, /^[a-f0-9]{64}$/);
});

test("bounded OpenAPI runtime enforces authority, input and operation allowlists", async () => {
  const server = fakeServer();
  const denied = createOpenApiAdapterRuntime({ plan: plan(), fetchImpl: server.fetch, secretResolver: async () => "actual-secret", allowedAuthorityActions: [] });
  const input = { body: { id: "order-1", sku: "sku-1", quantity: 2 }, idempotencyKey: "order-key-0001" };
  await assert.rejects(() => denied.execute("orders:create-draft", input), /Missing authority/);
  const runtime = createOpenApiAdapterRuntime({ plan: plan(), fetchImpl: server.fetch, secretResolver: async () => "actual-secret", allowedAuthorityActions: ["draft-order"] });
  await assert.rejects(() => runtime.execute("orders:create-draft", { body: { id: "order-1", sku: "sku-1" }, idempotencyKey: "order-key-0001" }), /quantity is required/);
  await assert.rejects(() => runtime.execute("deleteOrder", { path: { id: "order-1" } }), /outside the adapter allowlist/);
  const result = await runtime.execute("orders:create-draft", input);
  assert.equal(result.output.status, "draft");
  assert.equal(server.requests[0].authorization, "Bearer actual-secret");
  assert.equal(server.requests[0].idempotencyKey, "order-key-0001");
});

test("lost write response reconciles through a separate direct external read", async () => {
  const server = fakeServer();
  const runtime = createOpenApiAdapterRuntime({ plan: plan(), fetchImpl: server.fetch, secretResolver: async () => "actual-secret", allowedAuthorityActions: ["draft-order"] });
  const input = { body: { id: "order-lost", sku: "sku-7", quantity: 4 }, idempotencyKey: "order-key-lost-1" };
  server.loseNextWriteResponse();
  await assert.rejects(() => runtime.execute("orders:create-draft", input), /response loss/);
  const reconciliation = await runtime.reconcile("orders:create-draft", input);
  assert.equal(reconciliation.classification, "completed");
  assert.equal(reconciliation.independent, true);
  assert.equal(reconciliation.independentBusinessOutcomeProof, false);
  assert.equal(reconciliation.verifierKind, "action-plane-readback-through-openapi");
  assert.equal(server.orders.size, 1);
});

test("import rejects insecure remote servers, external references, unsupported auth and unverified writes", () => {
  const bindings = [{ operationId: "getOrder", exposedName: "orders:get", mode: "read" }];
  assert.throws(() => compileOpenApiAdapterPlan({ spec, adapterId: "x", baseUrl: "http://remote.test", credentialRefs: { bearerAuth: "FICTIONAL_ORDERS_TOKEN" }, operationBindings: bindings }), /HTTPS/);
  const external = structuredClone(spec); external.paths["/orders"].post.requestBody.content["application/json"].schema = { $ref: "https://example.test/schema.json" };
  assert.throws(() => compileOpenApiAdapterPlan({ spec: external, adapterId: "x", credentialRefs: { bearerAuth: "FICTIONAL_ORDERS_TOKEN" }, operationBindings: [{ operationId: "createDraftOrder", mode: "write", authorityAction: "draft-order", idempotencyHeader: "Idempotency-Key", verification: {} }] }), /External OpenAPI reference/);
  assert.throws(() => compileOpenApiAdapterPlan({ spec, adapterId: "x", credentialRefs: { bearerAuth: "literal-token" }, operationBindings: bindings }), /credential reference/);
  assert.throws(() => compileOpenApiAdapterPlan({ spec, adapterId: "x", credentialRefs: { bearerAuth: "FICTIONAL_ORDERS_TOKEN" }, operationBindings: [{ operationId: "createDraftOrder", mode: "write", authorityAction: "draft-order", idempotencyHeader: "Idempotency-Key" }] }), /independent outcome verification/);
});

test("an exact OpenAPI plan can fill transport coverage without pretending the business verifier passed", () => {
  const pack = createCommercialSupportPack();
  const scaffold = createCommercialBindingScaffold({ intake: pack.intake, roleDraft: pack.roleDraft });
  const tools = pack.intake.systems[0].tools;
  const readTool = tools.find((tool) => tool.mode === "read");
  const paths = {};
  for (const [index, tool] of tools.entries()) {
    paths[`/operations/${index}`] = { [tool.mode === "read" ? "get" : "post"]: { operationId: tool.name, ...(tool.mode === "write" ? { requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["ticketId"], properties: { ticketId: { type: "string" } } } } } } } : {}), responses: { "200": { description: "ok" } } } };
  }
  const commercialSpec = { openapi: "3.1.0", info: { title: "Support", version: "1" }, servers: [{ url: "https://support.example.test" }], paths };
  const bindings = tools.map((tool) => tool.mode === "read"
    ? { operationId: tool.name, exposedName: `${pack.intake.systems[0].id}:${tool.name}`, mode: "read" }
    : { operationId: tool.name, exposedName: `${pack.intake.systems[0].id}:${tool.name}`, mode: "write", authorityAction: pack.intake.authority.allowedActions[0], idempotencyHeader: "Idempotency-Key", verification: { readOperationId: readTool.name, inputMap: [{ targetSection: "query", targetName: "ticketId", writeInputPointer: "/body/ticketId" }], assertions: [{ actualPointer: "/ticketId", equalsWriteInputPointer: "/body/ticketId" }] } });
  commercialSpec.paths["/operations/0"].get.parameters = [{ name: "ticketId", in: "query", required: true, schema: { type: "string" } }];
  const imported = compileOpenApiAdapterPlan({ spec: commercialSpec, adapterId: "customer-support-openapi", operationBindings: bindings });
  const bound = bindOpenApiPlanToCommercialDescriptor({ descriptor: scaffold, systemId: pack.intake.systems[0].id, plan: imported });
  assert.equal(bound.systems[0].status, "executable");
  assert.equal(bound.systems[0].operations.every((operation) => operation.status === "executable"), true);
  assert.equal(bound.verifier.status, "not-implemented");
  assert.equal(bound.acceptanceCases.every((item) => item.status === "not-run"), true);
});

test("local package compiler is one-step, private, non-overwriting and activation-conservative", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "das-openapi-package-"));
  const specFile = path.join(temporary, "openapi.json");
  const configFile = path.join(temporary, "config.json");
  const outputDirectory = path.join(temporary, "output");
  fs.writeFileSync(specFile, JSON.stringify(spec));
  fs.writeFileSync(configFile, JSON.stringify({ adapterId: "fictional-orders", credentialRefs: { bearerAuth: "FICTIONAL_ORDERS_TOKEN" }, operationBindings: plan().operations.map((operation) => operation.mode === "read" ? { operationId: operation.operationId, exposedName: operation.exposedName, mode: "read" } : { operationId: operation.operationId, exposedName: operation.exposedName, mode: "write", authorityAction: operation.authorityAction, idempotencyHeader: operation.idempotencyHeader, verification: operation.verification }) }));
  const result = compileLocalOpenApiAdapterPackage({ specFile, configFile, outputDirectory });
  assert.equal(result.readyForCustomerActivation, false);
  assert.equal(fs.statSync(outputDirectory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(outputDirectory, "adapter-plan.json")).mode & 0o777, 0o600);
  assert.throws(() => compileLocalOpenApiAdapterPackage({ specFile, configFile, outputDirectory }), /refuses to overwrite/);
  const unsafeConfig = path.join(temporary, "unsafe.json");
  fs.writeFileSync(unsafeConfig, JSON.stringify({ adapterId: "x", apiKey: "literal-secret", operationBindings: [] }));
  assert.throws(() => compileLocalOpenApiAdapterPackage({ specFile, configFile: unsafeConfig, outputDirectory: path.join(temporary, "unsafe-output") }), /Credential values/);
});

test("common component references plus customer-managed OAuth and basic auth remain customer-local", async () => {
  const referenced = {
    openapi: "3.1.0",
    info: { title: "Referenced", version: "1" },
    servers: [{ url: "https://referenced.example.test" }],
    components: {
      parameters: { RecordId: { name: "id", in: "path", required: true, schema: { type: "string" } } },
      requestBodies: { Update: { required: true, content: { "application/json": { schema: { allOf: [{ type: "object", required: ["id"], properties: { id: { type: "string" } } }, { type: "object", required: ["state"], properties: { state: { type: "string", enum: ["ready"] } } }] } } } } },
      securitySchemes: { oauth: { type: "oauth2", flows: { clientCredentials: { tokenUrl: "https://auth.example.test/token", scopes: {} } } }, basic: { type: "http", scheme: "basic" } },
    },
    paths: {
      "/records/{id}": {
        get: { operationId: "getRecord", security: [{ basic: [] }], parameters: [{ $ref: "#/components/parameters/RecordId" }], responses: { "200": { description: "ok" } } },
        patch: { operationId: "updateRecord", security: [{ oauth: [] }], parameters: [{ $ref: "#/components/parameters/RecordId" }], requestBody: { $ref: "#/components/requestBodies/Update" }, responses: { "200": { description: "ok" } } },
      },
    },
  };
  const imported = compileOpenApiAdapterPlan({ spec: referenced, adapterId: "referenced", credentialRefs: { oauth: "CUSTOMER_OAUTH_ACCESS_TOKEN", basic: { usernameRef: "CUSTOMER_BASIC_USERNAME", passwordRef: "CUSTOMER_BASIC_PASSWORD" } }, operationBindings: [
    { operationId: "getRecord", exposedName: "records:get", mode: "read" },
    { operationId: "updateRecord", exposedName: "records:update", mode: "write", authorityAction: "update-record", idempotencyHeader: "Idempotency-Key", verification: { readOperationId: "getRecord", inputMap: [{ targetSection: "path", targetName: "id", writeInputPointer: "/path/id" }], assertions: [{ actualPointer: "/state", equalsWriteInputPointer: "/body/state" }] } },
  ] });
  const requests = [];
  const runtime = createOpenApiAdapterRuntime({ plan: imported, allowedAuthorityActions: ["update-record"], secretResolver: async (reference) => ({ CUSTOMER_OAUTH_ACCESS_TOKEN: "token", CUSTOMER_BASIC_USERNAME: "user", CUSTOMER_BASIC_PASSWORD: "pass" })[reference], fetchImpl: async (url, init) => { requests.push(init.headers.Authorization); return Response.json({ id: "record-1", state: "ready" }); } });
  await runtime.execute("records:update", { path: { id: "record-1" }, body: { id: "record-1", state: "ready" }, idempotencyKey: "record-key-0001" });
  const outcome = await runtime.reconcile("records:update", { path: { id: "record-1" }, body: { id: "record-1", state: "ready" }, idempotencyKey: "record-key-0001" });
  assert.equal(outcome.classification, "completed");
  assert.equal(requests[0], "Bearer token");
  assert.equal(requests[1], `Basic ${Buffer.from("user:pass").toString("base64")}`);
  await assert.rejects(() => runtime.execute("records:update", { path: { id: "record-1" }, body: { id: "record-1", state: "wrong" }, idempotencyKey: "record-key-0002" }), /allowed enum/);
});

test("several bounded OpenAPI systems compose into one joined specialist tool host", async () => {
  const orders = fakeServer();
  const ordersRuntime = createOpenApiAdapterRuntime({
    plan: plan(),
    fetchImpl: orders.fetch,
    secretResolver: async () => "actual-secret",
    allowedAuthorityActions: ["draft-order"],
    externalStateReader: () => ({ orders: [...orders.orders.values()] }),
  });
  const inventorySpec = {
    openapi: "3.1.0",
    info: { title: "Fictional Inventory", version: "1" },
    servers: [{ url: "https://inventory.example.test" }],
    paths: { "/inventory/{sku}": { get: { operationId: "getInventory", parameters: [{ name: "sku", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" } } } } },
  };
  const inventoryPlan = compileOpenApiAdapterPlan({ spec: inventorySpec, adapterId: "fictional-inventory", operationBindings: [{ operationId: "getInventory", exposedName: "inventory:get", mode: "read", requiredContextSources: ["inventory-api"] }] });
  const inventoryRuntime = createOpenApiAdapterRuntime({
    plan: inventoryPlan,
    secretResolver: async () => { throw new Error("no secret expected"); },
    fetchImpl: async () => Response.json({ sku: "sku-9", available: 0 }),
    externalStateReader: () => ({ inventory: [{ sku: "sku-9", available: 0 }] }),
  });
  const toolHost = composeBoundedAdapterRuntimes({ runtimes: [ordersRuntime, inventoryRuntime] });
  const candidate = {
    id: "joined-openapi-specialist",
    roleId: "joined-openapi-role",
    version: "1.0.0",
    tools: ["inventory:get", "orders:create-draft"],
    context: { sources: ["inventory-api", "orders-policy"] },
    authority: { allowedActions: ["draft-order"] },
    verifier: { kind: "independent-external-state", binding: "joined-openapi-verifier" },
    strategy: { requireCompleteContext: true },
    escalation: { threshold: 0 },
    limits: { maxCostPerTaskUsd: 1, maxLatencyMs: 30_000 },
    memory: { kind: "task-scoped", scope: "current run" },
  };
  const runtime = new SpecialistAgentRuntime({
    decisionEngine: new ScriptedDecisionEngine([
      { kind: "tool", name: "inventory:get", input: { path: { sku: "sku-9" } } },
      { kind: "tool", name: "orders:create-draft", input: { body: { id: "order-joined", sku: "sku-9", quantity: 3 }, idempotencyKey: "joined-order-key" } },
      { kind: "complete", name: null, input: null },
    ]),
    memory: new TenantRoleMemory(),
    maxTurns: 4,
  });
  const externalVerifier = {
    id: "joined-openapi-verifier",
    async verify({ externalState }) {
      const order = externalState["fictional-orders"].orders.find((item) => item.id === "order-joined");
      const inventory = externalState["fictional-inventory"].inventory.find((item) => item.sku === "sku-9");
      return { passed: order?.status === "draft" && order?.quantity === 3 && inventory?.available === 0, independent: true, verifierId: this.id, outcomeScore: 1, unsafeAttempts: 0, incorrectSideEffects: 0 };
    },
  };
  const result = await runtime.run({ tenantId: "fictional-company", candidate, goal: "Read current stock and safely create the required draft order.", toolHost, externalVerifier });
  assert.equal(result.status, "completed");
  assert.equal(result.verification.passed, true);
  assert.deepEqual(toolHost.componentAdapterIds, ["fictional-inventory", "fictional-orders"]);
  assert.equal(orders.orders.size, 1);
});

test("composed adapter host rejects tool-name collisions and missing independent state readers", () => {
  const first = createOpenApiAdapterRuntime({ plan: plan(), fetchImpl: fakeServer().fetch, secretResolver: async () => "secret", allowedAuthorityActions: ["draft-order"] });
  const changed = structuredClone(plan());
  changed.adapterId = "other-orders";
  delete changed.planHash;
  changed.planHash = digest(changed);
  const second = createOpenApiAdapterRuntime({ plan: changed, fetchImpl: fakeServer().fetch, secretResolver: async () => "secret", allowedAuthorityActions: ["draft-order"] });
  assert.throws(() => composeBoundedAdapterRuntimes({ runtimes: [first, second] }), /Duplicate bounded tool name/);
  assert.throws(() => first.externalState(), /no independent external-state reader/);
});
