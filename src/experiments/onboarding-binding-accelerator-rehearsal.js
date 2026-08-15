import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { createCommercialSupportPack } from "../product/commercial-support-pack.js";
import { createCommercialBindingScaffold } from "../product/commercial-binding-kit.js";
import { proposeOnboardingSystemImport } from "../product/onboarding-system-import.js";
import { confirmOnboardingSystemImport, createOnboardingBindingWorkPlan, writeOnboardingBindingWorkPlan } from "../product/onboarding-binding-accelerator.js";

const outputRoot = path.resolve("artifacts/onboarding/binding-accelerator-v1");
if (fs.existsSync(outputRoot)) throw new Error(`Refusing to overwrite preserved DAS-007 evidence: ${outputRoot}`);

const pack = createCommercialSupportPack();
const intake = pack.intake;
const systemId = intake.systems[0].id;
const scaffold = createCommercialBindingScaffold({ intake, roleDraft: pack.roleDraft });

const fixtures = [
  {
    id: "openapi",
    source: {
      kind: "openapi",
      document: {
        openapi: "3.1.0",
        info: { title: "Fictional customer support API", version: "1.0.0" },
        servers: [{ url: "https://support.example.test" }],
        paths: {
          "/tickets/{ticketId}": { get: { operationId: "getTicket", parameters: [{ name: "ticketId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" } } } },
          "/tickets/{ticketId}/draft": { post: { operationId: "draftReply", parameters: [{ name: "ticketId", in: "path", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["message"], properties: { message: { type: "string" } }, additionalProperties: false } } } }, responses: { "200": { description: "ok" } } } },
        },
      },
    },
    sourceNames: { read: "getTicket", write: "draftReply" },
    provenance: { acquisition: "engineer-local-fixture", label: "DAS-007 fictional OpenAPI fixture" },
  },
  {
    id: "mcp",
    source: {
      kind: "mcp-tools-list",
      serverId: "fictional-customer-support",
      serverVersion: "1.0.0",
      toolsList: {
        tools: [
          { name: "get_ticket", annotations: { readOnlyHint: true }, inputSchema: { type: "object", required: ["ticketId"], properties: { ticketId: { type: "string" } }, additionalProperties: false } },
          { name: "draft_reply", inputSchema: { type: "object", required: ["ticketId", "message", "requestId"], properties: { ticketId: { type: "string" }, message: { type: "string" }, requestId: { type: "string" } }, additionalProperties: false } },
        ],
      },
    },
    sourceNames: { read: "get_ticket", write: "draft_reply" },
    provenance: { acquisition: "engineer-local-fixture", label: "DAS-007 fictional MCP fixture" },
  },
];

fs.mkdirSync(outputRoot, { recursive: false, mode: 0o700 });
const rows = [];
for (const fixture of fixtures) {
  const proposal = proposeOnboardingSystemImport({ intake, systemId, source: fixture.source, provenance: fixture.provenance });
  const decisions = {
    operationChoices: [
      { sourceName: fixture.sourceNames.read, approved: true, targetExposedName: `${systemId}:read-ticket`, confirmedMode: "read", authorityAction: null, requiredContextSources: ["ticket-thread"] },
      { sourceName: fixture.sourceNames.write, approved: true, targetExposedName: `${systemId}:draft-response`, confirmedMode: "write", authorityAction: "draft-support-response", requiredContextSources: ["ticket-thread", "support-policy"] },
    ],
    contextChoices: proposal.proposedContextSources.map((sourceId) => ({ sourceId, approved: true })),
  };
  const confirmation = confirmOnboardingSystemImport({ proposal, intake, source: fixture.source, decisions, confirmedBy: "fictional-rehearsal-owner" });
  const workPlan = createOnboardingBindingWorkPlan({ proposal, confirmation, intake, source: fixture.source, bindingScaffold: scaffold });
  const written = writeOnboardingBindingWorkPlan({ directory: path.join(outputRoot, fixture.id), proposal, confirmation, workPlan });
  rows.push({
    mode: fixture.id,
    proposalHash: proposal.proposalHash,
    confirmationHash: confirmation.confirmationHash,
    workPlanHash: workPlan.workPlanHash,
    approvedOperations: workPlan.approvedOperations.length,
    setupCoverage: workPlan.authoring,
    exactRemainingWorkCount: workPlan.exactRemainingWork.length,
    fileHashes: written.fileHashes,
    executable: false,
  });
}

const summary = {
  schemaVersion: "das.onboarding-binding-accelerator-rehearsal.v1",
  checkpoint: "DAS-007",
  modes: rows,
  modelCalls: 0,
  spendUsd: 0,
  verdict: "Both approved OpenAPI and MCP materials produced digest-bound reviewed adapter and independent-verifier scaffolds with exact omissions. Neither path produced an executable binding or independent proof.",
  evidenceBoundary: "Fictional deterministic local preparation evidence only. It does not prove compilation against an unknown customer system, human setup-time reduction, customer compatibility, verifier correctness, acceptance, activation, demand or production reliability.",
};
summary.summaryHash = digest(summary);
fs.writeFileSync(path.join(outputRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600, flag: "wx" });
console.log(JSON.stringify(summary, null, 2));
