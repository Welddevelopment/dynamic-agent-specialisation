import assert from "node:assert/strict";
import test from "node:test";
import { createCommercialSupportPack } from "../src/product/commercial-support-pack.js";
import { proposeOnboardingSystemImport } from "../src/product/onboarding-system-import.js";
import {
  assertOnboardingReviewAssistance,
  classifyOnboardingResidualWork,
  createOnboardingReviewAssistance,
} from "../src/product/onboarding-review-assistant.js";
import { createCommercialBindingScaffold } from "../src/product/commercial-binding-kit.js";
import { confirmOnboardingSystemImport, createOnboardingBindingWorkPlan } from "../src/product/onboarding-binding-accelerator.js";

function fixture() {
  const pack = createCommercialSupportPack();
  const intake = pack.intake;
  const systemId = intake.systems[0].id;
  const source = {
    kind: "openapi",
    document: {
      openapi: "3.1.0",
      info: { title: "Unfamiliar Helpdesk", version: "2.0.0" },
      servers: [{ url: "https://helpdesk.example.test" }],
      paths: {
        "/cases/{caseId}": { get: { operationId: "fetchCase", summary: "Fetch a support case", parameters: [{ name: "caseId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" } } } },
        "/cases/{caseId}/reply": { post: { operationId: "composeReply", summary: "Compose a support response", parameters: [{ name: "caseId", in: "path", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["message", "requestId"], properties: { message: { type: "string" }, requestId: { type: "string" } }, additionalProperties: false } } } }, responses: { "200": { description: "ok" } } } },
      },
    },
  };
  const proposal = proposeOnboardingSystemImport({ intake, systemId, source, provenance: { acquisition: "customer-upload", label: "Fresh unfamiliar helpdesk schema" } });
  return { pack, intake, systemId, source, proposal };
}

test("review assistant proposes source-grounded mappings without approving or granting authority", () => {
  const data = fixture();
  const assistance = createOnboardingReviewAssistance(data);
  assert.equal(assertOnboardingReviewAssistance({ ...data, assistance }), true);
  const read = assistance.operationSuggestions.find((item) => item.sourceName === "fetchCase");
  const write = assistance.operationSuggestions.find((item) => item.sourceName === "composeReply");
  assert.equal(read.target.proposedExposedName, `${data.systemId}:read-ticket`);
  assert.equal(write.target.proposedExposedName, `${data.systemId}:draft-response`);
  assert.equal(write.authority.proposedAction, "draft-support-response");
  assert.equal(write.writeSafety.idempotency.status, "source-candidate-needs-engineer-binding");
  assert.equal(assistance.operationSuggestions.every((item) => item.approved === false && item.executable === false && item.authority.runtimeGrant === false), true);
  assert.deepEqual(assistance.authorizations, { modelSpend: false, execution: false, customerWrites: false, activation: false });
});

test("review assistance is bound to the exact source and fails closed after tampering", () => {
  const data = fixture();
  const assistance = createOnboardingReviewAssistance(data);
  const tampered = structuredClone(assistance);
  tampered.operationSuggestions[1].approved = true;
  assert.throws(() => assertOnboardingReviewAssistance({ ...data, assistance: tampered }), /integrity mismatch/);
  const changedSource = structuredClone(data.source);
  changedSource.document.info.version = "3.0.0";
  assert.throws(() => assertOnboardingReviewAssistance({ ...data, assistance, source: changedSource }), /source no longer matches|source digest mismatch/);
});

test("residual classification separates software work, customer-specific safety, missing material, and proof", () => {
  const data = fixture();
  const assistance = createOnboardingReviewAssistance(data);
  const decisions = {
    operationChoices: [
      { sourceName: "fetchCase", approved: true, targetExposedName: `${data.systemId}:read-ticket`, confirmedMode: "read", authorityAction: null, requiredContextSources: ["ticket-thread"] },
      { sourceName: "composeReply", approved: true, targetExposedName: `${data.systemId}:draft-response`, confirmedMode: "write", authorityAction: "draft-support-response", requiredContextSources: ["ticket-thread", "support-policy"] },
    ],
    contextChoices: data.proposal.proposedContextSources.map((sourceId) => ({ sourceId, approved: true })),
  };
  const confirmation = confirmOnboardingSystemImport({ ...data, decisions, confirmedBy: "Fictional role owner" });
  const bindingScaffold = createCommercialBindingScaffold({ intake: data.intake, roleDraft: data.pack.roleDraft });
  const workPlan = createOnboardingBindingWorkPlan({ ...data, confirmation, bindingScaffold });
  const classification = classifyOnboardingResidualWork({ workPlan, reviewAssistance: assistance });
  assert.ok(classification.totals["automatable-generic-compiler-or-source-schema-work"] > 0);
  assert.ok(classification.totals["customer-specific-write-safety-implementation"] > 0);
  assert.ok(classification.totals["missing-approved-source-material"] > 0);
  assert.ok(classification.totals["independent-verifier-or-proof-work"] > 0);
  assert.match(classification.boundary, /not observed human setup time/i);
});
