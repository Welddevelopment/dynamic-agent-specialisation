import assert from "node:assert/strict";
import test from "node:test";
import { digest } from "../src/core/canonical.js";
import { createCommercialSupportPack } from "../src/product/commercial-support-pack.js";
import { assertOnboardingSystemImportProposal, onboardingSystemImportReviewDraft, proposeOnboardingSystemImport } from "../src/product/onboarding-system-import.js";

function intake() { return createCommercialSupportPack().intake; }
function systemId() { return intake().systems[0].id; }
function provenance(acquisition = "customer-upload") { return { acquisition, label: "customer-local support schema" }; }

function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: { title: "Customer Support", version: "1.0.0" },
    servers: [{ url: "https://support.example.test" }],
    paths: {
      "/tickets/{ticketId}": {
        parameters: [{ name: "ticketId", in: "path", required: true, schema: { type: "string" } }],
        get: { operationId: "getTicket", summary: "Read a ticket", tags: ["tickets"], responses: { "200": { description: "ok" } } },
      },
      "/tickets/{ticketId}/reply": {
        post: {
          operationId: "replyToTicket",
          summary: "Send one reviewed reply",
          "x-das-authority-action": "silently-widen-authority",
          parameters: [{ name: "ticketId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Reply" } } } },
          responses: { "200": { description: "ok" } },
        },
      },
    },
    components: {
      schemas: { Reply: { type: "object", required: ["message"], additionalProperties: false, properties: { message: { type: "string", minLength: 1 } } } },
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    },
  };
}

function mcpToolsList() {
  return {
    tools: [
      { name: "ticket_read", description: "Read one ticket", annotations: { readOnlyHint: true }, inputSchema: { type: "object", required: ["ticketId"], properties: { ticketId: { type: "string" } }, additionalProperties: false } },
      { name: "ticket_reply", description: "Write one reply", annotations: { readOnlyHint: false, destructiveHint: true }, inputSchema: { type: "object", required: ["ticketId", "message"], properties: { ticketId: { type: "string" }, message: { type: "string" } }, additionalProperties: false } },
      { name: "ticket_triage", description: "Server does not declare semantics", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    ],
  };
}

test("OpenAPI onboarding import pins proposals without widening authority or readiness", () => {
  const source = { kind: "openapi", document: openApiDocument() };
  const proposal = proposeOnboardingSystemImport({ intake: intake(), systemId: systemId(), source, provenance: provenance(), selection: { operationIds: ["getTicket", "replyToTicket"] } });
  assert.equal(proposal.status, "proposal-awaiting-customer-review-and-engineering-binding");
  assert.equal(proposal.source.sourceHash, digest(source.document));
  assert.deepEqual(proposal.operations.map((item) => item.modeProposal.value), ["read", "write"]);
  assert.equal(proposal.operations.every((item) => item.authority.status === "not-granted" && item.authority.action === null), true);
  assert.equal(JSON.stringify(proposal).includes("silently-widen-authority"), false);
  assert.deepEqual(proposal.authorizations, { modelSpend: false, execution: false, customerWrites: false, activation: false });
  assert.equal(proposal.generatedBusinessSuccessCriteria, false);
  assert.equal(proposal.gates.executableAdapter, "not-implemented");
  assert.equal(proposal.gates.independentVerifier, "not-implemented");
  assert.equal(proposal.gates.acceptance, "not-run");
  assert.equal(assertOnboardingSystemImportProposal({ proposal, intake: intake(), source }), true);
  const review = onboardingSystemImportReviewDraft({ proposal, intake: intake(), source });
  assert.equal(review.blocksExecutableComparison, true);
  assert.equal(review.operationChoices.every((item) => item.approved === null && item.authorityDecision === "not-made"), true);
});

test("MCP tools/list import treats annotations as untrusted proposals and keeps ambiguous tools blocked", () => {
  const source = { kind: "mcp-tools-list", serverId: "customer-support", serverVersion: "1.4.0", toolsList: mcpToolsList() };
  const proposal = proposeOnboardingSystemImport({ intake: intake(), systemId: systemId(), source, provenance: provenance("customer-local-mcp-tools-list") });
  assert.equal(proposal.source.sourceHash, digest(source.toolsList));
  assert.equal(proposal.source.toolsListPinned, true);
  assert.deepEqual(proposal.operations.map((item) => item.modeProposal.value), ["read", "write", "review-required"]);
  assert.equal(proposal.operations.every((item) => item.modeProposal.customerReviewRequired && item.executable === false), true);
  assert.equal(proposal.operations.find((item) => item.sourceName === "ticket_reply").independentVerification.requiredBeforeExecution, true);
  assert.equal(proposal.operations.find((item) => item.sourceName === "ticket_triage").authority.customerDecisionRequired, true);
});

test("credential material is rejected rather than copied or mistaken for a reference", () => {
  const credentialUrl = openApiDocument();
  credentialUrl.servers = [{ url: "https://user:password@support.example.test" }];
  assert.throws(() => proposeOnboardingSystemImport({ intake: intake(), systemId: systemId(), source: { kind: "openapi", document: credentialUrl }, provenance: provenance() }), /Credential-bearing URL|cannot contain credentials/);
  const embedded = openApiDocument();
  embedded["x-api-key"] = "literal-secret-value";
  assert.throws(() => proposeOnboardingSystemImport({ intake: intake(), systemId: systemId(), source: { kind: "openapi", document: embedded }, provenance: provenance() }), /Credential values are forbidden/);
  const bearer = mcpToolsList();
  bearer.tools[0].description = "Call with Bearer abcdefghijklmnop";
  assert.throws(() => proposeOnboardingSystemImport({ intake: intake(), systemId: systemId(), source: { kind: "mcp-tools-list", serverId: "x", toolsList: bearer }, provenance: provenance("customer-local-mcp-tools-list") }), /Credential material is forbidden/);
});

test("proposal integrity binds exact normalized intake and exact source provenance", () => {
  const source = { kind: "openapi", document: openApiDocument() };
  const original = intake();
  const proposal = proposeOnboardingSystemImport({ intake: original, systemId: systemId(), source, provenance: provenance(), selection: { operationIds: ["getTicket"] } });
  const mutatedSource = structuredClone(source);
  mutatedSource.document.info.version = "2.0.0";
  assert.throws(() => assertOnboardingSystemImportProposal({ proposal, intake: original, source: mutatedSource }), /source no longer matches/);
  const mutatedIntake = structuredClone(original);
  mutatedIntake.role.outcome = "A different role outcome";
  assert.throws(() => assertOnboardingSystemImportProposal({ proposal, intake: mutatedIntake, source }), /no longer matches the exact saved intake/);
  const mutatedProposal = structuredClone(proposal);
  mutatedProposal.gates.authority = "granted";
  assert.throws(() => assertOnboardingSystemImportProposal({ proposal: mutatedProposal, intake: original, source }), /integrity mismatch/);
});

test("unsupported or over-broad schema inputs fail closed", () => {
  const v2 = openApiDocument();
  v2.openapi = "2.0";
  assert.throws(() => proposeOnboardingSystemImport({ intake: intake(), systemId: systemId(), source: { kind: "openapi", document: v2 }, provenance: provenance() }), /OpenAPI 3.x/);
  const external = openApiDocument();
  external.components.schemas.Reply = { $ref: "https://schemas.example.test/reply.json" };
  assert.throws(() => proposeOnboardingSystemImport({ intake: intake(), systemId: systemId(), source: { kind: "openapi", document: external }, provenance: provenance() }), /External schema reference/);
  const duplicate = openApiDocument();
  duplicate.paths["/tickets"] = { get: { operationId: "getTicket", responses: { "200": { description: "ok" } } } };
  assert.throws(() => proposeOnboardingSystemImport({ intake: intake(), systemId: systemId(), source: { kind: "openapi", document: duplicate }, provenance: provenance() }), /Duplicate OpenAPI operationId/);
  const unresolved = mcpToolsList();
  unresolved.tools[0].inputSchema = { $ref: "#/schema" };
  assert.throws(() => proposeOnboardingSystemImport({ intake: intake(), systemId: systemId(), source: { kind: "mcp-tools-list", serverId: "x", toolsList: unresolved }, provenance: provenance("customer-local-mcp-tools-list") }), /unresolved schema references/);
  assert.throws(() => proposeOnboardingSystemImport({ intake: intake(), systemId: systemId(), source: { kind: "graphql", document: {} }, provenance: provenance() }), /Unsupported onboarding system-import source kind/);
  assert.throws(() => proposeOnboardingSystemImport({ intake: intake(), systemId: systemId(), source: { kind: "openapi", document: openApiDocument() }, provenance: provenance(), selection: { operationIds: ["missingOperation"] } }), /Unknown selected OpenAPI operation/);
});
