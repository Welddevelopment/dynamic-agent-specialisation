import { digest } from "../core/canonical.js";

export const ROLE_DISCOVERY_FACT_STATUSES = Object.freeze([
  "observed",
  "extracted",
  "inferred-proposal",
  "customer-confirmed",
  "independently-verified",
  "unknown",
]);

export const ROLE_DISCOVERY_FACT_CATEGORIES = Object.freeze([
  "proposable",
  "consequential-confirmation",
  "executable-evidence",
]);

const SUPPORTED_ROLE_FAMILIES = new Set(["support-operations", "procurement-coverage", "revenue-operations", "frontend-implementation"]);
const PROVIDER_BASES = new Set(["description", "artifact", "current-agent", "inference"]);
const SECRET_KEY = /(^|[-_])(api[-_]?key|password|passwd|secret|access[-_]?token|refresh[-_]?token|private[-_]?key|credential|authorization)($|[-_])/i;
const SECRET_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\bBasic\s+[A-Za-z0-9+/=]{8,}|\bsk-[A-Za-z0-9_-]{8,}|-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----|\b(?:api[-_]?key|password|access[-_]?token)\s*[:=]\s*\S{6,})/i;
const INSTRUCTION_ATTACK = /(?:ignore (?:all |the |any )?(?:previous|prior|safety|policy)|grant (?:unlimited|all|root|admin) (?:authority|access)|bypass (?:approval|policy|safety)|mark (?:the )?(?:adapter|verifier|sandbox) (?:as )?verified)/i;
const MAX_DESCRIPTION = 12_000;
const MAX_ARTIFACTS = 30;
const MAX_IMPORT_RECEIPTS = 20;
const MAX_CONFIRMATIONS = 40;
const MAX_PROVIDER_FACTS = 160;
const MAX_PROVIDER_WARNINGS = 30;
const MAX_CLARIFICATIONS = 7;
const MAX_STRUCTURED_DEPTH = 16;
const MAX_STRUCTURED_NODES = 5_000;
const MAX_ARRAY_ITEMS = 200;
const MAX_OBJECT_KEYS = 200;
const MAX_SERIALIZED_SOURCE_BYTES = 250_000;
const VERIFIED_IMPORT_RECEIPT = Symbol("das.server-verified-system-import-receipt");

export const ROLE_DISCOVERY_FACT_PATHS = Object.freeze({
  "input.ordinaryLanguageDescription": "proposable",
  "role.title": "proposable",
  "role.outcome": "proposable",
  "role.completionRule": "proposable",
  "systems.inventory": "proposable",
  "work.inputs": "proposable",
  "work.outputs": "proposable",
  "success.measures": "proposable",
  "success.observableReadyDefinition": "proposable",
  "authority.allowedActions": "consequential-confirmation",
  "authority.repositoryWrites": "consequential-confirmation",
  "forbiddenActions.actions": "consequential-confirmation",
  "approvals.requiredActions": "consequential-confirmation",
  "approvals.pullRequestRequired": "consequential-confirmation",
  "approvals.mergeRequired": "consequential-confirmation",
  "approvals.deployRequired": "consequential-confirmation",
  "limits.monetary": "consequential-confirmation",
  "limits.actionLimits": "consequential-confirmation",
  "escalation.owner": "consequential-confirmation",
  "escalation.conditions": "consequential-confirmation",
  "frontend.componentPolicy": "consequential-confirmation",
  "frontend.requiredViewports": "consequential-confirmation",
  "execution.verifierBinding": "executable-evidence",
  "evaluation.representativeCases": "proposable",
  "currentAgent.configuration": "proposable",
});

const PROVIDER_FACT_PATHS = new Set(Object.keys(ROLE_DISCOVERY_FACT_PATHS).filter((path) => path !== "input.ordinaryLanguageDescription" && path !== "execution.verifierBinding"));
const IMPORTED_OPERATION_PATH = /^systems\.importedOperations\.[a-f0-9]{12}$/;
const IMPORTED_ADAPTER_PATH = /^execution\.adapters\.[a-f0-9]{12}$/;

export const ROLE_DISCOVERY_QUESTION_IDS = Object.freeze([
  "role-outcome",
  "component-policy",
  "required-viewports",
  "systems-and-work",
  "authority-boundary",
  "financial-limits",
  "escalation",
  "independent-success",
  "representative-cases",
  "current-agent",
]);

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function clean(value, maximum = 1_000) { return String(value ?? "").trim().slice(0, maximum); }
function stable(value) { return JSON.parse(JSON.stringify(value)); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }
function unique(values) { return [...new Set(values)]; }
function normalizedPath(value) {
  const path = clean(value, 300);
  requireCondition(/^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_-]+)+$/.test(path), `Invalid discovery fact path: ${path || "empty"}`);
  return path;
}

function strictText(value, maximum, label, { minimum = 0 } = {}) {
  const text = String(value ?? "").trim();
  requireCondition(text.length <= maximum, `${label} exceeds the ${maximum}-character limit`);
  requireCondition(text.length >= minimum, `${label} needs at least ${minimum} characters`);
  return text;
}

function assertBoundedStructuredValue(value, location = "discovery value", state = { nodes: 0 }, depth = 0) {
  requireCondition(depth <= MAX_STRUCTURED_DEPTH, `${location} exceeds the maximum structured depth`);
  state.nodes += 1;
  requireCondition(state.nodes <= MAX_STRUCTURED_NODES, `${location} exceeds the maximum structured size`);
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    requireCondition(Number.isFinite(value), `${location} contains a non-finite number`);
    return;
  }
  if (typeof value === "string") {
    requireCondition(value.length <= MAX_DESCRIPTION, `${location} contains an oversized string`);
    return;
  }
  if (Array.isArray(value)) {
    requireCondition(value.length <= MAX_ARRAY_ITEMS, `${location} exceeds the ${MAX_ARRAY_ITEMS}-item array limit`);
    value.forEach((item, index) => assertBoundedStructuredValue(item, `${location}[${index}]`, state, depth + 1));
    return;
  }
  requireCondition(isObject(value), `${location} contains an unsupported value type`);
  const entries = Object.entries(value);
  requireCondition(entries.length <= MAX_OBJECT_KEYS, `${location} exceeds the ${MAX_OBJECT_KEYS}-key object limit`);
  for (const [key, child] of entries) {
    requireCondition(key.length <= 240, `${location} contains an oversized object key`);
    assertBoundedStructuredValue(child, `${location}.${key}`, state, depth + 1);
  }
}

function assertNoCredentialBearingUrl(text, location) {
  const candidates = String(text ?? "").match(/https?:\/\/[^\s"'<>\]}\)]+/gi) ?? [];
  for (const candidate of candidates) {
    let url;
    try { url = new URL(candidate); } catch { continue; }
    const secretParameter = [...url.searchParams.entries()].some(([key, value]) => isCredentialKey(key) && clean(value));
    requireCondition(!url.username && !url.password && !secretParameter, `Credential-bearing URL is forbidden in role discovery: ${location}`);
  }
}

function isCredentialKey(value) {
  const raw = String(value ?? "");
  const compact = raw.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return SECRET_KEY.test(raw)
    || ["apikey", "password", "passwd", "secret", "clientsecret", "accesstoken", "refreshtoken", "privatetoken", "privatekey", "credential", "credentials", "authorization"].includes(compact)
    || /(?:^|[^a-z])(?:bearer|basic)authorization(?:$|[^a-z])/i.test(raw);
}

function isExplicitCredentialAbsence(value) {
  if (!isObject(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 2
    && keys[0] === "references"
    && keys[1] === "status"
    && value.status === "not-collected"
    && Array.isArray(value.references)
    && value.references.length === 0;
}

function assertNoCredentialMaterial(value, location = "discovery input", { allowExplicitAbsence = false } = {}) {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoCredentialMaterial(item, `${location}[${index}]`, { allowExplicitAbsence }));
  if (typeof value === "string") {
    requireCondition(!SECRET_VALUE.test(value), `Credential material is forbidden in role discovery: ${location}`);
    assertNoCredentialBearingUrl(value, location);
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (allowExplicitAbsence && key === "credentials" && (child === "not-collected" || isExplicitCredentialAbsence(child))) continue;
    if (isCredentialKey(key) && child !== null && child !== undefined && clean(child)) {
      throw new Error(`Credential fields are forbidden in role discovery: ${location}.${key}`);
    }
    assertNoCredentialMaterial(child, `${location}.${key}`, { allowExplicitAbsence });
  }
}

function canonicalFactCategory(path, { provider = false } = {}) {
  const normalized = normalizedPath(path);
  if (provider) requireCondition(PROVIDER_FACT_PATHS.has(normalized), `Discovery provider returned an unknown or reserved fact path: ${normalized}`);
  if (ROLE_DISCOVERY_FACT_PATHS[normalized]) return ROLE_DISCOVERY_FACT_PATHS[normalized];
  if (IMPORTED_OPERATION_PATH.test(normalized)) return "proposable";
  if (IMPORTED_ADAPTER_PATH.test(normalized)) return "executable-evidence";
  throw new Error(`Unknown discovery fact path: ${normalized}`);
}

function meaningfulValueForPath(path, value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length >= (path === "role.outcome" || path.startsWith("success.") ? 10 : 2);
  if (Array.isArray(value)) return value.length > 0 && value.every((item) => typeof item === "string" ? item.trim().length >= 2 : item !== null && item !== undefined);
  if (!isObject(value) || Object.keys(value).length === 0) return false;
  if (path === "limits.monetary") {
    return typeof value.currency === "string" && value.currency.trim().length >= 3
      && Number.isFinite(value.amount) && value.amount >= 0
      && typeof value.action === "string" && value.action.trim().length >= 2;
  }
  return Object.values(value).some((item) => item !== null && item !== undefined && item !== "");
}

export function roleDiscoveryConfirmationTargetHash(fact) {
  requireCondition(isObject(fact), "Confirmation target fact is required");
  return digest({ path: fact.path, value: fact.value, status: fact.status, category: fact.category });
}

function sourceSummary({ id, kind, label, content, approvedForDiscovery }) {
  requireCondition(approvedForDiscovery === true, `${kind} must be explicitly approved for role discovery`);
  const sourceId = clean(id, 160);
  requireCondition(sourceId, `${kind} needs a stable source id`);
  const sourceLabel = clean(label, 240);
  requireCondition(sourceLabel, `${kind} needs a label`);
  requireCondition(typeof content === "string" || isObject(content) || Array.isArray(content), `${kind} content must be text or parsed data`);
  assertBoundedStructuredValue(content, `${kind}:${sourceId}`);
  requireCondition(Buffer.byteLength(JSON.stringify(content), "utf8") <= MAX_SERIALIZED_SOURCE_BYTES, `${kind} exceeds the ${MAX_SERIALIZED_SOURCE_BYTES}-byte source limit`);
  assertNoCredentialMaterial(content, `${kind}:${sourceId}`);
  return Object.freeze({
    id: sourceId,
    kind,
    label: sourceLabel,
    content: stable(content),
    contentHash: digest(content),
    approvedForDiscovery: true,
  });
}

function assertSafeImportProposal(proposal) {
  assertBoundedStructuredValue(proposal, "system-import proposal");
  assertNoCredentialMaterial(proposal, "system-import proposal", { allowExplicitAbsence: true });
  requireCondition(proposal?.schemaVersion === "das.onboarding-system-import-proposal.v1", "Discovery accepts only DAS onboarding system-import proposals");
  requireCondition(proposal.proposalHash === digest(withoutHash(proposal, "proposalHash")), "System-import proposal integrity mismatch");
  requireCondition(clean(proposal.proposalId, 300) && clean(proposal.systemId, 160), "System-import proposal needs exact proposal and system identities");
  requireCondition(["openapi", "mcp-tools-list"].includes(proposal.source?.kind) && /^[a-f0-9]{64}$/.test(clean(proposal.source?.sourceHash, 128)), "System-import proposal needs a pinned supported source");
  requireCondition(proposal.status === "proposal-awaiting-customer-review-and-engineering-binding", "System-import proposal cannot claim executable status");
  requireCondition(proposal.gates?.authority === "not-granted" && proposal.gates?.executableAdapter === "not-implemented" && proposal.gates?.independentVerifier === "not-implemented" && proposal.gates?.acceptance === "not-run", "System-import proposal widened a readiness gate");
  requireCondition(
    proposal.authorizations?.modelSpend === false
      && proposal.authorizations?.execution === false
      && proposal.authorizations?.customerWrites === false
      && proposal.authorizations?.activation === false
      && Object.keys(proposal.authorizations).length === 4,
    "System-import proposal must preserve every explicit false authorization",
  );
  requireCondition(proposal.generatedBusinessSuccessCriteria === false, "System-import proposal invented business success criteria");
  requireCondition(Array.isArray(proposal.operations) && proposal.operations.every((operation) => operation.executable === false && operation.authority?.status === "not-granted" && operation.credentials?.references?.length === 0 && operation.adapter?.verified === false && operation.independentVerification?.status === "not-implemented"), "System-import operation is not a safe non-executable proposal");
  return true;
}

export function createServerVerifiedSystemImportReceipt({ proposal, verification }) {
  assertSafeImportProposal(proposal);
  requireCondition(isObject(verification), "System-import discovery receipt needs server verification");
  const verifiedBy = strictText(verification.verifiedBy, 120, "System-import receipt verifier");
  requireCondition(verifiedBy === "assisted-onboarding-journey", "Unsupported system-import receipt verifier");
  const verificationId = strictText(verification.verificationId, 240, "System-import receipt verification id");
  const verificationHash = strictText(verification.verificationHash, 128, "System-import receipt verification hash");
  requireCondition(/^[a-f0-9]{64}$/.test(verificationHash), "System-import receipt needs a pinned server-record hash");
  requireCondition(!proposal.sessionId || verificationId.startsWith(`${proposal.sessionId}:`), "System-import receipt does not match the proposal session");
  const receipt = {
    schemaVersion: "das.server-verified-system-import-receipt.v1",
    proposal: stable(proposal),
    verification: { verifiedBy, verificationId, verificationHash },
  };
  receipt.receiptHash = digest(receipt);
  Object.defineProperty(receipt, VERIFIED_IMPORT_RECEIPT, { value: true, enumerable: false, configurable: false });
  return Object.freeze(receipt);
}

function normalizeImportReceipt(receipt) {
  requireCondition(receipt?.[VERIFIED_IMPORT_RECEIPT] === true, "Raw system-import proposals are unverified; discovery requires a server-verified receipt");
  requireCondition(receipt.schemaVersion === "das.server-verified-system-import-receipt.v1", "Unsupported system-import discovery receipt");
  requireCondition(receipt.receiptHash === digest(withoutHash(receipt, "receiptHash")), "System-import discovery receipt integrity mismatch");
  assertSafeImportProposal(receipt.proposal);
  return Object.freeze({
    ...normalizeImportProposal(receipt.proposal),
    receiptHash: receipt.receiptHash,
    verification: stable(receipt.verification),
  });
}

function normalizeImportProposal(proposal) {
  assertSafeImportProposal(proposal);
  return Object.freeze({
    proposalId: clean(proposal.proposalId, 300),
    proposalHash: proposal.proposalHash,
    sourceKind: clean(proposal.source?.kind, 80),
    sourceHash: clean(proposal.source?.sourceHash, 128),
    systemId: clean(proposal.systemId, 160),
    operations: proposal.operations.map((operation) => ({
      sourceName: clean(operation.sourceName, 240),
      proposedExposedName: clean(operation.proposedExposedName, 300),
      description: clean(operation.description, 700),
      proposedMode: clean(operation.modeProposal?.value, 80),
      classificationBasis: clean(operation.modeProposal?.basis, 300),
      boundedInputSchemaHash: clean(operation.boundedInputSchemaHash, 128),
      customerReviewRequired: true,
      executable: false,
    })),
  });
}

export function createRoleDiscoveryRequest(input) {
  const description = strictText(input?.description, MAX_DESCRIPTION, "Role discovery description", { minimum: 12 });
  assertNoCredentialMaterial(description, "description");
  requireCondition(Array.isArray(input?.approvedArtifacts ?? []), "Approved role-discovery artifacts must be an array");
  requireCondition(Array.isArray(input?.systemImportProposals ?? []), "Role-discovery system-import proposals must be an array");
  requireCondition((input?.systemImportProposals ?? []).length === 0, "Raw system-import proposals are unverified; discovery requires server-verified receipts");
  requireCondition(Array.isArray(input?.verifiedSystemImportReceipts ?? []), "Verified role-discovery system-import receipts must be an array");
  requireCondition(Array.isArray(input?.customerConfirmations ?? []), "Role-discovery customer confirmations must be an array");
  const artifacts = (input?.approvedArtifacts ?? []).slice(0, MAX_ARTIFACTS).map((artifact) => sourceSummary({ ...artifact, kind: "approved-artifact" }));
  requireCondition(artifacts.length === (input?.approvedArtifacts ?? []).length, `Role discovery accepts at most ${MAX_ARTIFACTS} approved artifacts`);
  requireCondition(new Set(artifacts.map((item) => item.id)).size === artifacts.length, "Approved role-discovery artifacts need unique source ids");
  const currentAgent = input?.currentAgentConfiguration
    ? sourceSummary({ ...input.currentAgentConfiguration, kind: "current-agent-configuration" })
    : null;
  requireCondition((input?.verifiedSystemImportReceipts ?? []).length <= MAX_IMPORT_RECEIPTS, `Role discovery accepts at most ${MAX_IMPORT_RECEIPTS} verified system-import receipts`);
  const systemImportProposals = (input?.verifiedSystemImportReceipts ?? []).map(normalizeImportReceipt);
  requireCondition(new Set(systemImportProposals.map((item) => item.proposalHash)).size === systemImportProposals.length, "Verified system-import receipts cannot repeat a proposal");
  requireCondition((input?.customerConfirmations ?? []).length <= MAX_CONFIRMATIONS, `Role discovery accepts at most ${MAX_CONFIRMATIONS} customer confirmations`);
  const customerConfirmations = (input?.customerConfirmations ?? []).map((confirmation, index) => {
    const path = normalizedPath(confirmation?.path);
    const category = canonicalFactCategory(path);
    requireCondition(path !== "input.ordinaryLanguageDescription" && !IMPORTED_OPERATION_PATH.test(path), `Customer confirmation cannot replace reserved discovery evidence: ${path}`);
    requireCondition(category !== "executable-evidence", `Customer confirmation cannot prove executable evidence: ${path}`);
    requireCondition(confirmation?.confirmed === true, `Customer confirmation ${index + 1} is not explicit`);
    assertBoundedStructuredValue(confirmation?.value, `customer confirmation:${path}`);
    assertNoCredentialMaterial(confirmation?.value, `customer confirmation:${path}`);
    requireCondition(meaningfulValueForPath(path, confirmation?.value), `Customer confirmation needs a meaningful value for ${path}`);
    const confirmedBy = strictText(confirmation.confirmedBy, 240, `Customer confirmation ${index + 1} identity`, { minimum: 2 });
    const confirmedRole = strictText(confirmation.confirmedRole, 160, `Customer confirmation ${index + 1} role`, { minimum: 2 });
    const priorFactId = strictText(confirmation.priorFactId, 160, `Customer confirmation ${index + 1} prior fact id`, { minimum: 8 });
    requireCondition(/^fact-[a-f0-9]{20}$/.test(priorFactId), `Customer confirmation ${index + 1} needs a valid prior fact id`);
    const priorFactHash = strictText(confirmation.priorFactHash, 128, `Customer confirmation ${index + 1} prior fact hash`);
    requireCondition(/^[a-f0-9]{64}$/.test(priorFactHash), `Customer confirmation ${index + 1} needs a valid prior fact hash`);
    return Object.freeze({
      path,
      value: stable(confirmation.value),
      confirmed: true,
      confirmedBy,
      confirmedRole,
      priorFactId,
      priorFactHash,
      confirmationId: clean(confirmation.confirmationId, 160) || `confirmation-${digest({ path, value: confirmation.value, confirmedBy, confirmedRole, priorFactHash, index }).slice(0, 16)}`,
    });
  });
  requireCondition(new Set(customerConfirmations.map((item) => item.path)).size === customerConfirmations.length, "Customer confirmations cannot repeat a fact path");
  const request = {
    schemaVersion: "das.role-discovery-request.v1",
    requestId: clean(input?.requestId, 160) || `role-discovery-${digest({ description, artifacts: artifacts.map((item) => item.contentHash), currentAgent: currentAgent?.contentHash, systemImportProposals: systemImportProposals.map((item) => item.proposalHash) }).slice(0, 16)}`,
    description,
    companyContext: {
      companyName: strictText(input?.companyContext?.companyName, 240, "Company name"),
      industry: strictText(input?.companyContext?.industry, 200, "Company industry"),
      operatingContext: strictText(input?.companyContext?.operatingContext, 4_000, "Company operating context"),
    },
    approvedArtifacts: artifacts,
    currentAgentConfiguration: currentAgent,
    systemImportProposals,
    customerConfirmations,
    constraints: {
      noAuthorityFromDiscovery: true,
      noCredentialsFromDiscovery: true,
      noExecutableBindingsFromDiscovery: true,
      noIndependentVerificationFromDiscovery: true,
      noModelSpendAuthorization: true,
    },
  };
  assertBoundedStructuredValue(request.companyContext, "company context");
  assertNoCredentialMaterial(request.companyContext, "company context");
  request.requestHash = digest(request);
  return Object.freeze(request);
}

export function assertRoleDiscoveryProvider(provider) {
  requireCondition(isObject(provider), "Role discovery provider is required");
  requireCondition(clean(provider.id, 160) && clean(provider.version, 120), "Role discovery provider needs id and version");
  requireCondition(typeof provider.discover === "function", "Role discovery provider needs a discover(request) function");
  return true;
}

function normalizeUsageAuthorization(authorization, provider) {
  if (authorization === null || authorization === undefined) return null;
  requireCondition(isObject(authorization), "Role discovery usage authorization must be an object");
  requireCondition(authorization.schemaVersion === "das.role-discovery-usage-authorization.v1", "Unsupported role discovery usage authorization");
  requireCondition(authorization.providerId === clean(provider.id, 160), "Role discovery usage authorization belongs to another provider");
  requireCondition(clean(authorization.campaignId, 160), "Role discovery usage authorization needs a campaign id");
  requireCondition(/^[a-f0-9]{64}$/.test(clean(authorization.planHash, 128)), "Role discovery usage authorization needs an exact plan hash");
  requireCondition(Number.isInteger(authorization.maximumCalls) && authorization.maximumCalls >= 1 && authorization.maximumCalls <= 4, "Role discovery usage authorization has an invalid call ceiling");
  requireCondition(Number.isInteger(authorization.maximumExternalRequests) && authorization.maximumExternalRequests >= 1 && authorization.maximumExternalRequests <= authorization.maximumCalls, "Role discovery usage authorization has an invalid external-request ceiling");
  requireCondition(Number.isFinite(authorization.maximumSpendUsd) && authorization.maximumSpendUsd > 0 && authorization.maximumSpendUsd <= 1, "Role discovery usage authorization has an invalid spend ceiling");
  requireCondition(provider.usagePolicy?.kind === "instrumented-model-backed", "Only an explicitly instrumented model-backed discovery provider may consume usage");
  requireCondition(provider.usagePolicy.maximumCallsPerDiscovery <= authorization.maximumCalls, "Discovery provider call policy exceeds the authorization");
  requireCondition(provider.usagePolicy.maximumExternalRequestsPerDiscovery <= authorization.maximumExternalRequests, "Discovery provider request policy exceeds the authorization");
  return Object.freeze({
    schemaVersion: authorization.schemaVersion,
    campaignId: clean(authorization.campaignId, 160),
    planHash: clean(authorization.planHash, 128),
    providerId: clean(authorization.providerId, 160),
    maximumCalls: authorization.maximumCalls,
    maximumExternalRequests: authorization.maximumExternalRequests,
    maximumSpendUsd: authorization.maximumSpendUsd,
  });
}

function assertProviderUsage({ usage, authorization }) {
  requireCondition(isObject(usage), "Role discovery provider must report usage");
  requireCondition(Number.isInteger(usage.modelCalls) && usage.modelCalls >= 0, "Role discovery provider reported invalid model-call usage");
  requireCondition(Number.isInteger(usage.externalRequests) && usage.externalRequests >= 0, "Role discovery provider reported invalid external-request usage");
  requireCondition(Number.isFinite(usage.spendUsd) && usage.spendUsd >= 0, "Role discovery provider reported invalid spend usage");
  if (!authorization) {
    requireCondition(
      usage.modelCalls === 0
        && usage.externalRequests === 0
        && usage.spendUsd === 0
        && Object.keys(usage).length === 3,
      "This discovery call permits only explicitly reported zero-call, zero-request, zero-spend providers",
    );
    return true;
  }
  requireCondition(usage.modelCalls <= authorization.maximumCalls, "Role discovery provider exceeded its authorized model-call ceiling");
  requireCondition(usage.externalRequests <= authorization.maximumExternalRequests, "Role discovery provider exceeded its authorized external-request ceiling");
  requireCondition(usage.spendUsd <= authorization.maximumSpendUsd, "Role discovery provider exceeded its authorized spend ceiling");
  requireCondition(usage.modelCalls === usage.externalRequests, "Role discovery provider call and external-request accounting disagree");
  for (const key of ["inputTokens", "cachedInputTokens", "outputTokens", "elapsedMs"]) {
    requireCondition(Number.isFinite(usage[key]) && usage[key] >= 0, `Role discovery provider reported invalid ${key}`);
  }
  requireCondition(typeof usage.provider === "string" && clean(usage.provider, 160), "Role discovery provider usage lacks provider attribution");
  requireCondition(typeof usage.requestedModel === "string" && clean(usage.requestedModel, 160), "Role discovery provider usage lacks requested-model attribution");
  requireCondition(typeof usage.resolvedModel === "string" && clean(usage.resolvedModel, 160), "Role discovery provider usage lacks resolved-model attribution");
  requireCondition(typeof usage.cached === "boolean", "Role discovery provider usage lacks cache attribution");
  if (usage.cached) requireCondition(usage.modelCalls === 0 && usage.externalRequests === 0 && usage.spendUsd === 0, "A cache hit cannot claim a new call, request, or spend");
  return true;
}

function factCategory(path) { return canonicalFactCategory(path); }

function resolveJsonPointer(value, pointer) {
  if (pointer === "") return value;
  requireCondition(typeof pointer === "string" && pointer.startsWith("/"), "Discovery extraction locator needs an RFC 6901 JSON pointer");
  return pointer.slice(1).split("/").reduce((current, segment) => {
    const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) return /^\d+$/.test(key) ? current[Number(key)] : undefined;
    return isObject(current) && Object.hasOwn(current, key) ? current[key] : undefined;
  }, value);
}

function sameStructuredValue(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

function verifiedTextLocator(locator, text, value) {
  if (!isObject(locator) || locator.kind !== "text-range") return null;
  const start = locator.start;
  const end = locator.end;
  if (typeof locator.quote !== "string" || locator.quote.length < 1 || locator.quote.length > 4_000) return null;
  const quote = locator.quote.trim();
  if (!quote || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) return null;
  if (text.slice(start, end) !== quote) return null;
  if (typeof value !== "string" || value !== quote) return null;
  return Object.freeze({ kind: "text-range", start, end, quoteHash: digest(quote) });
}

function verifiedJsonLocator(locator, content, value) {
  if (!isObject(locator) || locator.kind !== "json-pointer") return null;
  if (typeof locator.pointer !== "string" || locator.pointer.length > 1_000) return null;
  const pointer = locator.pointer.trim();
  const located = resolveJsonPointer(content, pointer);
  if (located === undefined) return null;
  if (!sameStructuredValue(located, value)) return null;
  return Object.freeze({ kind: "json-pointer", pointer, valueHash: digest(located) });
}

function verifiedLocatorFor({ fact, sourceContent }) {
  if (typeof sourceContent === "string") return verifiedTextLocator(fact.locator, sourceContent, fact.value);
  if (isObject(sourceContent) || Array.isArray(sourceContent)) return verifiedJsonLocator(fact.locator, sourceContent, fact.value);
  return null;
}

function sourceForProviderFact(fact, request) {
  const basis = PROVIDER_BASES.has(fact.basis) ? fact.basis : "inference";
  if (basis === "artifact") {
    const source = request.approvedArtifacts.find((item) => item.id === fact.sourceId);
    if (!source && request.currentAgentConfiguration?.id === fact.sourceId) {
      return { basis: "inference", sourceId: `provider:${request.requestId}`, sourceKind: "discovery-provider-proposal", sourceHash: request.requestHash, label: `Unverified proposal based on ${request.currentAgentConfiguration.label}`, claimedBasis: basis, claimedSourceId: fact.sourceId, locatorVerified: false, sourceTypeMismatch: true };
    }
    requireCondition(source, `Provider cited an unknown approved artifact: ${fact.sourceId}`);
    const locator = verifiedLocatorFor({ fact, sourceContent: source.content });
    if (!locator) return { basis: "inference", sourceId: `provider:${request.requestId}`, sourceKind: "discovery-provider-proposal", sourceHash: request.requestHash, label: `Unverified proposal based on ${source.label}`, claimedBasis: basis, locatorVerified: false };
    return { basis, sourceId: source.id, sourceKind: source.kind, sourceHash: source.contentHash, label: source.label, locator, locatorVerified: true };
  }
  if (basis === "current-agent") {
    if ((!request.currentAgentConfiguration || fact.sourceId !== request.currentAgentConfiguration.id) && request.approvedArtifacts.some((item) => item.id === fact.sourceId)) {
      const source = request.approvedArtifacts.find((item) => item.id === fact.sourceId);
      return { basis: "inference", sourceId: `provider:${request.requestId}`, sourceKind: "discovery-provider-proposal", sourceHash: request.requestHash, label: `Unverified proposal based on ${source.label}`, claimedBasis: basis, claimedSourceId: fact.sourceId, locatorVerified: false, sourceTypeMismatch: true };
    }
    requireCondition(request.currentAgentConfiguration && fact.sourceId === request.currentAgentConfiguration.id, "Provider cited an unknown current-agent configuration");
    const source = request.currentAgentConfiguration;
    const locator = verifiedLocatorFor({ fact, sourceContent: source.content });
    if (!locator) return { basis: "inference", sourceId: `provider:${request.requestId}`, sourceKind: "discovery-provider-proposal", sourceHash: request.requestHash, label: `Unverified proposal based on ${source.label}`, claimedBasis: basis, locatorVerified: false };
    return { basis, sourceId: source.id, sourceKind: source.kind, sourceHash: source.contentHash, label: source.label, locator, locatorVerified: true };
  }
  if (basis === "description") {
    const locator = verifiedLocatorFor({ fact, sourceContent: request.description });
    if (!locator) return { basis: "inference", sourceId: `provider:${request.requestId}`, sourceKind: "discovery-provider-proposal", sourceHash: request.requestHash, label: "Unverified proposal based on the customer description", claimedBasis: basis, locatorVerified: false };
    return { basis, sourceId: "ordinary-language-description", sourceKind: "customer-description", sourceHash: digest(request.description), label: "Customer role description", locator, locatorVerified: true };
  }
  return { basis: "inference", sourceId: `provider:${request.requestId}`, sourceKind: "discovery-provider-proposal", sourceHash: request.requestHash, label: "Provider inference" };
}

function providerFactStatus(source) {
  if (["description", "artifact", "current-agent"].includes(source.basis)) return "extracted";
  return "inferred-proposal";
}

function makeFact({ path, value, status, category, provenance, confidence = null, reviewRequired = false, executable = false, note = "", supersession = null }) {
  const canonicalCategory = canonicalFactCategory(path);
  requireCondition(category === canonicalCategory, `Discovery fact category does not match the canonical registry: ${path}`);
  requireCondition(ROLE_DISCOVERY_FACT_STATUSES.includes(status), `Unsupported discovery fact status: ${status}`);
  requireCondition(ROLE_DISCOVERY_FACT_CATEGORIES.includes(category), `Unsupported discovery fact category: ${category}`);
  assertBoundedStructuredValue(value, `discovery fact:${path}`);
  assertNoCredentialMaterial(value, `discovery fact:${path}`);
  if (category === "consequential-confirmation") {
    requireCondition(["customer-confirmed", "independently-verified", "unknown", "inferred-proposal", "extracted"].includes(status), `Consequential fact has invalid status: ${status}`);
  }
  if (category === "executable-evidence") requireCondition(executable === false || status === "independently-verified", "Executable evidence cannot be marked executable without independent verification");
  requireCondition(Array.isArray(provenance) && provenance.length > 0 && provenance.length <= 12, `Discovery fact needs bounded provenance: ${path}`);
  const normalizedSupersession = supersession ? Object.freeze(stable(supersession)) : null;
  return Object.freeze({
    factId: `fact-${digest({ path, value, status, provenance, supersession: normalizedSupersession }).slice(0, 20)}`,
    path,
    value: value === undefined ? null : stable(value),
    status,
    category,
    provenance: provenance.map((item) => Object.freeze(stable(item))),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
    customerConfirmationRequired: category === "consequential-confirmation" && !["customer-confirmed", "independently-verified"].includes(status),
    independentVerificationRequired: category === "executable-evidence" && status !== "independently-verified",
    reviewRequired: reviewRequired || status === "inferred-proposal",
    executable: executable === true,
    note: clean(note, 700),
    supersession: normalizedSupersession,
  });
}

function normalizeProviderFacts(providerOutput, request) {
  requireCondition(isObject(providerOutput), "Role discovery provider returned no structured proposal");
  requireCondition(Array.isArray(providerOutput.facts) && providerOutput.facts.length <= MAX_PROVIDER_FACTS, `Role discovery provider must return at most ${MAX_PROVIDER_FACTS} facts`);
  assertBoundedStructuredValue(providerOutput, "role discovery provider output");
  const paths = providerOutput.facts.map((fact) => {
    const path = normalizedPath(fact?.path);
    requireCondition(!path.startsWith("input."), "Role discovery provider cannot overwrite observed input facts");
    canonicalFactCategory(path, { provider: true });
    return path;
  });
  requireCondition(new Set(paths).size === paths.length, "Role discovery provider returned duplicate fact paths");
  return providerOutput.facts.map((fact, index) => {
    const path = paths[index];
    requireCondition(fact.value !== undefined, `Discovery provider omitted a value for ${path}`);
    const source = sourceForProviderFact(fact, request);
    return makeFact({
      path,
      value: fact.value,
      status: providerFactStatus(source),
      category: canonicalFactCategory(path, { provider: true }),
      provenance: [source],
      confidence: fact.confidence,
      reviewRequired: fact.reviewRequired === true,
      executable: false,
      note: clean(fact.note, 700),
    });
  });
}

function importedOperationFacts(request) {
  const facts = [];
  for (const proposal of request.systemImportProposals) {
    for (const operation of proposal.operations) {
      const operationKey = digest({ proposal: proposal.proposalHash, operation: operation.proposedExposedName }).slice(0, 12);
      facts.push(makeFact({
        path: `systems.importedOperations.${operationKey}`,
        value: {
          systemId: proposal.systemId,
          exposedName: operation.proposedExposedName,
          description: operation.description,
          proposedMode: operation.proposedMode,
          boundedInputSchemaHash: operation.boundedInputSchemaHash,
        },
        status: "inferred-proposal",
        category: "proposable",
        provenance: [{ sourceId: proposal.proposalId, sourceKind: "server-verified-system-import-receipt", sourceHash: proposal.receiptHash, label: "Server-recorded, pinned, non-executable system import proposal", verification: proposal.verification }],
        reviewRequired: true,
        executable: false,
        note: "Pinned tool-inventory proposal only. The server receipt proves which local record supplied it; it does not verify operation semantics, authority, an adapter, or the business outcome.",
      }));
    }
    facts.push(makeFact({
      path: `execution.adapters.${digest(proposal.systemId).slice(0, 12)}`,
      value: { systemId: proposal.systemId, status: "not-implemented" },
      status: "unknown",
      category: "executable-evidence",
      provenance: [{ sourceId: proposal.proposalId, sourceKind: "server-verified-system-import-receipt", sourceHash: proposal.receiptHash, label: "Import proposal readiness boundary", verification: proposal.verification }],
      executable: false,
      note: "A schema proposal is not an executable customer binding.",
    }));
  }
  return facts;
}

function applyCustomerConfirmations(facts, confirmations) {
  const byPath = new Map(facts.map((fact) => [fact.path, fact]));
  for (const confirmation of confirmations) {
    const existing = byPath.get(confirmation.path);
    requireCondition(existing, `Customer confirmation must bind a prior discovery fact: ${confirmation.path}`);
    requireCondition(confirmation.priorFactHash === roleDiscoveryConfirmationTargetHash(existing), `Customer confirmation no longer matches the prior fact value: ${confirmation.path}`);
    const category = existing.category;
    requireCondition(category !== "executable-evidence", `Customer confirmation cannot prove executable evidence: ${confirmation.path}`);
    byPath.set(confirmation.path, makeFact({
      path: confirmation.path,
      value: confirmation.value,
      status: "customer-confirmed",
      category,
      provenance: [
        ...existing.provenance,
        { sourceId: confirmation.confirmationId, sourceKind: "explicit-customer-confirmation", sourceHash: digest(confirmation), label: `${confirmation.confirmedBy} · ${confirmation.confirmedRole}` },
      ],
      executable: false,
      note: "Explicit customer confirmation superseded a bound provisional fact; the prior value and provenance remain in the lineage.",
      supersession: {
        priorFactId: confirmation.priorFactId,
        priorFactHash: confirmation.priorFactHash,
        priorStatus: existing.status,
        priorValue: stable(existing.value),
        priorProvenance: stable(existing.provenance),
        confirmedBy: confirmation.confirmedBy,
        confirmedRole: confirmation.confirmedRole,
        confirmationId: confirmation.confirmationId,
      },
    }));
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function factMap(facts) { return new Map(facts.map((fact) => [fact.path, fact])); }
function confirmed(fact) { return fact && ["customer-confirmed", "independently-verified"].includes(fact.status); }
function present(fact) { return fact && fact.status !== "unknown" && fact.value !== null && fact.value !== "" && (!Array.isArray(fact.value) || fact.value.length > 0); }

function clarificationCandidates({ facts, roleFamily, importedOperationCount }) {
  const byPath = factMap(facts);
  const hasWrites = facts.some((fact) => fact.path.startsWith("systems.importedOperations.") && ["write", "review-required"].includes(fact.value?.proposedMode));
  const frontend = roleFamily === "frontend-implementation";
  const financialSignalPaths = new Set(["role.outcome", "authority.allowedActions", "forbiddenActions.actions", "approvals.requiredActions", "limits.actionLimits"]);
  const financial = roleFamily === "procurement-coverage"
    || (!frontend && facts.some((fact) => financialSignalPaths.has(fact.path) && /issue (?:a )?credit|refund|purchase|spend|charge|pay(?:ment)?|monetary|transaction/i.test(JSON.stringify(fact.value))));
  const authorityPaths = frontend
    ? ["authority.allowedActions", "authority.repositoryWrites", "forbiddenActions.actions", "approvals.requiredActions", "approvals.pullRequestRequired", "approvals.mergeRequired", "approvals.deployRequired"]
    : ["authority.allowedActions", "forbiddenActions.actions", "approvals.requiredActions"];
  const successPaths = frontend
    ? ["success.measures", "success.observableReadyDefinition", "execution.verifierBinding"]
    : ["success.measures", "execution.verifierBinding"];
  const candidates = [
    { id: "role-outcome", score: 100, blocks: ["trusted-role-contract"], paths: ["role.outcome"], needed: () => !confirmed(byPath.get("role.outcome")), question: "What exact result should this specialist own, and what should be true when its work is complete?" },
    { id: "component-policy", score: 99, blocks: ["trusted-role-contract", "change-boundary"], paths: ["frontend.componentPolicy"], needed: () => frontend && !confirmed(byPath.get("frontend.componentPolicy")), question: "Which existing components and design-system primitives must be reused, and when—if ever—may the specialist create a new component?" },
    { id: "required-viewports", score: 98, blocks: ["trusted-role-contract", "acceptance-contract"], paths: ["frontend.requiredViewports"], needed: () => frontend && !confirmed(byPath.get("frontend.requiredViewports")), question: "Which exact viewport sizes and device classes must the implementation support and be reviewed at?" },
    { id: "systems-and-work", score: 96, blocks: ["bounded-environment"], paths: ["systems.inventory"], needed: () => !present(byPath.get("systems.inventory")) && importedOperationCount === 0, question: "Which systems and information sources does this job read from or write to? Please name the systems, not credentials." },
    { id: "authority-boundary", score: 94, blocks: ["authority-contract"], paths: authorityPaths, needed: () => authorityPaths.some((path) => !confirmed(byPath.get(path))) || (hasWrites && !confirmed(byPath.get("approvals.requiredActions"))), question: frontend ? "Which repository paths may the specialist edit, may it open a pull request, who must approve merge or deployment, and what must it never do?" : "What may the specialist do without asking, what must it ask approval for, and what must it never do?" },
    { id: "financial-limits", score: 91, blocks: ["consequential-limits"], paths: ["limits.monetary"], needed: () => financial && !confirmed(byPath.get("limits.monetary")), question: "What monetary or transaction limit applies, and does the specialist draft, approve, or execute actions below it?" },
    { id: "escalation", score: 88, blocks: ["safe-handoff"], paths: ["escalation.owner", "escalation.conditions"], needed: () => !confirmed(byPath.get("escalation.owner")) || !confirmed(byPath.get("escalation.conditions")), question: "Who receives blocked or uncertain work, and which situations must always be handed to them?" },
    { id: "independent-success", score: 84, blocks: ["comparison-contract", "trusted-role-contract"], paths: successPaths, needed: () => successPaths.filter((path) => path !== "execution.verifierBinding").some((path) => !confirmed(byPath.get(path))), question: frontend ? "What exact pages, viewports, interactions, tests, accessibility checks and review evidence should an independent checker inspect before calling the work ready?" : "What external result should an independent checker inspect to decide whether the work succeeded?" },
    { id: "representative-cases", score: 78, blocks: ["fair-evaluation"], paths: ["evaluation.representativeCases"], needed: () => !present(byPath.get("evaluation.representativeCases")), question: "Can you provide several approved, redacted examples—including normal cases, exceptions, and a case the specialist must refuse or escalate?" },
    { id: "current-agent", score: 70, blocks: ["fair-baseline"], paths: ["currentAgent.configuration"], needed: () => !present(byPath.get("currentAgent.configuration")), question: "Is there a current agent or manual process DAS must compare against? If yes, provide an approved configuration or reproducible baseline description." },
  ];
  requireCondition(candidates.every((item) => ROLE_DISCOVERY_QUESTION_IDS.includes(item.id)), "Discovery clarification planner contains a non-canonical question id");
  return candidates.filter((item) => item.needed()).sort((a, b) => b.score - a.score);
}

function unknownFact(path, category, questionId) {
  return makeFact({
    path,
    value: null,
    status: "unknown",
    category,
    provenance: [{ sourceId: `clarification:${questionId}`, sourceKind: "missing-required-fact", sourceHash: digest({ path, questionId }), label: "Discovery clarification gap" }],
    executable: false,
    note: "This fact remains unknown; discovery did not invent it.",
  });
}

function contractStatus({ supported, questions, consequential, executableEvidence, trustedRoleContractReady }) {
  if (!supported) return "unsupported-role-preview-only";
  if (questions.some((item) => item.blocks.includes("trusted-role-contract") || item.blocks.includes("bounded-environment"))) return "provisional-description-needs-clarification";
  if (consequential.some((fact) => fact.customerConfirmationRequired)) return "awaiting-consequential-confirmation";
  if (!trustedRoleContractReady) return "awaiting-trusted-outcome-and-success-confirmation";
  if (executableEvidence.some((fact) => fact.independentVerificationRequired)) return "contract-draft-ready-execution-still-blocked";
  return "trusted-role-contract-ready-execution-still-blocked";
}

export async function discoverRoleFromPlainEnglish({ provider, input, usageAuthorization = null }) {
  assertRoleDiscoveryProvider(provider);
  const normalizedUsageAuthorization = normalizeUsageAuthorization(usageAuthorization, provider);
  const request = createRoleDiscoveryRequest(input);
  const rawOutput = await provider.discover(structuredClone(request));
  requireCondition(rawOutput?.schemaVersion === "das.role-discovery-provider-output.v1", "Role discovery provider returned an unsupported output schema");
  requireCondition(rawOutput.requestHash === request.requestHash, "Role discovery provider output does not match the request");
  assertProviderUsage({ usage: rawOutput.usage, authorization: normalizedUsageAuthorization });
  assertNoCredentialMaterial(rawOutput, "provider output");
  const roleFamily = clean(rawOutput.roleFamily, 120) || "unsupported";
  const supported = SUPPORTED_ROLE_FAMILIES.has(roleFamily);
  let facts = [makeFact({
    path: "input.ordinaryLanguageDescription",
    value: request.description,
    status: "observed",
    category: "proposable",
    provenance: [{ sourceId: "ordinary-language-description", sourceKind: "customer-description", sourceHash: digest(request.description), label: "Exact customer-supplied description" }],
    reviewRequired: false,
    executable: false,
    note: "Observed input only; it is not itself a trusted operating contract.",
  }), ...normalizeProviderFacts(rawOutput, request)];
  facts.push(...importedOperationFacts(request));
  requireCondition(new Set(facts.map((fact) => fact.path)).size === facts.length, "Role discovery sources produced conflicting fact paths");
  facts = applyCustomerConfirmations(facts, request.customerConfirmations);

  const importedOperationCount = request.systemImportProposals.reduce((count, proposal) => count + proposal.operations.length, 0);
  const initialQuestions = clarificationCandidates({ facts, roleFamily, importedOperationCount });
  const existingPaths = new Set(facts.map((fact) => fact.path));
  for (const question of initialQuestions) {
    for (const path of question.paths) {
      if (!existingPaths.has(path)) {
        const category = factCategory(path);
        facts.push(unknownFact(path, category, question.id));
        existingPaths.add(path);
      }
    }
  }
  facts.sort((a, b) => a.path.localeCompare(b.path));

  const questions = clarificationCandidates({ facts, roleFamily, importedOperationCount });
  const clarificationQueue = questions.slice(0, MAX_CLARIFICATIONS).map((item, index) => Object.freeze({
    rank: index + 1,
    id: item.id,
    question: item.question,
    resolvesFactPaths: item.paths,
    blocks: item.blocks,
    informationPriority: item.score,
  }));
  const proposable = facts.filter((fact) => fact.category === "proposable");
  const consequential = facts.filter((fact) => fact.category === "consequential-confirmation");
  const executableEvidence = facts.filter((fact) => fact.category === "executable-evidence");
  const factsByPath = factMap(facts);
  const successFact = roleFamily === "frontend-implementation"
    ? factsByPath.get("success.observableReadyDefinition")
    : factsByPath.get("success.measures");
  const trustedRoleContractReady = supported
    && confirmed(factsByPath.get("role.outcome"))
    && confirmed(successFact)
    && present(factsByPath.get("systems.inventory"))
    && consequential.length > 0
    && consequential.every((fact) => confirmed(fact));
  requireCondition(!rawOutput.warnings || Array.isArray(rawOutput.warnings), "Role discovery provider warnings must be an array");
  requireCondition((rawOutput.warnings ?? []).length <= MAX_PROVIDER_WARNINGS, `Role discovery provider may return at most ${MAX_PROVIDER_WARNINGS} warnings`);
  const warnings = unique([
    ...(Array.isArray(rawOutput.warnings) ? rawOutput.warnings.map((item) => clean(item, 500)).filter(Boolean) : []),
    ...(INSTRUCTION_ATTACK.test(request.description) ? ["The description contains instructions that attempt to widen authority or bypass policy. They were treated as untrusted text and granted nothing."] : []),
    ...(!supported ? ["The proposed role is outside the currently supported structured role families. The output is preview-only."] : []),
  ]);
  const output = {
    schemaVersion: "das.provisional-role-contract.v1",
    discoveryId: `${request.requestId}:${clean(provider.id, 160)}:${clean(provider.version, 120)}`,
    requestHash: request.requestHash,
    provider: {
      id: clean(provider.id, 160),
      version: clean(provider.version, 120),
      usage: stable(rawOutput.usage),
      usageAuthorization: normalizedUsageAuthorization ? stable(normalizedUsageAuthorization) : null,
    },
    roleFamily: { proposed: roleFamily, supported, confidence: Number.isFinite(rawOutput.roleFamilyConfidence) ? Math.max(0, Math.min(1, rawOutput.roleFamilyConfidence)) : null, status: supported ? "inferred-proposal" : "unknown" },
    status: contractStatus({ supported, questions: clarificationQueue, consequential, executableEvidence, trustedRoleContractReady }),
    facts,
    factGroups: {
      safelyProposable: proposable.map((fact) => fact.factId),
      requiresConsequentialConfirmation: consequential.filter((fact) => fact.customerConfirmationRequired).map((fact) => fact.factId),
      requiresExecutableEvidence: executableEvidence.filter((fact) => fact.independentVerificationRequired).map((fact) => fact.factId),
    },
    clarificationQueue,
    deferredClarificationCount: Math.max(0, questions.length - clarificationQueue.length),
    engineeringBlockers: unique([
      ...(importedOperationCount ? ["Customer and engineer must review imported operation subsets and read/write classifications."] : ["No reviewed system-operation inventory is connected."]),
      "Customer-local executable adapters and credential references are not connected.",
      "An independent external-state verifier and unknown-outcome reconciler are not implemented and bound.",
      "A safe sandbox/replay environment and mandatory acceptance evidence are not complete.",
    ]),
    authorizations: { authorityGranted: false, credentialsAccepted: false, modelSpend: false, comparisonExecution: false, customerWrites: false, activation: false },
    readiness: {
      descriptionObserved: true,
      provisionalContractDrafted: true,
      consequentialFactsConfirmed: consequential.length > 0 && consequential.every((fact) => !fact.customerConfirmationRequired),
      trustedRoleContractReady,
      executionBlocked: true,
      executableEnvironmentReady: false,
      comparisonReady: false,
      activationReady: false,
    },
    warnings,
    evidenceBoundary: "This is a provisional, execution-blocked role-contract draft from approved inputs. It can preserve exact extraction provenance, propose role facts and prioritize canonical clarification. It cannot grant authority, accept credentials, prove adapters or verifiers, authorize model spend, run a comparison, or activate a specialist.",
  };
  output.contractHash = digest(output);
  return Object.freeze(output);
}

export function assertProvisionalRoleContract(contract) {
  requireCondition(contract?.schemaVersion === "das.provisional-role-contract.v1" && contract.contractHash === digest(withoutHash(contract, "contractHash")), "Provisional role contract integrity mismatch");
  const authorizationKeys = ["authorityGranted", "credentialsAccepted", "modelSpend", "comparisonExecution", "customerWrites", "activation"];
  requireCondition(
    authorizationKeys.every((key) => contract.authorizations?.[key] === false)
      && Object.keys(contract.authorizations ?? {}).length === authorizationKeys.length,
    "Discovery contract must preserve every explicit false authorization",
  );
  const contractAuthorization = contract.provider?.usageAuthorization;
  if (contractAuthorization === null) {
    requireCondition(
      contract.provider?.usage?.modelCalls === 0
        && contract.provider?.usage?.externalRequests === 0
        && contract.provider?.usage?.spendUsd === 0
        && Object.keys(contract.provider?.usage ?? {}).length === 3,
      "Discovery contract without usage authorization must preserve exact zero provider usage",
    );
  } else {
    requireCondition(contractAuthorization?.schemaVersion === "das.role-discovery-usage-authorization.v1", "Discovery contract has an unsupported usage authorization");
    requireCondition(contractAuthorization.providerId === contract.provider.id, "Discovery contract usage authorization belongs to another provider");
    requireCondition(/^[a-f0-9]{64}$/.test(contractAuthorization.planHash), "Discovery contract usage authorization lacks an exact plan hash");
    requireCondition(contract.provider.usage.modelCalls <= contractAuthorization.maximumCalls, "Discovery contract exceeds its model-call authorization");
    requireCondition(contract.provider.usage.externalRequests <= contractAuthorization.maximumExternalRequests, "Discovery contract exceeds its request authorization");
    requireCondition(contract.provider.usage.spendUsd <= contractAuthorization.maximumSpendUsd, "Discovery contract exceeds its spend authorization");
  }
  requireCondition(contract.readiness?.executionBlocked === true && contract.readiness?.executableEnvironmentReady === false && contract.readiness?.comparisonReady === false && contract.readiness?.activationReady === false, "Discovery contract widened readiness");
  requireCondition(contract.facts.every((fact) => fact.executable === false && ROLE_DISCOVERY_FACT_STATUSES.includes(fact.status) && ROLE_DISCOVERY_FACT_CATEGORIES.includes(fact.category)), "Discovery contract contains an invalid or executable fact");
  requireCondition(new Set(contract.facts.map((fact) => fact.path)).size === contract.facts.length, "Discovery contract contains duplicate fact paths");
  requireCondition(contract.facts.every((fact) => fact.category === canonicalFactCategory(fact.path)), "Discovery contract weakened a fact category");
  requireCondition(contract.facts.filter((fact) => fact.category === "executable-evidence").every((fact) => fact.status !== "customer-confirmed"), "Customer confirmation cannot prove executable evidence");
  requireCondition(contract.facts.filter((fact) => fact.status === "extracted").every((fact) => fact.provenance.some((source) => source.locatorVerified === true && source.locator)), "Extracted facts require an exact verified source locator");
  requireCondition(contract.clarificationQueue.every((item) => ROLE_DISCOVERY_QUESTION_IDS.includes(item.id)), "Discovery contract contains a non-canonical clarification question");
  if (contract.readiness.trustedRoleContractReady === true) {
    const byPath = factMap(contract.facts);
    const success = contract.roleFamily.proposed === "frontend-implementation" ? byPath.get("success.observableReadyDefinition") : byPath.get("success.measures");
    requireCondition(contract.roleFamily.supported === true && confirmed(byPath.get("role.outcome")) && confirmed(success), "Trusted role readiness lacks confirmed outcome or success criteria");
    requireCondition(contract.facts.filter((fact) => fact.category === "consequential-confirmation").every((fact) => confirmed(fact)), "Trusted role readiness has unresolved consequential facts");
  }
  return true;
}
