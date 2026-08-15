import { digest } from "../core/canonical.js";
import { normalizeCommercialIntake } from "./commercial-intake.js";
import { assertOnboardingSystemImportProposal } from "./onboarding-system-import.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }
function clean(value, maximum = 700) { return String(value ?? "").trim().slice(0, maximum); }
function unique(values) { return [...new Set(values)]; }

const TOKEN_ALIASES = Object.freeze({
  tickets: "case", ticket: "case", cases: "case", demands: "demand", warehouses: "warehouse",
  orders: "order", purchases: "purchase", suppliers: "supplier", offers: "offer",
  leads: "lead", contacts: "contact", accounts: "account", territories: "territory",
  replies: "response", reply: "response", messages: "response", message: "response",
  owners: "owner", assignments: "assign", assigned: "assign",
  incidents: "incident", escalations: "escalation", duplicates: "duplicate",
  stage: "draft", staged: "draft", staging: "draft",
});

const ACTION_TOKENS = new Set([
  "get", "read", "fetch", "retrieve", "list", "search", "find", "lookup", "look",
  "create", "add", "post", "put", "patch", "update", "set", "apply",
  "prepare", "make", "link", "merge", "close", "route", "submit", "operation",
  "record", "records", "api", "tool", "tools", "by", "for", "the", "a", "an",
]);

const HIGH_SIGNAL_TOKENS = new Set([
  "response", "adjustment", "credit", "escalation", "incident", "duplicate", "owner", "draft",
  "account", "disposition", "follow", "purchase", "transfer", "inventory", "policy",
  "consent", "territory", "supplier", "warehouse", "contact", "article", "knowledge",
]);

function tokens(value, { keepActions = false } = {}) {
  const expanded = clean(value, 2_000)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((token) => TOKEN_ALIASES[token] ?? token)
    .filter((token) => token.length > 1);
  return new Set(expanded.filter((token) => keepActions || !ACTION_TOKENS.has(token)));
}

function overlap(left, right) {
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  return intersection / Math.max(left.size, right.size);
}

function operationSimilarity(source, target) {
  const sourceName = tokens(source.sourceName);
  const targetName = tokens(target.name);
  const sourceAll = tokens(`${source.sourceName} ${source.description}`);
  const targetAll = tokens(`${target.name} ${target.description}`);
  const nameScore = overlap(sourceName, targetName);
  const descriptionScore = overlap(sourceAll, targetAll);
  const highSignalMatches = [...sourceAll].filter((token) => HIGH_SIGNAL_TOKENS.has(token) && targetAll.has(token)).length;
  return Number(Math.min(1, nameScore * 0.65 + descriptionScore * 0.2 + Math.min(0.45, highSignalMatches * 0.45)).toFixed(4));
}

function authoritySimilarity(target, action) {
  return Number(overlap(tokens(target.name), tokens(action)).toFixed(4));
}

function rankedUnique(rows, minimum = 0.25, margin = 0.12) {
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const first = sorted[0] ?? null;
  const second = sorted[1] ?? null;
  const uniqueWinner = Boolean(first && first.score >= minimum && (!second || first.score - second.score >= margin));
  return { sorted, first, second, uniqueWinner };
}

function contextSuggestions(operation, proposal, system, target) {
  const operationTokens = tokens(`${operation.sourceName} ${operation.description} ${target?.name ?? ""} ${target?.description ?? ""}`);
  const imported = proposal.proposedContextSources.filter((item) => item.endsWith(`:${operation.sourceName}`));
  const customer = system.contextSources
    .map((sourceId) => ({ sourceId, score: overlap(operationTokens, tokens(sourceId)) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.sourceId.localeCompare(b.sourceId))
    .map((item) => item.sourceId);
  return unique([...customer, ...imported]).sort();
}

function schemaPropertyPointers(schema, prefix = "") {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
  const rows = [];
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    const pointer = `${prefix}/${name.replace(/~/g, "~0").replace(/\//g, "~1")}`;
    rows.push({ name, pointer });
    rows.push(...schemaPropertyPointers(child, pointer));
  }
  for (const child of [...(schema.allOf ?? []), ...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) rows.push(...schemaPropertyPointers(child, prefix));
  if (schema.items) rows.push(...schemaPropertyPointers(schema.items, `${prefix}/0`));
  return rows;
}

function idempotencyProposal(operation, sourceKind) {
  const candidates = schemaPropertyPointers(operation.inputSchema)
    .filter((item) => /(?:idempot|request.?id|correlation.?id|dedup)/i.test(item.name))
    .map((item) => ({
      name: item.name,
      pointer: item.pointer,
      location: sourceKind === "openapi" && item.pointer.startsWith("/headers/") ? "header" : "input-field",
    }));
  return {
    status: candidates.length === 1 ? "source-candidate-needs-engineer-binding" : candidates.length > 1 ? "multiple-source-candidates-need-decision" : "missing-source-evidence",
    candidates,
    implemented: false,
    customerDecisionRequired: false,
    engineerDecisionRequired: true,
  };
}

function reconciliationProposal(operation, proposal) {
  const sourceTokens = tokens(`${operation.sourceName} ${operation.description}`);
  const candidates = proposal.operations
    .filter((candidate) => candidate.sourceName !== operation.sourceName && candidate.modeProposal.value === "read")
    .map((candidate) => ({
      sourceName: candidate.sourceName,
      score: Number(overlap(sourceTokens, tokens(`${candidate.sourceName} ${candidate.description}`)).toFixed(4)),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.sourceName.localeCompare(b.sourceName));
  const ranked = rankedUnique(candidates.map((item) => ({ id: item.sourceName, ...item })), 0.25, 0.12);
  return {
    status: ranked.uniqueWinner ? "source-candidate-needs-mapping-and-assertions" : candidates.length ? "ambiguous-source-candidates-need-engineer-decision" : "missing-source-readback-operation",
    proposedReadOperation: ranked.uniqueWinner ? ranked.first.sourceName : null,
    candidates,
    inputMapImplemented: false,
    assertionsImplemented: false,
    independentlyVerified: false,
  };
}

function assistedModeProposal(operation) {
  if (operation.modeProposal.value !== "review-required") return operation.modeProposal.value;
  const raw = clean(operation.sourceName).replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const first = TOKEN_ALIASES[raw[0]] ?? raw[0];
  if (["get", "read", "fetch", "retrieve", "list", "search", "find", "lookup", "status", "state", "catalogue", "queue"].includes(first)) return "read";
  if (["create", "add", "post", "put", "patch", "update", "set", "apply", "draft", "prepare", "make", "link", "merge", "close", "route", "submit", "compose", "open", "assign", "attach", "grant", "resolve"].includes(first)) return "write";
  return null;
}

function targetCandidates(operation, system, proposedMode) {
  return system.tools
    .filter((target) => !proposedMode || target.mode === proposedMode)
    .map((target) => ({ id: `${system.id}:${target.name}`, mode: target.mode, score: operationSimilarity(operation, target) }));
}

function assignUniqueTargets(provisional) {
  const available = new Set(provisional.flatMap((item) => item.candidates.map((candidate) => candidate.id)));
  const unassigned = new Set(provisional.map((item) => item.operation.sourceName));
  const assignments = new Map();
  while (unassigned.size && available.size) {
    const choices = provisional.filter((item) => unassigned.has(item.operation.sourceName)).map((item) => {
      const ranked = item.candidates.filter((candidate) => available.has(candidate.id)).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      const first = ranked[0] ?? null;
      const second = ranked[1] ?? null;
      return { sourceName: item.operation.sourceName, first, confidence: first ? first.score - (second?.score ?? 0) : -1 };
    }).filter((item) => item.first?.score >= 0.25).sort((a, b) => b.confidence - a.confidence || b.first.score - a.first.score || a.sourceName.localeCompare(b.sourceName));
    if (!choices.length) break;
    const selected = choices[0];
    assignments.set(selected.sourceName, selected.first.id);
    unassigned.delete(selected.sourceName);
    available.delete(selected.first.id);
  }
  return assignments;
}

function targetProposal(operation, candidates, assignedTarget) {
  const ranked = { sorted: [...candidates].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)) };
  const assigned = ranked.sorted.find((item) => item.id === assignedTarget) ?? null;
  return {
    status: assigned ? "unique-global-proposal-needs-customer-confirmation" : candidates.some((item) => item.score > 0) ? "ambiguous-needs-customer-decision" : "unresolved-needs-customer-mapping",
    proposedExposedName: assigned?.id ?? null,
    score: assigned?.score ?? null,
    alternatives: ranked.sorted.slice(0, 5).map(({ id, mode, score }) => ({ exposedName: id, mode, score })),
    customerConfirmationRequired: true,
  };
}

function authorityProposal(intake, target, mode) {
  if (mode === "read") return { status: "not-applicable", proposedAction: null, alternatives: [], runtimeGrant: false, customerConfirmationRequired: false };
  if (!target) return { status: "blocked-until-operation-mapped", proposedAction: null, alternatives: [], runtimeGrant: false, customerConfirmationRequired: true };
  const targetName = target.split(":").at(-1);
  const actions = [
    ...intake.authority.allowedActions.map((action) => ({ id: action, classification: "already-declared-allowed-action" })),
    ...intake.authority.approvalActions.map((action) => ({ id: action, classification: "already-declared-approval-required-action" })),
  ].map((item) => ({ ...item, score: authoritySimilarity({ name: targetName }, item.id) }));
  const ranked = rankedUnique(actions, 0.25, 0.12);
  return {
    status: ranked.uniqueWinner ? "existing-authority-proposal-needs-customer-confirmation" : actions.some((item) => item.score > 0) ? "ambiguous-existing-authority-needs-customer-decision" : "unresolved-existing-authority-needs-customer-decision",
    proposedAction: ranked.uniqueWinner ? ranked.first.id : null,
    alternatives: ranked.sorted.slice(0, 6).map(({ id, classification, score }) => ({ action: id, classification, score })),
    runtimeGrant: false,
    customerConfirmationRequired: true,
  };
}

export function createOnboardingReviewAssistance({ proposal, intake: input, source }) {
  assertOnboardingSystemImportProposal({ proposal, intake: input, source });
  const intake = normalizeCommercialIntake(input);
  const system = intake.systems.find((item) => item.id === proposal.systemId);
  requireCondition(system, `Review assistance system is missing: ${proposal.systemId}`);
  const provisional = proposal.operations.map((operation) => {
    const proposedMode = assistedModeProposal(operation);
    return { operation, proposedMode, candidates: targetCandidates(operation, system, proposedMode) };
  });
  const assignments = assignUniqueTargets(provisional);
  const operationSuggestions = provisional.map(({ operation, proposedMode, candidates }) => {
    const target = targetProposal(operation, candidates, assignments.get(operation.sourceName));
    const targetTool = target.proposedExposedName ? system.tools.find((item) => `${system.id}:${item.name}` === target.proposedExposedName) : null;
    const finalProposedMode = proposedMode ?? targetTool?.mode ?? null;
    const write = finalProposedMode === "write";
    return {
      sourceName: operation.sourceName,
      target,
      mode: {
        status: operation.modeProposal.value === "review-required" ? "proposal-needs-customer-confirmation" : "source-classification-needs-customer-confirmation",
        proposed: finalProposedMode,
        basis: operation.modeProposal.basis,
        customerConfirmationRequired: true,
      },
      authority: authorityProposal(intake, target.proposedExposedName, finalProposedMode),
      context: {
        proposedSourceIds: contextSuggestions(operation, proposal, system, targetTool),
        customerConfirmationRequired: true,
      },
      writeSafety: write ? {
        idempotency: idempotencyProposal(operation, proposal.source.kind),
        reconciliation: reconciliationProposal(operation, proposal),
      } : null,
      approved: false,
      executable: false,
    };
  });
  const proposedTargets = new Set(operationSuggestions.map((item) => item.target.proposedExposedName).filter(Boolean));
  const unresolved = operationSuggestions.flatMap((item) => [
    ...(!item.target.proposedExposedName ? [`${item.sourceName}: target operation needs a customer decision`] : []),
    ...(!item.mode.proposed ? [`${item.sourceName}: read/write meaning needs a customer decision`] : []),
    ...(item.mode.proposed === "write" && !item.authority.proposedAction ? [`${item.sourceName}: existing authority mapping needs a customer decision`] : []),
    ...(item.writeSafety?.idempotency.status === "missing-source-evidence" ? [`${item.sourceName}: source material exposes no clear idempotency field or header`] : []),
    ...(item.writeSafety?.reconciliation.status === "missing-source-readback-operation" ? [`${item.sourceName}: source material exposes no plausible read-back operation`] : []),
  ]);
  const assistance = {
    schemaVersion: "das.onboarding-review-assistance.v1",
    proposalHash: proposal.proposalHash,
    intakeHash: digest(intake),
    systemId: proposal.systemId,
    source: { kind: proposal.source.kind, sourceHash: proposal.source.sourceHash },
    status: "deterministic-proposals-awaiting-customer-review",
    operationSuggestions,
    unmappedRoleOperations: system.tools.map((item) => `${system.id}:${item.name}`).filter((item) => !proposedTargets.has(item)),
    unresolved,
    decisionCounts: {
      operationApproval: operationSuggestions.length,
      targetMapping: operationSuggestions.length,
      modeConfirmation: operationSuggestions.length,
      authorityConfirmation: operationSuggestions.filter((item) => item.mode.proposed === "write").length,
      contextConfirmation: operationSuggestions.length,
      totalConsequentialConfirmations: operationSuggestions.reduce((total, item) => total + 4 + (item.mode.proposed === "write" ? 1 : 0), 0),
    },
    authorizations: { modelSpend: false, execution: false, customerWrites: false, activation: false },
    evidenceBoundary: "Deterministic review assistance only. Similar names and source schemas can propose mappings and write-safety candidates, but the customer must confirm business semantics and existing authority; an engineer must still implement and prove the customer-local adapter, reconciliation, verifier and acceptance campaign.",
  };
  assistance.assistanceHash = digest(assistance);
  return Object.freeze(assistance);
}

export function assertOnboardingReviewAssistance({ assistance, proposal, intake, source }) {
  requireCondition(assistance?.schemaVersion === "das.onboarding-review-assistance.v1" && assistance.assistanceHash === digest(withoutHash(assistance, "assistanceHash")), "Onboarding review assistance integrity mismatch");
  const expected = createOnboardingReviewAssistance({ proposal, intake, source });
  requireCondition(assistance.assistanceHash === expected.assistanceHash, "Onboarding review assistance no longer matches its exact proposal, source or intake");
  requireCondition(Object.values(assistance.authorizations).every((value) => value === false) && assistance.operationSuggestions.every((item) => item.approved === false && item.executable === false && item.authority.runtimeGrant === false), "Onboarding review assistance widened authority or execution");
  return true;
}

export function classifyOnboardingResidualWork({ workPlan, reviewAssistance }) {
  requireCondition(workPlan?.schemaVersion === "das.onboarding-binding-work-plan.v1", "Residual classification needs a binding work plan");
  requireCondition(reviewAssistance?.schemaVersion === "das.onboarding-review-assistance.v1" && reviewAssistance.proposalHash === workPlan.proposalHash, "Residual classification needs matching review assistance");
  const categoryFor = (item) => {
    if (["customer"].includes(item.owner)) return "legitimate-customer-fact-or-decision";
    if (item.id.startsWith("coverage:")) return "missing-approved-source-material";
    if (item.id.startsWith("runtime-input-schema:") || item.id.startsWith("transport:")) return "automatable-generic-compiler-or-source-schema-work";
    if (item.id.startsWith("idempotency:") || item.id.startsWith("reconciliation:")) return "customer-specific-write-safety-implementation";
    if (item.id.startsWith("verifier:") || item.id === "acceptance-campaign") return "independent-verifier-or-proof-work";
    return "customer-specific-engineering-work";
  };
  const rows = workPlan.authoring.inventory.map((item) => ({ ...structuredClone(item), residualClass: ["generated", "confirmed", "confirmed-existing-only"].includes(item.status) ? "complete" : categoryFor(item) }));
  const totals = Object.fromEntries([...new Set(rows.map((item) => item.residualClass))].sort().map((category) => [category, rows.filter((item) => item.residualClass === category).length]));
  const receipt = {
    schemaVersion: "das.onboarding-residual-classification.v1",
    workPlanHash: workPlan.workPlanHash,
    reviewAssistanceHash: reviewAssistance.assistanceHash,
    rows,
    totals,
    customerSpecificConfigurationDecisions: reviewAssistance.decisionCounts.totalConsequentialConfirmations,
    customerSpecificCodeComponents: unique(rows.filter((item) => ["customer-specific-write-safety-implementation", "customer-specific-engineering-work", "independent-verifier-or-proof-work"].includes(item.residualClass)).map((item) => item.id.split(":")[0])).sort(),
    boundary: "Field-level teardown classification only. It is not observed human setup time, code volume, executable evidence or proof that the proposed mapping is correct.",
  };
  receipt.receiptHash = digest(receipt);
  return Object.freeze(receipt);
}
