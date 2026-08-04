import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { composeBoundedAdapterRuntimes } from "../src/product/openapi-adapter-kit.js";
import { compileMcpAdapterPlan, createMcpAdapterRuntime } from "../src/product/mcp-adapter-kit.js";
import { compileLocalMcpAdapterPackage } from "../src/product/mcp-adapter-files.js";

const toolsList = {
  tools: [
    { name: "crm_get_lead", description: "Read one lead", inputSchema: { type: "object", properties: { leadId: { type: "string" } }, required: ["leadId"], additionalProperties: false } },
    { name: "crm_assign_owner", description: "Assign an owner", inputSchema: { type: "object", properties: { leadId: { type: "string" }, ownerId: { type: "string" }, requestId: { type: "string", minLength: 8 } }, required: ["leadId", "ownerId", "requestId"], additionalProperties: false } },
    { name: "crm_delete_lead", description: "Not selected", inputSchema: { type: "object", properties: { leadId: { type: "string" } }, required: ["leadId"], additionalProperties: false } },
  ],
};

function plan() {
  return compileMcpAdapterPlan({
    serverId: "fictional-crm",
    serverVersion: "1.2.0",
    toolsList,
    operationBindings: [
      { toolName: "crm_get_lead", exposedName: "crm:get-lead", mode: "read", requiredContextSources: ["crm-schema"] },
      { toolName: "crm_assign_owner", exposedName: "crm:assign-owner", mode: "write", authorityAction: "assign-lead-owner", idempotencyField: "requestId", requiredContextSources: ["routing-policy"], verification: { readToolName: "crm_get_lead", inputMap: [{ targetName: "leadId", writeInputPointer: "/leadId" }], assertions: [{ actualPointer: "/ownerId", equalsWriteInputPointer: "/ownerId" }] } },
    ],
  });
}

test("MCP importer pins an exact safe subset and rejects unverified writes", () => {
  const compiled = plan();
  assert.equal(compiled.operations.length, 2);
  assert.equal(compiled.operations.some((item) => item.toolName === "crm_delete_lead"), false);
  assert.deepEqual(compiled.operations.find((item) => item.mode === "write").requiredContextSources, ["routing-policy"]);
  assert.throws(() => compileMcpAdapterPlan({ serverId: "x", toolsList, operationBindings: [{ toolName: "crm_assign_owner", mode: "write", authorityAction: "assign" }] }), /idempotency/);
  const unresolved = structuredClone(toolsList); unresolved.tools[0].inputSchema = { $ref: "https://unsafe.test/schema" };
  assert.throws(() => compileMcpAdapterPlan({ serverId: "x", toolsList: unresolved, operationBindings: [{ toolName: "crm_get_lead", mode: "read" }] }), /unresolved schema reference/);
});

test("bounded MCP runtime enforces authority and reconciles a lost write through read-back", async () => {
  const leads = new Map([["lead-1", { leadId: "lead-1", ownerId: null }]]);
  let loseResponse = true;
  const calls = [];
  const callTool = async ({ name, arguments: input }) => {
    calls.push({ name, input });
    if (name === "crm_get_lead") return { structuredContent: leads.get(input.leadId) };
    if (name === "crm_assign_owner") {
      leads.set(input.leadId, { ...leads.get(input.leadId), ownerId: input.ownerId });
      if (loseResponse) { loseResponse = false; throw new Error("response lost after commit"); }
      return { structuredContent: leads.get(input.leadId) };
    }
    return { isError: true };
  };
  const denied = createMcpAdapterRuntime({ plan: plan(), callTool, allowedAuthorityActions: [], externalStateReader: () => ({ leads: [...leads.values()] }) });
  await assert.rejects(() => denied.execute("crm:assign-owner", { leadId: "lead-1", ownerId: "owner-7", requestId: "request-0001" }), /Missing authority/);
  const runtime = createMcpAdapterRuntime({ plan: plan(), callTool, allowedAuthorityActions: ["assign-lead-owner"], externalStateReader: () => ({ leads: [...leads.values()] }) });
  const input = { leadId: "lead-1", ownerId: "owner-7", requestId: "request-0001" };
  await assert.rejects(() => runtime.execute("crm:assign-owner", input), /response lost/);
  const reconciliation = await runtime.reconcile("crm:assign-owner", input);
  assert.equal(reconciliation.classification, "completed");
  assert.equal(reconciliation.independent, true);
  assert.equal(leads.get("lead-1").ownerId, "owner-7");
  assert.equal(calls.at(-1).name, "crm_get_lead");
});

test("MCP and OpenAPI shaped runtimes share the same composition boundary", () => {
  const runtime = createMcpAdapterRuntime({ plan: plan(), callTool: async () => ({ structuredContent: {} }), allowedAuthorityActions: ["assign-lead-owner"], externalStateReader: () => ({ leads: [] }) });
  const host = composeBoundedAdapterRuntimes({ runtimes: [runtime] });
  assert.deepEqual(host.componentAdapterIds, ["mcp:fictional-crm"]);
  assert.equal(host.definitions().length, 2);
  assert.deepEqual(host.externalState(), { "mcp:fictional-crm": { leads: [] } });
});

test("local MCP package compiler pins review inputs privately and refuses credentials or overwrite", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "das-mcp-adapter-"));
  const toolsListFile = path.join(temporary, "tools-list.json");
  const configFile = path.join(temporary, "config.json");
  const outputDirectory = path.join(temporary, "output");
  fs.writeFileSync(toolsListFile, JSON.stringify(toolsList));
  fs.writeFileSync(configFile, JSON.stringify({ serverId: "fictional-crm", serverVersion: "1.2.0", operationBindings: plan().operations.map((item) => item.mode === "read" ? { toolName: item.toolName, exposedName: item.exposedName, mode: "read", requiredContextSources: item.requiredContextSources } : { toolName: item.toolName, exposedName: item.exposedName, mode: "write", authorityAction: item.authorityAction, idempotencyField: item.idempotencyField, requiredContextSources: item.requiredContextSources, verification: item.verification }) }));
  const compiled = compileLocalMcpAdapterPackage({ toolsListFile, configFile, outputDirectory });
  assert.equal(compiled.readyForCustomerActivation, false);
  assert.equal(fs.statSync(outputDirectory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(outputDirectory, "adapter-plan.json")).mode & 0o777, 0o600);
  assert.throws(() => compileLocalMcpAdapterPackage({ toolsListFile, configFile, outputDirectory }), /refuses to overwrite/);
  const unsafeConfig = path.join(temporary, "unsafe.json");
  fs.writeFileSync(unsafeConfig, JSON.stringify({ serverId: "x", apiKey: "secret", operationBindings: [] }));
  assert.throws(() => compileLocalMcpAdapterPackage({ toolsListFile, configFile: unsafeConfig, outputDirectory: path.join(temporary, "unsafe-output") }), /unsupported top-level field|credential/);
});
