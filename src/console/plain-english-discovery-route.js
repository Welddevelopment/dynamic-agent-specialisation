import { digest } from "../core/canonical.js";
import { createDeterministicRoleDiscoveryPreviewProvider } from "../product/deterministic-role-discovery-preview.js";
import {
  assertProvisionalRoleContract,
  createServerVerifiedSystemImportReceipt,
  discoverRoleFromPlainEnglish,
} from "../product/plain-english-role-discovery.js";

const ROLE_LABELS = Object.freeze({
  "support-operations": "Support operations",
  "procurement-coverage": "Procurement coverage",
  "revenue-operations": "Revenue operations",
  "frontend-implementation": "Frontend implementation",
  unsupported: "Unsupported role preview",
});
const CONSOLE_FACT_PATHS = new Set([
  "input.ordinaryLanguageDescription",
  "role.title",
  "role.outcome",
  "role.completionRule",
  "systems.inventory",
  "work.inputs",
  "work.outputs",
  "success.measures",
  "success.observableReadyDefinition",
  "authority.allowedActions",
  "authority.repositoryWrites",
  "forbiddenActions.actions",
  "approvals.requiredActions",
  "approvals.pullRequestRequired",
  "approvals.mergeRequired",
  "approvals.deployRequired",
  "limits.monetary",
  "limits.actionLimits",
  "escalation.owner",
  "escalation.conditions",
  "frontend.componentPolicy",
  "frontend.requiredViewports",
  "execution.verifierBinding",
  "evaluation.representativeCases",
  "currentAgent.configuration",
]);
const SECRET_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\bBasic\s+[A-Za-z0-9+/=]{8,}|\bsk-[A-Za-z0-9_-]{8,}|-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----|\b(?:api[-_]?key|password|access[-_]?token|secret|credential)\s*[:=]\s*\S{6,})/i;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function clean(value, maximum = 4_000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function contextText(value, maximum, label, { singleLine = false } = {}) {
  const cleaned = clean(value, maximum).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  requireCondition(!SECRET_VALUE.test(cleaned), `Credential material is forbidden in ${label}`);
  return singleLine ? cleaned.replace(/\s+/g, " ") : cleaned;
}

function safeDisplayValue(value) {
  if (Array.isArray(value)) return value.slice(0, 40).map(safeDisplayValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/(?:hash|credential|secret|token|private|content|file|path)/i.test(key))
      .map(([key, child]) => [key, safeDisplayValue(child)]));
  }
  if (typeof value === "string") return value.slice(0, 1_000);
  return value ?? null;
}

function factLabel(path) {
  const exact = {
    "input.ordinaryLanguageDescription": "Customer description",
    "role.title": "Proposed role title",
    "role.outcome": "Proposed owned outcome",
    "role.completionRule": "Proposed completion rule",
    "systems.inventory": "Proposed system inventory",
    "success.measures": "Proposed success measures",
    "authority.allowedActions": "Allowed actions",
    "forbiddenActions.actions": "Forbidden actions",
    "approvals.requiredActions": "Approval-required actions",
    "limits.monetary": "Monetary or transaction limits",
    "escalation.owner": "Escalation owner",
    "escalation.conditions": "Escalation conditions",
    "execution.verifierBinding": "Independent verifier binding",
    "evaluation.representativeCases": "Representative evaluation cases",
    "currentAgent.configuration": "Current-agent baseline",
  };
  if (exact[path]) return exact[path];
  if (path.startsWith("systems.importedOperations.")) return "Pinned system operation proposal";
  if (path.startsWith("execution.adapters.")) return "Executable adapter evidence";
  return path.split(".").at(-1).replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("-", " ");
}

function sanitizedFact(fact) {
  const providerGenerated = fact.path !== "input.ordinaryLanguageDescription" && !fact.path.startsWith("systems.importedOperations.");
  const status = providerGenerated && fact.status === "extracted" ? "inferred-proposal" : fact.status;
  return Object.freeze({
    label: factLabel(fact.path),
    value: fact.path === "input.ordinaryLanguageDescription" ? "Supplied in this preview" : safeDisplayValue(fact.value),
    status,
    reviewRequired: fact.reviewRequired || status === "inferred-proposal",
    customerConfirmationRequired: fact.customerConfirmationRequired,
    independentVerificationRequired: fact.independentVerificationRequired,
    executable: false,
    note: clean(fact.note, 700),
    provenance: fact.provenance.map((source) => ({ sourceKind: clean(source.sourceKind, 120), label: clean(source.label, 240) })),
  });
}

function factValue(contract, path) {
  return contract.facts.find((fact) => fact.path === path)?.value;
}

function namedSystems(contract, record) {
  const proposed = factValue(contract, "systems.inventory");
  const names = [
    ...(Array.isArray(proposed) ? proposed : []),
    ...((record?.intake?.systems ?? []).map((system) => system.name)),
  ].map((name) => clean(name, 240)).filter(Boolean);
  return [...new Set(names)].slice(0, 40).map((name, index) => ({
    id: `system-${index + 1}`,
    name,
    kind: "customer system",
    access: "none",
    adapterStatus: "missing",
    contextSources: [],
    tools: [],
  }));
}

function verifiedSystemImportReceipts(record, sessionId) {
  if (!record) return [];
  requireCondition(record.sessionId === sessionId, "Recorded onboarding session does not match the discovery request");
  requireCondition(/^[a-f0-9]{64}$/.test(clean(record.recordHash, 128)), "Recorded onboarding session is missing its integrity hash");
  return (record.systemImports ?? []).map((entry, index) => createServerVerifiedSystemImportReceipt({
    proposal: entry.proposal,
    verification: {
      verifiedBy: "assisted-onboarding-journey",
      verificationId: `${sessionId}:${record.revision}:${entry.proposal.proposalId}`,
      verificationHash: digest({
        sessionId,
        revision: record.revision,
        recordHash: record.recordHash,
        importIndex: index,
        proposalHash: entry.proposal.proposalHash,
        recordedAt: entry.recordedAt,
      }),
    },
  }));
}

function sanitizedContract({ contract, input, record }) {
  requireCondition(contract.facts.every((fact) => CONSOLE_FACT_PATHS.has(fact.path) || fact.path.startsWith("systems.importedOperations.") || fact.path.startsWith("execution.adapters.")), "Discovery returned a fact outside the console's reviewed path registry");
  const groups = {
    safelyProposable: contract.facts.filter((fact) => fact.category === "proposable").map(sanitizedFact),
    consequentialConfirmation: contract.facts.filter((fact) => fact.category === "consequential-confirmation").map(sanitizedFact),
    executableEvidence: contract.facts.filter((fact) => fact.category === "executable-evidence").map(sanitizedFact),
  };
  const supported = contract.roleFamily.supported;
  const proposedTitle = supported ? clean(factValue(contract, "role.title"), 240) : "";
  const proposedOutcome = supported ? clean(factValue(contract, "role.outcome"), 2_000) : "";
  const handoffPermitted = supported && Boolean(proposedTitle && proposedOutcome);
  return Object.freeze({
    schemaVersion: "das.console-role-discovery-preview.v1",
    status: contract.status,
    provider: {
      id: contract.provider.id,
      version: contract.provider.version,
      kind: "deterministic-structural-preview",
      modelCalls: 0,
      externalRequests: 0,
      spendUsd: 0,
    },
    roleFamily: {
      id: contract.roleFamily.proposed,
      label: ROLE_LABELS[contract.roleFamily.proposed] ?? ROLE_LABELS.unsupported,
      supported,
      confidence: contract.roleFamily.confidence,
      status: contract.roleFamily.status,
    },
    previewWarning: "Deterministic structural preview only: keyword routing and predefined safe proposals, not intelligent or model-backed role extraction.",
    factGroups: groups,
    clarificationQueue: contract.clarificationQueue.map((item) => ({
      rank: item.rank,
      id: item.id,
      question: item.question,
      blocks: [...item.blocks],
      informationPriority: item.informationPriority,
    })),
    deferredClarificationCount: contract.deferredClarificationCount,
    engineeringBlockers: [...contract.engineeringBlockers],
    warnings: [...contract.warnings],
    recordedSystemProposals: {
      included: (record?.systemImports?.length ?? 0) > 0,
      count: record?.systemImports?.length ?? 0,
      boundary: "Only integrity-checked proposals already recorded in the selected local onboarding session were included. Browser-supplied proposals are not accepted.",
    },
    authorizations: structuredClone(contract.authorizations),
    readiness: structuredClone(contract.readiness),
    safeHandoff: {
      permitted: handoffPermitted,
      company: {
        name: input.companyContext.companyName,
        industry: input.companyContext.industry,
        operatingContext: input.companyContext.operatingContext,
      },
      role: {
        templateId: supported ? contract.roleFamily.proposed : null,
        title: proposedTitle,
        outcome: proposedOutcome,
      },
      systems: handoffPermitted ? namedSystems(contract, record) : [],
      boundary: "This handoff may populate only company context, the supported role proposal, and named unbound systems. It does not confirm policies, authority, limits, approvals, escalation, credentials, adapters, verifiers, evidence, spend, comparison readiness, or activation.",
    },
    evidenceBoundary: contract.evidenceBoundary,
  });
}

export async function previewPlainEnglishRoleForConsole({ journey, input }) {
  requireCondition(journey && typeof journey.record === "function", "Role discovery needs the assisted-onboarding journey");
  const sessionId = clean(input?.sessionId, 120);
  let record = null;
  if (sessionId) record = journey.record(sessionId);
  const provider = createDeterministicRoleDiscoveryPreviewProvider();
  const companyContext = {
    companyName: contextText(input?.companyName, 240, "company name", { singleLine: true }),
    industry: contextText(input?.industry, 200, "industry", { singleLine: true }),
    operatingContext: contextText(input?.operatingContext, 4_000, "operating context"),
  };
  const discoveryInput = {
    description: input?.description,
    companyContext,
    verifiedSystemImportReceipts: verifiedSystemImportReceipts(record, sessionId),
    approvedArtifacts: [],
    customerConfirmations: [],
  };
  const contract = await discoverRoleFromPlainEnglish({ provider, input: discoveryInput });
  assertProvisionalRoleContract(contract);
  return sanitizedContract({ contract, input: discoveryInput, record });
}
