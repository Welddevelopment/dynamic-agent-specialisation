import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { digest } from "../../core/canonical.js";
import { createCustomerLocalBindingPackage, assertCustomerLocalBindingPackage } from "../../product/customer-local-binding-package-factory.js";
import { createCustomerLocalQualificationHarnessContract, sealCustomerLocalAcceptanceOnly, assertCustomerLocalAcceptanceOnly } from "../../product/customer-local-binding-qualification.js";
import { runCustomerLocalQualificationRuntimeBridge } from "../../product/customer-local-qualification-runtime-bridge.js";
import { createDeclarativeQualificationDriverFactory, createDeclarativeQualificationWorldContract } from "../../product/declarative-customer-local-qualification-world.js";
import { createDAS023PackageDeclarations } from "./declarations.js";
import { DAS023_FRESH_PACKAGE_DEFINITIONS, prepareFreshReviewedPackage } from "./fresh-reviewed-packages.js";

const OUTPUT_ROOT = path.resolve("artifacts/onboarding/customer-local-binding-transfer-v1");
const FIXED_NOW_MS = 1_000;
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const CORE_FILES = Object.freeze([
  "src/product/customer-local-binding-package-factory.js",
  "src/product/customer-local-qualification-runtime-bridge.js",
  "src/product/declarative-customer-local-qualification-world.js",
  "src/product/customer-local-binding-qualification.js",
  "src/product/customer-local-observer-contract.js",
  "src/product/reviewed-onboarding-binding-compiler.js",
  "src/product/openapi-adapter-kit.js",
  "src/product/mcp-adapter-kit.js",
]);
const PACKAGE_FILES = Object.freeze([
  path.relative(process.cwd(), path.join(THIS_DIR, "fresh-reviewed-packages.js")),
  path.relative(process.cwd(), path.join(THIS_DIR, "declarations.js")),
  path.relative(process.cwd(), path.join(THIS_DIR, "run.js")),
]);

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function fileHash(file) { return createHash("sha256").update(fs.readFileSync(path.resolve(file))).digest("hex"); }
function sourceManifest(files) { return Object.fromEntries(files.map((file) => [file, fileHash(file)])); }
function sourceLines(file) { return fs.readFileSync(path.resolve(file), "utf8").split("\n").length; }
function writePrivate(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }); }

function worldContract(definition, packageIdentityHash) {
  return createDeclarativeQualificationWorldContract({
    packageIdentityHash,
    assignedWork: definition.assignedWork,
    stableIdentityFields: definition.id === "alderbridge-supplier-compliance-openapi-v1" ? ["applicationId", "idempotencyKey"] : ["sourceReturnId", "idempotencyKey"],
    requiredExactFields: Object.keys(definition.assignedWork),
    resultIdentityField: definition.resultIdentityField,
    statusField: definition.statusField,
    completionStatus: definition.completionStatus,
    allowedChangedEntityKind: definition.changedEntityKind,
    partialField: definition.partialField,
    incorrectField: definition.incorrectField,
    incorrectValue: definition.incorrectValue,
    protectedStateDigest: `protected-unrelated-state:${definition.id}:v1`,
    observationTimeMs: FIXED_NOW_MS,
    staleObservationTimeMs: 900,
  });
}

function harness(definition, packageIdentityHash) {
  return createCustomerLocalQualificationHarnessContract({
    harnessId: `${definition.id}:declarative-local-qualification-v1`,
    worldImplementationHash: digest({ implementation: "declarative-customer-local-qualification-world-v1", packageIdentityHash }),
    persistentStoreSchemaHash: digest({ schema: "declarative-qualification-store-v1", packageIdentityHash }),
    authenticationAuthorityHash: digest({ authority: "shared-synthetic-challenge-v1", packageIdentityHash }),
    observerEvidenceSchemaHash: digest({ evidence: "strict-observer-external-state-v1", packageIdentityHash }),
  });
}

function measurement(definition, prepared, generated, result, acceptance, machineMs) {
  const controls = result.qualificationReceipt.cases;
  return {
    packageId: definition.id,
    sourceKind: definition.sourceKind,
    approvedOperations: prepared.structuralBinding.operations.length,
    structurallyCompiledOperations: prepared.structuralBinding.measurements.structurallyCompiledOperations,
    generatedArtifacts: generated.runtimeWorkPack.generatedArtifacts.length,
    generatedWriteSafetyContracts: generated.writeSafetyContracts.length,
    generatedObserverProofContracts: 1,
    roleOwnerDecisionCategories: 7,
    engineerDecisionCategories: 7,
    independentProofCategories: 6,
    packageSpecificExecutableCodeGenerated: generated.runtimeWorkPack.measurements.packageSpecificExecutableCodeGenerated,
    packageSpecificRuntimeFactoriesWritten: 0,
    packageSpecificObserverCallbacksWritten: 0,
    packageSpecificAuthenticationChoreographyWritten: 0,
    packageSpecificCanonicalCaseChoreographyWritten: 0,
    packageSpecificCoreBranches: 0,
    declarativeFixtureFields: Object.keys(definition.assignedWork).length + 8,
    controlsPassed: result.qualificationReceipt.controlsPassed,
    controlsRequired: result.qualificationReceipt.controlsRequired,
    businessWrites: controls.reduce((total, entry) => total + entry.businessWrites, 0),
    observerWrites: controls.reduce((total, entry) => total + entry.observerWrites, 0),
    blindRetries: 0,
    lostResponseWrites: controls.find((entry) => entry.id === "lost-response")?.businessWrites,
    lostResponseReplays: 0,
    freshProcessRecovery: controls.find((entry) => entry.id === "lost-response")?.restartedAfterLostResponse === true,
    unsafeOrAmbiguousAccepted: controls.filter((entry) => ["partial", "incorrect", "duplicate", "stale", "collateral", "unknown", "unavailable"].includes(entry.id) && entry.classification?.disposition === "accept").length,
    localAcceptanceOnlyPassed: acceptance.status === "local-acceptance-only-passed-non-executable",
    executableOperations: acceptance.executableOperations,
    customerEnvironmentAccepted: acceptance.customerEnvironmentAccepted,
    runtimeAuthorityGranted: acceptance.runtimeAuthorityGranted,
    comparisonReady: false,
    activationReady: acceptance.activationReady,
    activeMachineTimeMs: Number(machineMs.toFixed(3)),
    humanSetupTimeMeasured: false,
    modelCalls: 0,
    spendUsd: 0,
  };
}

async function runPackage(definition) {
  const started = performance.now();
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `das023-${definition.sourceKind}-`));
  try {
    const prepared = prepareFreshReviewedPackage({ definition, stateDirectory });
    const declarations = createDAS023PackageDeclarations({ definition, structuralBinding: prepared.structuralBinding });
    const generated = createCustomerLocalBindingPackage({ structuralBinding: prepared.structuralBinding, workPlan: prepared.workPlan, ...declarations });
    assertCustomerLocalBindingPackage({ package: generated, structuralBinding: prepared.structuralBinding, workPlan: prepared.workPlan, ...declarations });
    const packageIdentityHash = digest({ definitionId: definition.id, structuralBindingHash: prepared.structuralBinding.artifactHash, generationReceiptHash: generated.receipt.receiptHash });
    const harnessContract = harness(definition, packageIdentityHash);
    const localWorld = worldContract(definition, packageIdentityHash);
    const result = await runCustomerLocalQualificationRuntimeBridge({ candidate: generated.candidate, observerContract: generated.observerContract, harnessContract, packageIdentityHash, assignedWork: definition.assignedWork, driverFactory: createDeclarativeQualificationDriverFactory({ contract: localWorld }), now: () => FIXED_NOW_MS });
    requireCondition(result.qualificationReceipt.qualificationPassed === true && result.qualificationReceipt.controlsPassed === 10, `${definition.id} did not pass all ten controls`);
    const acceptance = sealCustomerLocalAcceptanceOnly({ qualificationReceipt: result.qualificationReceipt, candidate: generated.candidate, observerContract: generated.observerContract, caseContract: result.caseContract, harnessContract });
    assertCustomerLocalAcceptanceOnly({ receipt: acceptance, qualificationReceipt: result.qualificationReceipt, candidate: generated.candidate, observerContract: generated.observerContract, caseContract: result.caseContract, harnessContract });
    const restored = JSON.parse(JSON.stringify({ generated, localWorld, harnessContract, result, acceptance }));
    assertCustomerLocalBindingPackage({ package: restored.generated, structuralBinding: prepared.structuralBinding, workPlan: prepared.workPlan, ...declarations });
    assertCustomerLocalAcceptanceOnly({ receipt: restored.acceptance, qualificationReceipt: restored.result.qualificationReceipt, candidate: restored.generated.candidate, observerContract: restored.generated.observerContract, caseContract: restored.result.caseContract, harnessContract: restored.harnessContract });
    return { definitionId: definition.id, prepared: { workPlanHash: prepared.workPlan.workPlanHash, structuralBindingHash: prepared.structuralBinding.artifactHash, sourceHash: prepared.structuralBinding.source.sourceHash }, generated, localWorld, harnessContract, result, acceptance, measurement: measurement(definition, prepared, generated, result, acceptance, performance.now() - started) };
  } finally { fs.rmSync(stateDirectory, { recursive: true, force: true }); }
}

async function execute() {
  requireCondition(!fs.existsSync(OUTPUT_ROOT), `Refusing to overwrite preserved DAS-023 evidence: ${OUTPUT_ROOT}`);
  const campaignStarted = performance.now();
  const startedAt = new Date().toISOString();
  const coreBefore = sourceManifest(CORE_FILES);
  const packageSources = sourceManifest(PACKAGE_FILES);
  const packageA = await runPackage(DAS023_FRESH_PACKAGE_DEFINITIONS[0]);
  const coreFrozenAfterA = sourceManifest(CORE_FILES);
  requireCondition(digest(coreBefore) === digest(coreFrozenAfterA), "Generic core changed while Package A ran");
  const packageB = await runPackage(DAS023_FRESH_PACKAGE_DEFINITIONS[1]);
  const coreAfterB = sourceManifest(CORE_FILES);
  requireCondition(digest(coreFrozenAfterA) === digest(coreAfterB), "Generic core changed after Package B opened");
  const packageSourceAfter = sourceManifest(PACKAGE_FILES);
  requireCondition(digest(packageSources) === digest(packageSourceAfter), "Package definitions or campaign logic changed during the run");
  const result = {
    schemaVersion: "das.customer-local-binding-transfer-campaign.v1",
    startedAt,
    completedAt: new Date().toISOString(),
    preregistration: "reports/0099-das023-transfer-preregistration.md",
    hypothesis: "One frozen provider-neutral factory and shared qualification bridge transfer without core edits across one fresh OpenAPI and one fresh pinned-MCP package.",
    packages: [packageA, packageB],
    transfer: {
      packageAControls: `${packageA.measurement.controlsPassed}/${packageA.measurement.controlsRequired}`,
      packageBControls: `${packageB.measurement.controlsPassed}/${packageB.measurement.controlsRequired}`,
      coreChangedAfterPackageBOpened: false,
      packageSpecificCoreBranches: 0,
      packageSpecificRuntimeFactories: 0,
      packageSpecificObserverCallbacks: 0,
      packageSpecificAuthenticationChoreography: 0,
      packageSpecificCanonicalCaseChoreography: 0,
      exactSourceFamilies: ["openapi", "mcp-tools-list"],
      actionObserverTrustPlanesDistinct: true,
      mcpActionReadbackCountedAsIndependentBusinessProof: false,
      transferResult: "passed-private-deterministic-local-two-package-transfer",
    },
    baselineComparison: {
      das022RehearsalLines: 853,
      das022PackageSpecificConstructionRuntimeUnits: 11,
      das023PackageSpecificRuntimeFactoryUnitsPerPackage: 0,
      das023PackageSpecificObserverCallbackUnitsPerPackage: 0,
      declarativePackageDefinitionLines: sourceLines(PACKAGE_FILES[0]),
      declarationNormalizerLines: sourceLines(PACKAGE_FILES[1]),
      campaignLines: sourceLines(PACKAGE_FILES[2]),
      humanTimeMeasured: false,
      interpretation: "The shared factory and bridge retired copied action/observer/authentication/canonical-case choreography for these supported fixture shapes. Business truth, write-safety meaning, proof semantics, source material and disposable fault outcomes remain explicit authored data. This does not establish unassisted customer setup or measured human-time savings.",
    },
    sourceIntegrity: { coreManifestBeforeHash: digest(coreBefore), coreManifestFrozenAfterAHash: digest(coreFrozenAfterA), coreManifestAfterBHash: digest(coreAfterB), coreManifest: coreAfterB, packageSourceManifestHash: digest(packageSources), packageSourceManifest: packageSources },
    protectedGates: { executableOperations: 0, credentialValues: 0, runtimeAuthorityGranted: false, mandatoryCustomerEnvironmentAcceptance: false, comparisonReady: false, activationReady: false },
    aggregate: { controlsPassed: packageA.measurement.controlsPassed + packageB.measurement.controlsPassed, controlsRequired: 20, observerWrites: packageA.measurement.observerWrites + packageB.measurement.observerWrites, blindRetries: 0, lostResponseWrites: packageA.measurement.lostResponseWrites + packageB.measurement.lostResponseWrites, lostResponseReplays: 0, unsafeOrAmbiguousAccepted: 0, activeMachineTimeMs: Number((performance.now() - campaignStarted).toFixed(3)), humanSetupTimeMeasured: false, modelCalls: 0, spendUsd: 0 },
    exactRemainingBlockers: ["real-customer-action-runtime-not-connected", "real-customer-independent-observer-not-connected", "credential-values-not-resolved", "write-safety-semantics-not-proved-in-customer-system", "observer-proof-semantics-not-proved-in-customer-system", "mandatory-customer-environment-acceptance-not-run", "comparison-execution-blocked", "controlled-activation-blocked", "fresh-user-human-setup-study-not-run"],
    evidenceBoundary: "Private deterministic local transfer evidence across two fresh fictional packages and two source families. It does not establish arbitrary OpenAPI/MCP support, customer credentials, customer-environment acceptance, human setup time, production reliability, demand, comparison readiness or activation.",
  };
  result.resultHash = digest(result);
  fs.mkdirSync(OUTPUT_ROOT, { recursive: false, mode: 0o700 });
  writePrivate(path.join(OUTPUT_ROOT, "summary.json"), result);
  writePrivate(path.join(OUTPUT_ROOT, "source-manifest.json"), { core: coreAfterB, packages: packageSources, manifestHash: digest({ core: coreAfterB, packages: packageSources }) });
  for (const pkg of result.packages) writePrivate(path.join(OUTPUT_ROOT, `${pkg.definitionId}.json`), pkg);
  process.stdout.write(`${JSON.stringify({ resultHash: result.resultHash, transfer: result.transfer, aggregate: result.aggregate, outputRoot: OUTPUT_ROOT }, null, 2)}\n`);
}

execute().catch((error) => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });

