import { digest } from "../core/canonical.js";

const HASH = /^[a-f0-9]{64}$/;
const ALIAS = /^[A-Z][A-Z0-9_]{5,120}$/;
const SECRET = /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\bBasic\s+[A-Za-z0-9+/=]{8,}|\bsk-[A-Za-z0-9_-]{8,}|-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----|\b(?:password|secret|token|api[-_]?key)\s*[:=]\s*["']?[^\s,"'}]{6,})/i;
const SECRET_KEY = /^(?:api[-_]?key|password|passwd|secret|access[-_]?token|refresh[-_]?token|private[-_]?key|authorization)$/i;
const INJECTION = /(?:ignore (?:all |the |any )?(?:previous|prior|safety|policy)|grant (?:unlimited|all|root|admin)|bypass (?:approval|policy|safety)|mark (?:the )?(?:adapter|verifier|package|sandbox) (?:as )?(?:verified|active)|action response (?:is|as) proof)/i;
const FACT_STATUSES = new Set(["observed", "extracted", "inferred-proposal", "owner-confirmed", "engineer-confirmed", "independently-verified", "unknown"]);

const QUESTION_DEFINITIONS = Object.freeze([
  ["actionOperation", "owner", "Which exact source operation performs the one allowed mutation for this role?", []],
  ["actionReadOperations", "owner", "Which exact action-source operations may only read context or reconcile state?", ["actionOperation"]],
  ["rejectedOperations", "owner", "Which source operations are outside this role and must remain unavailable?", ["actionOperation"]],
  ["stableIdentityFields", "owner", "Which fields form the stable business identity for one assigned item and its result?", ["actionOperation"]],
  ["assignedWorkMapping", "owner", "How do stable assigned-work fields map to the action and observation identity?", ["stableIdentityFields"]],
  ["conflictKeyFields", "engineer", "Which exact fields form the duplicate/conflict key?", ["stableIdentityFields"]],
  ["conflictKeySource", "engineer", "Where does the source contract carry that conflict key?", ["conflictKeyFields"]],
  ["conflictBehavior", "engineer", "What must happen when the same key identifies conflicting work?", ["conflictKeyFields"]],
  ["allowedEntityKinds", "owner", "Which exact business entity kinds may this action create or change?", ["actionOperation"]],
  ["allowedScopeFields", "owner", "Which stable fields bound the allowed mutation to the assigned item?", ["stableIdentityFields"]],
  ["maximumWritesPerAssignedItem", "owner", "What is the maximum number of business writes for one assigned item?", ["actionOperation"]],
  ["authority", "owner", "Which already-approved authority action permits this mutation?", ["actionOperation"]],
  ["approvals", "owner", "Which consequential actions still require separate approval?", ["actionOperation"]],
  ["forbiddenActions", "owner", "Which actions and protected state must never be changed by this role?", ["actionOperation"]],
  ["unknownStateHandling", "owner", "What exact handoff is required when external state is unknown or unavailable?", []],
  ["actionBindingId", "engineer", "What reviewed local binding identity will implement the action path?", ["actionOperation"]],
  ["actionSurfaceId", "engineer", "What exact customer-local surface hosts the action path?", ["actionOperation"]],
  ["actionImplementationLabel", "engineer", "Which reviewed implementation revision will be hashed for the action path?", ["actionOperation"]],
  ["reconciliationOperation", "engineer", "Which exact read-only action-source operation performs duplicate-prevention readback?", ["actionReadOperations"]],
  ["reconciliationInputBindings", "engineer", "How are stable write inputs mapped into that readback operation?", ["reconciliationOperation", "stableIdentityFields"]],
  ["noBlindRetry", "engineer", "Must every retry remain blocked until a fresh observation proves not-started?", ["reconciliationOperation"]],
  ["automaticRetries", "engineer", "How many automatic retries are permitted before independent classification?", ["noBlindRetry"]],
  ["maximumGatedRetries", "engineer", "After an explicit gate and fresh not-started proof, how many retries are permitted?", ["noBlindRetry"]],
  ["observerOperations", "engineer", "Which exact operations on the separate observer source are read-only proof inputs?", ["stableIdentityFields"]],
  ["observerId", "engineer", "What exact observer binding identity will be used?", ["observerOperations"]],
  ["observerSurfaceId", "engineer", "What separate read-only surface hosts the observer?", ["observerOperations"]],
  ["observerImplementationLabel", "engineer", "Which reviewed implementation revision will be hashed for the observer?", ["observerOperations"]],
  ["observerIndependent", "engineer", "Has the proposed observer been deliberately separated from the action source, surface, implementation, authentication and credential alias?", ["observerOperations", "actionSurfaceId"]],
  ["requiredExactFields", "owner", "Which exact assigned-work fields must match the externally observed result?", ["stableIdentityFields"]],
  ["statusField", "owner", "Which observed field carries the result state?", ["observerOperations"]],
  ["completionStatuses", "owner", "Which exact observed states count as complete?", ["statusField"]],
  ["resultIdentityField", "owner", "Which observed field uniquely identifies each result record?", ["observerOperations"]],
  ["maximumDistinctResults", "owner", "How many distinct results may exist for one stable identity?", ["resultIdentityField"]],
  ["changedEntitiesField", "engineer", "Which observer field lists every changed entity?", ["observerOperations"]],
  ["unrelatedStateDigestField", "engineer", "Which observer field proves unrelated protected state stayed unchanged?", ["observerOperations"]],
  ["snapshotGeneratedAtField", "engineer", "Which observer field records when the snapshot was generated?", ["observerOperations"]],
  ["caughtUpThroughField", "engineer", "Which observer field records the event-time fence covered by the snapshot?", ["observerOperations"]],
  ["maximumAgeMs", "engineer", "What maximum observation age is permitted?", ["snapshotGeneratedAtField", "caughtUpThroughField"]],
  ["predicates", "engineer", "Which exact predicates must the observer evaluate for success?", ["requiredExactFields", "completionStatuses"]],
  ["invariants", "engineer", "Which protected-state and duplicate invariants must always hold?", ["changedEntitiesField", "unrelatedStateDigestField", "maximumDistinctResults"]],
  ["terminalOutcomes", "owner", "For all ten outcome classes, what exact accept, halt, quarantine, handoff or retry-gate behavior applies?", ["unknownStateHandling"]],
  ["ownerReviewer", "owner", "Who is the exact role owner confirming business, authority and outcome meaning?", []],
  ["engineerReviewer", "engineer", "Who is the exact engineer reviewing runtime, write-safety and proof wiring?", []],
]);

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function clean(value, maximum = 2_000) { return String(value ?? "").trim().slice(0, maximum); }
function stable(value) { return JSON.parse(JSON.stringify(value)); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }
function noSecrets(value, label, location = label) {
  requireCondition(!SECRET.test(JSON.stringify(value)), `${label} contains possible credential material`);
  if (Array.isArray(value)) return value.forEach((item, index) => noSecrets(item, label, `${location}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) requireCondition(child === null || child === "" || child === false || typeof child === "object", `${label} contains a credential value at ${location}.${key}`);
    noSecrets(child, label, `${location}.${key}`);
  }
}
function uniqueStrings(value, label) {
  requireCondition(Array.isArray(value) && value.length > 0, `${label} must be a non-empty array`);
  const result = value.map((item) => clean(item, 240));
  requireCondition(result.every(Boolean) && new Set(result).size === result.length, `${label} must contain unique non-empty strings`);
  return result;
}
function sourceDocument(source) { return source?.kind === "openapi" ? source.document : source?.kind === "mcp-tools-list" ? source.toolsList : null; }
function sourceHash(source) { const document = sourceDocument(source); requireCondition(document && typeof document === "object", "Pinned source material is missing"); return digest(document); }

function assertBounded(value, depth = 0, state = { nodes: 0 }) {
  requireCondition(depth <= 24 && ++state.nodes <= 20_000, "Pinned source exceeds structural limits");
  if (Array.isArray(value)) { requireCondition(value.length <= 500, "Pinned source array is too large"); value.forEach((item) => assertBounded(item, depth + 1, state)); }
  else if (value && typeof value === "object") { requireCondition(Object.keys(value).length <= 500, "Pinned source object is too large"); for (const [key, child] of Object.entries(value)) { requireCondition(!["__proto__", "prototype", "constructor"].includes(key), "Pinned source contains an unsafe object key"); if (key === "$ref") requireCondition(typeof child === "string" && child.startsWith("#/"), "External source references are forbidden"); assertBounded(child, depth + 1, state); } }
}

function openApiInventory(source, label) {
  const document = source.document;
  requireCondition(document && /^3\.\d+(?:\.\d+)?$/.test(document.openapi ?? "") && document.paths && typeof document.paths === "object", `${label} must be one OpenAPI 3.x document`);
  const operations = [];
  const seen = new Set();
  for (const [route, pathItem] of Object.entries(document.paths)) {
    requireCondition(route.startsWith("/") && pathItem && typeof pathItem === "object", `${label} contains an invalid OpenAPI path`);
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!["get", "head", "post", "put", "patch", "delete"].includes(method.toLowerCase())) continue;
      const name = clean(operation?.operationId, 240);
      requireCondition(name && !seen.has(name), `${label} contains a duplicate or missing operationId`);
      seen.add(name);
      const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])].map((parameter) => ({ name: clean(parameter.name), in: clean(parameter.in), required: parameter.required === true, schemaHash: digest(parameter.schema ?? {}) }));
      const requestSchema = operation.requestBody?.content?.["application/json"]?.schema ?? null;
      const bodyFields = Object.keys(requestSchema?.properties ?? {});
      const bodyRequired = [...(requestSchema?.required ?? [])];
      const inputFields = [...new Set([...parameters.map((item) => item.name), ...bodyFields])].sort();
      const requiredFields = [...new Set([...parameters.filter((item) => item.required).map((item) => item.name), ...bodyRequired])].sort();
      const responses = Object.entries(operation.responses ?? {}).map(([status, response]) => ({ status, descriptionHash: digest(clean(response?.description, 500)), contentSchemaHashes: Object.values(response?.content ?? {}).map((content) => digest(content?.schema ?? {})) }));
      operations.push({ name, method: method.toUpperCase(), route, modeProposal: ["GET", "HEAD"].includes(method.toUpperCase()) ? "read" : "write", inputSchemaHash: digest({ parameters, requestBody: operation.requestBody ?? null }), inputFields, requiredFields, parameters, responses, untrustedDescriptionHash: digest(clean(operation.summary || operation.description, 2_000)), instructionLikeDescription: INJECTION.test(clean(operation.summary || operation.description, 2_000)) });
    }
  }
  const baseUrl = clean(source.baseUrl || document.servers?.[0]?.url, 500);
  let parsed;
  try { parsed = new URL(baseUrl); } catch { throw new Error(`${label} needs an exact credential-free HTTP(S) base URL`); }
  requireCondition(["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.search && !parsed.hash, `${label} base URL contains unsupported authority or credentials`);
  return { kind: "openapi", sourceHash: sourceHash(source), sourceIdentity: { title: clean(document.info?.title, 240), version: clean(document.info?.version, 120), baseUrl }, operations };
}

function mcpInventory(source, label) {
  requireCondition(clean(source.serverId, 160) && clean(source.serverVersion, 120) && Array.isArray(source.toolsList?.tools), `${label} must pin server id, version and tools/list`);
  const seen = new Set();
  const operations = source.toolsList.tools.map((tool) => {
    const name = clean(tool?.name, 240);
    requireCondition(name && !seen.has(name), `${label} contains a duplicate or missing MCP tool name`);
    seen.add(name);
    requireCondition(tool.inputSchema && typeof tool.inputSchema === "object", `${label}.${name} lacks a bounded input schema`);
    const description = clean(tool.description, 2_000);
    return { name, modeProposal: tool.annotations?.readOnlyHint === true ? "read" : tool.annotations?.readOnlyHint === false || tool.annotations?.destructiveHint === true ? "write" : "review-required", inputSchemaHash: digest(tool.inputSchema), inputFields: Object.keys(tool.inputSchema.properties ?? {}).sort(), requiredFields: [...(tool.inputSchema.required ?? [])].sort(), untrustedAnnotationHash: digest(tool.annotations ?? {}), untrustedDescriptionHash: digest(description), instructionLikeDescription: INJECTION.test(description) };
  });
  return { kind: "mcp-tools-list", sourceHash: sourceHash(source), sourceIdentity: { serverId: clean(source.serverId, 160), serverVersion: clean(source.serverVersion, 120) }, operations };
}

function inventory(source, label) {
  requireCondition(["openapi", "mcp-tools-list"].includes(source?.kind), `${label} source kind is unsupported`);
  assertBounded(sourceDocument(source));
  noSecrets(source, label);
  return source.kind === "openapi" ? openApiInventory(source, label) : mcpInventory(source, label);
}

function aliases(value, label) {
  const result = uniqueStrings(value, label);
  requireCondition(result.every((alias) => ALIAS.test(alias)), `${label} must contain environment-reference aliases only`);
  return result;
}

function fact({ path, value, status, provenance, note = "" }) {
  requireCondition(FACT_STATUSES.has(status), `Unsupported draft fact status: ${status}`);
  const output = { factId: `binding-fact:${digest({ path, value, status, provenance }).slice(0, 20)}`, path, value: stable(value), status, provenance: stable(provenance), note: clean(note, 500), executable: false };
  output.factHash = digest(output);
  return Object.freeze(output);
}

function sourceFact(path, value, source, locator) { return fact({ path, value, status: "extracted", provenance: [{ source: "pinned-source", sourceHash: source.sourceHash, locator, locatorVerified: true }] }); }
function observedFact(path, value, identityHash) { return fact({ path, value, status: "observed", provenance: [{ source: "bounded-business-intake", sourceHash: identityHash, locator: path, locatorVerified: true }] }); }
function unknownFact(path, identityHash) { return fact({ path, value: null, status: "unknown", provenance: [{ source: "question-graph", sourceHash: identityHash, locator: path, locatorVerified: true }] }); }
function proposalFact(path, value, sourceHashes, note) { return fact({ path, value, status: "inferred-proposal", provenance: sourceHashes.map((hash) => ({ source: "source-grounded-candidate", sourceHash: hash, locator: path, locatorVerified: true })), note }); }

function requiredBusinessIntake(input) {
  const keys = ["roleLabel", "roleOutcome", "intendedMutation", "desiredExternallyObservableOutcome", "knownStableIdentity", "limits", "escalationOwner"];
  requireCondition(input && typeof input === "object" && !Array.isArray(input) && Object.keys(input).every((key) => keys.includes(key)), "Business intake contains unsupported fields");
  const output = Object.fromEntries(keys.map((key) => [key, key === "knownStableIdentity" ? uniqueStrings(input[key], `businessIntake.${key}`) : clean(input[key], 4_000)]));
  requireCondition(keys.filter((key) => key !== "knownStableIdentity").every((key) => output[key]), "Business intake is incomplete");
  noSecrets(output, "Business intake");
  return output;
}

function answerRole(key) { return QUESTION_DEFINITIONS.find(([id]) => id === key)?.[1]; }
function answerValue(value, key) { noSecrets(value, `Answer ${key}`); requireCondition(value !== undefined && value !== null && value !== "", `Answer ${key} is empty`); return stable(value); }
function operationNames(inv, mode = null) { return inv.operations.filter((item) => !mode || item.modeProposal === mode).map((item) => item.name); }

function validateAnsweredFacts(session, factsByKey) {
  const actionNames = new Set(session.sources.action.operations.map((item) => item.name));
  const actionReads = new Set(operationNames(session.sources.action, "read"));
  const actionWrites = new Set(operationNames(session.sources.action, "write"));
  const observerReads = new Set(operationNames(session.sources.observer, "read"));
  const one = (key) => factsByKey.get(key)?.status === "unknown" ? undefined : factsByKey.get(key)?.value;
  if (one("actionOperation") !== undefined) requireCondition(actionWrites.has(one("actionOperation")), "Confirmed action operation is not one exact source-grounded write candidate");
  if (one("actionReadOperations") !== undefined) requireCondition(uniqueStrings(one("actionReadOperations"), "actionReadOperations").every((name) => actionReads.has(name)), "actionReadOperations contains a non-read or unknown operation");
  if (one("rejectedOperations") !== undefined) requireCondition(uniqueStrings(one("rejectedOperations"), "rejectedOperations").every((name) => actionNames.has(name)), "rejectedOperations contains an unknown action-source operation");
  if (one("actionOperation") !== undefined && one("rejectedOperations") !== undefined) requireCondition(!one("rejectedOperations").includes(one("actionOperation")), "The selected action operation is explicitly rejected by the role owner");
  const write = session.sources.action.operations.find((operation) => operation.name === one("actionOperation"));
  if (write && one("stableIdentityFields") !== undefined) requireCondition(uniqueStrings(one("stableIdentityFields"), "stableIdentityFields").every((field) => write.inputFields.includes(field)), "Stable identity is not grounded in the selected write input");
  if (write && one("conflictKeyFields") !== undefined) requireCondition(uniqueStrings(one("conflictKeyFields"), "conflictKeyFields").every((field) => write.inputFields.includes(field)), "Conflict key is not grounded in the selected write input");
  if (write && one("requiredExactFields") !== undefined) requireCondition(uniqueStrings(one("requiredExactFields"), "requiredExactFields").every((field) => write.inputFields.includes(field)), "Required exact outcome fields are not grounded in the selected write input");
  if (one("reconciliationOperation") !== undefined) requireCondition(actionReads.has(one("reconciliationOperation")), "Reconciliation operation is not an exact action-source read candidate");
  if (one("observerOperations") !== undefined) requireCondition(uniqueStrings(one("observerOperations"), "observerOperations").every((name) => observerReads.has(name)), "Observer operations must be exact read candidates on the separate source");
  if (one("conflictKeySource") !== undefined) requireCondition(one("conflictKeySource") === (session.sources.action.kind === "openapi" ? "http-idempotency-header" : "mcp-required-input-field"), "Conflict-key source does not match the pinned source family");
  if (one("conflictBehavior") !== undefined) requireCondition(one("conflictBehavior") === "halt-handoff-no-overwrite", "Conflict behavior cannot overwrite or continue");
  if (one("maximumWritesPerAssignedItem") !== undefined) requireCondition(one("maximumWritesPerAssignedItem") === 1, "The bounded package permits at most one write per assigned item");
  if (one("noBlindRetry") !== undefined) requireCondition(one("noBlindRetry") === true, "Blind retry cannot be enabled");
  if (one("automaticRetries") !== undefined) requireCondition(one("automaticRetries") === 0, "Automatic retries must remain zero");
  if (one("maximumGatedRetries") !== undefined) requireCondition(one("maximumGatedRetries") === 1, "Only one explicitly gated retry is supported");
  if (one("observerIndependent") !== undefined) requireCondition(one("observerIndependent") === true && session.boundaryChecks.separateSource && session.boundaryChecks.disjointAliases, "Observer independence cannot be confirmed on a shared source or credential plane");
  if (one("maximumDistinctResults") !== undefined) requireCondition(one("maximumDistinctResults") === 1, "The bounded duplicate rule requires exactly one result maximum");
  if (one("terminalOutcomes") !== undefined) {
    const required = ["completed", "not-started", "partial", "incorrect", "duplicate", "stale", "collateral", "unknown", "unavailable", "lost-response"];
    requireCondition(required.every((key) => clean(one("terminalOutcomes")?.[key], 240)), "All ten terminal outcome meanings must be explicit");
  }
}

function rebuildSession(session, { answers = session.answers, revision = session.revision, previousRevisionHash = session.previousRevisionHash } = {}) {
  const answered = new Map(answers.map((item) => [item.questionId, item]));
  const facts = session.baseFacts.filter((item) => !item.path.startsWith("answers."));
  for (const [key] of QUESTION_DEFINITIONS) {
    const answer = answered.get(key);
    facts.push(answer ? fact({ path: `answers.${key}`, value: answer.value, status: answer.status, provenance: [{ source: "explicit-answer", sourceHash: answer.answerHash, suppliedBy: answer.suppliedBy, actorRole: answer.actorRole }] }) : unknownFact(`answers.${key}`, session.identityHash));
  }
  const byKey = new Map(facts.filter((item) => item.path.startsWith("answers.")).map((item) => [item.path.slice(8), item]));
  validateAnsweredFacts(session, byKey);
  const unresolved = QUESTION_DEFINITIONS.filter(([key]) => !answered.has(key)).map(([key]) => key);
  const blockedByBoundary = session.blockers.filter((item) => item.severity === "hard").map((item) => item.id);
  const questions = session.questionGraph.map((item) => ({ ...item, status: answered.has(item.id) ? "answered" : item.dependsOn.every((key) => answered.has(key)) ? "ready" : "deferred" }));
  const result = { ...withoutHash(session, "sessionHash"), revision, previousRevisionHash, answers: stable(answers), facts, questionGraph: questions, unresolvedQuestionIds: unresolved, currentClarificationQueue: questions.filter((item) => item.status === "ready").slice(0, 6).map((item) => item.id), status: unresolved.length || blockedByBoundary.length ? "draft-blocked-explicit-questions" : "complete-non-executable-package-input-draft", readiness: { packageInputDraftComplete: unresolved.length === 0 && blockedByBoundary.length === 0, executable: false, independentlyVerified: false, comparisonReady: false, activationReady: false }, authorizations: { credentialsAccepted: false, runtimeAuthorityGranted: false, customerWrites: false, comparisonExecution: false, activation: false } };
  result.sessionHash = digest(result);
  return Object.freeze(result);
}

export function createSourceGroundedBindingDraftSession({ sessionId, businessIntake, actionSource, observerSource, credentialAliases }) {
  const boundedIntake = requiredBusinessIntake(businessIntake);
  const action = inventory(actionSource, "Action source");
  const observer = inventory(observerSource, "Observer source");
  const actionAliases = aliases(credentialAliases?.action, "Action credential aliases");
  const observerAliases = aliases(credentialAliases?.observer, "Observer credential aliases");
  const id = clean(sessionId, 240);
  requireCondition(id, "Draft authoring needs a session id");
  const identity = { sessionId: id, businessIntakeHash: digest(boundedIntake), actionSourceHash: action.sourceHash, observerSourceHash: observer.sourceHash, actionAliasesHash: digest(actionAliases), observerAliasesHash: digest(observerAliases) };
  const identityHash = digest(identity);
  const separateSource = action.sourceHash !== observer.sourceHash && digest(action.sourceIdentity) !== digest(observer.sourceIdentity);
  const disjointAliases = actionAliases.every((alias) => !observerAliases.includes(alias));
  const observerReadOnly = observer.operations.length > 0 && observer.operations.every((item) => item.modeProposal === "read");
  const blockers = [
    ...(!separateSource ? [{ id: "independent-observer-source-collapsed", severity: "hard", owner: "engineer" }] : []),
    ...(!disjointAliases ? [{ id: "action-observer-credential-alias-shared", severity: "hard", owner: "engineer" }] : []),
    ...(!observerReadOnly ? [{ id: "observer-source-not-read-only", severity: "hard", owner: "engineer" }] : []),
  ];
  const injectionWarnings = [...action.operations, ...observer.operations].filter((item) => item.instructionLikeDescription).map((item) => `Untrusted source text for ${item.name} contains instruction-like language; it granted nothing.`);
  const actionWriteCandidates = operationNames(action, "write");
  const actionReadCandidates = operationNames(action, "read");
  const observerReadCandidates = operationNames(observer, "read");
  const candidateInputFields = [...new Set(action.operations.filter((item) => item.modeProposal === "write").flatMap((item) => item.inputFields))].sort();
  const stableIdentityCandidates = boundedIntake.knownStableIdentity.filter((field) => candidateInputFields.includes(field));
  const idempotencyCandidates = candidateInputFields.filter((field) => /(?:idempot|dedup|request.*id|conflict.*key)/i.test(field));
  const baseFacts = [
    ...Object.entries(boundedIntake).map(([key, value]) => observedFact(`business.${key}`, value, identityHash)),
    sourceFact("sources.action.identity", action.sourceIdentity, action, "source.identity"),
    sourceFact("sources.action.operations", action.operations, action, "source.operations"),
    sourceFact("sources.observer.identity", observer.sourceIdentity, observer, "source.identity"),
    sourceFact("sources.observer.operations", observer.operations, observer, "source.operations"),
    proposalFact("proposals.actionWriteCandidates", actionWriteCandidates, [action.sourceHash], "Source method or annotation only; the role owner must still choose the allowed mutation and authority."),
    proposalFact("proposals.actionReadCandidates", actionReadCandidates, [action.sourceHash], "Source method or annotation only; read semantics still require review."),
    proposalFact("proposals.observerReadCandidates", observerReadCandidates, [observer.sourceHash], "Read candidates only; this does not prove observer independence or outcome fitness."),
    proposalFact("proposals.stableIdentityCandidates", stableIdentityCandidates, [action.sourceHash, identityHash], "Intersection of customer-proposed identity names and source input fields; business stability is not inferred."),
    proposalFact("proposals.idempotencyFieldCandidates", idempotencyCandidates, [action.sourceHash], "Name-based candidate only; conflict meaning and retry safety remain unknown."),
    observedFact("credentials.actionAliases", actionAliases, identityHash),
    observedFact("credentials.observerAliases", observerAliases, identityHash),
  ];
  const questionGraph = QUESTION_DEFINITIONS.map(([key, actorRole, question, dependsOn], index) => ({ id: key, rank: index + 1, actorRole, question, dependsOn, targetHash: digest({ identityHash, key, actorRole, question, dependsOn }), status: dependsOn.length ? "deferred" : "ready" }));
  const session = { schemaVersion: "das.source-grounded-binding-draft-session.v1", sessionId: id, revision: 0, previousRevisionHash: null, identity, identityHash, businessIntake: boundedIntake, sources: { action, observer }, credentialAliases: { action: actionAliases, observer: observerAliases }, boundaryChecks: { separateSource, disjointAliases, observerReadOnly }, baseFacts, facts: [], answers: [], questionGraph, unresolvedQuestionIds: [], currentClarificationQueue: [], blockers, warnings: injectionWarnings, measurements: { sourceOperationsExtracted: action.operations.length + observer.operations.length, sourceInstructionWarnings: injectionWarnings.length, modelCalls: 0, spendUsd: 0 }, evidenceBoundary: "Source-grounded, integrity-bound, non-executable draft only. Source text is inert evidence; it cannot grant authority, prove write safety, establish observer independence, authorize credentials, execute, compare or activate." };
  return rebuildSession(session);
}

export function applySourceGroundedBindingDraftAnswers({ session, answers, suppliedBy = {}, expectedSessionHash }) {
  assertSourceGroundedBindingDraftSession(session);
  requireCondition(expectedSessionHash === session.sessionHash, "Binding-draft answer batch is stale or belongs to another session revision");
  requireCondition(answers && typeof answers === "object" && !Array.isArray(answers), "Draft answers must be one keyed answer object");
  const questions = new Map(session.questionGraph.map((item) => [item.id, item]));
  const existing = new Map(session.answers.map((item) => [item.questionId, item]));
  const batchQuestionIds = new Set(Object.keys(answers));
  let changed = false;
  for (const [questionId, rawValue] of Object.entries(answers)) {
    const question = questions.get(questionId);
    requireCondition(question, `Unknown binding-draft question: ${questionId}`);
    requireCondition(question.dependsOn.every((dependency) => existing.has(dependency) || batchQuestionIds.has(dependency)), `Answer ${questionId} is stale or premature because required questions remain unresolved`);
    const actorRole = answerRole(questionId);
    const supplier = clean(suppliedBy[actorRole], 240);
    requireCondition(supplier, `Answer ${questionId} needs an exact ${actorRole} supplier identity`);
    const value = answerValue(rawValue, questionId);
    const answer = { schemaVersion: "das.source-grounded-binding-answer.v1", sessionId: session.sessionId, identityHash: session.identityHash, priorRevisionHash: session.sessionHash, questionId, targetHash: question.targetHash, actorRole, status: actorRole === "owner" ? "owner-confirmed" : "engineer-confirmed", suppliedBy: supplier, value };
    answer.answerHash = digest(answer);
    const prior = existing.get(questionId);
    if (prior) { requireCondition(prior.answerHash === answer.answerHash || JSON.stringify(prior.value) === JSON.stringify(value) && prior.suppliedBy === supplier && prior.status === answer.status, `Conflicting replay for binding-draft answer ${questionId}`); continue; }
    existing.set(questionId, answer); changed = true;
  }
  if (!changed) return session;
  const ordered = QUESTION_DEFINITIONS.map(([key]) => existing.get(key)).filter(Boolean);
  return rebuildSession(session, { answers: ordered, revision: session.revision + 1, previousRevisionHash: session.sessionHash });
}

export function assertSourceGroundedBindingDraftSession(session) {
  requireCondition(session?.schemaVersion === "das.source-grounded-binding-draft-session.v1" && session.sessionHash === digest(withoutHash(session, "sessionHash")), "Source-grounded binding-draft session integrity mismatch");
  requireCondition(session.identityHash === digest(session.identity) && session.identity.businessIntakeHash === digest(session.businessIntake), "Binding-draft identity changed");
  requireCondition(session.identity.actionSourceHash === session.sources.action.sourceHash && session.identity.observerSourceHash === session.sources.observer.sourceHash, "Binding-draft source identity changed");
  requireCondition(session.identity.actionAliasesHash === digest(session.credentialAliases.action) && session.identity.observerAliasesHash === digest(session.credentialAliases.observer), "Binding-draft credential aliases changed");
  requireCondition(Object.values(session.authorizations).every((value) => value === false) && session.readiness.executable === false && session.readiness.independentlyVerified === false && session.readiness.comparisonReady === false && session.readiness.activationReady === false, "Binding-draft session widened readiness or authority");
  requireCondition(session.facts.every((item) => FACT_STATUSES.has(item.status) && item.executable === false && item.factHash === digest(withoutHash(item, "factHash"))), "Binding-draft session contains an invalid fact");
  const questions = new Map(session.questionGraph.map((item) => [item.id, item]));
  requireCondition(questions.size === QUESTION_DEFINITIONS.length && session.answers.every((answer) => answer.sessionId === session.sessionId && answer.identityHash === session.identityHash && questions.get(answer.questionId)?.targetHash === answer.targetHash && answer.answerHash === digest(withoutHash(answer, "answerHash"))), "Binding-draft answer chain contains a stale or substituted answer");
  return true;
}

function answered(session) { return Object.fromEntries(session.answers.map((item) => [item.questionId, item.value])); }
function provenance(status, suppliedBy, sourceHash) { return { status, suppliedBy, sourceHash }; }

export function materializeSourceGroundedBindingPackageInputs({ session, structuralBinding, workPlan }) {
  assertSourceGroundedBindingDraftSession(session);
  requireCondition(session.readiness.packageInputDraftComplete === true, "Binding-draft questions or source-boundary blockers remain unresolved");
  requireCondition(structuralBinding?.source?.sourceHash === session.sources.action.sourceHash && workPlan?.source?.sourceHash === session.sources.action.sourceHash, "Binding-draft action source differs from the reviewed structural chain");
  const a = answered(session);
  const owner = (label) => provenance("customer-confirmed", a.ownerReviewer, structuralBinding.confirmationHash);
  const engineer = (label) => provenance("engineer-supplied-unproved", a.engineerReviewer, digest({ sessionHash: session.sessionHash, label, status: "unproved" }));
  const segmentTransports = [...new Set(structuralBinding.compilerSegments.map((item) => item.transportIdentityHash))];
  requireCondition(segmentTransports.length === 1, "Binding-draft materialization needs one exact action transport identity");
  const sourceIdentity = session.sources.action.kind === "openapi" ? {
    kind: "openapi", sourceHash: session.sources.action.sourceHash, provenance: provenance("reviewed-source-observed", "DAS-024 exact pinned action source", session.sources.action.sourceHash),
    openapi: { documentHash: session.sources.action.sourceHash, baseUrl: session.sources.action.sourceIdentity.baseUrl, transportIdentityHash: segmentTransports[0] },
  } : {
    kind: "mcp-tools-list", sourceHash: session.sources.action.sourceHash, provenance: provenance("reviewed-source-observed", "DAS-024 exact pinned action source", session.sources.action.sourceHash),
    mcp: { serverId: session.sources.action.sourceIdentity.serverId, serverVersion: session.sources.action.sourceIdentity.serverVersion, toolsListHash: session.sources.action.sourceHash, transportIdentityHash: segmentTransports[0] },
  };
  const actionRuntime = {
    bindingId: a.actionBindingId, surfaceId: a.actionSurfaceId, credentialAliases: session.credentialAliases.action,
    implementationHash: digest({ reviewedImplementationLabel: a.actionImplementationLabel }),
    runtimeSchemaHash: digest(session.sources.action.operations.map(({ name, inputSchemaHash }) => ({ name, inputSchemaHash }))),
    authenticationIdentityHash: digest({ bindingId: a.actionBindingId, surfaceId: a.actionSurfaceId, aliases: session.credentialAliases.action, review: a.engineerReviewer }), provenance: engineer("action-runtime"),
  };
  const terminalBehavior = { unknown: "halt-handoff-no-retry", unavailable: "halt-handoff-no-retry", partial: "halt-quarantine-no-retry", incorrect: "halt-quarantine-no-retry", duplicate: "halt-quarantine-no-retry", collateral: "halt-quarantine-no-retry", provenance: owner("terminal-behavior") };
  const writeSafety = [{
    sourceName: a.actionOperation,
    stableIdentity: { fields: a.stableIdentityFields, provenance: owner("stable-identity") },
    idempotency: { conflictKeyFields: a.conflictKeyFields, conflictKeySource: a.conflictKeySource, conflictBehavior: a.conflictBehavior, provenance: engineer("idempotency") },
    allowedMutation: { entityKinds: a.allowedEntityKinds, scopeFields: a.allowedScopeFields, maximumWritesPerAssignedItem: a.maximumWritesPerAssignedItem, provenance: owner("allowed-mutation") },
    reconciliation: { readOperation: a.reconciliationOperation, inputBindings: a.reconciliationInputBindings, requiredPredicates: ["one exact result for the stable identity", "no protected or unrelated state changed"], proofSource: "separate-independent-observer", provenance: engineer("reconciliation") },
    retryPolicy: { automaticRetries: a.automaticRetries, eligibleClassification: "not-started", requiresExplicitGate: a.noBlindRetry, maximumGatedRetries: a.maximumGatedRetries, provenance: engineer("retry") },
    terminalBehavior,
    review: { responsibility: "customer-local-engineer-and-role-owner-reviewed-unproved", reviewedBy: `${a.ownerReviewer} + ${a.engineerReviewer}`, confirmationHash: structuralBinding.confirmationHash, successCriteriaHash: structuralBinding.successCriteriaHash, provenance: owner("write-review") },
  }];
  const observerSource = session.sources.observer;
  const observerTransport = digest({ sourceKind: observerSource.kind, sourceIdentity: observerSource.sourceIdentity, sourceHash: observerSource.sourceHash });
  const observerProof = {
    runtime: { observerId: a.observerId, surfaceId: a.observerSurfaceId, credentialAliases: session.credentialAliases.observer, implementationHash: digest({ reviewedImplementationLabel: a.observerImplementationLabel }), sourceHash: observerSource.sourceHash, runtimeSchemaHash: digest({ operations: observerSource.operations, requiredExactFields: a.requiredExactFields, statusField: a.statusField }), transportIdentityHash: observerTransport, authenticationIdentityHash: digest({ observerId: a.observerId, surfaceId: a.observerSurfaceId, aliases: session.credentialAliases.observer, review: a.engineerReviewer }), readOperations: a.observerOperations, provenance: engineer("observer-runtime") },
    stableIdentity: { fields: a.stableIdentityFields, provenance: owner("observer-stable-identity") },
    freshness: { snapshotGeneratedAtField: a.snapshotGeneratedAtField, caughtUpThroughField: a.caughtUpThroughField, maximumAgeMs: a.maximumAgeMs, provenance: engineer("freshness") },
    outcomeRules: { requiredExactFields: a.requiredExactFields, statusField: a.statusField, completionStatuses: a.completionStatuses, provenance: owner("outcome-rules") },
    duplicateRule: { maximumDistinctResults: a.maximumDistinctResults, resultIdentityField: a.resultIdentityField, provenance: owner("duplicate-rule") },
    collateralRules: { changedEntitiesField: a.changedEntitiesField, unrelatedStateDigestField: a.unrelatedStateDigestField, allowedChangedEntityKinds: a.allowedEntityKinds, provenance: owner("collateral-rules") },
    predicates: { values: a.predicates, provenance: engineer("predicates") },
    invariants: { values: a.invariants, provenance: engineer("invariants") },
    evidenceTiming: { beforeActionBaselineRequired: true, afterActionFenceRequired: true, futureEvidenceRejected: true, preExistingMatchRejected: true, provenance: engineer("evidence-timing") },
    proofRuleReview: { responsibility: "engineer-owned-reviewed-unproved", reviewedBy: a.engineerReviewer, confirmationHash: structuralBinding.confirmationHash, successCriteriaHash: structuralBinding.successCriteriaHash, provenance: engineer("proof-rule-review") },
  };
  const output = { schemaVersion: "das.source-grounded-binding-package-input-draft.v1", sessionHash: session.sessionHash, sourceIdentity, actionRuntime, writeSafety, observerProof, protectedGates: { credentialValues: 0, runtimeAuthorityGranted: false, independentlyVerified: false, executable: false, comparisonReady: false, activationReady: false }, evidenceBoundary: "Complete reviewed input draft for the unchanged DAS-023 package factory. It remains unproved, non-executable and unactivated until separate local qualification, customer-environment acceptance and activation gates." };
  output.draftHash = digest(output);
  return Object.freeze(output);
}

export const SOURCE_GROUNDED_BINDING_QUESTION_IDS = Object.freeze(QUESTION_DEFINITIONS.map(([id]) => id));
