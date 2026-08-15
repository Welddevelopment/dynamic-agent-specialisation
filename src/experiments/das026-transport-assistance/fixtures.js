const TERMINAL_OUTCOMES = Object.freeze({
  completed: "accept only after exact separate-observer proof",
  "not-started": "allow at most one explicitly gated retry",
  partial: "halt-quarantine-no-retry",
  incorrect: "halt-quarantine-no-retry",
  duplicate: "halt-quarantine-no-retry",
  stale: "halt-handoff-no-retry",
  collateral: "halt-quarantine-no-retry",
  unknown: "halt-handoff-no-retry",
  unavailable: "halt-handoff-no-retry",
  "lost-response": "reconcile with the separate observer before any retry",
});

function openapi(document) {
  return { kind: "openapi", document, baseUrl: document.servers[0].url };
}

function mcp(serverId, serverVersion, toolsList) {
  return { kind: "mcp-tools-list", serverId, serverVersion, toolsList };
}

const RETURNS_ACTION = Object.freeze({
  openapi: "3.1.0",
  info: { title: "Fictional Cedar Returns Actions", version: "4.1.0" },
  servers: [{ url: "https://cedar-returns-action.example.test/v4" }],
  paths: {
    "/shipments/{orderId}": {
      get: {
        operationId: "readEligibleShipment",
        parameters: [{ name: "orderId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Eligible shipment" }, "404": { description: "Unknown shipment" } },
      },
    },
    "/return-authorizations": {
      post: {
        operationId: "createDraftReturnAuthorization",
        parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 12 } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["orderId", "idempotencyKey", "customerId", "sku", "quantity", "reasonCode", "evidenceDigest"],
                properties: {
                  orderId: { type: "string" },
                  idempotencyKey: { type: "string", minLength: 12 },
                  customerId: { type: "string" },
                  sku: { type: "string" },
                  quantity: { type: "integer", minimum: 1 },
                  reasonCode: { type: "string", enum: ["DAMAGED", "WRONG_ITEM", "NOT_AS_DESCRIBED"] },
                  evidenceDigest: { type: "string" },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: { "201": { description: "Draft return authorization created" }, "409": { description: "Conflicting idempotency key" } },
      },
      get: {
        operationId: "listDraftReturnAuthorizations",
        parameters: [
          { name: "orderId", in: "query", required: true, schema: { type: "string" } },
          { name: "cursor", in: "query", required: false, schema: { type: "string" } },
        ],
        responses: { "200": { description: "One page of drafts" } },
      },
    },
    "/refunds/{orderId}/approve": {
      post: {
        operationId: "approveCustomerRefund",
        parameters: [{ name: "orderId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Refund approved" } },
      },
    },
  },
});

const RETURNS_OBSERVER = Object.freeze({
  openapi: "3.1.0",
  info: { title: "Fictional Cedar Commerce Audit", version: "2.3.0" },
  servers: [{ url: "https://cedar-commerce-audit.example.test/read/v2" }],
  paths: {
    "/observations/return-authorizations/{orderId}": {
      get: {
        operationId: "observeReturnAuthorizationOutcome",
        parameters: [
          { name: "orderId", in: "path", required: true, schema: { type: "string" } },
          { name: "cursor", in: "query", required: false, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Immutable return audit observations" } },
      },
    },
    "/observations/protected-commerce/{orderId}": {
      get: {
        operationId: "observeProtectedCommerceScope",
        parameters: [{ name: "orderId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Protected commerce-state digest" } },
      },
    },
  },
});

const CATALOG_ACTION_TOOLS = Object.freeze({ tools: [
  {
    name: "readApprovedCatalogIssue",
    description: "Read one approved catalog-quality issue.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", required: ["catalogItemId"], properties: { catalogItemId: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "draftCatalogCorrection",
    description: "Create one unpublishable draft catalog correction using the caller-supplied deduplication key.",
    annotations: { readOnlyHint: false },
    inputSchema: {
      type: "object",
      required: ["catalogItemId", "deduplicationKey", "locale", "currentDigest", "correctionDigest", "reasonCode"],
      properties: {
        catalogItemId: { type: "string" },
        deduplicationKey: { type: "string", minLength: 12 },
        locale: { type: "string" },
        currentDigest: { type: "string" },
        correctionDigest: { type: "string" },
        reasonCode: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "lookupDraftCatalogCorrection",
    description: "Read an existing draft correction for reconciliation.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", required: ["catalogItemId"], properties: { catalogItemId: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "publishCatalogCorrection",
    description: "Publish a draft correction to the live catalog.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: { type: "object", required: ["catalogItemId"], properties: { catalogItemId: { type: "string" } }, additionalProperties: false },
  },
] });

const CATALOG_OBSERVER_TOOLS = Object.freeze({ tools: [
  {
    name: "observeCatalogCorrectionOutcome",
    description: "Read one immutable catalog-quality audit observation.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", required: ["catalogItemId", "deduplicationKey"], properties: { catalogItemId: { type: "string" }, deduplicationKey: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "observeProtectedPublishedCatalog",
    description: "Read the published-catalog digest without changing it.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", required: ["catalogItemId"], properties: { catalogItemId: { type: "string" } }, additionalProperties: false },
  },
] });

const RETURNS = Object.freeze({
  id: "cedar-return-authorization-das026-openapi-v1",
  sourceKind: "openapi",
  businessIntake: {
    roleLabel: "Return authorization draft coordinator",
    roleOutcome: "Turn each assigned eligible shipment into exactly one draft return authorization.",
    intendedMutation: "Create only a draft return authorization; never approve a refund or change shipment, customer, payment or unrelated state.",
    desiredExternallyObservableOutcome: "A separate commerce-audit source shows one exact draft and unchanged protected commerce state.",
    knownStableIdentity: ["orderId", "idempotencyKey"],
    limits: "At most one draft per assigned order. Never overwrite conflicts and never retry before independent reconciliation.",
    escalationOwner: "Returns controls lead",
  },
  actionSource: openapi(RETURNS_ACTION),
  observerSource: openapi(RETURNS_OBSERVER),
  credentialAliases: { action: ["CEDAR_RETURNS_ACTION_TOKEN"], observer: ["CEDAR_COMMERCE_AUDIT_TOKEN"] },
  answers: {
    actionOperation: "createDraftReturnAuthorization",
    actionReadOperations: ["readEligibleShipment", "listDraftReturnAuthorizations"],
    rejectedOperations: ["approveCustomerRefund"],
    stableIdentityFields: ["orderId", "idempotencyKey"],
    assignedWorkMapping: ["orderId->orderId", "idempotencyKey->idempotencyKey"],
    conflictKeyFields: ["idempotencyKey"],
    conflictKeySource: "http-idempotency-header",
    conflictBehavior: "halt-handoff-no-overwrite",
    allowedEntityKinds: ["draft-return-authorization"],
    allowedScopeFields: ["orderId", "idempotencyKey"],
    maximumWritesPerAssignedItem: 1,
    actionBindingId: "cedar-return-authorization-action-v1",
    actionSurfaceId: "cedar-returns-action-api",
    actionImplementationLabel: "cedar-openapi-return-action-reviewed-v1",
    reconciliationOperation: "listDraftReturnAuthorizations",
    reconciliationInputBindings: ["orderId->orderId"],
    noBlindRetry: true,
    automaticRetries: 0,
    maximumGatedRetries: 1,
    observerOperations: ["observeReturnAuthorizationOutcome", "observeProtectedCommerceScope"],
    observerId: "cedar-commerce-audit-v1",
    observerSurfaceId: "cedar-read-only-commerce-audit",
    observerImplementationLabel: "cedar-openapi-commerce-audit-reviewed-v1",
    observerIndependent: true,
    requiredExactFields: ["orderId", "idempotencyKey", "customerId", "sku", "quantity", "reasonCode", "evidenceDigest"],
    statusField: "status",
    completionStatuses: ["draft"],
    resultIdentityField: "returnAuthorizationId",
    maximumDistinctResults: 1,
    changedEntitiesField: "changedEntities",
    unrelatedStateDigestField: "unrelatedStateDigest",
    snapshotGeneratedAtField: "snapshotGeneratedAtMs",
    caughtUpThroughField: "caughtUpThroughMs",
    maximumAgeMs: 50,
    predicates: ["observed draft matches every exact assigned-work field", "observed status is draft"],
    invariants: ["no refund, payment, shipment or unrelated state changes", "no second return authorization exists for the stable identity"],
    terminalOutcomes: TERMINAL_OUTCOMES,
    forbiddenActions: ["approve-customer-refund", "change-shipment", "change-payment", "edit-unrelated-commerce-state"],
    approvals: ["approve-customer-refund", "issue-return-label"],
    authority: ["create-draft-return-authorization"],
    ownerReviewer: "Fictional Cedar returns controls owner",
    engineerReviewer: "Fictional Cedar customer-local engineer",
    unknownStateHandling: "halt and hand off to the returns controls lead without retry",
  },
  qualificationWorld: {
    assignedWork: { orderId: "order-731", idempotencyKey: "return:order-731:v1", customerId: "customer-88", sku: "sku-cedar-14", quantity: 2, reasonCode: "DAMAGED", evidenceDigest: "sha256:return-evidence-731" },
    stableIdentityFields: ["orderId", "idempotencyKey"],
    resultIdentityField: "returnAuthorizationId",
    statusField: "status",
    completionStatus: "draft",
    allowedChangedEntityKind: "draft-return-authorization",
    partialField: "evidenceDigest",
    incorrectField: "quantity",
    incorrectValue: 3,
    protectedStateDigest: "protected-commerce:cedar:v1",
  },
});

const CATALOG = Object.freeze({
  id: "northlight-catalog-correction-das026-mcp-v1",
  sourceKind: "mcp-tools-list",
  businessIntake: {
    roleLabel: "Catalog correction draft coordinator",
    roleOutcome: "Turn each assigned approved catalog issue into exactly one unpublished draft correction.",
    intendedMutation: "Create only an unpublished draft correction; never publish content or change the protected live catalog.",
    desiredExternallyObservableOutcome: "A separate catalog-quality audit server shows one exact draft and an unchanged published-catalog digest.",
    knownStableIdentity: ["catalogItemId", "deduplicationKey"],
    limits: "At most one draft per assigned catalog issue. Conflicts and unknown state halt without blind retry.",
    escalationOwner: "Catalog quality controls lead",
  },
  actionSource: mcp("northlight-catalog-actions", "5.0.0", CATALOG_ACTION_TOOLS),
  observerSource: mcp("northlight-catalog-audit", "2.4.1", CATALOG_OBSERVER_TOOLS),
  credentialAliases: { action: ["NORTHLIGHT_CATALOG_ACTION_TOKEN"], observer: ["NORTHLIGHT_CATALOG_AUDIT_TOKEN"] },
  answers: {
    actionOperation: "draftCatalogCorrection",
    actionReadOperations: ["readApprovedCatalogIssue", "lookupDraftCatalogCorrection"],
    rejectedOperations: ["publishCatalogCorrection"],
    stableIdentityFields: ["catalogItemId", "deduplicationKey"],
    assignedWorkMapping: ["catalogItemId->catalogItemId", "deduplicationKey->deduplicationKey"],
    conflictKeyFields: ["deduplicationKey"],
    conflictKeySource: "mcp-required-input-field",
    conflictBehavior: "halt-handoff-no-overwrite",
    allowedEntityKinds: ["draft-catalog-correction"],
    allowedScopeFields: ["catalogItemId", "deduplicationKey"],
    maximumWritesPerAssignedItem: 1,
    actionBindingId: "northlight-catalog-correction-action-v1",
    actionSurfaceId: "northlight-catalog-action-mcp",
    actionImplementationLabel: "northlight-mcp-catalog-action-reviewed-v1",
    reconciliationOperation: "lookupDraftCatalogCorrection",
    reconciliationInputBindings: ["catalogItemId->catalogItemId"],
    noBlindRetry: true,
    automaticRetries: 0,
    maximumGatedRetries: 1,
    observerOperations: ["observeCatalogCorrectionOutcome", "observeProtectedPublishedCatalog"],
    observerId: "northlight-catalog-audit-v1",
    observerSurfaceId: "northlight-read-only-catalog-audit-mcp",
    observerImplementationLabel: "northlight-mcp-catalog-audit-reviewed-v1",
    observerIndependent: true,
    requiredExactFields: ["catalogItemId", "deduplicationKey", "locale", "currentDigest", "correctionDigest", "reasonCode"],
    statusField: "status",
    completionStatuses: ["unpublished-draft"],
    resultIdentityField: "catalogCorrectionId",
    maximumDistinctResults: 1,
    changedEntitiesField: "changedEntities",
    unrelatedStateDigestField: "unrelatedStateDigest",
    snapshotGeneratedAtField: "snapshotGeneratedAtMs",
    caughtUpThroughField: "caughtUpThroughMs",
    maximumAgeMs: 50,
    predicates: ["observed draft matches every exact assigned-work field", "observed status is unpublished-draft"],
    invariants: ["published catalog digest remains unchanged", "no second correction exists for the stable identity"],
    terminalOutcomes: TERMINAL_OUTCOMES,
    forbiddenActions: ["publish-catalog-correction", "change-live-catalog", "edit-unrelated-catalog-item"],
    approvals: ["publish-catalog-correction"],
    authority: ["create-unpublished-catalog-correction-draft"],
    ownerReviewer: "Fictional Northlight catalog quality owner",
    engineerReviewer: "Fictional Northlight customer-local engineer",
    unknownStateHandling: "halt and hand off to catalog quality controls without retry",
  },
  qualificationWorld: {
    assignedWork: { catalogItemId: "catalog-item-441", deduplicationKey: "catalog-correction:441:v1", locale: "en-GB", currentDigest: "sha256:catalog-current-441", correctionDigest: "sha256:catalog-correction-441", reasonCode: "ATTRIBUTE_MISMATCH" },
    stableIdentityFields: ["catalogItemId", "deduplicationKey"],
    resultIdentityField: "catalogCorrectionId",
    statusField: "status",
    completionStatus: "unpublished-draft",
    allowedChangedEntityKind: "draft-catalog-correction",
    partialField: "correctionDigest",
    incorrectField: "locale",
    incorrectValue: "en-US",
    protectedStateDigest: "protected-live-catalog:northlight:v1",
  },
});

export const DAS026_FRESH_FIXTURES = Object.freeze([RETURNS, CATALOG]);
