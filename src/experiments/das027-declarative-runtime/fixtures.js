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

const SUPPLIER_ACTION = Object.freeze({
  openapi: "3.1.0",
  info: { title: "Fictional Arbor Supplier Quality Actions", version: "6.0.1" },
  servers: [{ url: "https://arbor-supplier-actions.example.test/v6" }],
  components: { securitySchemes: { ActionLease: { type: "http", scheme: "bearer" } } },
  security: [{ ActionLease: [] }],
  paths: {
    "/suppliers/{supplierId}": {
      get: {
        operationId: "readApprovedSupplierQualityCase",
        parameters: [{ name: "supplierId", in: "path", required: true, schema: { type: "string", minLength: 3 } }],
        responses: { "200": { description: "Approved supplier quality case" }, "404": { description: "Unknown supplier" } },
      },
    },
    "/suppliers/{supplierId}/quality-holds": {
      post: {
        operationId: "createDraftSupplierQualityHold",
        parameters: [
          { name: "supplierId", in: "path", required: true, schema: { type: "string", minLength: 3 } },
          { name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 12 } },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object",
            required: ["idempotencyKey", "issueCode", "evidenceDigest", "severity"],
            properties: {
              idempotencyKey: { type: "string", minLength: 12 },
              issueCode: { type: "string", enum: ["CERTIFICATE_MISSING", "BATCH_DEFECT", "PACKAGING_NONCONFORMITY"] },
              evidenceDigest: { type: "string", minLength: 12 },
              severity: { type: "string", enum: ["low", "medium", "high"] },
            },
            additionalProperties: false,
          } } },
        },
        responses: { "201": { description: "Draft quality hold created" }, "409": { description: "Conflicting idempotency key" } },
      },
      get: {
        operationId: "listDraftSupplierQualityHolds",
        parameters: [
          { name: "supplierId", in: "path", required: true, schema: { type: "string", minLength: 3 } },
          { name: "cursor", in: "query", required: false, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Draft quality holds" } },
      },
    },
    "/suppliers/{supplierId}/suspend": {
      post: {
        operationId: "suspendSupplier",
        parameters: [{ name: "supplierId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Supplier suspended" } },
      },
    },
  },
});

const SUPPLIER_OBSERVER = Object.freeze({
  openapi: "3.1.0",
  info: { title: "Fictional Arbor Supplier Audit", version: "3.7.0" },
  servers: [{ url: "https://arbor-supplier-audit.example.test/read/v3" }],
  components: { securitySchemes: { AuditLease: { type: "apiKey", in: "header", name: "X-Audit-Lease" } } },
  security: [{ AuditLease: [] }],
  paths: {
    "/observations/supplier-quality-holds/{supplierId}": {
      get: {
        operationId: "observeSupplierQualityHoldOutcome",
        parameters: [{ name: "supplierId", in: "path", required: true, schema: { type: "string", minLength: 3 } }],
        responses: { "200": { description: "Immutable supplier quality audit observations" } },
      },
    },
    "/observations/protected-supplier-scope/{supplierId}": {
      get: {
        operationId: "observeProtectedSupplierScope",
        parameters: [{ name: "supplierId", in: "path", required: true, schema: { type: "string", minLength: 3 } }],
        responses: { "200": { description: "Protected supplier-state digest" } },
      },
    },
  },
});

const CLAIM_ACTION_TOOLS = Object.freeze({ tools: [
  {
    name: "readApprovedWarrantyClaim",
    description: "Read one approved warranty claim.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", required: ["claimId"], properties: { claimId: { type: "string", minLength: 3 } }, additionalProperties: false },
  },
  {
    name: "draftWarrantyClaimResponse",
    description: "Create one unsubmitted draft warranty response using the caller-supplied deduplication key.",
    annotations: { readOnlyHint: false },
    inputSchema: {
      type: "object",
      required: ["claimId", "deduplicationKey", "productSerial", "decisionCode", "evidenceDigest", "approvedAmountMinor"],
      properties: {
        claimId: { type: "string", minLength: 3 },
        deduplicationKey: { type: "string", minLength: 12 },
        productSerial: { type: "string", minLength: 4 },
        decisionCode: { type: "string", enum: ["REQUEST_MORE_EVIDENCE", "ELIGIBLE_DRAFT", "INELIGIBLE_DRAFT"] },
        evidenceDigest: { type: "string", minLength: 12 },
        approvedAmountMinor: { type: "integer", minimum: 0, maximum: 500000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "lookupDraftWarrantyClaimResponse",
    description: "Read the draft response for reconciliation.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", required: ["claimId"], properties: { claimId: { type: "string", minLength: 3 } }, additionalProperties: false },
  },
  {
    name: "issueWarrantyPayment",
    description: "Issue the warranty payment.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: { type: "object", required: ["claimId"], properties: { claimId: { type: "string" } }, additionalProperties: false },
  },
] });

const CLAIM_OBSERVER_TOOLS = Object.freeze({ tools: [
  {
    name: "observeWarrantyClaimResponseOutcome",
    description: "Read an immutable claim-audit observation.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", required: ["claimId", "deduplicationKey"], properties: { claimId: { type: "string" }, deduplicationKey: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "observeProtectedWarrantyScope",
    description: "Read payment and claim-state digests without changing them.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", required: ["claimId"], properties: { claimId: { type: "string" } }, additionalProperties: false },
  },
] });

const SUPPLIER = Object.freeze({
  id: "arbor-supplier-quality-hold-das027-openapi-v1",
  sourceKind: "openapi",
  businessIntake: {
    roleLabel: "Supplier quality-hold draft coordinator",
    roleOutcome: "Turn each assigned approved supplier quality case into exactly one draft hold.",
    intendedMutation: "Create only a draft supplier quality hold; never suspend the supplier or change purchasing, payment or unrelated supplier state.",
    desiredExternallyObservableOutcome: "A separate supplier-audit source shows one exact draft and unchanged protected supplier state.",
    knownStableIdentity: ["supplierId", "idempotencyKey"],
    limits: "At most one draft hold per assigned supplier case. Never overwrite conflicts or retry before independent reconciliation.",
    escalationOwner: "Supplier quality controls lead",
  },
  actionSource: openapi(SUPPLIER_ACTION),
  observerSource: openapi(SUPPLIER_OBSERVER),
  credentialAliases: { action: ["ARBOR_SUPPLIER_ACTION_LEASE"], observer: ["ARBOR_SUPPLIER_AUDIT_LEASE"] },
  answers: {
    actionOperation: "createDraftSupplierQualityHold",
    actionReadOperations: ["readApprovedSupplierQualityCase", "listDraftSupplierQualityHolds"],
    rejectedOperations: ["suspendSupplier"],
    stableIdentityFields: ["supplierId", "idempotencyKey"],
    assignedWorkMapping: ["supplierId->supplierId", "idempotencyKey->idempotencyKey"],
    conflictKeyFields: ["idempotencyKey"],
    conflictKeySource: "http-idempotency-header",
    conflictBehavior: "halt-handoff-no-overwrite",
    allowedEntityKinds: ["draft-supplier-quality-hold"],
    allowedScopeFields: ["supplierId", "idempotencyKey"],
    maximumWritesPerAssignedItem: 1,
    actionBindingId: "arbor-supplier-quality-action-v1",
    actionSurfaceId: "arbor-supplier-action-api",
    actionImplementationLabel: "arbor-openapi-quality-action-reviewed-v1",
    reconciliationOperation: "listDraftSupplierQualityHolds",
    reconciliationInputBindings: ["supplierId->supplierId"],
    noBlindRetry: true,
    automaticRetries: 0,
    maximumGatedRetries: 1,
    observerOperations: ["observeSupplierQualityHoldOutcome", "observeProtectedSupplierScope"],
    observerId: "arbor-supplier-audit-v1",
    observerSurfaceId: "arbor-read-only-supplier-audit",
    observerImplementationLabel: "arbor-openapi-supplier-audit-reviewed-v1",
    observerIndependent: true,
    requiredExactFields: ["supplierId", "idempotencyKey", "issueCode", "evidenceDigest", "severity"],
    statusField: "status",
    completionStatuses: ["draft"],
    resultIdentityField: "qualityHoldId",
    maximumDistinctResults: 1,
    changedEntitiesField: "changedEntities",
    unrelatedStateDigestField: "unrelatedStateDigest",
    snapshotGeneratedAtField: "snapshotGeneratedAtMs",
    caughtUpThroughField: "caughtUpThroughMs",
    maximumAgeMs: 50,
    predicates: ["observed hold matches every exact assigned-work field", "observed status is draft"],
    invariants: ["supplier suspension and unrelated supplier state remain unchanged", "no second hold exists for the stable identity"],
    terminalOutcomes: TERMINAL_OUTCOMES,
    forbiddenActions: ["suspend-supplier", "change-payment", "edit-unrelated-supplier-state"],
    approvals: ["suspend-supplier", "release-quality-hold"],
    authority: ["create-draft-supplier-quality-hold"],
    ownerReviewer: "Fictional Arbor supplier quality owner",
    engineerReviewer: "Fictional Arbor customer-local engineer",
    unknownStateHandling: "halt and hand off to supplier quality controls without retry",
  },
  qualificationWorld: {
    assignedWork: { supplierId: "supplier-312", idempotencyKey: "quality-hold:supplier-312:v1", issueCode: "BATCH_DEFECT", evidenceDigest: "sha256:quality-evidence-312", severity: "high" },
    stableIdentityFields: ["supplierId", "idempotencyKey"],
    resultIdentityField: "qualityHoldId",
    statusField: "status",
    completionStatus: "draft",
    allowedChangedEntityKind: "draft-supplier-quality-hold",
    partialField: "evidenceDigest",
    incorrectField: "severity",
    incorrectValue: "low",
    protectedStateDigest: "protected-supplier-state:arbor:v1",
  },
});

const WARRANTY = Object.freeze({
  id: "solace-warranty-response-das027-mcp-v1",
  sourceKind: "mcp-tools-list",
  businessIntake: {
    roleLabel: "Warranty claim response draft coordinator",
    roleOutcome: "Turn each assigned approved warranty claim into exactly one unsubmitted draft response.",
    intendedMutation: "Create only an unsubmitted response draft; never issue payment or alter protected claim or product state.",
    desiredExternallyObservableOutcome: "A separately authenticated claim-audit server shows one exact draft and unchanged protected payment and claim state.",
    knownStableIdentity: ["claimId", "deduplicationKey"],
    limits: "At most one response draft per claim. Conflicts and unknown state halt without blind retry.",
    escalationOwner: "Warranty controls lead",
  },
  actionSource: mcp("solace-warranty-actions", "8.2.0", CLAIM_ACTION_TOOLS),
  observerSource: mcp("solace-warranty-audit", "4.6.0", CLAIM_OBSERVER_TOOLS),
  credentialAliases: { action: ["SOLACE_WARRANTY_ACTION_LEASE"], observer: ["SOLACE_WARRANTY_AUDIT_LEASE"] },
  answers: {
    actionOperation: "draftWarrantyClaimResponse",
    actionReadOperations: ["readApprovedWarrantyClaim", "lookupDraftWarrantyClaimResponse"],
    rejectedOperations: ["issueWarrantyPayment"],
    stableIdentityFields: ["claimId", "deduplicationKey"],
    assignedWorkMapping: ["claimId->claimId", "deduplicationKey->deduplicationKey"],
    conflictKeyFields: ["deduplicationKey"],
    conflictKeySource: "mcp-required-input-field",
    conflictBehavior: "halt-handoff-no-overwrite",
    allowedEntityKinds: ["draft-warranty-claim-response"],
    allowedScopeFields: ["claimId", "deduplicationKey"],
    maximumWritesPerAssignedItem: 1,
    actionBindingId: "solace-warranty-response-action-v1",
    actionSurfaceId: "solace-warranty-action-mcp",
    actionImplementationLabel: "solace-mcp-warranty-action-reviewed-v1",
    reconciliationOperation: "lookupDraftWarrantyClaimResponse",
    reconciliationInputBindings: ["claimId->claimId"],
    noBlindRetry: true,
    automaticRetries: 0,
    maximumGatedRetries: 1,
    observerOperations: ["observeWarrantyClaimResponseOutcome", "observeProtectedWarrantyScope"],
    observerId: "solace-warranty-audit-v1",
    observerSurfaceId: "solace-read-only-warranty-audit-mcp",
    observerImplementationLabel: "solace-mcp-warranty-audit-reviewed-v1",
    observerIndependent: true,
    requiredExactFields: ["claimId", "deduplicationKey", "productSerial", "decisionCode", "evidenceDigest", "approvedAmountMinor"],
    statusField: "status",
    completionStatuses: ["unsubmitted-draft"],
    resultIdentityField: "warrantyResponseId",
    maximumDistinctResults: 1,
    changedEntitiesField: "changedEntities",
    unrelatedStateDigestField: "unrelatedStateDigest",
    snapshotGeneratedAtField: "snapshotGeneratedAtMs",
    caughtUpThroughField: "caughtUpThroughMs",
    maximumAgeMs: 50,
    predicates: ["observed response matches every exact assigned-work field", "observed status is unsubmitted-draft"],
    invariants: ["payment and protected claim state remain unchanged", "no second response exists for the stable identity"],
    terminalOutcomes: TERMINAL_OUTCOMES,
    forbiddenActions: ["issue-warranty-payment", "change-protected-claim", "edit-unrelated-product-state"],
    approvals: ["issue-warranty-payment", "submit-warranty-response"],
    authority: ["create-unsubmitted-warranty-response-draft"],
    ownerReviewer: "Fictional Solace warranty controls owner",
    engineerReviewer: "Fictional Solace customer-local engineer",
    unknownStateHandling: "halt and hand off to warranty controls without retry",
  },
  qualificationWorld: {
    assignedWork: { claimId: "claim-804", deduplicationKey: "warranty-response:claim-804:v1", productSerial: "serial-Q7T8", decisionCode: "ELIGIBLE_DRAFT", evidenceDigest: "sha256:warranty-evidence-804", approvedAmountMinor: 32900 },
    stableIdentityFields: ["claimId", "deduplicationKey"],
    resultIdentityField: "warrantyResponseId",
    statusField: "status",
    completionStatus: "unsubmitted-draft",
    allowedChangedEntityKind: "draft-warranty-claim-response",
    partialField: "evidenceDigest",
    incorrectField: "approvedAmountMinor",
    incorrectValue: 32901,
    protectedStateDigest: "protected-warranty-state:solace:v1",
  },
});

export const DAS027_FRESH_FIXTURES = Object.freeze([SUPPLIER, WARRANTY]);
