import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { recordConsoleSystemImport, recordConsoleSystemImportReview } from "../src/console/system-import-route.js";
import { createCommercialSupportPack } from "../src/product/commercial-support-pack.js";
import { AssistedCommercialOnboardingJourney } from "../src/product/assisted-onboarding-journey.js";

function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: { title: "Customer Support", version: "1.0.0" },
    paths: {
      "/tickets/{ticketId}": {
        get: { operationId: "getTicket", summary: "Read a ticket", responses: { "200": { description: "ok" } } },
      },
      "/tickets/{ticketId}/reply": {
        post: {
          operationId: "replyToTicket",
          summary: "Send one reviewed reply",
          requestBody: { content: { "application/json": { schema: { type: "object", properties: { message: { type: "string" } } } } } },
          responses: { "200": { description: "ok" } },
        },
      },
    },
  };
}

function mcpToolsList() {
  return {
    tools: [
      { name: "ticket_read", annotations: { readOnlyHint: true }, inputSchema: { type: "object", properties: { ticketId: { type: "string" } } } },
      { name: "ticket_triage", description: "Server does not declare action semantics", inputSchema: { type: "object", properties: {} } },
    ],
  };
}

function fixture(t) {
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "das-console-system-import-"));
  t.after(() => fs.rmSync(stateDirectory, { recursive: true, force: true }));
  const journey = new AssistedCommercialOnboardingJourney({ stateDirectory });
  const intake = createCommercialSupportPack().intake;
  journey.saveBusinessIntake(intake);
  return { journey, intake, systemId: intake.systems[0].id };
}

test("console OpenAPI import records a sanitized review-only proposal", (t) => {
  const { journey, intake, systemId } = fixture(t);
  const document = openApiDocument();
  const result = recordConsoleSystemImport({
    journey,
    input: { sessionId: intake.sessionId, systemId, sourceKind: "openapi", sourceLabel: "/Users/customer/private/support.json", document, selectedNames: [] },
  });
  assert.equal(result.proposal.sessionId, intake.sessionId);
  assert.equal(result.proposal.source.label, "support.json");
  assert.equal(result.proposal.operationCount, 2);
  assert.equal(result.proposal.operations.every((item) => item.customerReviewRequired && item.authority === "not-granted" && item.credentials === "not-collected" && item.adapter === "not-implemented" && item.executable === false), true);
  assert.deepEqual(result.proposal.authorizations, { modelSpend: false, execution: false, customerWrites: false, activation: false });
  assert.equal(result.projection.generated.systemImportProposals, 1);
  assert.equal(result.projection.generated.systemImportReviewAssistants, 1);
  assert.equal(result.proposal.operations.find((item) => item.sourceName === "getTicket").suggestion.targetExposedName, `${systemId}:read-ticket`);
  assert.equal(result.proposal.operations.find((item) => item.sourceName === "replyToTicket").suggestion.targetExposedName, `${systemId}:draft-response`);
  assert.equal(result.proposal.operations.every((item) => item.suggestion.customerConfirmationRequired), true);
  assert.equal(result.projection.stages.executableComparisonEnvironmentReady, false);
  const serialized = JSON.stringify(result.proposal);
  assert.doesNotMatch(serialized, /Users\/customer|sourceHash|proposalHash|intakeHash|"paths"|raw/i);
});

test("console MCP import preserves ambiguity as customer review rather than authority", (t) => {
  const { journey, intake, systemId } = fixture(t);
  const result = recordConsoleSystemImport({
    journey,
    input: { sessionId: intake.sessionId, systemId, sourceKind: "mcp-tools-list", sourceLabel: "Pinned support tools", serverId: "support-tools", serverVersion: "1.4.0", document: mcpToolsList() },
  });
  assert.deepEqual(result.proposal.operations.map((item) => item.proposedMode), ["read", "review-required"]);
  assert.equal(result.proposal.operations.every((item) => item.customerReviewRequired && !item.executable), true);
  assert.equal(result.proposal.gates.authority, "not-granted");
  assert.equal(result.proposal.gates.comparisonExecution, "blocked");
});

test("console joins explicit review to a measured non-executable binding work plan", (t) => {
  const { journey, intake, systemId } = fixture(t);
  const document = openApiDocument();
  const input = { sessionId: intake.sessionId, systemId, sourceKind: "openapi", sourceLabel: "support.json", document, selectedNames: [] };
  const proposed = recordConsoleSystemImport({ journey, input });
  const reviewed = recordConsoleSystemImportReview({
    journey,
    input: {
      ...input,
      confirmedBy: "Support owner",
      decisions: {
        operationChoices: [
          { sourceName: "getTicket", approved: true, targetExposedName: `${systemId}:read-ticket`, confirmedMode: "read", authorityAction: null, requiredContextSources: ["ticket-thread"] },
          { sourceName: "replyToTicket", approved: true, targetExposedName: `${systemId}:draft-response`, confirmedMode: "write", authorityAction: "draft-support-response", requiredContextSources: ["ticket-thread", "support-policy"] },
        ],
        contextChoices: proposed.proposal.review.contextSources.map((sourceId) => ({ sourceId, approved: true })),
      },
    },
  });
  assert.equal(reviewed.review.status, "customer-confirmed-engineering-required");
  assert.equal(reviewed.review.approvedOperations.length, 2);
  assert.equal(reviewed.review.gates.executable, false);
  assert.equal(reviewed.review.gates.authorityWidened, false);
  assert.ok(reviewed.review.setupCoverage.generatedOrCustomerConfirmed > 0);
  assert.ok(reviewed.review.setupCoverage.remainingEngineerOrIndependentProof > 0);
  assert.ok(reviewed.review.exactRemainingWork.some((item) => /independently read external state/i.test(item.detail)));
  assert.equal(reviewed.projection.stages.executableComparisonEnvironmentReady, false);
  assert.equal(reviewed.projection.generated.bindingWorkPlans, 1);
  const serialized = JSON.stringify(reviewed.review);
  assert.doesNotMatch(serialized, /proposalHash|confirmationHash|workPlanHash|sourceHash|\/Users\/customer/);
});

test("console import fails closed on credentials and external references", (t) => {
  const { journey, intake, systemId } = fixture(t);
  const credential = openApiDocument();
  credential["x-api-key"] = "literal-secret-value";
  assert.throws(() => recordConsoleSystemImport({ journey, input: { sessionId: intake.sessionId, systemId, sourceKind: "openapi", sourceLabel: "support", document: credential } }), /Credential values are forbidden/);
  const external = openApiDocument();
  external.paths["/tickets/{ticketId}"].get.responses["200"].content = { "application/json": { schema: { $ref: "https://private.example/schema.json" } } };
  assert.throws(() => recordConsoleSystemImport({ journey, input: { sessionId: intake.sessionId, systemId, sourceKind: "openapi", sourceLabel: "support", document: external } }), /External schema reference/);
});

test("console import binds to the exact saved session and declared system", (t) => {
  const { journey, intake } = fixture(t);
  assert.throws(() => recordConsoleSystemImport({ journey, input: { sessionId: "another-session", systemId: intake.systems[0].id, sourceKind: "openapi", sourceLabel: "support", document: openApiDocument() } }), /Unknown assisted-onboarding session/);
  assert.throws(() => recordConsoleSystemImport({ journey, input: { sessionId: intake.sessionId, systemId: "other-system", sourceKind: "openapi", sourceLabel: "support", document: openApiDocument() } }), /does not belong to this saved onboarding session/);
});
