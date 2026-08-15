import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { AssistedCommercialOnboardingJourney } from "../product/assisted-onboarding-journey.js";
import { createReviewedBindingImplementationInput } from "../product/reviewed-onboarding-binding-compiler.js";
import { proposeOnboardingSystemImport } from "../product/onboarding-system-import.js";

const SOURCE_ROOT = path.resolve("artifacts/onboarding/fresh-start-teardown-v3/fixtures");
const OUTPUT_ROOT = path.resolve("artifacts/onboarding/reviewed-binding-compiler-v4");
const FIXED_NOW = "2026-08-14T06:00:00.000Z";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function writePrivate(filePath, value) { fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" }); }
function examples(label) { return Array.from({ length: 5 }, (_, index) => ({ situation: `${label} case ${index + 1}`, expected: `${label} independently observed result ${index + 1}`, source: "customer-authored", redacted: true })); }

function decisionsFor(proposal, importPacket) {
  const mappings = new Map(importPacket.mappings.map(([sourceName, targetName, mode, authorityAction]) => [sourceName, { targetName, mode, authorityAction }]));
  const rejected = new Set(importPacket.rejected);
  return {
    operationChoices: proposal.operations.map((operation) => {
      if (rejected.has(operation.sourceName)) return { sourceName: operation.sourceName, approved: false, rejectionReason: "Outside this exact bounded role." };
      const mapping = mappings.get(operation.sourceName);
      requireCondition(mapping, `Missing role-owner decision for ${operation.sourceName}`);
      return { sourceName: operation.sourceName, approved: true, targetExposedName: `${importPacket.systemId}:${mapping.targetName}`, confirmedMode: mapping.mode, authorityAction: mapping.authorityAction, requiredContextSources: proposal.proposedContextSources.filter((item) => !item.includes(":") || item.endsWith(`:${operation.sourceName}`)) };
    }),
    contextChoices: proposal.proposedContextSources.map((sourceId) => ({ sourceId, approved: true })),
  };
}

export function heldOutPacket() {
  const sessionId = "heldout-warranty-dispatch-v1";
  const systemId = "warranty-ops";
  const source = {
    kind: "openapi",
    document: {
      openapi: "3.1.0",
      info: { title: "Fictional Warranty Dispatch", version: "1.0.0" },
      servers: [{ url: "https://warranty.example.test/v1" }],
      paths: {
        "/claims": { get: { operationId: "listReadyClaims", summary: "List approved claims awaiting replacement", responses: { "200": { description: "ok" } } } },
        "/claims/{claimId}": { get: { operationId: "readClaim", summary: "Read one approved claim", parameters: [{ name: "claimId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" } } } },
        "/dispatches": { post: { operationId: "createReplacementDispatch", summary: "Create one bounded replacement dispatch", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["requestId", "claimId", "partSku", "quantity"], properties: { requestId: { type: "string" }, claimId: { type: "string" }, partSku: { type: "string" }, quantity: { type: "integer", minimum: 1, maximum: 2 } }, additionalProperties: false } } } }, responses: { "202": { description: "accepted" } } } },
        "/dispatches/{requestId}": { get: { operationId: "readReplacementDispatch", summary: "Read one persisted dispatch by stable request", parameters: [{ name: "requestId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" }, "404": { description: "not found" } } } },
        "/cash-settlements": { post: { operationId: "issueCashSettlement", summary: "Issue a cash settlement", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["claimId", "amount"], properties: { claimId: { type: "string" }, amount: { type: "number" } } } } } }, responses: { "201": { description: "created" } } } },
      },
    },
  };
  const intake = {
    sessionId,
    company: { name: "Fictional Harbor Homeware", industry: "Retail", operatingContext: "Approved warranty replacements are prepared in a disposable local test world." },
    role: { templateId: "support-operations", title: "Warranty replacement coordinator", outcome: "Create one correct replacement dispatch for every approved claim.", completionRule: "Complete only when direct readback confirms the exact dispatch and unrelated state is unchanged.", escalationOwner: "Warranty operations lead" },
    systems: [{ id: systemId, name: "Warranty operations", kind: "customer-local warranty API", access: "customer-local-test", adapterStatus: "missing", contextSources: ["approved-claims", "replacement-policy"], tools: [{ name: "list-ready-claims", mode: "read" }, { name: "read-claim", mode: "read" }, { name: "create-replacement-dispatch", mode: "write" }, { name: "read-replacement-dispatch", mode: "read" }] }],
    knowledgeSources: [{ name: "Replacement policy", kind: "policy", contentHash: digest("heldout-warranty-policy-v1"), current: true }],
    policies: [{ rule: "Inspect approval and authorised parts before dispatch.", kind: "required-check", confirmed: true }, { rule: "Any quantity above two requires review.", kind: "approval", confirmed: true }, { rule: "Never issue cash or dispatch unapproved parts.", kind: "forbidden", confirmed: true }],
    authority: { allowedActions: ["create-replacement-dispatch"], approvalActions: ["quantity-review"], forbiddenActions: ["issue-cash-settlement", "change-warranty-approval"] },
    examples: examples("warranty replacement"),
    success: { measures: ["Every approved claim has exactly one matching dispatch.", "Every dispatch matches the approved claim, part and quantity.", "No cash settlement or unrelated state change occurs."], verifierMode: "independent-external-state", verifierStatus: "declared", owner: "Customer-local warranty observer" },
    priorities: { quality: 1, cost: .2, speed: .2, maximumCostPerTaskUsd: .5, maximumLatencyMs: 300000, goal: "Preserve exact dispatch outcomes before optimizing cost." },
    currentAgent: { mode: "none" },
    dataHandling: { localOnly: true, productionDataIncluded: false, redactionConfirmed: true },
  };
  return {
    description: "Create approved warranty replacement dispatches, verify each one, and never issue cash.",
    intake,
    imports: [{
      systemId,
      source,
      provenance: { acquisition: "customer-upload", label: "Held-out fictional warranty OpenAPI" },
      mappings: [["listReadyClaims", "list-ready-claims", "read", null], ["readClaim", "read-claim", "read", null], ["createReplacementDispatch", "create-replacement-dispatch", "write", "create-replacement-dispatch"], ["readReplacementDispatch", "read-replacement-dispatch", "read", null]],
      rejected: ["issueCashSettlement"],
      writeSafety: [{ sourceName: "createReplacementDispatch", idempotencyHeader: "Idempotency-Key", verification: { readOperationId: "readReplacementDispatch", inputMap: [{ targetSection: "path", targetName: "requestId", writeInputPointer: "/body/requestId" }], assertions: [{ actualPointer: "/requestId", equalsWriteInputPointer: "/body/requestId" }, { actualPointer: "/claimId", equalsWriteInputPointer: "/body/claimId" }, { actualPointer: "/partSku", equalsWriteInputPointer: "/body/partSku" }, { actualPointer: "/quantity", equalsWriteInputPointer: "/body/quantity" }] } }],
    }],
  };
}

async function execute() {
  requireCondition(!fs.existsSync(OUTPUT_ROOT), `Refusing to overwrite preserved DAS-012 evidence: ${OUTPUT_ROOT}`);
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true, mode: 0o700 });
  const frozenPackets = fs.readdirSync(SOURCE_ROOT).sort().map((fixtureId) => JSON.parse(fs.readFileSync(path.join(SOURCE_ROOT, fixtureId, "customer-packet.json"), "utf8")));

  function run(packet, heldOut = false) {
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), `das012-${packet.intake.sessionId}-`));
    try {
      const journey = new AssistedCommercialOnboardingJourney({ stateDirectory: stateRoot, now: () => FIXED_NOW });
      const saved = journey.saveBusinessIntake(packet.intake);
      requireCondition(saved.generated.bindingScaffold, `${packet.intake.sessionId} did not reach binding scaffold: ${JSON.stringify(saved.questions)}`);
      const imports = [];
      for (const input of packet.imports) {
        const record = journey.record(packet.intake.sessionId);
        const proposal = proposeOnboardingSystemImport({ intake: record.intake, systemId: input.systemId, source: input.source, provenance: input.provenance });
        journey.recordSystemImportProposal({ sessionId: record.sessionId, proposal, source: input.source });
        const confirmation = journey.recordSystemImportConfirmation({ sessionId: record.sessionId, proposalHash: proposal.proposalHash, source: input.source, decisions: decisionsFor(proposal, input), confirmedBy: "Fictional role owner" });
        const implementationInput = createReviewedBindingImplementationInput({ workPlan: confirmation.workPlan, writeSafety: heldOut ? input.writeSafety : [] });
        const compiled = journey.recordSystemImportStructuralCompilation({ sessionId: record.sessionId, proposalHash: proposal.proposalHash, source: input.source, implementationInput }).structuralBinding;
        imports.push({ sourceKind: input.source.kind, artifactHash: compiled.artifactHash, status: compiled.status, measurements: compiled.measurements, exactBlockers: compiled.exactBlockers });
      }
      const projection = journey.latest(packet.intake.sessionId);
      const receipt = journey.readinessReceipt(packet.intake.sessionId);
      requireCondition(projection.stages.executableComparisonEnvironmentReady === false && projection.stages.controlledActivationReady === false, "DAS-012 rehearsal became falsely ready");
      return { sessionId: packet.intake.sessionId, imports, projectionStatus: projection.status, readinessReceiptHash: receipt.receiptHash, executionReady: false, activationReady: false };
    } finally { fs.rmSync(stateRoot, { recursive: true, force: true }); }
  }

  const frozen = frozenPackets.map((packet) => run(packet, false));
  const heldOut = run(heldOutPacket(), true);
  const allImports = frozen.flatMap((item) => item.imports);
  const summary = {
    schemaVersion: "das.reviewed-binding-compiler-rehearsal.v1",
    sourceTeardownSummaryHash: "e526ff220f59eb53e825272a59ba01ac6ec0ef633c423e3d61ea90a525d55c29",
    frozenFamily: {
      fixtures: frozen.length,
      imports: allImports.length,
      targetedGenericCompilerFields: allImports.reduce((total, item) => total + item.measurements.targetedGenericCompilerFields, 0),
      retiredGenericCompilerFields: allImports.reduce((total, item) => total + item.measurements.retiredGenericCompilerFields, 0),
      remainingGenericCompilerFields: allImports.reduce((total, item) => total + item.measurements.remainingGenericCompilerFields, 0),
      structurallyCompiledOperations: allImports.reduce((total, item) => total + item.measurements.structurallyCompiledOperations, 0),
      executionReady: frozen.some((item) => item.executionReady),
      activationReady: frozen.some((item) => item.activationReady),
    },
    heldOut: {
      sessionId: heldOut.sessionId,
      imports: heldOut.imports.length,
      status: heldOut.imports[0].status,
      targetedGenericCompilerFields: heldOut.imports[0].measurements.targetedGenericCompilerFields,
      retiredGenericCompilerFields: heldOut.imports[0].measurements.retiredGenericCompilerFields,
      remainingGenericCompilerFields: heldOut.imports[0].measurements.remainingGenericCompilerFields,
      structurallyCompiledOperations: heldOut.imports[0].measurements.structurallyCompiledOperations,
      writeSafetyFieldsStillUnproved: heldOut.imports[0].measurements.writeSafetyFieldsStillUnproved,
      executionReady: false,
      activationReady: false,
    },
    modelCalls: 0,
    spendUsd: 0,
    evidenceBoundary: "Private fictional deterministic structural compilation only. Frozen teardowns intentionally omit customer-specific write-safety inputs; the held-out package supplies them but still remains unprobed, non-executable and unaccepted.",
    results: { frozen, heldOut },
  };
  summary.summaryHash = digest(summary);
  writePrivate(path.join(OUTPUT_ROOT, "heldout-customer-packet.json"), heldOutPacket());
  writePrivate(path.join(OUTPUT_ROOT, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
}

execute();
