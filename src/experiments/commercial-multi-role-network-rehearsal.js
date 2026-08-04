import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { runCommercialNetworkRehearsal } from "../product/commercial-network-rehearsal.js";
import { CommercialRevopsToolHost, CommercialRevopsVerifier, createCommercialRevopsPack } from "../product/commercial-revops-pack.js";
import { CommercialSupportToolHost, CommercialSupportVerifier, createCommercialSupportPack } from "../product/commercial-support-pack.js";
import { commercialRevopsCases } from "../worlds/realistic-revops-cases.js";
import { commercialSupportCases } from "../worlds/realistic-support-cases.js";

const supportTask = commercialSupportCases.development[1];
const support = await runCommercialNetworkRehearsal({
  roleId: "support",
  pack: createCommercialSupportPack(),
  task: supportTask,
  ToolHost: CommercialSupportToolHost,
  Verifier: CommercialSupportVerifier,
  processEpoch: "support-network-rehearsal-v1",
  decisions: [
    { kind: "tool", name: "support-sandbox:apply-service-credit", input: { ticketId: "ticket-111", amountUsd: 38, reason: "duplicate-charge", idempotencyKey: `${supportTask.id}:ticket-111:credit` } },
    { kind: "tool", name: "support-sandbox:draft-response", input: { ticketId: "ticket-111", responseCode: "credit-applied", idempotencyKey: `${supportTask.id}:ticket-111:response` } },
    { kind: "tool", name: "support-sandbox:close-ticket", input: { ticketId: "ticket-111", resolutionCode: "credit-resolved", idempotencyKey: `${supportTask.id}:ticket-111:close` } },
    { kind: "tool", name: "support-sandbox:merge-duplicate-ticket", input: { ticketId: "ticket-112", canonicalTicketId: "canonical-112", idempotencyKey: `${supportTask.id}:ticket-112:merge` } },
    { kind: "complete" },
  ],
});

const revopsTask = commercialRevopsCases.development[1];
const revops = await runCommercialNetworkRehearsal({
  roleId: "revops",
  pack: createCommercialRevopsPack(),
  task: revopsTask,
  ToolHost: CommercialRevopsToolHost,
  Verifier: CommercialRevopsVerifier,
  processEpoch: "revops-network-rehearsal-v1",
  decisions: [
    { kind: "tool", name: "revops-sandbox:merge-duplicate-lead", input: { leadId: "lead-r111", canonicalLeadId: "lead-canonical-111", idempotencyKey: `${revopsTask.id}:lead-r111:merge` } },
    { kind: "tool", name: "revops-sandbox:set-lead-disposition", input: { leadId: "lead-r112", disposition: "do-not-contact", idempotencyKey: `${revopsTask.id}:lead-r112:suppress` } },
    { kind: "complete" },
  ],
});

const receipt = {
  schemaVersion: "das.commercial-multi-role-network-rehearsal.v1",
  roles: [support, revops].map(({ externalState, ...item }) => ({ ...item, intendedBusinessWrites: Object.values(externalState).filter(Array.isArray).flat().filter((entry) => entry?.idempotencyKey).length, deniedAttempts: externalState.deniedAttempts.length })),
  modelCalls: 0,
  spendUsd: 0,
  evidenceBoundary: "Disposable fictional end-to-end network rehearsals using deterministic scripted decisions. They validate role-specific packaging, activation, runtime, independent external-state verification, durable status, monitoring and duplicate suppression; they are not model comparisons or customer evidence.",
};
receipt.receiptHash = digest(receipt);
const output = path.resolve("artifacts/commercial/multi-role-network-activation-rehearsal.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
