import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCommercialSupportPack } from "../src/product/commercial-support-pack.js";
import { proposeOnboardingSystemImport } from "../src/product/onboarding-system-import.js";
import {
  assertOnboardingBindingWorkPlan,
  assertOnboardingSystemImportConfirmation,
  confirmOnboardingSystemImport,
  createOnboardingBindingWorkPlan,
  writeOnboardingBindingWorkPlan,
} from "../src/product/onboarding-binding-accelerator.js";
import { createCommercialBindingScaffold } from "../src/product/commercial-binding-kit.js";
import {
  assertReviewedOnboardingStructuralBinding,
  compileReviewedOnboardingBinding,
  createReviewedBindingImplementationInput,
} from "../src/product/reviewed-onboarding-binding-compiler.js";

function fixture(kind = "openapi") {
  const pack = createCommercialSupportPack();
  const intake = pack.intake;
  const systemId = intake.systems[0].id;
  const source = kind === "openapi"
    ? {
        kind: "openapi",
        document: {
          openapi: "3.1.0",
          info: { title: "Customer Support", version: "1.0.0" },
          servers: [{ url: "https://support.example.test" }],
          paths: {
            "/tickets/{ticketId}": {
              get: { operationId: "getTicket", parameters: [{ name: "ticketId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" } } },
            },
            "/tickets/{ticketId}/draft": {
              post: { operationId: "draftReply", parameters: [{ name: "ticketId", in: "path", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["message"], properties: { message: { type: "string" } }, additionalProperties: false } } } }, responses: { "200": { description: "ok" } } },
            },
          },
        },
      }
    : {
        kind: "mcp-tools-list",
        serverId: "customer-support-tools",
        serverVersion: "1.4.0",
        toolsList: {
          tools: [
            { name: "get_ticket", annotations: { readOnlyHint: true }, inputSchema: { type: "object", required: ["ticketId"], properties: { ticketId: { type: "string" } }, additionalProperties: false } },
            { name: "draft_reply", inputSchema: { type: "object", required: ["ticketId", "message", "requestId"], properties: { ticketId: { type: "string" }, message: { type: "string" }, requestId: { type: "string" } }, additionalProperties: false } },
          ],
        },
      };
  const proposal = proposeOnboardingSystemImport({
    intake,
    systemId,
    source,
    provenance: { acquisition: kind === "openapi" ? "customer-upload" : "customer-local-mcp-tools-list", label: `Pinned ${kind} fixture` },
  });
  const readSource = kind === "openapi" ? "getTicket" : "get_ticket";
  const writeSource = kind === "openapi" ? "draftReply" : "draft_reply";
  const approvedContexts = proposal.proposedContextSources.map((sourceId) => ({ sourceId, approved: true }));
  const decisions = {
    operationChoices: [
      { sourceName: readSource, approved: true, targetExposedName: `${systemId}:read-ticket`, confirmedMode: "read", authorityAction: null, requiredContextSources: ["ticket-thread"] },
      { sourceName: writeSource, approved: true, targetExposedName: `${systemId}:draft-response`, confirmedMode: "write", authorityAction: "draft-support-response", requiredContextSources: ["ticket-thread", "support-policy"] },
    ],
    contextChoices: approvedContexts,
  };
  const scaffold = createCommercialBindingScaffold({ intake, roleDraft: pack.roleDraft });
  return { pack, intake, systemId, source, proposal, decisions, scaffold, readSource, writeSource };
}

for (const kind of ["openapi", "mcp-tools-list"]) test(`${kind} review produces a digest-bound non-executable work pack with measured omissions`, (t) => {
  const data = fixture(kind === "openapi" ? "openapi" : "mcp");
  const confirmation = confirmOnboardingSystemImport({ proposal: data.proposal, intake: data.intake, source: data.source, decisions: data.decisions, confirmedBy: "Customer test owner" });
  assert.equal(assertOnboardingSystemImportConfirmation({ confirmation, proposal: data.proposal, intake: data.intake, source: data.source }), true);
  assert.equal(confirmation.authorizations.execution, false);
  assert.equal(confirmation.operationChoices.every((item) => item.executable === false && item.runtimeInputSchemaHash === null), true);
  const workPlan = createOnboardingBindingWorkPlan({ proposal: data.proposal, confirmation, intake: data.intake, source: data.source, bindingScaffold: data.scaffold });
  assert.equal(assertOnboardingBindingWorkPlan({ workPlan, proposal: data.proposal, confirmation, intake: data.intake, source: data.source, bindingScaffold: data.scaffold }), true);
  assert.equal(workPlan.gates.executable, false);
  assert.equal(workPlan.gates.authorityWidened, false);
  assert.equal(workPlan.gates.credentialsCollected, false);
  assert.equal(workPlan.adapterConfigurationDraft.compilable, false);
  assert.ok(workPlan.authoring.generatedOrCustomerConfirmed > 0);
  assert.ok(workPlan.authoring.remainingEngineerOrIndependentProof > 0);
  assert.ok(workPlan.exactRemainingWork.some((item) => item.id.startsWith("coverage:")));
  assert.ok(workPlan.exactRemainingWork.some((item) => item.id.startsWith("verifier:")));
  assert.equal(JSON.stringify(workPlan).includes("literal-secret"), false);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "das-binding-work-pack-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, "pack");
  const written = writeOnboardingBindingWorkPlan({ directory: output, proposal: data.proposal, confirmation, workPlan });
  assert.equal(written.executable, false);
  assert.equal(fs.statSync(output).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(output, "binding-work-plan.json")).mode & 0o777, 0o600);
  assert.throws(() => writeOnboardingBindingWorkPlan({ directory: output, proposal: data.proposal, confirmation, workPlan }), /refuses to overwrite/);
});

test("review cannot widen authority, duplicate a role target, or silently classify ambiguous MCP", () => {
  const data = fixture("mcp");
  const widened = structuredClone(data.decisions);
  widened.operationChoices[1].authorityAction = "deploy-production";
  assert.throws(() => confirmOnboardingSystemImport({ proposal: data.proposal, intake: data.intake, source: data.source, decisions: widened }), /widen authority/);
  const duplicate = structuredClone(data.decisions);
  duplicate.operationChoices[1].targetExposedName = duplicate.operationChoices[0].targetExposedName;
  duplicate.operationChoices[1].confirmedMode = "read";
  duplicate.operationChoices[1].authorityAction = null;
  assert.throws(() => confirmOnboardingSystemImport({ proposal: data.proposal, intake: data.intake, source: data.source, decisions: duplicate }), /unused exact operation/);
  const ambiguous = structuredClone(data.decisions);
  ambiguous.operationChoices[1].confirmedMode = null;
  assert.throws(() => confirmOnboardingSystemImport({ proposal: data.proposal, intake: data.intake, source: data.source, decisions: ambiguous }), /explicit read or write/);
});

test("confirmation and work plan fail closed after source, identity, intake or artifact mutation", () => {
  const data = fixture("mcp");
  const confirmation = confirmOnboardingSystemImport({ proposal: data.proposal, intake: data.intake, source: data.source, decisions: data.decisions });
  const changedServer = structuredClone(data.source);
  changedServer.serverVersion = "2.0.0";
  assert.throws(() => assertOnboardingSystemImportConfirmation({ confirmation, proposal: data.proposal, intake: data.intake, source: changedServer }), /server id and version/);
  const workPlan = createOnboardingBindingWorkPlan({ proposal: data.proposal, confirmation, intake: data.intake, source: data.source, bindingScaffold: data.scaffold });
  const tampered = structuredClone(workPlan);
  tampered.gates.executable = true;
  assert.throws(() => assertOnboardingBindingWorkPlan({ workPlan: tampered, proposal: data.proposal, confirmation, intake: data.intake, source: data.source, bindingScaffold: data.scaffold }), /integrity mismatch/);
  const changedIntake = structuredClone(data.intake);
  changedIntake.role.outcome = "Changed after customer review";
  assert.throws(() => assertOnboardingBindingWorkPlan({ workPlan, proposal: data.proposal, confirmation, intake: changedIntake, source: data.source, bindingScaffold: data.scaffold }), /no longer matches|exact saved intake/);
});

for (const kind of ["openapi", "mcp"]) test(`${kind} reviewed plan compiles structurally but remains unprobed and non-executable`, () => {
  const data = fixture(kind);
  const confirmation = confirmOnboardingSystemImport({ proposal: data.proposal, intake: data.intake, source: data.source, decisions: data.decisions, confirmedBy: "Customer test owner" });
  const workPlan = createOnboardingBindingWorkPlan({ proposal: data.proposal, confirmation, intake: data.intake, source: data.source, bindingScaffold: data.scaffold });
  const writeSafety = kind === "openapi"
    ? [{ sourceName: data.writeSource, idempotencyHeader: "X-Idempotency-Key", verification: { readOperationId: data.readSource, inputMap: [{ targetSection: "path", targetName: "ticketId", writeInputPointer: "/path/ticketId" }], assertions: [{ actualPointer: "/ticketId", equalsWriteInputPointer: "/path/ticketId" }] } }]
    : [{ sourceName: data.writeSource, idempotencyField: "requestId", verification: { readToolName: data.readSource, inputMap: [{ targetName: "ticketId", writeInputPointer: "/ticketId" }], assertions: [{ actualPointer: "/ticketId", equalsWriteInputPointer: "/ticketId" }] } }];
  const implementationInput = createReviewedBindingImplementationInput({ workPlan, writeSafety });
  const artifact = compileReviewedOnboardingBinding({ workPlan, proposal: data.proposal, confirmation, intake: data.intake, source: data.source, bindingScaffold: data.scaffold, implementationInput });

  assert.equal(assertReviewedOnboardingStructuralBinding({ artifact, workPlan, proposal: data.proposal, confirmation, intake: data.intake, source: data.source, bindingScaffold: data.scaffold, implementationInput }), true);
  assert.equal(artifact.status, "structurally-compiled-runtime-unprobed");
  assert.equal(artifact.measurements.approvedOperations, 2);
  assert.equal(artifact.measurements.structurallyCompiledOperations, 2);
  assert.equal(artifact.measurements.remainingGenericCompilerFields, 0);
  assert.equal(artifact.measurements.writeSafetyFieldsStillUnproved, 2);
  assert.equal(artifact.gates.executable, false);
  assert.equal(artifact.gates.activationReady, false);
  assert.equal(artifact.descriptorDiagnostics.readyForAcceptance, false);
  assert.ok(artifact.descriptorDiagnostics.failedGates.length > 0);
  assert.equal(artifact.operations.every((item) => item.probed === false && item.runtimeAuthorityGranted === false), true);
  assert.equal(artifact.operations.every((item) => /^[a-f0-9]{64}$/.test(item.sourceInputSchemaHash) && /^[a-f0-9]{64}$/.test(item.boundedInputSchemaHash)), true);
  assert.equal(artifact.descriptor.systems[0].status, "partially-compiled-runtime-unprobed");
  assert.ok(artifact.exactBlockers.some((item) => item.startsWith("work-plan:coverage:")));
  assert.equal(JSON.stringify(artifact).includes("executable-bounded-contract"), false);
});

test("reviewed structural compiler rejects source, review, credential and authority substitution", () => {
  const data = fixture("openapi");
  const confirmation = confirmOnboardingSystemImport({ proposal: data.proposal, intake: data.intake, source: data.source, decisions: data.decisions });
  const workPlan = createOnboardingBindingWorkPlan({ proposal: data.proposal, confirmation, intake: data.intake, source: data.source, bindingScaffold: data.scaffold });
  assert.throws(() => createReviewedBindingImplementationInput({ workPlan, credentialRefs: { ApiKey: "literal-secret" } }), /environment-reference name/);
  assert.throws(() => createReviewedBindingImplementationInput({ workPlan, writeSafety: [{ sourceName: data.readSource, idempotencyHeader: "X-Key", verification: { readOperationId: data.readSource } }] }), /unapproved or non-write/);
  const implementationInput = createReviewedBindingImplementationInput({ workPlan, writeSafety: [] });
  const changedSource = structuredClone(data.source);
  changedSource.document.info.version = "2.0.0";
  assert.throws(() => compileReviewedOnboardingBinding({ workPlan, proposal: data.proposal, confirmation, intake: data.intake, source: changedSource, bindingScaffold: data.scaffold, implementationInput }), /source no longer matches|source digest mismatch/);
  const tampered = structuredClone(implementationInput);
  tampered.runtimeAuthorityGranted = true;
  assert.throws(() => compileReviewedOnboardingBinding({ workPlan, proposal: data.proposal, confirmation, intake: data.intake, source: data.source, bindingScaffold: data.scaffold, implementationInput: tampered }), /integrity mismatch|widened authority/);
});
