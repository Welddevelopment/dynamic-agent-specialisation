import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { CUSTOMER_LOCAL_QUALIFICATION_EXPECTATIONS } from "./customer-local-binding-qualification.js";

const HASH = /^[a-f0-9]{64}$/;
const ALIAS = /^[A-Z][A-Z0-9_]{5,120}$/;
const SECRET_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\bBasic\s+[A-Za-z0-9+/=]{8,}|\bsk-[A-Za-z0-9_-]{8,}|-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----|\b(?:password|secret|token|api[-_]?key)\s*[:=]\s*["']?[^\s,"'}]{6,})/i;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

function clean(value, maximum = 240) {
  return String(value ?? "").trim().slice(0, maximum);
}

function exactHash(value, label) {
  requireCondition(HASH.test(value ?? ""), `${label} must be an exact SHA-256 hash`);
  return value;
}

function aliases(values, label) {
  requireCondition(Array.isArray(values) && values.length > 0, `${label} must contain at least one customer-local alias`);
  const normalized = values.map((value) => clean(value, 121));
  requireCondition(normalized.every((value) => ALIAS.test(value)), `${label} must contain aliases only`);
  requireCondition(new Set(normalized).size === normalized.length, `${label} contains duplicate aliases`);
  return normalized;
}

function assertNoSecretValues(value, label) {
  requireCondition(!SECRET_VALUE.test(JSON.stringify(value)), `${label} contains possible credential material`);
}

function assertProtectedGates(value, label) {
  requireCondition(value && value.executable === false, `${label} must remain non-executable`);
  requireCondition(value.activationReady === false, `${label} must remain unactivated`);
  if (Object.hasOwn(value, "independentlyVerified")) requireCondition(value.independentlyVerified === false, `${label} cannot claim independent verification`);
  if (Object.hasOwn(value, "comparisonReady")) requireCondition(value.comparisonReady === false, `${label} cannot claim comparison readiness`);
  if (Object.hasOwn(value, "runtimeAuthorityGranted")) requireCondition(value.runtimeAuthorityGranted === false, `${label} cannot grant runtime authority`);
}

function normalizeFromDraft(value) {
  requireCondition(value?.schemaVersion === "das.source-grounded-binding-package-input-draft.v1", "Unsupported DAS-024 package-input draft");
  requireCondition(value.draftHash === digest(withoutHash(value, "draftHash")), "DAS-024 package-input draft integrity mismatch");
  assertProtectedGates(value.protectedGates, "DAS-024 package-input draft");
  const source = value.sourceIdentity;
  const action = value.actionRuntime;
  const observer = value.observerProof?.runtime;
  requireCondition(source && action && observer, "DAS-024 draft is missing action or observer runtime declarations");
  const transportIdentityHash = source.kind === "openapi" ? source.openapi?.transportIdentityHash : source.mcp?.transportIdentityHash;
  const writeOperations = (value.writeSafety ?? []).map((contract) => clean(contract.sourceName)).filter(Boolean);
  const reconcileOperations = (value.writeSafety ?? []).map((contract) => clean(contract.reconciliation?.readOperation)).filter(Boolean);
  requireCondition(writeOperations.length > 0 && writeOperations.length === value.writeSafety.length, "DAS-024 draft must name every write operation");
  return {
    inputKind: "das024-package-input-draft",
    inputHash: value.draftHash,
    sourceKind: source.kind,
    action: {
      bindingId: clean(action.bindingId),
      surfaceId: clean(action.surfaceId),
      credentialAliases: aliases(action.credentialAliases, "Action credential aliases"),
      sourceHash: exactHash(source.sourceHash, "Action source hash"),
      runtimeSchemaHash: exactHash(action.runtimeSchemaHash, "Action runtime schema hash"),
      transportIdentityHash: exactHash(transportIdentityHash, "Action transport identity hash"),
      implementationIntentHash: exactHash(action.implementationHash, "Action implementation-intent hash"),
      authenticationIdentityHash: exactHash(action.authenticationIdentityHash, "Action authentication identity hash"),
      writeOperations,
      reconcileOperations,
    },
    observer: {
      observerId: clean(observer.observerId),
      surfaceId: clean(observer.surfaceId),
      credentialAliases: aliases(observer.credentialAliases, "Observer credential aliases"),
      sourceHash: exactHash(observer.sourceHash, "Observer source hash"),
      runtimeSchemaHash: exactHash(observer.runtimeSchemaHash, "Observer runtime schema hash"),
      transportIdentityHash: exactHash(observer.transportIdentityHash, "Observer transport identity hash"),
      implementationIntentHash: exactHash(observer.implementationHash, "Observer implementation-intent hash"),
      authenticationIdentityHash: exactHash(observer.authenticationIdentityHash, "Observer authentication identity hash"),
      readOperations: [...(observer.readOperations ?? [])].map((item) => clean(item)).filter(Boolean),
      proofContractHash: digest(value.observerProof),
    },
  };
}

function assertGeneratedPackageIntegrity(value) {
  requireCondition(value?.schemaVersion === "das.customer-local-binding-package.v1", "Unsupported DAS-023 generated package");
  requireCondition(value.receipt?.receiptHash === digest(withoutHash(value.receipt, "receiptHash")), "DAS-023 package receipt integrity mismatch");
  requireCondition(value.runtimeWorkPack?.workPackHash === digest(withoutHash(value.runtimeWorkPack, "workPackHash")), "DAS-023 work-pack integrity mismatch");
  requireCondition(value.actionRuntimeDeclaration?.declarationHash === digest(withoutHash(value.actionRuntimeDeclaration, "declarationHash")), "DAS-023 action declaration integrity mismatch");
  requireCondition(value.proofContractInput?.contractHash === digest(withoutHash(value.proofContractInput, "contractHash")), "DAS-023 proof-input integrity mismatch");
  requireCondition(value.observerContract?.contractHash === digest(withoutHash(value.observerContract, "contractHash")), "DAS-023 observer-contract integrity mismatch");
  requireCondition(value.candidate?.candidateHash === digest(withoutHash(value.candidate, "candidateHash")), "DAS-023 candidate integrity mismatch");
  requireCondition(value.receipt.actionRuntimeDeclarationHash === value.actionRuntimeDeclaration.declarationHash, "DAS-023 receipt does not bind the action declaration");
  requireCondition(value.receipt.proofContractInputHash === value.proofContractInput.contractHash, "DAS-023 receipt does not bind the proof input");
  requireCondition(value.receipt.observerContractHash === value.observerContract.contractHash, "DAS-023 receipt does not bind the observer contract");
  requireCondition(value.receipt.candidateHash === value.candidate.candidateHash, "DAS-023 receipt does not bind the candidate");
  requireCondition(value.receipt.workPackHash === value.runtimeWorkPack.workPackHash, "DAS-023 receipt does not bind the work pack");
  requireCondition(value.receipt.executableOperations === 0 && value.receipt.runtimeAuthorityGranted === false && value.receipt.comparisonReady === false && value.receipt.qualified === false && value.receipt.activated === false, "DAS-023 package widened a protected gate");
  requireCondition(value.candidate.executable === false && value.observerContract.executable === false && value.runtimeWorkPack.gates?.executable === false, "DAS-023 package fabricated executable evidence");
}

function normalizeFromPackage(value) {
  assertGeneratedPackageIntegrity(value);
  const source = value.sourceIdentity;
  const action = value.actionRuntimeDeclaration;
  const observer = value.proofContractInput.runtime;
  const transportIdentityHash = source.kind === "openapi" ? source.openapi?.transportIdentityHash : source.mcp?.transportIdentityHash;
  const writeOperations = (value.writeSafetyContracts ?? []).map((contract) => clean(contract.sourceName)).filter(Boolean);
  const reconcileOperations = (value.writeSafetyContracts ?? []).map((contract) => clean(contract.reconciliation?.readOperation)).filter(Boolean);
  return {
    inputKind: "das023-generated-package",
    inputHash: value.receipt.receiptHash,
    sourceKind: source.kind,
    action: {
      bindingId: clean(action.bindingId),
      surfaceId: clean(action.surfaceId),
      credentialAliases: aliases(action.credentialAliases, "Action credential aliases"),
      sourceHash: exactHash(action.sourceHash, "Action source hash"),
      runtimeSchemaHash: exactHash(action.runtimeSchemaHash, "Action runtime schema hash"),
      transportIdentityHash: exactHash(transportIdentityHash, "Action transport identity hash"),
      implementationIntentHash: exactHash(action.implementationHash, "Action implementation-intent hash"),
      authenticationIdentityHash: exactHash(action.authenticationIdentityHash, "Action authentication identity hash"),
      writeOperations,
      reconcileOperations,
      operationIdentityPins: value.candidate.action.operations.map((operation) => ({ sourceName: operation.sourceName, targetExposedName: operation.targetExposedName, mode: operation.mode, boundedInputSchemaHash: operation.boundedInputSchemaHash })),
    },
    observer: {
      observerId: clean(observer.observerId),
      surfaceId: clean(observer.surfaceId),
      credentialAliases: aliases(observer.credentialAliases, "Observer credential aliases"),
      sourceHash: exactHash(observer.sourceHash, "Observer source hash"),
      runtimeSchemaHash: exactHash(observer.runtimeSchemaHash, "Observer runtime schema hash"),
      transportIdentityHash: exactHash(observer.transportIdentityHash, "Observer transport identity hash"),
      implementationIntentHash: exactHash(observer.implementationHash, "Observer implementation-intent hash"),
      authenticationIdentityHash: exactHash(observer.authenticationIdentityHash, "Observer authentication identity hash"),
      readOperations: [...(observer.readOperations ?? [])].map((item) => clean(item)).filter(Boolean),
      proofContractHash: value.proofContractInput.contractHash,
    },
  };
}

function assertSeparatedTrustPlanes(normalized) {
  requireCondition(normalized.action.bindingId && normalized.action.surfaceId, "Action project requires exact binding and surface ids");
  requireCondition(normalized.observer.observerId && normalized.observer.surfaceId, "Observer project requires exact observer and surface ids");
  requireCondition(normalized.observer.readOperations.length > 0, "Observer project requires at least one reviewed read-only operation");
  requireCondition(normalized.action.sourceHash !== normalized.observer.sourceHash, "Action and observer projects must pin separate source identities");
  requireCondition(normalized.action.transportIdentityHash !== normalized.observer.transportIdentityHash, "Action and observer projects must pin separate transport identities");
  requireCondition(normalized.action.authenticationIdentityHash !== normalized.observer.authenticationIdentityHash, "Action and observer projects must pin separate authentication identities");
  requireCondition(normalized.action.credentialAliases.every((alias) => !normalized.observer.credentialAliases.includes(alias)), "Action and observer projects must use disjoint credential aliases");
}

function assertExactChain(draft, generatedPackage) {
  const fromDraft = normalizeFromDraft(draft);
  const fromPackage = normalizeFromPackage(generatedPackage);
  const comparable = (value) => {
    const action = { ...value.action };
    const observer = { ...value.observer };
    delete action.operationIdentityPins;
    delete observer.proofContractHash;
    return { sourceKind: value.sourceKind, action, observer };
  };
  requireCondition(digest(comparable(fromDraft)) === digest(comparable(fromPackage)), "DAS-024 draft and DAS-023 package belong to different action/observer chains");
  requireCondition(generatedPackage.receipt.sourceIdentityHash === digest(generatedPackage.sourceIdentity), "DAS-023 source identity is not receipt-bound");
  requireCondition(generatedPackage.actionRuntimeDeclaration.sourceHash === draft.sourceIdentity.sourceHash, "DAS-024/DAS-023 action source mismatch");
  requireCondition(generatedPackage.proofContractInput.runtime.sourceHash === draft.observerProof.runtime.sourceHash, "DAS-024/DAS-023 observer source mismatch");
  return { ...fromPackage, inputKind: "das024-to-das023-exact-chain", draftHash: draft.draftHash, packageReceiptHash: generatedPackage.receipt.receiptHash, inputHash: digest({ draftHash: draft.draftHash, packageReceiptHash: generatedPackage.receipt.receiptHash }) };
}

function javascript(value) {
  return JSON.stringify(value, null, 2);
}

function actionIndex(contract) {
  return `export const ACTION_PLUGIN_CONTRACT = Object.freeze(${javascript(contract)});\n\nconst BLOCKED = "DAS_ACTION_PLUGIN_NON_EXECUTABLE";\n\nexport async function inspectAuthAlias(alias) {\n  void alias;\n  throw new Error(BLOCKED + ": resolve and inspect aliases only inside the customer-local credential boundary");\n}\n\nexport async function execute(context, input) {\n  void context;\n  void input;\n  throw new Error(BLOCKED + ": implement the exact customer-local action transport, authority check, and durable write boundary before qualification");\n}\n\nexport async function reconcile(context, stableIdentity) {\n  void context;\n  void stableIdentity;\n  throw new Error(BLOCKED + ": implement readback and classify external state before any retry");\n}\n\nexport async function persistActionReceipt(store, receipt) {\n  void store;\n  void receipt;\n  throw new Error(BLOCKED + ": attach an integrity-checked durable store before qualification");\n}\n`;
}

function observerIndex(contract) {
  return `export const OBSERVER_PLUGIN_CONTRACT = Object.freeze(${javascript(contract)});\n\nconst BLOCKED = "DAS_OBSERVER_PLUGIN_NON_EXECUTABLE";\n\nexport async function inspectAuthAlias(alias) {\n  void alias;\n  throw new Error(BLOCKED + ": resolve and inspect observer aliases only inside the separate customer-local credential boundary");\n}\n\nexport async function observe(context, stableIdentity) {\n  void context;\n  void stableIdentity;\n  throw new Error(BLOCKED + ": implement the separately authenticated read-only observer and direct external-state read before qualification");\n}\n\nexport async function proveNoWrite(probe) {\n  void probe;\n  throw new Error(BLOCKED + ": attach a read-only no-write probe before qualification");\n}\n\nexport async function persistObservation(store, observation) {\n  void store;\n  void observation;\n  throw new Error(BLOCKED + ": attach an integrity-checked durable observation store before qualification");\n}\n`;
}

function evidenceMapper(kind) {
  const upper = kind.toUpperCase();
  return `export function map${kind === "action" ? "Action" : "Observer"}Evidence(rawEvidence) {\n  void rawEvidence;\n  throw new Error("DAS_${upper}_EVIDENCE_MAPPER_NOT_IMPLEMENTED: map only independently challengeable, provenance-bound evidence");\n}\n`;
}

function classifier() {
  return `export function classifyObservedOutcome(beforeEvidence, afterEvidence, assignedWork, actionFence) {\n  void beforeEvidence;\n  void afterEvidence;\n  void assignedWork;\n  void actionFence;\n  throw new Error("DAS_OBSERVER_CLASSIFIER_NOT_IMPLEMENTED: bind the exact ten canonical classifications before qualification");\n}\n`;
}

function actionTest() {
  return `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { ACTION_PLUGIN_CONTRACT, execute, reconcile } from "../src/index.js";\nimport { mapActionEvidence } from "../src/evidence-mapper.js";\n\ntest("generated action scaffold stays non-executable", async () => {\n  assert.equal(ACTION_PLUGIN_CONTRACT.executable, false);\n  assert.equal(ACTION_PLUGIN_CONTRACT.qualified, false);\n  assert.equal(ACTION_PLUGIN_CONTRACT.activated, false);\n  await assert.rejects(execute({}, {}), /NON_EXECUTABLE/);\n  await assert.rejects(reconcile({}, {}), /NON_EXECUTABLE/);\n  assert.throws(() => mapActionEvidence({}), /NOT_IMPLEMENTED/);\n});\n`;
}

function observerTest() {
  return `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { OBSERVER_PLUGIN_CONTRACT, observe } from "../src/index.js";\nimport { mapObserverEvidence } from "../src/evidence-mapper.js";\n\ntest("generated observer scaffold stays separate, read-only, and non-executable", async () => {\n  assert.equal(OBSERVER_PLUGIN_CONTRACT.readOnly, true);\n  assert.equal(OBSERVER_PLUGIN_CONTRACT.executable, false);\n  assert.equal(OBSERVER_PLUGIN_CONTRACT.qualified, false);\n  assert.equal(OBSERVER_PLUGIN_CONTRACT.activated, false);\n  await assert.rejects(observe({}, {}), /NON_EXECUTABLE/);\n  assert.throws(() => mapObserverEvidence({}), /NOT_IMPLEMENTED/);\n});\n`;
}

function packageJson(name) {
  return `${JSON.stringify({ name, private: true, version: "0.0.0-unqualified", type: "module" }, null, 2)}\n`;
}

function pluginManifest({ plane, normalized, contract }) {
  const action = plane === "action";
  const manifest = {
    schemaVersion: action
      ? "das.customer-local-action-plugin-project.v1"
      : "das.customer-local-observer-plugin-project.v1",
    plane,
    inputHash: normalized.inputHash,
    draftHash: normalized.draftHash,
    packageReceiptHash: normalized.packageReceiptHash,
    sourceKind: normalized.sourceKind,
    sourceHash: contract.sourceHash,
    transportIdentityHash: contract.transportIdentityHash,
    runtimeSchemaHash: contract.runtimeSchemaHash,
    authenticationIdentityHash: contract.authenticationIdentityHash,
    implementationIntentHash: contract.implementationIntentHash,
    implementationContentHash: null,
    conformanceReceiptHash: null,
    credentialAliases: [...contract.credentialAliases],
    operations: action
      ? [...contract.operationIdentityPins]
      : contract.readOperations.map((sourceName) => ({ sourceName, mode: "read" })),
    importPath: contract.importPath,
    evidenceMapperPath: contract.evidenceMapperPath,
    ...(action ? {} : { classifierPath: contract.classifierPath, readOnly: true, writeOperations: [] }),
    credentialValuesPresent: false,
    runtimeAuthorityGranted: false,
    status: "generated-unimplemented-non-executable",
    executable: false,
    qualified: false,
    activationReady: false,
  };
  manifest.manifestHash = digest(manifest);
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function lineCount(value) {
  return value.split("\n").filter((line) => line.trim()).length;
}

function render(normalized) {
  const actionContract = {
    schemaVersion: "das.customer-local-action-plugin-scaffold-contract.v1",
    ...normalized.action,
    inputHash: normalized.inputHash,
    sourceKind: normalized.sourceKind,
    importPath: "./src/index.js",
    evidenceMapperPath: "./src/evidence-mapper.js",
    interfaces: {
      execute: "execute(context,input)->Promise<action-result>",
      reconcile: "reconcile(context,stableIdentity)->Promise<completed|not-started|partial|incorrect|duplicate|collateral|unknown|unavailable>",
      evidenceMapper: "mapActionEvidence(rawEvidence)->provenance-bound-evidence",
    },
    credentialValuesPresent: false,
    implementationContentHash: null,
    conformanceReceiptHash: null,
    runtimeAuthorityGranted: false,
    executable: false,
    qualified: false,
    activated: false,
    evidenceBoundary: "Generated action plugin project scaffold only. Its interfaces throw and no real transport, credential, authority, write, reconciliation or evidence mapping exists.",
  };
  const observerContract = {
    schemaVersion: "das.customer-local-observer-plugin-scaffold-contract.v1",
    ...normalized.observer,
    inputHash: normalized.inputHash,
    importPath: "./src/index.js",
    evidenceMapperPath: "./src/evidence-mapper.js",
    classifierPath: "./src/classifier.js",
    interfaces: {
      observe: "observe(context,stableIdentity)->Promise<direct-external-state-observation>",
      evidenceMapper: "mapObserverEvidence(rawEvidence)->provenance-bound-independent-evidence",
    },
    readOnly: true,
    credentialValuesPresent: false,
    implementationContentHash: null,
    conformanceReceiptHash: null,
    runtimeAuthorityGranted: false,
    executable: false,
    qualified: false,
    activated: false,
    evidenceBoundary: "Generated independent-observer plugin project scaffold only. Its interfaces throw and no real authentication, direct read, freshness fence or evidence mapping exists.",
  };
  actionContract.contractHash = digest(actionContract);
  observerContract.contractHash = digest(observerContract);

  const files = new Map([
    ["action-plugin/package.json", packageJson("@das-private/customer-local-action-plugin-scaffold")],
    ["action-plugin/plugin-manifest.json", pluginManifest({ plane: "action", normalized, contract: actionContract })],
    ["action-plugin/src/index.js", actionIndex(actionContract)],
    ["action-plugin/src/evidence-mapper.js", evidenceMapper("action")],
    ["action-plugin/test/non-executable.test.js", actionTest()],
    ["action-plugin/README.md", "# Customer-local action plugin scaffold\n\nThis project is deliberately non-executable. Implement the exact reviewed transport, resolve aliases only in customer-local secret storage, enforce exact authority, reconcile before retry, map challengeable evidence, and pass the generated negative-conformance plan.\n"],
    ["observer-plugin/package.json", packageJson("@das-private/customer-local-observer-plugin-scaffold")],
    ["observer-plugin/plugin-manifest.json", pluginManifest({ plane: "observer", normalized, contract: observerContract })],
    ["observer-plugin/src/index.js", observerIndex(observerContract)],
    ["observer-plugin/src/evidence-mapper.js", evidenceMapper("observer")],
    ["observer-plugin/src/classifier.js", classifier()],
    ["observer-plugin/test/non-executable.test.js", observerTest()],
    ["observer-plugin/README.md", "# Customer-local independent observer plugin scaffold\n\nThis project is deliberately non-executable and read-only. Implement a separately authenticated direct observation path, freshness fences, duplicate/collateral checks and evidence mapping without importing or trusting the action response.\n"],
  ]);
  return { actionContract, observerContract, files };
}

function conformancePlan(normalized, actionContract, observerContract) {
  const cases = Object.entries(CUSTOMER_LOCAL_QUALIFICATION_EXPECTATIONS).map(([id, expected]) => ({ id, expected, status: "declared-not-run" }));
  const integrityControls = [
    ["credential-value-in-artifact", "reject"],
    ["source-schema-or-transport-drift", "reject"],
    ["action-observer-authentication-shared", "reject"],
    ["action-observer-credential-alias-shared", "reject"],
    ["observer-performs-a-write", "reject"],
    ["action-response-used-as-independent-proof", "reject"],
    ["blind-retry-after-unknown", "reject"],
    ["stale-or-pre-existing-observer-evidence", "reject"],
    ["duplicate-or-collateral-outcome", "reject"],
    ["generated-stub-invoked-before-implementation", "fail-closed"],
    ["scaffold-directory-already-exists", "refuse-overwrite"],
  ].map(([id, expected]) => ({ id, expected, status: "declared-not-run" }));
  const plan = {
    schemaVersion: "das.customer-local-plugin-negative-conformance-plan.v1",
    inputHash: normalized.inputHash,
    actionContractHash: actionContract.contractHash,
    observerContractHash: observerContract.contractHash,
    cases,
    integrityControls,
    status: "generated-not-run",
    executable: false,
    qualified: false,
    activated: false,
    evidenceBoundary: "Generated negative-conformance TODO contract only. No case is evidence until a separately bound implementation runs and preserves its results.",
  };
  plan.planHash = digest(plan);
  return plan;
}

export function createCustomerLocalBindingPluginScaffoldPlan({ packageInputDraft, generatedPackage } = {}) {
  requireCondition(packageInputDraft && generatedPackage, "Plugin scaffold requires the exact completed DAS-024 draft and its DAS-023 generated package");
  assertNoSecretValues({ packageInputDraft, generatedPackage }, "Plugin-scaffold input");
  const normalized = assertExactChain(packageInputDraft, generatedPackage);
  assertSeparatedTrustPlanes(normalized);
  const { actionContract, observerContract, files } = render(normalized);
  const negativeConformancePlan = conformancePlan(normalized, actionContract, observerContract);
  files.set("canonical-controls.json", `${JSON.stringify({ schemaVersion: negativeConformancePlan.schemaVersion, planHash: negativeConformancePlan.planHash, inputHash: negativeConformancePlan.inputHash, cases: negativeConformancePlan.cases, status: "declared-not-run" }, null, 2)}\n`);
  files.set("integrity-controls.json", `${JSON.stringify({ schemaVersion: "das.customer-local-plugin-integrity-controls.v1", inputHash: normalized.inputHash, controls: negativeConformancePlan.integrityControls, status: "declared-not-run" }, null, 2)}\n`);

  const projectFileHashes = Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([relative, content]) => [relative, digest(content)]));
  const generatedProjectHash = digest({ inputHash: normalized.inputHash, projectFileHashes });

  const generatedSourceFiles = [...files].filter(([name]) => name.endsWith(".js"));
  const remainingImplementation = [
    "action.execute: customer-local authenticated transport plus exact authority enforcement",
    "action.reconcile: separately read external state and classify before any retry",
    "action.mapActionEvidence: provenance-bound action evidence mapping",
    "observer.observe: separately authenticated read-only direct external-state observation",
    "observer.mapObserverEvidence: freshness, duplicate, collateral and outcome evidence mapping",
    "customer-local credential alias resolution outside generated artifacts",
    "all negative conformance and mandatory acceptance execution",
  ];
  const plan = {
    schemaVersion: "das.customer-local-binding-plugin-scaffold-plan.v1",
    inputKind: normalized.inputKind,
    inputHash: normalized.inputHash,
    draftHash: normalized.draftHash,
    packageReceiptHash: normalized.packageReceiptHash,
    generatedProjectHash,
    projectFileHashes,
    actionContract,
    observerContract,
    negativeConformancePlan,
    filePaths: [...files.keys()].sort(),
    measurements: {
      generatedFiles: files.size + 1,
      generatedScaffoldSourceFiles: generatedSourceFiles.length,
      generatedScaffoldSourceLines: generatedSourceFiles.reduce((sum, [, content]) => sum + lineCount(content), 0),
      generatedExecutableFunctions: 0,
      generatedProjectHash,
      implementationContentHash: null,
      conformanceReceiptHash: null,
      remainingHandwrittenImplementationItems: remainingImplementation.length,
      remainingImplementation,
      credentialValues: 0,
      modelCalls: 0,
      spendUsd: 0,
    },
    gates: {
      sourcePinned: true,
      actionObserverSeparated: true,
      credentialValuesPresent: false,
      runtimeAuthorityGranted: false,
      executable: false,
      qualified: false,
      activated: false,
    },
    evidenceBoundary: "Project-scaffold generation only. Generated interfaces, manifests and tests reduce file setup but implement no transport, proof, authority, qualification, acceptance or activation.",
  };
  plan.planHash = digest(plan);
  return Object.freeze({ plan: Object.freeze(plan), files });
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

function writePrivateFile(file, content) {
  fs.writeFileSync(file, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.chmodSync(file, 0o600);
}

export function writeCustomerLocalBindingPluginScaffold({ directory, packageInputDraft, generatedPackage }) {
  const root = path.resolve(directory);
  requireCondition(!fs.existsSync(root), "Plugin scaffold refuses to overwrite an existing directory");
  const generated = createCustomerLocalBindingPluginScaffoldPlan({ packageInputDraft, generatedPackage });
  const directories = new Set(["action-plugin", "action-plugin/src", "action-plugin/test", "observer-plugin", "observer-plugin/src", "observer-plugin/test"]);
  ensureDirectory(root);
  for (const relative of [...directories].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))) ensureDirectory(path.join(root, relative));
  for (const [relative, content] of generated.files) writePrivateFile(path.join(root, relative), content);
  const receipt = {
    schemaVersion: "das.customer-local-binding-plugin-scaffold-receipt.v1",
    planHash: generated.plan.planHash,
    inputHash: generated.plan.inputHash,
    draftHash: generated.plan.draftHash,
    packageReceiptHash: generated.plan.packageReceiptHash,
    generatedProjectHash: generated.plan.generatedProjectHash,
    actionContractHash: generated.plan.actionContract.contractHash,
    observerContractHash: generated.plan.observerContract.contractHash,
    negativeConformancePlanHash: generated.plan.negativeConformancePlan.planHash,
    files: [...generated.files.keys()].sort().map((relative) => ({ relative, sha256: digest(fs.readFileSync(path.join(root, relative), "utf8")), mode: "0600" })),
    directories: [".", ...[...directories].sort()].map((relative) => ({ relative, mode: "0700" })),
    measurements: generated.plan.measurements,
    status: "generated-non-executable-unqualified-unactivated",
    executable: false,
    qualified: false,
    activated: false,
    evidenceBoundary: generated.plan.evidenceBoundary,
  };
  receipt.receiptHash = digest(receipt);
  writePrivateFile(path.join(root, "scaffold-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  return Object.freeze({ root, plan: generated.plan, receipt: Object.freeze(receipt) });
}

export function inspectCustomerLocalBindingPluginScaffold({ directory, expectedReceiptHash } = {}) {
  const root = path.resolve(directory);
  const receiptFile = path.join(root, "scaffold-receipt.json");
  requireCondition(fs.existsSync(receiptFile), "Plugin scaffold receipt is missing");
  const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  requireCondition(receipt.receiptHash === digest(withoutHash(receipt, "receiptHash")), "Plugin scaffold receipt integrity mismatch");
  if (expectedReceiptHash) requireCondition(receipt.receiptHash === expectedReceiptHash, "Plugin scaffold receipt does not match the expected generation");
  requireCondition(receipt.executable === false && receipt.qualified === false && receipt.activated === false, "Plugin scaffold receipt widened a protected gate");
  requireCondition((fs.statSync(root).mode & 0o777) === 0o700, "Plugin scaffold root mode is not 0700");
  for (const entry of receipt.directories) {
    const directory = path.resolve(root, entry.relative);
    requireCondition(directory === root || directory.startsWith(`${root}${path.sep}`), "Plugin scaffold receipt contains a directory path escape");
    requireCondition(!fs.lstatSync(directory).isSymbolicLink(), `Plugin scaffold contains a directory symlink: ${entry.relative}`);
    requireCondition((fs.statSync(directory).mode & 0o777) === 0o700, `Plugin scaffold directory mode changed: ${entry.relative}`);
  }
  const expectedFiles = new Set([...receipt.files.map((entry) => entry.relative), "scaffold-receipt.json"]);
  const actualFiles = [];
  function walk(directory) {
    for (const name of fs.readdirSync(directory)) {
      const absolute = path.join(directory, name);
      const relative = path.relative(root, absolute);
      requireCondition(!fs.lstatSync(absolute).isSymbolicLink(), `Plugin scaffold contains a symlink: ${relative}`);
      if (fs.statSync(absolute).isDirectory()) walk(absolute); else actualFiles.push(relative);
    }
  }
  walk(root);
  requireCondition(actualFiles.length === expectedFiles.size && actualFiles.every((relative) => expectedFiles.has(relative)), "Plugin scaffold contains a file outside the exact allowlist");
  for (const entry of receipt.files) {
    const file = path.resolve(root, entry.relative);
    requireCondition(file.startsWith(`${root}${path.sep}`), "Plugin scaffold receipt contains a path escape");
    requireCondition(fs.existsSync(file) && (fs.statSync(file).mode & 0o777) === 0o600, `Plugin scaffold file mode changed: ${entry.relative}`);
    requireCondition(digest(fs.readFileSync(file, "utf8")) === entry.sha256, `Plugin scaffold file content changed: ${entry.relative}`);
  }
  const projectFileHashes = Object.fromEntries(receipt.files.map((entry) => [entry.relative, entry.sha256]).sort(([a], [b]) => a.localeCompare(b)));
  requireCondition(receipt.generatedProjectHash === digest({ inputHash: receipt.inputHash, projectFileHashes }), "Plugin scaffold generated-project hash no longer matches the exact allowlisted files");
  for (const plugin of ["action-plugin", "observer-plugin"]) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, plugin, "package.json"), "utf8"));
    requireCondition(manifest.private === true && manifest.scripts === undefined && manifest.dependencies === undefined && manifest.devDependencies === undefined && manifest.optionalDependencies === undefined, `${plugin} manifest added scripts or dependencies`);
    const pluginManifest = JSON.parse(fs.readFileSync(path.join(root, plugin, "plugin-manifest.json"), "utf8"));
    requireCondition(pluginManifest.manifestHash === digest(withoutHash(pluginManifest, "manifestHash")), `${plugin} provider-neutral manifest integrity mismatch`);
    requireCondition(pluginManifest.inputHash === receipt.inputHash && pluginManifest.draftHash === receipt.draftHash && pluginManifest.packageReceiptHash === receipt.packageReceiptHash, `${plugin} manifest belongs to another draft or package`);
    requireCondition(pluginManifest.status === "generated-unimplemented-non-executable" && pluginManifest.executable === false && pluginManifest.qualified === false && pluginManifest.activationReady === false && pluginManifest.runtimeAuthorityGranted === false, `${plugin} manifest widened a protected gate`);
    if (plugin === "observer-plugin") requireCondition(pluginManifest.readOnly === true && pluginManifest.writeOperations.length === 0, "Observer plugin manifest added a write surface");
  }
  const sourceText = receipt.files.filter((entry) => entry.relative.endsWith(".js")).map((entry) => fs.readFileSync(path.join(root, entry.relative), "utf8")).join("\n");
  requireCondition(!/(?:\beval\s*\(|\bnew\s+Function\s*\(|\bfetch\s*\(|\bimport\s*\()/m.test(sourceText), "Plugin scaffold contains forbidden dynamic or network execution");
  assertNoSecretValues(sourceText, "Plugin scaffold source");
  assertNoSecretValues(receipt, "Plugin scaffold receipt");
  return Object.freeze({ valid: true, receipt: Object.freeze(receipt) });
}
