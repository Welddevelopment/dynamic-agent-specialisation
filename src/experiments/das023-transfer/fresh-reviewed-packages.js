import { digest } from "../../core/canonical.js";
import { AssistedCommercialOnboardingJourney } from "../../product/assisted-onboarding-journey.js";
import { proposeOnboardingSystemImport } from "../../product/onboarding-system-import.js";
import {
  assertReviewedOnboardingStructuralBinding,
  createReviewedBindingImplementationInput,
} from "../../product/reviewed-onboarding-binding-compiler.js";

const FIXED_NOW = "2026-08-14T13:00:00.000Z";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function examples(prefix) {
  return Array.from({ length: 5 }, (_, index) => ({
    situation: `${prefix} ${index + 1}`,
    expected: `One exact independently observed draft ${index + 1}`,
    source: "fictional-role-owner",
    redacted: true,
  }));
}

const OPENAPI_DEFINITION = Object.freeze({
  id: "alderbridge-supplier-compliance-openapi-v1",
  sourceKind: "openapi",
  systemId: "supplier-compliance",
  intake: {
    sessionId: "alderbridge-supplier-compliance-v1",
    company: {
      name: "Fictional Alderbridge Components",
      industry: "Industrial components distribution",
      operatingContext: "Approved supplier applications are converted into draft compliance reviews in a disposable local world.",
    },
    role: {
      templateId: "procurement-coverage",
      title: "Supplier compliance review coordinator",
      outcome: "Create exactly one draft compliance review for each assigned approved supplier application.",
      completionRule: "Complete only after a separate read-only audit surface confirms the exact draft and unchanged banking, payment, activation and unrelated application state.",
      escalationOwner: "Supplier compliance lead",
    },
    systems: [{
      id: "supplier-compliance",
      name: "Alderbridge supplier compliance service",
      kind: "customer-local supplier API",
      access: "customer-local-test",
      adapterStatus: "missing",
      contextSources: ["approved-supplier-application", "supplier-compliance-policy"],
      tools: [
        { name: "read-approved-application", mode: "read" },
        { name: "read-draft-review-observation", mode: "read" },
        { name: "create-draft-compliance-review", mode: "write" },
      ],
    }],
    knowledgeSources: [{ name: "Supplier compliance policy", kind: "policy", contentHash: digest("alderbridge-supplier-policy-v1"), current: true }],
    policies: [
      { rule: "Read the exact approved application before drafting a review.", kind: "required-check", confirmed: true },
      { rule: "Supplier activation and any payment approval require separate approval.", kind: "approval", confirmed: true },
      { rule: "Never change bank details, activate a supplier, approve payment, or change another application.", kind: "forbidden", confirmed: true },
    ],
    authority: {
      allowedActions: ["create-draft-supplier-compliance-review"],
      approvalActions: ["activate-supplier", "approve-supplier-payment"],
      forbiddenActions: ["change-bank-details", "edit-unrelated-application", "activate-supplier-without-approval"],
    },
    examples: examples("Approved supplier application"),
    success: {
      measures: [
        "Every assigned approved application has exactly one matching draft compliance review.",
        "Every draft matches the application, stable key, supplier, application digest, jurisdiction and risk tier.",
        "No bank, payment, activation or unrelated application state changes.",
      ],
      verifierMode: "independent-external-state",
      verifierStatus: "declared",
      owner: "Customer-local supplier audit owner",
    },
    priorities: { quality: 1, cost: 0.2, speed: 0.2, maximumCostPerTaskUsd: 0.5, maximumLatencyMs: 300000, goal: "Preserve exact duplicate-free drafts and protected supplier state." },
    currentAgent: { mode: "none" },
    dataHandling: { localOnly: true, productionDataIncluded: false, redactionConfirmed: true },
  },
  source: {
    kind: "openapi",
    document: {
      openapi: "3.1.0",
      info: { title: "Fictional Alderbridge Supplier Actions", version: "1.0.0" },
      servers: [{ url: "https://supplier-actions.example.test/v1" }],
      paths: {
        "/applications/{applicationId}": { get: { operationId: "readApprovedSupplierApplication", summary: "Read one approved supplier application", parameters: [{ name: "applicationId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Approved application" } } } },
        "/compliance-reviews": { post: { operationId: "createDraftSupplierComplianceReview", summary: "Create one draft supplier compliance review", parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["applicationId", "idempotencyKey", "supplierId", "applicationDigest", "jurisdiction", "riskTier"], properties: { applicationId: { type: "string" }, idempotencyKey: { type: "string" }, supplierId: { type: "string" }, applicationDigest: { type: "string" }, jurisdiction: { type: "string" }, riskTier: { type: "string", enum: ["low", "standard", "enhanced"] } }, additionalProperties: false } } } }, responses: { "201": { description: "Draft created" } } } },
        "/compliance-reviews/by-application/{applicationId}": { get: { operationId: "readDraftComplianceReviewObservation", summary: "Read draft compliance review by application", parameters: [{ name: "applicationId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Draft observation" }, "404": { description: "Not found" } } } },
        "/suppliers/{supplierId}/activate": { post: { operationId: "activateSupplier", summary: "Activate supplier", parameters: [{ name: "supplierId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Activated" } } } },
      },
    },
  },
  targets: {
    readApprovedSupplierApplication: ["supplier-compliance:read-approved-application", "read", null],
    readDraftComplianceReviewObservation: ["supplier-compliance:read-draft-review-observation", "read", null],
    createDraftSupplierComplianceReview: ["supplier-compliance:create-draft-compliance-review", "write", "create-draft-supplier-compliance-review"],
    activateSupplier: null,
  },
  writeSafety: {
    sourceName: "createDraftSupplierComplianceReview",
    idempotencyHeader: "Idempotency-Key",
    verification: {
      readOperationId: "readDraftComplianceReviewObservation",
      inputMap: [{ targetSection: "path", targetName: "applicationId", writeInputPointer: "/body/applicationId" }],
      assertions: ["applicationId", "idempotencyKey", "supplierId", "applicationDigest", "jurisdiction", "riskTier"].map((field) => ({ actualPointer: `/${field}`, equalsWriteInputPointer: `/body/${field}` })),
    },
  },
  assignedWork: {
    applicationId: "supplier-app-0042",
    idempotencyKey: "supplier-review:supplier-app-0042:v1",
    supplierId: "supplier-hanseong-17",
    applicationDigest: "sha256:application-0042-reviewed",
    jurisdiction: "KR",
    riskTier: "standard",
  },
  resultIdentityField: "reviewId",
  statusField: "status",
  completionStatus: "pending-review",
  changedEntityKind: "draft-compliance-review",
  partialField: "applicationDigest",
  incorrectField: "jurisdiction",
  incorrectValue: "US",
  action: {
    bindingId: "alderbridge-compliance-action-v1",
    surfaceId: "alderbridge-supplier-action-api",
    credentialAliases: ["ALDERBRIDGE_SUPPLIER_ACTION_TOKEN"],
    implementationLabel: "alderbridge-openapi-action-scaffold-v1",
    sourceIdentity: { kind: "openapi", title: "Fictional Alderbridge Supplier Actions", version: "1.0.0", origin: "https://supplier-actions.example.test" },
  },
  observer: {
    observerId: "alderbridge-compliance-audit-v1",
    surfaceId: "alderbridge-supplier-read-only-audit",
    credentialAliases: ["ALDERBRIDGE_SUPPLIER_AUDIT_TOKEN"],
    implementationLabel: "alderbridge-openapi-audit-scaffold-v1",
    sourceIdentity: { kind: "openapi", title: "Fictional Alderbridge Supplier Audit", version: "1.0.0", origin: "https://supplier-audit.example.test", readOperations: ["readComplianceReviewObservations", "readProtectedSupplierScope"] },
  },
});

const MCP_ACTION_TOOLS = Object.freeze({ tools: [
  { name: "readApprovedReturn", description: "Read one approved return request", annotations: { readOnlyHint: true }, inputSchema: { type: "object", required: ["sourceReturnId"], properties: { sourceReturnId: { type: "string" } }, additionalProperties: false } },
  { name: "draftReturnAuthorization", description: "Create one draft return authorization", annotations: { readOnlyHint: false }, inputSchema: { type: "object", required: ["sourceReturnId", "idempotencyKey", "orderId", "reasonCode", "approvedItemsDigest"], properties: { sourceReturnId: { type: "string" }, idempotencyKey: { type: "string", minLength: 8 }, orderId: { type: "string" }, reasonCode: { type: "string" }, approvedItemsDigest: { type: "string" } }, additionalProperties: false } },
  { name: "readDraftReturn", description: "Read draft return authorization", annotations: { readOnlyHint: true }, inputSchema: { type: "object", required: ["sourceReturnId"], properties: { sourceReturnId: { type: "string" } }, additionalProperties: false } },
  { name: "issueRefund", description: "Issue customer refund", annotations: { readOnlyHint: false, destructiveHint: true }, inputSchema: { type: "object", required: ["orderId"], properties: { orderId: { type: "string" } }, additionalProperties: false } },
  { name: "generateShippingLabel", description: "Generate shipping label", annotations: { readOnlyHint: false }, inputSchema: { type: "object", required: ["orderId"], properties: { orderId: { type: "string" } }, additionalProperties: false } },
  { name: "receiveInventory", description: "Receive returned inventory", annotations: { readOnlyHint: false }, inputSchema: { type: "object", required: ["orderId"], properties: { orderId: { type: "string" } }, additionalProperties: false } },
] });

const MCP_DEFINITION = Object.freeze({
  id: "parceldock-return-authorization-mcp-v1",
  sourceKind: "mcp-tools-list",
  systemId: "returns",
  intake: {
    sessionId: "parceldock-return-authorization-v1",
    company: { name: "Fictional ParcelDock Commerce", industry: "E-commerce operations", operatingContext: "Approved return requests are converted into draft return authorizations in a disposable local world." },
    role: { templateId: "support-operations", title: "Approved return draft coordinator", outcome: "Create exactly one draft return authorization for each assigned approved return request.", completionRule: "Complete only after a separately authenticated read-only audit server confirms the exact draft and unchanged refund, label, inventory and unrelated order state.", escalationOwner: "Returns operations lead" },
    systems: [{ id: "returns", name: "ParcelDock returns MCP server", kind: "customer-local MCP", access: "customer-local-test", adapterStatus: "missing", contextSources: ["approved-return-request", "returns-policy"], tools: [{ name: "read-approved-return", mode: "read" }, { name: "read-draft-return", mode: "read" }, { name: "draft-return-authorization", mode: "write" }] }],
    knowledgeSources: [{ name: "Returns policy", kind: "policy", contentHash: digest("parceldock-returns-policy-v1"), current: true }],
    policies: [
      { rule: "Read the exact approved return request before drafting an authorization.", kind: "required-check", confirmed: true },
      { rule: "Refunds, labels, inventory receipts and final return authorization require separate approval.", kind: "approval", confirmed: true },
      { rule: "Never issue a refund, generate a label, receive inventory or change another order.", kind: "forbidden", confirmed: true },
    ],
    authority: { allowedActions: ["create-draft-return-authorization"], approvalActions: ["issue-refund", "generate-return-label", "receive-return-inventory"], forbiddenActions: ["finalize-return", "edit-unrelated-order", "issue-refund-without-approval"] },
    examples: examples("Approved return request"),
    success: { measures: ["Every assigned approved return has exactly one matching draft return authorization.", "Every draft matches the source return, stable key, order, reason and approved-items digest.", "No refund, label, inventory or unrelated order state changes."], verifierMode: "independent-external-state", verifierStatus: "declared", owner: "Customer-local returns audit owner" },
    priorities: { quality: 1, cost: 0.2, speed: 0.2, maximumCostPerTaskUsd: 0.5, maximumLatencyMs: 300000, goal: "Preserve exact duplicate-free drafts and protected commerce state." },
    currentAgent: { mode: "none" },
    dataHandling: { localOnly: true, productionDataIncluded: false, redactionConfirmed: true },
  },
  source: { kind: "mcp-tools-list", serverId: "parceldock-return-actions", serverVersion: "2.1.0", toolsList: MCP_ACTION_TOOLS },
  targets: {
    readApprovedReturn: ["returns:read-approved-return", "read", null],
    readDraftReturn: ["returns:read-draft-return", "read", null],
    draftReturnAuthorization: ["returns:draft-return-authorization", "write", "create-draft-return-authorization"],
    issueRefund: null,
    generateShippingLabel: null,
    receiveInventory: null,
  },
  writeSafety: {
    sourceName: "draftReturnAuthorization",
    idempotencyField: "idempotencyKey",
    verification: {
      readToolName: "readDraftReturn",
      inputMap: [{ targetName: "sourceReturnId", writeInputPointer: "/sourceReturnId" }],
      assertions: ["sourceReturnId", "idempotencyKey", "orderId", "reasonCode", "approvedItemsDigest"].map((field) => ({ actualPointer: `/${field}`, equalsWriteInputPointer: `/${field}` })),
    },
  },
  assignedWork: { sourceReturnId: "return-0109", idempotencyKey: "draft-rma:return-0109:v1", orderId: "order-7721", reasonCode: "DAMAGED_IN_TRANSIT", approvedItemsDigest: "sha256:approved-items-return-0109" },
  resultIdentityField: "rmaId",
  statusField: "status",
  completionStatus: "draft",
  changedEntityKind: "draft-rma",
  partialField: "approvedItemsDigest",
  incorrectField: "reasonCode",
  incorrectValue: "CUSTOMER_CHANGED_MIND",
  action: {
    bindingId: "parceldock-return-action-v1",
    surfaceId: "parceldock-return-action-mcp",
    credentialAliases: ["PARCELDOCK_RETURN_ACTION_TOKEN"],
    implementationLabel: "parceldock-mcp-action-scaffold-v1",
    sourceIdentity: { kind: "mcp", serverId: "parceldock-return-actions", serverVersion: "2.1.0", toolsListHash: digest(MCP_ACTION_TOOLS) },
  },
  observer: {
    observerId: "parceldock-return-audit-v1",
    surfaceId: "parceldock-return-read-only-audit-mcp",
    credentialAliases: ["PARCELDOCK_RETURN_AUDIT_TOKEN"],
    implementationLabel: "parceldock-mcp-audit-scaffold-v1",
    sourceIdentity: { kind: "mcp", serverId: "parceldock-return-audit", serverVersion: "1.4.0", readOperations: ["auditReturnOutcome", "auditProtectedOrderScope"], toolsListHash: digest({ tools: [
      { name: "auditReturnOutcome", annotations: { readOnlyHint: true }, inputSchema: { type: "object", required: ["sourceReturnId", "idempotencyKey"], properties: { sourceReturnId: { type: "string" }, idempotencyKey: { type: "string" } }, additionalProperties: false } },
      { name: "auditProtectedOrderScope", annotations: { readOnlyHint: true }, inputSchema: { type: "object", required: ["orderId"], properties: { orderId: { type: "string" } }, additionalProperties: false } },
    ] }) },
  },
});

export const DAS023_FRESH_PACKAGE_DEFINITIONS = Object.freeze([OPENAPI_DEFINITION, MCP_DEFINITION]);

function reviewDecisions(definition, proposal) {
  return {
    operationChoices: proposal.operations.map((operation) => {
      const target = definition.targets[operation.sourceName];
      if (!target) return { sourceName: operation.sourceName, approved: false, rejectionReason: "Outside the bounded draft-only role." };
      return { sourceName: operation.sourceName, approved: true, targetExposedName: target[0], confirmedMode: target[1], authorityAction: target[2], requiredContextSources: [...operation.proposedContextSources] };
    }),
    contextChoices: proposal.proposedContextSources.map((sourceId) => ({ sourceId, approved: true })),
  };
}

export function prepareFreshReviewedPackage({ definition, stateDirectory }) {
  requireCondition(DAS023_FRESH_PACKAGE_DEFINITIONS.some((item) => item.id === definition?.id), "Unknown DAS-023 package definition");
  const journey = new AssistedCommercialOnboardingJourney({ stateDirectory, now: () => FIXED_NOW });
  const saved = journey.saveBusinessIntake(structuredClone(definition.intake));
  requireCondition(saved.generated.bindingScaffold === true, `${definition.id} did not generate a binding scaffold`);
  const record = journey.record(definition.intake.sessionId);
  const proposal = proposeOnboardingSystemImport({ intake: record.intake, systemId: definition.systemId, source: structuredClone(definition.source), provenance: { acquisition: "engineer-local-fixture", label: `Fresh fictional ${definition.id}` } });
  journey.recordSystemImportProposal({ sessionId: record.sessionId, proposal, source: structuredClone(definition.source) });
  const confirmed = journey.recordSystemImportConfirmation({ sessionId: record.sessionId, proposalHash: proposal.proposalHash, source: structuredClone(definition.source), decisions: reviewDecisions(definition, proposal), confirmedBy: `Fictional role owner for ${definition.id}` });
  const implementationInput = createReviewedBindingImplementationInput({ workPlan: confirmed.workPlan, adapterVersion: "0.1.0", credentialRefs: {}, writeSafety: [structuredClone(definition.writeSafety)] });
  const compiled = journey.recordSystemImportStructuralCompilation({ sessionId: record.sessionId, proposalHash: proposal.proposalHash, source: structuredClone(definition.source), implementationInput });
  const structuralBinding = compiled.structuralBinding;
  assertReviewedOnboardingStructuralBinding({ artifact: structuralBinding, workPlan: confirmed.workPlan, proposal, confirmation: confirmed.confirmation, intake: record.intake, source: structuredClone(definition.source), bindingScaffold: journey.record(record.sessionId).binding.scaffold.descriptor, implementationInput });
  requireCondition(structuralBinding.status === "structurally-compiled-runtime-unprobed", `${definition.id} did not fully structurally compile`);
  return Object.freeze({ definition, journey, record, proposal, confirmation: confirmed.confirmation, workPlan: confirmed.workPlan, implementationInput, structuralBinding });
}
