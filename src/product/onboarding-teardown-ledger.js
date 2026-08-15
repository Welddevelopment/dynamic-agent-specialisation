import { digest } from "../core/canonical.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }
function stable(value) { return JSON.parse(JSON.stringify(value)); }

function row({ id, stage, itemPath, owner, provenanceStatus, decisionKind = "none", automationStatus, consequential = false, usedToAdvance = false, executableEvidence = false, authorityGranted = false, detail = null, artifactHash = null }) {
  return { id, stage, itemPath, owner, provenanceStatus, decisionKind, automationStatus, consequential, usedToAdvance, executableEvidence, authorityGranted, credentialValuePresent: false, detail, artifactHash };
}

function intakeRows(record) {
  return (record.intakeProvenance?.facts ?? []).map((fact) => row({
    id: `intake:${fact.path}`,
    stage: "business-intake",
    itemPath: fact.path,
    owner: fact.status === "customer-supplied" ? "customer-role-owner" : fact.status === "customer-declaration-not-proof" ? "customer-role-owner" : "das",
    provenanceStatus: fact.status,
    decisionKind: fact.status === "customer-supplied" ? "confirm" : "none",
    automationStatus: fact.status === "customer-supplied" ? "requires-ordinary-language-decision" : fact.status === "role-template-default" || fact.status === "das-safe-default" ? "generated" : "blocked-unknown",
    consequential: /authority|forbidden|approval|limit|outcome|success|verifier|escalation/i.test(fact.path),
    usedToAdvance: fact.valuePresent,
    detail: fact.valuePresent ? "Normalized value is present." : "Value remains absent or empty.",
    artifactHash: record.intakeProvenance.provenanceHash,
  }));
}

function importRows(record) {
  return (record.systemImports ?? []).flatMap((item, importIndex) => {
    const prefix = `import:${importIndex + 1}:${item.systemId}`;
    const review = item.reviewAssistance;
    const reviewRows = review ? review.operationSuggestions.flatMap((operation) => [
      row({ id: `${prefix}:${operation.sourceName}:mapping-proposal`, stage: "system-import-review", itemPath: `operations.${operation.sourceName}.target`, owner: "das", provenanceStatus: "das-proposal", automationStatus: operation.target.proposedExposedName ? "generated" : "blocked-unknown", consequential: true, detail: operation.target.status, artifactHash: review.assistanceHash }),
      row({ id: `${prefix}:${operation.sourceName}:mapping-confirmation`, stage: "system-import-review", itemPath: `operations.${operation.sourceName}.target.confirmation`, owner: "customer-role-owner", provenanceStatus: item.confirmation ? "customer-confirmed" : "unknown", decisionKind: "confirm", automationStatus: "requires-ordinary-language-decision", consequential: true, usedToAdvance: Boolean(item.confirmation), detail: "A source-grounded mapping proposal never self-confirms.", artifactHash: item.confirmation?.confirmationHash ?? null }),
      row({ id: `${prefix}:${operation.sourceName}:mode-confirmation`, stage: "system-import-review", itemPath: `operations.${operation.sourceName}.mode`, owner: "customer-role-owner", provenanceStatus: item.confirmation ? "customer-confirmed" : "unknown", decisionKind: "confirm", automationStatus: "requires-ordinary-language-decision", consequential: true, usedToAdvance: Boolean(item.confirmation), detail: operation.mode.status, artifactHash: item.confirmation?.confirmationHash ?? null }),
      ...(operation.mode.proposed === "write" ? [
        row({ id: `${prefix}:${operation.sourceName}:authority-proposal`, stage: "system-import-review", itemPath: `operations.${operation.sourceName}.authority`, owner: "das", provenanceStatus: "das-proposal", automationStatus: operation.authority.proposedAction ? "generated" : "blocked-unknown", consequential: true, detail: operation.authority.status, artifactHash: review.assistanceHash }),
        row({ id: `${prefix}:${operation.sourceName}:authority-confirmation`, stage: "system-import-review", itemPath: `operations.${operation.sourceName}.authority.confirmation`, owner: "customer-role-owner", provenanceStatus: item.confirmation ? "customer-confirmed" : "unknown", decisionKind: "confirm", automationStatus: "requires-ordinary-language-decision", consequential: true, usedToAdvance: Boolean(item.confirmation), authorityGranted: false, detail: "Confirms an existing saved boundary; grants no runtime authority.", artifactHash: item.confirmation?.confirmationHash ?? null }),
      ] : []),
    ]) : [];
    const workRows = (item.workPlan?.authoring?.inventory ?? []).map((entry) => {
      const completed = ["generated", "confirmed", "confirmed-existing-only"].includes(entry.status);
      const proof = entry.status === "required-independent-proof" || entry.owner === "independent-verifier";
      return row({
        id: `${prefix}:work:${entry.id}`,
        stage: entry.id === "acceptance-campaign" ? "binding-acceptance" : entry.id.startsWith("verifier:") ? "verifier-definition" : "binding-engineering",
        itemPath: entry.id,
        owner: proof ? "independent-verifier" : entry.owner === "customer" ? "customer-role-owner" : entry.owner,
        provenanceStatus: completed ? entry.status : proof ? "unknown" : "engineer-required",
        decisionKind: completed ? "none" : proof ? "prove" : "implement",
        automationStatus: completed ? "generated" : proof ? "requires-independent-proof" : entry.id.startsWith("coverage:") ? "blocked-unsupported" : "requires-engineering",
        consequential: /authority|idempotency|reconciliation|verifier|acceptance/i.test(entry.id),
        usedToAdvance: completed,
        executableEvidence: false,
        authorityGranted: false,
        detail: entry.detail,
        artifactHash: item.workPlan.workPlanHash,
      });
    });
    return [...reviewRows, ...workRows];
  });
}

export function createOnboardingTeardownLedger({ record, projection, readinessReceipt, measurements = {} }) {
  requireCondition(record?.schemaVersion === "das.assisted-onboarding-record.v1" && projection?.sessionId === record.sessionId, "Teardown ledger needs one exact onboarding record and projection");
  requireCondition(readinessReceipt?.session?.recordHash === record.recordHash, "Teardown ledger readiness receipt belongs to another record");
  const rows = [...intakeRows(record), ...importRows(record)];
  const usedRows = rows.filter((item) => item.usedToAdvance);
  const traceableUsed = usedRows.filter((item) => item.provenanceStatus !== "unknown" && item.automationStatus !== "blocked-unknown").length;
  const authorOnly = rows.filter((item) => item.owner === "author-only" || (item.usedToAdvance && item.provenanceStatus === "unknown"));
  const counts = Object.fromEntries([...new Set(rows.map((item) => item.automationStatus))].sort().map((status) => [status, rows.filter((item) => item.automationStatus === status).length]));
  const ledger = {
    schemaVersion: "das.onboarding-teardown-ledger.v1",
    sessionId: record.sessionId,
    revision: record.revision,
    recordHash: record.recordHash,
    readinessReceiptHash: readinessReceipt.receiptHash,
    rows,
    measurements: {
      ...stable(measurements),
      meaningfulSetupUnits: rows.length,
      usedToAdvanceUnits: usedRows.length,
      traceableUsedToAdvanceUnits: traceableUsed,
      provenanceCoverage: usedRows.length ? Number((traceableUsed / usedRows.length).toFixed(4)) : 1,
      preciseUnknownOrBlockedUnits: rows.filter((item) => item.provenanceStatus === "unknown" || item.automationStatus === "blocked-unknown").length,
      silentAuthorOnlyInjections: authorOnly.length,
      automationStatusCounts: counts,
      executableEvidenceRows: rows.filter((item) => item.executableEvidence).length,
      authorityGrantedRows: rows.filter((item) => item.authorityGranted).length,
      credentialValueRows: rows.filter((item) => item.credentialValuePresent).length,
    },
    exactAuthorOnlyRows: authorOnly.map((item) => item.id),
    boundary: "Machine-observed onboarding provenance and residual-work ledger. Active machine time is not human setup time. Customer confirmations are not DAS automation, and generated scaffolds are not executable evidence.",
  };
  ledger.ledgerHash = digest(ledger);
  return Object.freeze(ledger);
}

export function assertOnboardingTeardownLedger(ledger) {
  requireCondition(ledger?.schemaVersion === "das.onboarding-teardown-ledger.v1" && ledger.ledgerHash === digest(withoutHash(ledger, "ledgerHash")), "Onboarding teardown ledger integrity mismatch");
  requireCondition(ledger.measurements.silentAuthorOnlyInjections === 0 && ledger.exactAuthorOnlyRows.length === 0, "Onboarding teardown used silent author-only knowledge");
  requireCondition(ledger.measurements.credentialValueRows === 0 && ledger.measurements.authorityGrantedRows === 0, "Onboarding teardown persisted credentials or granted authority");
  return true;
}
