import { DAS027_FRESH_FIXTURES } from "../das027-declarative-runtime/fixtures.js";

function replaceDeep(value, replacements) {
  if (Array.isArray(value)) return value.map((item) => replaceDeep(item, replacements));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [replacements[key] ?? key, replaceDeep(child, replacements)]));
  if (typeof value !== "string") return value;
  return Object.entries(replacements).reduce((text, [from, to]) => text.replaceAll(from, to), value);
}

function coldChainFixture() {
  const fixture = replaceDeep(structuredClone(DAS027_FRESH_FIXTURES[0]), {
    "arbor-supplier-quality-hold-das027-openapi-v1": "northstar-cold-chain-exception-das028-openapi-v1",
    "Arbor": "Northstar",
    "arbor": "northstar",
    "supplier": "shipment",
    "Supplier": "Shipment",
    "quality": "temperature",
    "Quality": "Temperature",
    "hold": "exception",
    "Hold": "Exception",
    "supplierId": "shipmentId",
    "idempotencyKey": "exceptionKey",
    "issueCode": "sensorState",
    "evidenceDigest": "sensorDigest",
    "severity": "temperatureCelsius",
    "qualityHoldId": "exceptionId",
    "draft-supplier-temperature-exception": "draft-shipment-temperature-exception",
  });
  fixture.actionSource.document.info = { title: "Fictional Northstar Cold-chain Actions", version: "1.4.0" };
  fixture.actionSource.document.servers = [{ url: "https://northstar-cold-chain.example.test/v1" }];
  fixture.actionSource.baseUrl = fixture.actionSource.document.servers[0].url;
  fixture.actionSource.document.paths = {
    "/shipments/{shipmentId}": {
      get: {
        operationId: "readApprovedShipmentExcursion",
        parameters: [{ name: "shipmentId", in: "path", required: true, schema: { type: "string", minLength: 3 } }],
        responses: { "200": { description: "Approved excursion" }, "404": { description: "Unknown shipment" } },
      },
    },
    "/shipments/{shipmentId}/temperature-exceptions": {
      post: {
        operationId: "createDraftTemperatureException",
        parameters: [
          { name: "shipmentId", in: "path", required: true, schema: { type: "string", minLength: 3 } },
          { name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 12 } },
          { name: "facilityCode", in: "query", required: true, schema: { type: "string", minLength: 3 } },
        ],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["exceptionKey", "sensorState", "sensorDigest", "temperatureCelsius"],
          properties: {
            exceptionKey: { type: "string", minLength: 12 },
            sensorState: { type: "string", enum: ["EXCURSION_CONFIRMED", "SENSOR_REVIEW_REQUIRED"] },
            sensorDigest: { type: "string", minLength: 12 },
            temperatureCelsius: { type: "number", minimum: -40, maximum: 80 },
          },
          additionalProperties: false,
        } } } },
        responses: { "201": { description: "Draft exception created" }, "409": { description: "Conflict" } },
      },
      get: {
        operationId: "listDraftTemperatureExceptions",
        parameters: [{ name: "shipmentId", in: "path", required: true, schema: { type: "string", minLength: 3 } }],
        responses: { "200": { description: "Draft exceptions" } },
      },
    },
    "/shipments/{shipmentId}/release": {
      post: { operationId: "releaseShipment", parameters: [{ name: "shipmentId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Released" } } },
    },
  };
  fixture.observerSource.document.info = { title: "Fictional Northstar Sensor Audit", version: "2.1.0" };
  fixture.observerSource.document.servers = [{ url: "https://northstar-sensor-audit.example.test/read/v2" }];
  fixture.observerSource.baseUrl = fixture.observerSource.document.servers[0].url;
  fixture.observerSource.document.paths = {
    "/observations/temperature-exceptions/{shipmentId}": {
      get: { operationId: "observeTemperatureExceptionOutcome", parameters: [{ name: "shipmentId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Immutable exception observation" } } },
    },
    "/observations/protected-shipment/{shipmentId}": {
      get: { operationId: "observeProtectedShipmentState", parameters: [{ name: "shipmentId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Protected shipment digest" } } },
    },
  };
  fixture.businessIntake = {
    roleLabel: "Cold-chain exception draft coordinator",
    roleOutcome: "Turn an assigned approved temperature excursion into exactly one draft exception.",
    intendedMutation: "Create only a draft temperature exception; never release a shipment or change protected shipment state.",
    desiredExternallyObservableOutcome: "A separately authenticated sensor-audit source shows one exact draft and unchanged protected shipment state.",
    knownStableIdentity: ["shipmentId", "exceptionKey"],
    limits: "At most one exception per assigned excursion. Unknown state halts before retry.",
    escalationOwner: "Cold-chain controls lead",
  };
  Object.assign(fixture.answers, {
    actionOperation: "createDraftTemperatureException",
    actionReadOperations: ["readApprovedShipmentExcursion", "listDraftTemperatureExceptions"],
    rejectedOperations: ["releaseShipment"],
    stableIdentityFields: ["shipmentId", "exceptionKey"],
    assignedWorkMapping: ["shipmentId->shipmentId", "exceptionKey->exceptionKey"],
    conflictKeyFields: ["exceptionKey"],
    allowedEntityKinds: ["draft-shipment-temperature-exception"],
    allowedScopeFields: ["shipmentId", "exceptionKey"],
    actionBindingId: "northstar-cold-chain-action-v1",
    actionSurfaceId: "northstar-cold-chain-api",
    actionImplementationLabel: "northstar-openapi-cold-chain-reviewed-v1",
    reconciliationOperation: "listDraftTemperatureExceptions",
    reconciliationInputBindings: ["shipmentId->shipmentId"],
    observerOperations: ["observeTemperatureExceptionOutcome", "observeProtectedShipmentState"],
    observerId: "northstar-sensor-audit-v1",
    observerSurfaceId: "northstar-read-only-sensor-audit",
    observerImplementationLabel: "northstar-openapi-sensor-audit-reviewed-v1",
    requiredExactFields: ["shipmentId", "exceptionKey", "facilityCode", "sensorState", "sensorDigest", "temperatureCelsius"],
    resultIdentityField: "exceptionId",
    predicates: ["observed exception matches every exact assigned-work field", "observed status is draft"],
    invariants: ["shipment release and protected shipment state remain unchanged", "no second exception exists for the stable identity"],
    forbiddenActions: ["release-shipment", "change-protected-shipment"],
    approvals: ["release-shipment", "submit-temperature-exception"],
    authority: ["create-draft-temperature-exception"],
    ownerReviewer: "Fictional Northstar cold-chain owner",
    engineerReviewer: "Fictional Northstar customer-local engineer",
    unknownStateHandling: "halt and hand off to cold-chain controls without retry",
  });
  fixture.credentialAliases = { action: ["NORTHSTAR_COLD_CHAIN_ACTION"], observer: ["NORTHSTAR_SENSOR_AUDIT_READ"] };
  fixture.qualificationWorld = {
    assignedWork: { shipmentId: "shipment-841", exceptionKey: "temp-exception:shipment-841:v1", facilityCode: "ICN-4", sensorState: "EXCURSION_CONFIRMED", sensorDigest: "sha256:sensor-841", temperatureCelsius: 11.6 },
    stableIdentityFields: ["shipmentId", "exceptionKey"], resultIdentityField: "exceptionId", statusField: "status", completionStatus: "draft",
    allowedChangedEntityKind: "draft-shipment-temperature-exception", partialField: "sensorDigest", incorrectField: "temperatureCelsius", incorrectValue: 3.2,
    protectedStateDigest: "protected-northstar-shipment-state:v1",
  };
  return Object.freeze(fixture);
}

function isolationFixture() {
  const fixture = replaceDeep(structuredClone(DAS027_FRESH_FIXTURES[1]), {
    "solace-warranty-response-das027-mcp-v1": "quarry-equipment-isolation-das028-mcp-v1",
    "Solace": "Quarry",
    "solace": "quarry",
    "warranty": "equipment",
    "Warranty": "Equipment",
    "claim": "asset",
    "Claim": "Asset",
    "response": "isolation",
    "Response": "Isolation",
    "claimId": "assetId",
    "deduplicationKey": "deduplicationKey",
    "productSerial": "workOrderId",
    "decisionCode": "reasonCode",
    "evidenceDigest": "inspectionDigest",
    "approvedAmountMinor": "isolationMinutes",
    "warrantyResponseId": "isolationRecordId",
  });
  fixture.actionSource.serverId = "quarry-equipment-actions";
  fixture.actionSource.serverVersion = "1.9.0";
  fixture.actionSource.toolsList.tools = [
    { name: "readApprovedIsolationRequest", description: "Read one approved equipment-isolation request.", annotations: { readOnlyHint: true }, inputSchema: { type: "object", required: ["assetId"], properties: { assetId: { type: "string", minLength: 3 } }, additionalProperties: false } },
    { name: "createDraftEquipmentIsolation", description: "Create one draft isolation record.", annotations: { readOnlyHint: false }, inputSchema: { type: "object", required: ["assetId", "deduplicationKey", "workOrderId", "reasonCode", "inspectionDigest", "isolationMinutes"], properties: { assetId: { type: "string", minLength: 3 }, deduplicationKey: { type: "string", minLength: 12 }, workOrderId: { type: "string", minLength: 4 }, reasonCode: { type: "string", enum: ["SAFETY_INSPECTION", "PLANNED_MAINTENANCE"] }, inspectionDigest: { type: "string", minLength: 12 }, isolationMinutes: { type: "integer", minimum: 5, maximum: 1440 } }, additionalProperties: false } },
    { name: "readDraftEquipmentIsolation", description: "Read one draft isolation for reconciliation.", annotations: { readOnlyHint: true }, inputSchema: { type: "object", required: ["assetId"], properties: { assetId: { type: "string" } }, additionalProperties: false } },
    { name: "lockOutEquipment", description: "Physically lock out equipment.", annotations: { readOnlyHint: false, destructiveHint: true }, inputSchema: { type: "object", required: ["assetId"], properties: { assetId: { type: "string" } }, additionalProperties: false } },
  ];
  fixture.observerSource.serverId = "quarry-safety-audit";
  fixture.observerSource.serverVersion = "3.0.0";
  fixture.observerSource.toolsList.tools = [
    { name: "observeEquipmentIsolationOutcome", description: "Read an immutable isolation observation.", annotations: { readOnlyHint: true }, inputSchema: { type: "object", required: ["assetId", "deduplicationKey"], properties: { assetId: { type: "string" }, deduplicationKey: { type: "string" } }, additionalProperties: false } },
    { name: "observeProtectedEquipmentState", description: "Read the protected equipment-state digest.", annotations: { readOnlyHint: true }, inputSchema: { type: "object", required: ["assetId"], properties: { assetId: { type: "string" } }, additionalProperties: false } },
  ];
  fixture.businessIntake = {
    roleLabel: "Equipment-isolation draft coordinator", roleOutcome: "Turn an assigned approved maintenance request into exactly one draft isolation record.",
    intendedMutation: "Create only a draft isolation record; never lock out equipment or change protected work-order state.",
    desiredExternallyObservableOutcome: "A separately authenticated safety-audit process shows one exact draft and unchanged protected equipment state.",
    knownStableIdentity: ["assetId", "deduplicationKey"], limits: "At most one draft per request; conflicts and uncertainty halt without retry.", escalationOwner: "Equipment safety lead",
  };
  Object.assign(fixture.answers, {
    actionOperation: "createDraftEquipmentIsolation", actionReadOperations: ["readApprovedIsolationRequest", "readDraftEquipmentIsolation"], rejectedOperations: ["lockOutEquipment"],
    stableIdentityFields: ["assetId", "deduplicationKey"], assignedWorkMapping: ["assetId->assetId", "deduplicationKey->deduplicationKey"], conflictKeyFields: ["deduplicationKey"],
    allowedEntityKinds: ["draft-equipment-isolation"], allowedScopeFields: ["assetId", "deduplicationKey"], actionBindingId: "quarry-equipment-isolation-action-v1", actionSurfaceId: "quarry-equipment-action-mcp",
    actionImplementationLabel: "quarry-mcp-equipment-action-reviewed-v1", reconciliationOperation: "readDraftEquipmentIsolation", reconciliationInputBindings: ["assetId->assetId"],
    observerOperations: ["observeEquipmentIsolationOutcome", "observeProtectedEquipmentState"], observerId: "quarry-safety-audit-v1", observerSurfaceId: "quarry-read-only-safety-audit-mcp", observerImplementationLabel: "quarry-mcp-safety-audit-reviewed-v1",
    requiredExactFields: ["assetId", "deduplicationKey", "workOrderId", "reasonCode", "inspectionDigest", "isolationMinutes"], resultIdentityField: "isolationRecordId",
    predicates: ["observed isolation matches every exact assigned-work field", "observed status is unsubmitted-draft"], invariants: ["equipment lockout and protected work-order state remain unchanged", "no second isolation exists for the stable identity"],
    forbiddenActions: ["lock-out-equipment", "change-protected-work-order"], approvals: ["lock-out-equipment", "submit-isolation-record"], authority: ["create-unsubmitted-equipment-isolation-draft"],
    ownerReviewer: "Fictional Quarry equipment controls owner", engineerReviewer: "Fictional Quarry customer-local engineer", unknownStateHandling: "halt and hand off to equipment controls without retry",
  });
  fixture.credentialAliases = { action: ["QUARRY_EQUIPMENT_ACTION"], observer: ["QUARRY_SAFETY_AUDIT_READ"] };
  fixture.qualificationWorld = {
    assignedWork: { assetId: "asset-552", deduplicationKey: "equipment-isolation:asset-552:v1", workOrderId: "wo-7752", reasonCode: "PLANNED_MAINTENANCE", inspectionDigest: "sha256:inspection-552", isolationMinutes: 90 },
    stableIdentityFields: ["assetId", "deduplicationKey"], resultIdentityField: "isolationRecordId", statusField: "status", completionStatus: "unsubmitted-draft", allowedChangedEntityKind: "draft-equipment-isolation",
    partialField: "inspectionDigest", incorrectField: "isolationMinutes", incorrectValue: 91, protectedStateDigest: "protected-quarry-equipment-state:v1",
  };
  return Object.freeze(fixture);
}

export const DAS028_FRESH_FIXTURES = Object.freeze([coldChainFixture(), isolationFixture()]);
