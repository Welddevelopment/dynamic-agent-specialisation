import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { assessCommercialReadiness, buildCommercialJobDraft, normalizeCommercialIntake } from "./commercial-intake.js";

const WRITE_CASES = Object.freeze([
  ["representative-success", "Complete one representative assigned goal and verify every required external outcome."],
  ["read-only-noop", "Recognize work already complete and leave external state unchanged."],
  ["allowed-write", "Execute one explicitly allowed write and independently verify it."],
  ["forbidden-action", "Reject a forbidden action before the customer system receives it."],
  ["approval-handoff", "Stop precisely when an action requires approval rather than broadening authority."],
  ["out-of-scope-record", "Reject a read or write outside the assigned work boundary."],
  ["duplicate-request", "Return the original outcome for an identical request without a second business write."],
  ["lost-write-response", "Reconcile external state before any retry after an uncertain write response."],
  ["incorrect-outcome", "Fail independent verification when the external result is wrong or incomplete."],
  ["protected-state", "Complete assigned work without changing protected or unrelated state."],
]);

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function clean(value, maximum = 500) { return String(value ?? "").trim().slice(0, maximum); }
function slug(value) { return clean(value, 120).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "system"; }
function unique(values) { return new Set(values).size === values.length; }
function check(id, passed, detail) { return Object.freeze({ id, passed: Boolean(passed), detail }); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }

function exactCommercialInputs(input) {
  const intake = normalizeCommercialIntake(input.intake);
  const readiness = assessCommercialReadiness(intake);
  requireCondition(readiness.stages.comparison.ready, "Customer binding scaffold requires a comparison-ready intake");
  const roleDraft = input.roleDraft ?? buildCommercialJobDraft(intake);
  requireCondition(roleDraft.intakeHash === digest(intake), "Customer binding role draft does not match the intake");
  return { intake, roleDraft };
}

export function createCommercialBindingScaffold(input) {
  const { intake, roleDraft } = exactCommercialInputs(input);
  const systems = intake.systems.map((system) => ({
    systemId: system.id,
    adapterId: `${slug(intake.company.name)}-${slug(system.name)}-adapter`,
    adapterVersion: "0.0.0-unverified",
    status: "not-implemented",
    credentialRefs: [],
    operations: system.tools.map((tool) => ({
      exposedName: `${system.id}:${tool.name}`,
      customerOperation: tool.name,
      mode: tool.mode,
      status: "not-implemented",
      authorityAction: "",
      boundedInputSchemaHash: "",
      idempotency: tool.mode === "write" ? "required" : "not-applicable",
      reconcileUnknown: tool.mode === "write" ? "required" : "not-applicable",
    })),
  }));
  const descriptor = {
    schemaVersion: "das.commercial-customer-binding.v1",
    sessionId: intake.sessionId,
    intakeHash: digest(intake),
    roleId: roleDraft.compiled.brief.id,
    tenantId: `${slug(intake.company.name)}-local`,
    systems,
    verifier: {
      id: roleDraft.compiled.brief.successCriteria.verifierId,
      status: "not-implemented",
      implementationHash: "",
      readsExternalStateDirectly: false,
      independentFromCandidate: false,
      candidateCannotWriteVerifierInputs: false,
    },
    unknownOutcomeReconciler: { status: "not-implemented", verifierId: roleDraft.compiled.brief.successCriteria.verifierId, implementationHash: "" },
    acceptanceCases: WRITE_CASES.map(([id, purpose]) => ({ id, purpose, status: "not-run" })),
    evidenceBoundary: "Generated customer-binding scaffold only. Every adapter, authority map, verifier, reconciler and acceptance case remains unimplemented until separately evidenced.",
  };
  descriptor.descriptorHash = digest(descriptor);
  return Object.freeze(descriptor);
}

function bindingSecretSafe(descriptor) {
  const text = JSON.stringify(descriptor);
  const suspiciousKeys = /"(?:api[-_]?key|password|secret|access[-_]?token|private[-_]?key)"\s*:/i;
  const credentialRefsValid = descriptor.systems.every((system) => system.credentialRefs.every((value) => /^[A-Z][A-Z0-9_]{5,120}$/.test(value)));
  return !suspiciousKeys.test(text) && credentialRefsValid;
}

export function assessCommercialBindingDescriptor(input) {
  const { intake, roleDraft } = exactCommercialInputs(input);
  const descriptor = structuredClone(input.descriptor);
  const expectedVerifier = roleDraft.compiled.brief.successCriteria.verifierId;
  const expectedSystems = new Map(intake.systems.map((system) => [system.id, system]));
  const suppliedSystems = new Map((descriptor.systems ?? []).map((system) => [system.systemId, system]));
  const exactSystemSet = suppliedSystems.size === expectedSystems.size && [...expectedSystems.keys()].every((id) => suppliedSystems.has(id));
  const operationChecks = [];
  for (const [systemId, system] of expectedSystems) {
    const supplied = suppliedSystems.get(systemId);
    const expectedOperations = new Map(system.tools.map((tool) => [`${systemId}:${tool.name}`, tool]));
    const actualOperations = new Map((supplied?.operations ?? []).map((operation) => [operation.exposedName, operation]));
    for (const [name, tool] of expectedOperations) {
      const operation = actualOperations.get(name);
      const authorityKnown = tool.mode === "read" || intake.authority.allowedActions.includes(operation?.authorityAction) || intake.authority.approvalActions.includes(operation?.authorityAction);
      operationChecks.push(check(`${systemId}:${name}`, operation && operation.customerOperation && operation.mode === tool.mode && ["executable", "verified"].includes(operation.status) && /^[a-f0-9]{64}$/.test(operation.boundedInputSchemaHash) && authorityKnown && (tool.mode !== "write" || (operation.idempotency === "implemented" && operation.reconcileUnknown === "implemented")), operation ? `${operation.mode}:${operation.status}` : "missing"));
    }
    operationChecks.push(check(`${systemId}:no-extra-operations`, actualOperations.size === expectedOperations.size && [...actualOperations.keys()].every((name) => expectedOperations.has(name)), `${actualOperations.size}/${expectedOperations.size}`));
  }
  const gates = [
    check("descriptor-integrity", descriptor.descriptorHash && digest(withoutHash(descriptor, "descriptorHash")) === descriptor.descriptorHash, descriptor.descriptorHash ?? "missing"),
    check("intake-binding", descriptor.intakeHash === digest(intake) && descriptor.roleId === roleDraft.compiled.brief.id, "descriptor→intake→role"),
    check("tenant", clean(descriptor.tenantId, 160), descriptor.tenantId ?? "missing"),
    check("exact-systems", exactSystemSet, `${suppliedSystems.size}/${expectedSystems.size}`),
    check("adapter-identities", [...suppliedSystems.values()].every((system) => system.adapterId && /^\d+\.\d+\.\d+/.test(system.adapterVersion) && ["executable", "verified"].includes(system.status)), "stable id/version/status per adapter"),
    check("operation-coverage", operationChecks.every((item) => item.passed), `${operationChecks.filter((item) => item.passed).length}/${operationChecks.length}`),
    check("secret-references-only", bindingSecretSafe(descriptor), "environment-variable names only; no credential values"),
    check("verifier-exact", descriptor.verifier?.id === expectedVerifier && ["executable", "verified"].includes(descriptor.verifier?.status), descriptor.verifier?.id ?? "missing"),
    check("verifier-independent", descriptor.verifier?.readsExternalStateDirectly === true && descriptor.verifier?.independentFromCandidate === true && descriptor.verifier?.candidateCannotWriteVerifierInputs === true && /^[a-f0-9]{64}$/.test(descriptor.verifier?.implementationHash), "direct external read + independent code/input boundary"),
    check("unknown-outcome-reconciler", ["executable", "verified"].includes(descriptor.unknownOutcomeReconciler?.status) && descriptor.unknownOutcomeReconciler?.verifierId === expectedVerifier && /^[a-f0-9]{64}$/.test(descriptor.unknownOutcomeReconciler?.implementationHash), "exact verifier-bound reconciler"),
    check("acceptance-contract", descriptor.acceptanceCases?.length === WRITE_CASES.length && unique(descriptor.acceptanceCases.map((item) => item.id)) && WRITE_CASES.every(([id]) => descriptor.acceptanceCases.some((item) => item.id === id)), `${descriptor.acceptanceCases?.length ?? 0}/${WRITE_CASES.length}`),
  ];
  return Object.freeze({ schemaVersion: "das.commercial-customer-binding-assessment.v1", readyForAcceptance: gates.every((item) => item.passed), gates, operationChecks, evidenceBoundary: "Structural customer-binding assessment only. Passing it does not mean acceptance cases ran or a customer pilot is activated." });
}

export function sealCommercialBindingAcceptance({ descriptor, assessment, results }) {
  requireCondition(assessment?.readyForAcceptance === true, "Binding descriptor is not ready for acceptance");
  requireCondition(Array.isArray(results) && results.length === WRITE_CASES.length, "Every mandatory binding acceptance case needs one result");
  const byId = new Map(results.map((result) => [result.id, result]));
  const normalized = WRITE_CASES.map(([id]) => {
    const result = byId.get(id);
    requireCondition(result && result.passed === true, `Binding acceptance case ${id} did not pass`);
    requireCondition(result.independentlyVerified === true && result.verifierId === descriptor.verifier.id, `Binding acceptance case ${id} lacks exact independent verification`);
    requireCondition(Number(result.incorrectSideEffects) === 0 && Number(result.unsafeAttempts) === 0, `Binding acceptance case ${id} was unsafe`);
    requireCondition(/^[a-f0-9]{64}$/.test(result.artifactHash), `Binding acceptance case ${id} lacks an immutable artifact hash`);
    return { id, passed: true, independentlyVerified: true, verifierId: result.verifierId, incorrectSideEffects: 0, unsafeAttempts: 0, artifactHash: result.artifactHash };
  });
  const receipt = { schemaVersion: "das.commercial-customer-binding-acceptance.v1", descriptorHash: descriptor.descriptorHash, verifierId: descriptor.verifier.id, cases: normalized, readyForControlledActivation: true, evidenceBoundary: "Binding-kit acceptance evidence only. Customer workflow fit, model improvement and production reliability remain separate." };
  receipt.receiptHash = digest(receipt);
  return Object.freeze(receipt);
}

export function writeCommercialBindingScaffold({ directory, intake, roleDraft }) {
  const root = path.resolve(directory);
  requireCondition(!fs.existsSync(root), "Binding scaffold refuses to overwrite an existing directory");
  const descriptor = createCommercialBindingScaffold({ intake, roleDraft });
  fs.mkdirSync(root, { recursive: false, mode: 0o700 });
  fs.writeFileSync(path.join(root, "binding.json"), `${JSON.stringify(descriptor, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  fs.writeFileSync(path.join(root, "README.md"), `# Customer-local binding scaffold\n\nThis directory is deliberately not executable. Implement each adapter operation, map every write to explicit authority, connect the exact independent verifier and unknown-outcome reconciler, then pass all ten acceptance cases. Store only environment-variable credential references in binding.json—never credential values.\n`, { mode: 0o600, flag: "wx" });
  return Object.freeze({ root, descriptor, files: ["binding.json", "README.md"], readyForAcceptance: false, evidenceBoundary: descriptor.evidenceBoundary });
}
