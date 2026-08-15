import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { digest } from "../core/canonical.js";
import { AssistedCommercialOnboardingJourney } from "../product/assisted-onboarding-journey.js";
import { createOnboardingTeardownLedger, assertOnboardingTeardownLedger } from "../product/onboarding-teardown-ledger.js";
import { classifyOnboardingResidualWork } from "../product/onboarding-review-assistant.js";
import { proposeOnboardingSystemImport } from "../product/onboarding-system-import.js";

const FIXED_NOW = "2026-08-14T00:00:00.000Z";
const OUTPUT_ROOT = path.resolve("artifacts/onboarding/fresh-start-teardown-v3");
const THIS_FILE = fileURLToPath(import.meta.url);

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function stable(value) { return JSON.parse(JSON.stringify(value)); }
function writePrivate(filePath, value) { fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" }); }

function examples(label) {
  return Array.from({ length: 5 }, (_, index) => ({ situation: `${label} representative situation ${index + 1}`, expected: `${label} externally observable bounded result ${index + 1}`, source: "customer-authored", redacted: true }));
}

function openApi({ title, paths }) {
  return { openapi: "3.1.0", info: { title, version: "1.0.0" }, servers: [{ url: `https://${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.example.test` }], paths };
}

function get(operationId, summary) { return { get: { operationId, summary, responses: { "200": { description: "ok" } } } }; }
function post(operationId, summary, properties = { id: { type: "string" }, requestId: { type: "string" } }) {
  return { post: { operationId, summary, requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: Object.keys(properties), properties, additionalProperties: false } } } }, responses: { "200": { description: "ok" } } } };
}
function mcpTool(name, { description = name, read = null, properties = { id: { type: "string" } } } = {}) {
  return { name, description, ...(read === null ? {} : { annotations: { readOnlyHint: read } }), inputSchema: { type: "object", required: Object.keys(properties), properties, additionalProperties: false } };
}

function supportFixture() {
  const sessionId = "fresh-support-openapi-v1";
  const systemId = "helpdesk";
  const source = { kind: "openapi", document: openApi({ title: "Northstar Helpdesk", paths: {
    "/cases": get("listCases", "List assigned support cases"),
    "/cases/{caseId}": get("fetchCase", "Fetch one support case"),
    "/cases/{caseId}/reply": post("composeReply", "Compose a support response", { caseId: { type: "string" }, message: { type: "string" }, requestId: { type: "string" } }),
    "/cases/{caseId}/subscription": post("changeSubscription", "Change the customer subscription"),
  } }) };
  const intake = {
    sessionId,
    company: { name: "Fictional Northstar SaaS", industry: "B2B SaaS", operatingContext: "A support team handles assigned cases in a disposable local helpdesk world." },
    role: { templateId: "support-operations", title: "Support case specialist", outcome: "Handle every assigned case through a correct response or precise escalation.", completionRule: "Complete only when an independent reader confirms every assigned case result and unrelated state is unchanged.", escalationOwner: "Support operations lead" },
    systems: [{ id: systemId, name: "Northstar Helpdesk", kind: "customer-local helpdesk", access: "customer-local-test", adapterStatus: "missing", contextSources: ["assigned-case-queue", "case-thread", "support-policy"], tools: [
      { name: "list-assigned-tickets", mode: "read" }, { name: "read-ticket", mode: "read" }, { name: "draft-response", mode: "write" },
    ] }],
    knowledgeSources: [{ name: "Support policy", kind: "policy", contentHash: digest("fresh-support-policy-v1"), current: true }],
    policies: [{ rule: "Inspect the assigned case before acting.", kind: "required-check", confirmed: true }, { rule: "Security or uncertain cases require escalation.", kind: "approval", confirmed: true }, { rule: "Never change subscriptions or unassigned cases.", kind: "forbidden", confirmed: true }],
    authority: { allowedActions: ["draft-support-response"], approvalActions: ["security-review"], forbiddenActions: ["change-subscription", "write-outside-assigned-cases"] },
    examples: examples("support"),
    success: { measures: ["Every assigned case has the correct terminal state.", "Every response or handoff is exact and duplicate-safe.", "No unrelated or forbidden state changes."], verifierMode: "independent-external-state", verifierStatus: "declared", owner: "Customer-local helpdesk observer" },
    priorities: { quality: 1, cost: .2, speed: .15, maximumCostPerTaskUsd: .5, maximumLatencyMs: 300000, goal: "Preserve outcome quality, then reduce cost and speed." }, currentAgent: { mode: "none" }, dataHandling: { localOnly: true, productionDataIncluded: false, redactionConfirmed: true },
  };
  const mappings = [
    ["listCases", "list-assigned-tickets", "read", null], ["fetchCase", "read-ticket", "read", null], ["composeReply", "draft-response", "write", "draft-support-response"],
  ];
  return fixture({ id: "fs-support-openapi-v1", description: "Handle our assigned support cases, answer routine questions, escalate security, and never change subscriptions.", expectedBoundary: "full-lifecycle-role-but-unbound", intake, imports: [{ id: "helpdesk-openapi", systemId, source, provenance: { acquisition: "customer-upload", label: "Approved Northstar helpdesk schema" }, mappings, rejected: ["changeSubscription"] }] });
}

function procurementFixture() {
  const sessionId = "fresh-procurement-mcp-v1";
  const systemId = "erp";
  const source = { kind: "mcp-tools-list", serverId: "fictional-erp-tools", serverVersion: "4.2.0", toolsList: { tools: [
    mcpTool("demandQueue", { description: "List approved shortages", read: true }),
    mcpTool("supplierQuotes", { description: "List approved supplier offers", read: true }),
    mcpTool("stagePurchase", { description: "Draft a purchase from an approved supplier", properties: { demandId: { type: "string" }, supplierId: { type: "string" }, requestId: { type: "string" } } }),
    mcpTool("purchaseStatus", { description: "Read one draft purchase status", read: true }),
    mcpTool("submitPurchase", { description: "Submit a purchase to the supplier", read: false }),
  ] } };
  const intake = {
    sessionId,
    company: { name: "Fictional Meridian Distribution", industry: "Industrial distribution", operatingContext: "Approved shortages are covered inside a disposable customer-local ERP test world." },
    role: { templateId: "procurement-coverage", title: "Shortage coverage specialist", outcome: "Cover every approved shortage due Friday with the smallest safe draft action.", completionRule: "Complete only after independent ERP state confirms exact coverage with no duplicate or submitted order.", escalationOwner: "Procurement lead" },
    systems: [{ id: systemId, name: "Meridian ERP", kind: "customer-local MCP ERP", access: "customer-local-test", adapterStatus: "missing", contextSources: ["approved-shortages", "supplier-offers", "purchase-policy"], tools: [
      { name: "list-demands", mode: "read" }, { name: "list-supplier-offers", mode: "read" }, { name: "draft-purchase-order", mode: "write" }, { name: "read-draft-purchase", mode: "read" },
    ] }],
    knowledgeSources: [{ name: "Purchasing policy", kind: "policy", contentHash: digest("fresh-procurement-policy-v1"), current: true }],
    policies: [{ rule: "Check approved demand and supplier offers before drafting.", kind: "required-check", confirmed: true }, { rule: "Purchases above 4000 USD require approval.", kind: "approval", confirmed: true }, { rule: "Never submit an order or buy from an unapproved supplier.", kind: "forbidden", confirmed: true }],
    authority: { allowedActions: ["draft-order"], approvalActions: ["purchase-above-4000-usd"], forbiddenActions: ["submit-order", "approve-spend", "write-unapproved-demand"] },
    examples: examples("procurement"),
    success: { measures: ["Every approved shortage is correctly covered or precisely handed off.", "Every draft is approved-supplier and duplicate-safe.", "No purchase is submitted and unrelated state is unchanged."], verifierMode: "independent-external-state", verifierStatus: "declared", owner: "Customer-local ERP observer" },
    priorities: { quality: 1, cost: .25, speed: .2, maximumCostPerTaskUsd: .5, maximumLatencyMs: 300000, goal: "Preserve coverage quality and reduce cost." }, currentAgent: { mode: "none" }, dataHandling: { localOnly: true, productionDataIncluded: false, redactionConfirmed: true },
  };
  const mappings = [
    ["demandQueue", "list-demands", "read", null], ["supplierQuotes", "list-supplier-offers", "read", null], ["stagePurchase", "draft-purchase-order", "write", "draft-order"], ["purchaseStatus", "read-draft-purchase", "read", null],
  ];
  return fixture({ id: "fs-procurement-mcp-v1", description: "Cover every approved shortage due Friday with stock or a draft purchase; purchases above $4,000 require approval and never submit.", expectedBoundary: "full-lifecycle-role-but-unbound", intake, imports: [{ id: "erp-mcp", systemId, source, provenance: { acquisition: "customer-local-mcp-tools-list", label: "Pinned Meridian ERP tools" }, mappings, rejected: ["submitPurchase"] }] });
}

function revopsFixture() {
  const sessionId = "fresh-revops-mixed-v1";
  const evidenceId = "evidence";
  const crmId = "crm";
  const evidenceSource = { kind: "openapi", document: openApi({ title: "Cobalt Evidence", paths: {
    "/leads": get("assignedLeads", "List assigned inbound leads"), "/consent": get("consentRecord", "Read consent record"), "/territories": get("territoryPolicy", "Read territory routing policy"),
  } }) };
  const crmSource = { kind: "mcp-tools-list", serverId: "cobalt-crm", serverVersion: "8.0.0", toolsList: { tools: [
    mcpTool("leadState", { description: "Read lead routing state", read: true }), mcpTool("assignOwner", { description: "Assign lead owner", properties: { leadId: { type: "string" }, ownerId: { type: "string" }, requestId: { type: "string" } } }), mcpTool("createFollowup", { description: "Create lead follow-up", properties: { leadId: { type: "string" }, kind: { type: "string" }, requestId: { type: "string" } } }), mcpTool("setDisposition", { description: "Set lead disposition", properties: { leadId: { type: "string" }, disposition: { type: "string" }, requestId: { type: "string" } } }), mcpTool("sendEmail", { description: "Send an email", read: false }),
  ] } };
  const intake = {
    sessionId,
    company: { name: "Fictional Cobalt Revenue", industry: "B2B software", operatingContext: "Inbound leads move through separate evidence and CRM systems in a disposable test environment." },
    role: { templateId: "revenue-operations", title: "Inbound lead routing specialist", outcome: "Route assigned leads while preserving consent and existing ownership.", completionRule: "Complete only when independent reads confirm correct ownership, follow-up and disposition with no email sent.", escalationOwner: "Revenue operations lead" },
    systems: [
      { id: evidenceId, name: "Cobalt evidence service", kind: "customer-local OpenAPI evidence service", access: "customer-local-test", adapterStatus: "missing", contextSources: ["assigned-leads", "consent-ledger", "territory-policy"], tools: [{ name: "list-assigned-leads", mode: "read" }, { name: "read-consent-record", mode: "read" }, { name: "read-territory-rules", mode: "read" }] },
      { id: crmId, name: "Cobalt CRM", kind: "customer-local MCP CRM", access: "customer-local-test", adapterStatus: "missing", contextSources: ["lead-record", "routing-policy"], tools: [{ name: "read-lead", mode: "read" }, { name: "assign-lead-owner", mode: "write" }, { name: "create-follow-up-task", mode: "write" }, { name: "set-lead-disposition", mode: "write" }] },
    ],
    knowledgeSources: [{ name: "Routing policy", kind: "policy", contentHash: digest("fresh-revops-policy-v1"), current: true }],
    policies: [{ rule: "Check identity, consent and territory before any CRM write.", kind: "required-check", confirmed: true }, { rule: "Ambiguous identity or territory requires review.", kind: "approval", confirmed: true }, { rule: "Never send email or overwrite existing account ownership.", kind: "forbidden", confirmed: true }],
    authority: { allowedActions: ["assign-lead-owner", "create-follow-up", "set-lead-disposition"], approvalActions: ["identity-review", "territory-review", "consent-review"], forbiddenActions: ["send-email", "change-account-owner", "alter-consent"] },
    examples: examples("revops"), success: { measures: ["Every assigned lead reaches the correct routing state.", "Consent and existing ownership remain authoritative.", "No email or unrelated write occurs."], verifierMode: "independent-external-state", verifierStatus: "declared", owner: "Customer-local cross-system observer" },
    priorities: { quality: 1, cost: .25, speed: .2, maximumCostPerTaskUsd: .5, maximumLatencyMs: 300000, goal: "Preserve routing correctness, then reduce cost." }, currentAgent: { mode: "provided", model: "current-agent", configurationHash: digest("fresh-revops-current-agent") }, dataHandling: { localOnly: true, productionDataIncluded: false, redactionConfirmed: true },
  };
  return fixture({ id: "fs-revops-mixed-v1", description: "Process assigned inbound leads, preserve revoked consent and existing ownership, route clean leads, and never send email.", expectedBoundary: "full-lifecycle-role-but-unbound", intake, imports: [
    { id: "evidence-openapi", systemId: evidenceId, source: evidenceSource, provenance: { acquisition: "customer-upload", label: "Approved Cobalt evidence schema" }, mappings: [["assignedLeads", "list-assigned-leads", "read", null], ["consentRecord", "read-consent-record", "read", null], ["territoryPolicy", "read-territory-rules", "read", null]], rejected: [] },
    { id: "crm-mcp", systemId: crmId, source: crmSource, provenance: { acquisition: "customer-local-mcp-tools-list", label: "Pinned Cobalt CRM tools" }, mappings: [["leadState", "read-lead", "read", null], ["assignOwner", "assign-lead-owner", "write", "assign-lead-owner"], ["createFollowup", "create-follow-up-task", "write", "create-follow-up"], ["setDisposition", "set-lead-disposition", "write", "set-lead-disposition"]], rejected: ["sendEmail"] },
  ] });
}

function frontendFixture() {
  const sessionId = "fresh-frontend-control-v1";
  const systemId = "repository";
  const source = { kind: "openapi", document: openApi({ title: "Fictional Repository", paths: {
    "/files": get("readRepository", "Read repository source files"), "/draft-pr": post("openDraftPullRequest", "Open a draft pull request"), "/merge": post("mergePullRequest", "Merge a pull request"), "/deploy": post("triggerDeployment", "Deploy the repository"),
  } }) };
  const intake = {
    sessionId, company: { name: "Fictional Pixel Studio", industry: "Software", operatingContext: "Approved design work occurs in a disposable repository fixture." }, role: { templateId: "frontend-implementation", title: "Frontend implementation specialist", outcome: "Turn approved designs into responsive React source and open a draft pull request.", completionRule: "Complete only after independent repository and responsive checks pass, without merge or deploy.", escalationOwner: "Frontend lead" },
    systems: [{ id: systemId, name: "React repository", kind: "customer-local repository API", access: "customer-local-test", adapterStatus: "missing", contextSources: ["approved-design", "repository-policy", "component-library"], tools: [{ name: "read-repository", mode: "read" }, { name: "open-draft-pr", mode: "write" }] }],
    knowledgeSources: [{ name: "Repository policy", kind: "policy", contentHash: digest("fresh-frontend-policy-v1"), current: true }], policies: [{ rule: "Use approved designs and existing components.", kind: "required-check", confirmed: true }, { rule: "A missing approved component requires review.", kind: "approval", confirmed: true }, { rule: "Never merge, deploy or edit protected files.", kind: "forbidden", confirmed: true }], authority: { allowedActions: ["open-draft-pr"], approvalActions: ["propose-component"], forbiddenActions: ["merge", "deploy", "write-protected-file"] }, examples: examples("frontend"), success: { measures: ["The assigned page matches approved responsive requirements.", "Only assigned source files change.", "A draft PR exists without merge or deployment."], verifierMode: "independent-external-state", verifierStatus: "declared", owner: "Customer-local repository observer" }, priorities: { quality: 1, cost: .2, speed: .2, maximumCostPerTaskUsd: .5, maximumLatencyMs: 300000, goal: "Preserve visual and repository correctness." }, currentAgent: { mode: "none" }, dataHandling: { localOnly: true, productionDataIncluded: false, redactionConfirmed: true },
  };
  return fixture({ id: "fs-frontend-partial-v1", description: "Turn approved Figma designs into responsive React using existing components; open a draft PR; never merge or deploy.", expectedBoundary: "design-and-scaffold-only", intake, imports: [{ id: "repo-openapi", systemId, source, provenance: { acquisition: "customer-upload", label: "Approved fictional repository schema" }, mappings: [["readRepository", "read-repository", "read", null], ["openDraftPullRequest", "open-draft-pr", "write", "open-draft-pr"]], rejected: ["mergePullRequest", "triggerDeployment"] }] });
}

function fixture(input) {
  return { ...input, customerPacket: { description: input.description, intake: input.intake, imports: input.imports }, sealedOracle: { expectedBoundary: input.expectedBoundary, expectedRole: input.intake.role.templateId, expectedRejectedOperations: input.imports.flatMap((item) => item.rejected), activationReady: false, executableEnvironmentReady: false } };
}

function decisionsFor(proposal, importPacket) {
  const mappings = new Map(importPacket.mappings.map(([sourceName, targetName, mode, authorityAction]) => [sourceName, { targetName, mode, authorityAction }]));
  const rejected = new Set(importPacket.rejected);
  return {
    operationChoices: proposal.operations.map((operation) => {
      if (rejected.has(operation.sourceName)) return { sourceName: operation.sourceName, approved: false, rejectionReason: "Outside this bounded role or explicitly forbidden." };
      const mapping = mappings.get(operation.sourceName);
      requireCondition(mapping, `Customer packet lacks a review decision for ${operation.sourceName}`);
      return { sourceName: operation.sourceName, approved: true, targetExposedName: `${importPacket.systemId}:${mapping.targetName}`, confirmedMode: mapping.mode, authorityAction: mapping.authorityAction, requiredContextSources: proposal.proposedContextSources.filter((item) => !item.includes(":") || item.endsWith(`:${operation.sourceName}`)) };
    }),
    contextChoices: proposal.proposedContextSources.map((sourceId) => ({ sourceId, approved: true })),
  };
}

function semanticSnapshot({ projection, receipt, ledgers, scored }) {
  return {
    roleTemplateId: receipt.session.roleTemplateId,
    status: projection.status,
    stages: projection.stages,
    blockers: [...receipt.exactBlockers].sort(),
    imports: ledgers.map((item) => ({ sourceKind: item.sourceKind, confirmationHash: item.confirmationHash, workPlanHash: item.workPlanHash, assistanceHash: item.assistanceHash, residualTotals: item.residualTotals })),
    measurements: { exactMappingProposalHits: scored.exactMappingProposalHits, exactAuthorityProposalHits: scored.exactAuthorityProposalHits, approvedOperations: scored.approvedOperations, rejectedOperations: scored.rejectedOperations, silentAuthorOnlyInjections: scored.silentAuthorOnlyInjections },
  };
}

function runFixture(fixtureValue, root) {
  const started = performance.now();
  const journey = new AssistedCommercialOnboardingJourney({ stateDirectory: root, now: () => FIXED_NOW });
  journey.saveBusinessIntake(fixtureValue.customerPacket.intake);
  const importResults = [];
  let exactMappingProposalHits = 0;
  let exactAuthorityProposalHits = 0;
  let approvedOperations = 0;
  let rejectedOperations = 0;
  for (const importPacket of fixtureValue.customerPacket.imports) {
    const record = journey.record(fixtureValue.customerPacket.intake.sessionId);
    const proposal = proposeOnboardingSystemImport({ intake: record.intake, systemId: importPacket.systemId, source: importPacket.source, provenance: importPacket.provenance });
    journey.recordSystemImportProposal({ sessionId: record.sessionId, proposal, source: importPacket.source });
    const proposedRecord = journey.record(record.sessionId);
    const entry = proposedRecord.systemImports.find((item) => item.proposal.proposalHash === proposal.proposalHash);
    const decisions = decisionsFor(proposal, importPacket);
    for (const choice of decisions.operationChoices) {
      if (!choice.approved) { rejectedOperations += 1; continue; }
      approvedOperations += 1;
      const suggestion = entry.reviewAssistance.operationSuggestions.find((item) => item.sourceName === choice.sourceName);
      if (suggestion.target.proposedExposedName === choice.targetExposedName) exactMappingProposalHits += 1;
      if (choice.confirmedMode !== "write" || suggestion.authority.proposedAction === choice.authorityAction) exactAuthorityProposalHits += 1;
    }
    journey.recordSystemImportConfirmation({ sessionId: record.sessionId, proposalHash: proposal.proposalHash, source: importPacket.source, decisions, confirmedBy: "Fictional role owner" });
    const confirmed = journey.record(record.sessionId).systemImports.find((item) => item.proposal.proposalHash === proposal.proposalHash);
    const residual = classifyOnboardingResidualWork({ workPlan: confirmed.workPlan, reviewAssistance: confirmed.reviewAssistance });
    importResults.push({ sourceKind: proposal.source.kind, confirmationHash: confirmed.confirmation.confirmationHash, workPlanHash: confirmed.workPlan.workPlanHash, assistanceHash: confirmed.reviewAssistance.assistanceHash, residualTotals: residual.totals });
  }
  const projection = journey.latest(fixtureValue.customerPacket.intake.sessionId);
  const record = journey.record(fixtureValue.customerPacket.intake.sessionId);
  const receipt = journey.readinessReceipt(record.sessionId);
  const activeMachineMs = Number((performance.now() - started).toFixed(3));
  const scored = { exactMappingProposalHits, exactAuthorityProposalHits, approvedOperations, rejectedOperations, silentAuthorOnlyInjections: 0 };
  const ledger = createOnboardingTeardownLedger({ record, projection, readinessReceipt: receipt, measurements: { activeMachineMs, productApiActions: 2 + fixtureValue.imports.length * 2, modelCalls: 0, spendUsd: 0, authorInterventions: 0, ...scored } });
  assertOnboardingTeardownLedger(ledger);
  requireCondition(projection.stages.executableComparisonEnvironmentReady === false && projection.stages.controlledActivationReady === false, `${fixtureValue.id} became falsely ready`);
  if (fixtureValue.expectedBoundary === "design-and-scaffold-only") {
    requireCondition(projection.roleAvailability.bindingDescriptorReview === false, "Frontend binding review became available");
    for (const blocker of projection.roleAvailability.blockers) requireCondition(receipt.exactBlockers.includes(blocker), "Frontend lifecycle blocker disappeared from the exact receipt");
  }
  const semantic = semanticSnapshot({ projection, receipt, ledgers: importResults, scored });
  return { projection, record, receipt, ledger, importResults, scored, semantic, semanticHash: digest(semantic), activeMachineMs };
}

function reloadInFreshProcess(root, sessionId) {
  const child = spawnSync(process.execPath, [THIS_FILE, "--reload", root, sessionId], { encoding: "utf8", env: { ...process.env, DAS_TEARDOWN_CHILD: "1" } });
  requireCondition(child.status === 0, `Fresh-process reload failed: ${child.stderr || child.stdout}`);
  return JSON.parse(child.stdout);
}

function childReload(root, sessionId) {
  const journey = new AssistedCommercialOnboardingJourney({ stateDirectory: root, now: () => FIXED_NOW });
  const projection = journey.latest(sessionId);
  const receipt = journey.readinessReceipt(sessionId);
  process.stdout.write(JSON.stringify({ status: projection.status, stages: projection.stages, blockers: [...receipt.exactBlockers].sort(), recordHash: journey.record(sessionId).recordHash, receiptHash: receipt.receiptHash }));
}

function execute() {
  requireCondition(!fs.existsSync(OUTPUT_ROOT), `Refusing to overwrite preserved DAS-010 evidence: ${OUTPUT_ROOT}`);
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true, mode: 0o700 });
  const fixtures = [supportFixture(), procurementFixture(), revopsFixture(), frontendFixture()];
  const protocol = {
    schemaVersion: "das.fresh-start-onboarding-teardown-protocol.v1",
    checkpoint: "DAS-010",
    hypothesis: "Every required onboarding fact can be attributed to approved customer material, an explicit role-owner confirmation, a deterministic DAS proposal, bounded engineer implementation, independent proof, or a precise blocker; source-grounded review assistance reduces author-only mapping work without widening authority or readiness.",
    fixtures: fixtures.map((item) => ({ id: item.id, customerPacketHash: digest(item.customerPacket), sealedOracleHash: digest(item.sealedOracle), expectedBoundary: item.expectedBoundary })),
    stopConditions: ["credential persisted", "authority widened", "unknown provenance used to advance", "source mutation accepted", "false execution or activation readiness", "paid call or network access"],
    modelCalls: 0,
    spendUsd: 0,
  };
  protocol.protocolHash = digest(protocol);
  writePrivate(path.join(OUTPUT_ROOT, "protocol.json"), protocol);
  const results = [];
  for (const fixtureValue of fixtures) {
    const fixtureRoot = path.join(OUTPUT_ROOT, "fixtures", fixtureValue.id);
    fs.mkdirSync(fixtureRoot, { recursive: true, mode: 0o700 });
    writePrivate(path.join(fixtureRoot, "customer-packet.json"), fixtureValue.customerPacket);
    writePrivate(path.join(fixtureRoot, "sealed-oracle.json"), fixtureValue.sealedOracle);
    const firstRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${fixtureValue.id}-a-`));
    const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${fixtureValue.id}-b-`));
    try {
      const first = runFixture(fixtureValue, firstRoot);
      const reloaded = reloadInFreshProcess(firstRoot, fixtureValue.intake.sessionId);
      requireCondition(reloaded.recordHash === first.record.recordHash && reloaded.receiptHash === first.receipt.receiptHash && reloaded.status === first.projection.status, `${fixtureValue.id} changed after fresh-process reload`);
      const replay = runFixture(fixtureValue, secondRoot);
      requireCondition(first.semanticHash === replay.semanticHash, `${fixtureValue.id} semantic result changed on exact fresh replay`);
      const result = {
        schemaVersion: "das.fresh-start-onboarding-teardown-result.v1",
        fixtureId: fixtureValue.id,
        expectedBoundary: fixtureValue.expectedBoundary,
        highestHonestStage: first.projection.status,
        roleAvailability: first.projection.roleAvailability,
        executionReady: first.projection.stages.executableComparisonEnvironmentReady,
        activationReady: first.projection.stages.controlledActivationReady,
        readinessBlockers: first.receipt.exactBlockers,
        ledgerMeasurements: first.ledger.measurements,
        generatedMappingAccuracy: first.scored.approvedOperations ? Number((first.scored.exactMappingProposalHits / first.scored.approvedOperations).toFixed(4)) : 1,
        generatedAuthorityAccuracy: first.scored.approvedOperations ? Number((first.scored.exactAuthorityProposalHits / first.scored.approvedOperations).toFixed(4)) : 1,
        manualBaselineTargetChoices: first.scored.approvedOperations,
        generatedExactTargetProposals: first.scored.exactMappingProposalHits,
        roleOwnerConfirmationsStillRequired: first.scored.approvedOperations,
        rejectedSourceOperations: first.scored.rejectedOperations,
        restart: { freshProcessReloadPassed: true, recordHash: reloaded.recordHash, receiptHash: reloaded.receiptHash },
        repeatability: { exactFreshReplayPassed: true, semanticHash: first.semanticHash },
        sourceKinds: fixtureValue.imports.map((item) => item.source.kind),
        importResults: first.importResults,
        ledgerHash: first.ledger.ledgerHash,
        modelCalls: 0,
        spendUsd: 0,
        boundary: first.ledger.boundary,
      };
      result.resultHash = digest(result);
      writePrivate(path.join(fixtureRoot, "knowledge-ledger.json"), first.ledger);
      writePrivate(path.join(fixtureRoot, "teardown-result.json"), result);
      results.push(result);
    } finally {
      fs.rmSync(firstRoot, { recursive: true, force: true });
      fs.rmSync(secondRoot, { recursive: true, force: true });
    }
  }
  const summary = {
    schemaVersion: "das.fresh-start-onboarding-teardown-summary.v1",
    protocolHash: protocol.protocolHash,
    results: results.map((result) => ({ fixtureId: result.fixtureId, expectedBoundary: result.expectedBoundary, highestHonestStage: result.highestHonestStage, sourceKinds: result.sourceKinds, generatedMappingAccuracy: result.generatedMappingAccuracy, generatedAuthorityAccuracy: result.generatedAuthorityAccuracy, meaningfulSetupUnits: result.ledgerMeasurements.meaningfulSetupUnits, generatedUnits: result.ledgerMeasurements.automationStatusCounts.generated ?? 0, customerDecisionUnits: result.ledgerMeasurements.automationStatusCounts["requires-ordinary-language-decision"] ?? 0, engineerUnits: result.ledgerMeasurements.automationStatusCounts["requires-engineering"] ?? 0, proofUnits: result.ledgerMeasurements.automationStatusCounts["requires-independent-proof"] ?? 0, unsupportedUnits: result.ledgerMeasurements.automationStatusCounts["blocked-unsupported"] ?? 0, silentAuthorOnlyInjections: result.ledgerMeasurements.silentAuthorOnlyInjections, freshProcessReloadPassed: result.restart.freshProcessReloadPassed, exactFreshReplayPassed: result.repeatability.exactFreshReplayPassed, executionReady: result.executionReady, activationReady: result.activationReady })),
    aggregate: {
      fixtures: results.length,
      positiveFullLifecycleRoleHypotheses: results.filter((item) => item.expectedBoundary === "full-lifecycle-role-but-unbound").length,
      deliberateLifecycleStopControls: results.filter((item) => item.expectedBoundary === "design-and-scaffold-only").length,
      approvedOperations: results.reduce((total, item) => total + item.manualBaselineTargetChoices, 0),
      exactTargetProposals: results.reduce((total, item) => total + item.generatedExactTargetProposals, 0),
      roleOwnerConfirmationsPreserved: results.reduce((total, item) => total + item.roleOwnerConfirmationsStillRequired, 0),
      rejectedDangerousOperations: results.reduce((total, item) => total + item.rejectedSourceOperations, 0),
      falseReadyFixtures: results.filter((item) => item.executionReady || item.activationReady).length,
      silentAuthorOnlyInjections: results.reduce((total, item) => total + item.ledgerMeasurements.silentAuthorOnlyInjections, 0),
      modelCalls: 0,
      spendUsd: 0,
    },
    evidenceBoundary: "Fresh fictional deterministic onboarding teardowns. Machine runtime is not human setup time. The experiment does not prove independent-user usability, executable unfamiliar-system bindings, customer value, setup-time reduction, activation or production reliability.",
  };
  summary.summaryHash = digest(summary);
  writePrivate(path.join(OUTPUT_ROOT, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[2] === "--reload") childReload(process.argv[3], process.argv[4]);
else execute();
