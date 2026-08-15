import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { digest } from "../../core/canonical.js";
import {
  applySourceGroundedBindingDraftAnswers,
  createSourceGroundedBindingDraftSession,
  materializeSourceGroundedBindingPackageInputs,
} from "../../product/source-grounded-binding-package-draft.js";
import { createCustomerLocalBindingPackage } from "../../product/customer-local-binding-package-factory.js";
import {
  assertCustomerLocalAcceptanceOnly,
  createCustomerLocalQualificationHarnessContract,
  sealCustomerLocalAcceptanceOnly,
} from "../../product/customer-local-binding-qualification.js";
import { runCustomerLocalQualificationRuntimeBridge } from "../../product/customer-local-qualification-runtime-bridge.js";
import {
  createDeclarativeQualificationDriverFactory,
  createDeclarativeQualificationWorldContract,
} from "../../product/declarative-customer-local-qualification-world.js";
import {
  createCustomerLocalBindingPluginScaffoldPlan,
  writeCustomerLocalBindingPluginScaffold,
} from "../../product/customer-local-binding-plugin-scaffold.js";
import {
  assertCustomerLocalTransportImplementationWorkPack,
  createCustomerLocalTransportImplementationWorkPack,
} from "../../product/customer-local-transport-implementation-assistance.js";
import { prepareDAS024QualificationBinding } from "../das024-authoring/qualification-harness.js";
import { DAS026_FRESH_FIXTURES } from "./fixtures.js";

const OUTPUT_ROOT = path.resolve("artifacts/onboarding/das026-transport-implementation-assistance-v1");
const FIXED_NOW_MS = 1_000;
const FROZEN_SOURCE_FILES = Object.freeze([
  "reports/0103-das026-transport-implementation-assistance-preregistration.md",
  "src/product/customer-local-transport-implementation-assistance.js",
  "src/product/customer-local-binding-plugin-scaffold.js",
  "src/product/source-grounded-binding-package-draft.js",
  "src/product/customer-local-binding-package-factory.js",
  "src/product/customer-local-binding-qualification.js",
  "src/product/customer-local-qualification-runtime-bridge.js",
  "src/product/declarative-customer-local-qualification-world.js",
  "src/experiments/das024-authoring/qualification-harness.js",
  "src/experiments/das026-transport-assistance/fixtures.js",
  "src/experiments/das026-transport-assistance/rehearsal.js",
]);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

function writePrivate(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

function sourceManifest() {
  return FROZEN_SOURCE_FILES.map((relative) => ({
    relative,
    sha256: createHash("sha256").update(fs.readFileSync(path.resolve(relative))).digest("hex"),
  }));
}

function reconstruct(fixture, stateRoot) {
  const initial = createSourceGroundedBindingDraftSession({
    sessionId: fixture.id,
    businessIntake: structuredClone(fixture.businessIntake),
    actionSource: structuredClone(fixture.actionSource),
    observerSource: structuredClone(fixture.observerSource),
    credentialAliases: structuredClone(fixture.credentialAliases),
  });
  const completed = applySourceGroundedBindingDraftAnswers({
    session: initial,
    expectedSessionHash: initial.sessionHash,
    answers: structuredClone(fixture.answers),
    suppliedBy: { owner: fixture.answers.ownerReviewer, engineer: fixture.answers.engineerReviewer },
  });
  requireCondition(completed.status === "complete-non-executable-package-input-draft", `${fixture.id} did not complete its fresh reviewed package draft`);
  const prepared = prepareDAS024QualificationBinding({ fixture, stateDirectory: path.join(stateRoot, "reviewed-binding") });
  const packageInputDraft = materializeSourceGroundedBindingPackageInputs({
    session: completed,
    structuralBinding: prepared.structuralBinding,
    workPlan: prepared.workPlan,
  });
  const generatedPackage = createCustomerLocalBindingPackage({
    structuralBinding: prepared.structuralBinding,
    workPlan: prepared.workPlan,
    sourceIdentity: packageInputDraft.sourceIdentity,
    actionRuntime: packageInputDraft.actionRuntime,
    writeSafety: packageInputDraft.writeSafety,
    observerProof: packageInputDraft.observerProof,
  });
  const scaffold = writeCustomerLocalBindingPluginScaffold({
    directory: path.join(stateRoot, "generated-plugin-projects"),
    packageInputDraft,
    generatedPackage,
  });
  return { initial, completed, prepared, packageInputDraft, generatedPackage, scaffold };
}

function createBoundFictionalImplementation({ fixture, reconstruction, workPack }) {
  const common = {
    schemaVersion: "das.das026-fictional-bounded-implementation-plane.v1",
    fixtureId: fixture.id,
    workPackHash: workPack.workPackHash,
    das024DraftHash: reconstruction.packageInputDraft.draftHash,
    das023PackageReceiptHash: reconstruction.generatedPackage.receipt.receiptHash,
    das025GeneratedProjectHash: reconstruction.scaffold.receipt.generatedProjectHash,
    sourceFamily: fixture.sourceKind,
    sharedRuntimePrimitiveHash: digest({
      implementation: "das026-declarative-disposable-qualification-runtime-v1",
      sourceFiles: [
        "src/product/declarative-customer-local-qualification-world.js",
        "src/product/customer-local-qualification-runtime-bridge.js",
      ],
    }),
    customerExecutable: false,
    credentialValuesResolved: false,
    productionAuthorityGranted: false,
    activationReady: false,
    evidenceBoundary: "Exact fictional disposable implementation identity bound to the DAS-026 work pack. It does not implement a real provider transport or upgrade the non-executable generated project.",
  };
  const action = {
    ...common,
    plane: "action",
    transportSkeletonHash: workPack.actionTransport.transportSkeletonHash,
    implementationContentHash: digest({ ...common, plane: "action", transportSkeletonHash: workPack.actionTransport.transportSkeletonHash }),
  };
  const observer = {
    ...common,
    plane: "observer",
    transportSkeletonHash: workPack.observerTransport.transportSkeletonHash,
    implementationContentHash: digest({ ...common, plane: "observer", transportSkeletonHash: workPack.observerTransport.transportSkeletonHash }),
  };
  requireCondition(action.implementationContentHash !== observer.implementationContentHash, "Fictional implementation planes collapsed into one identity");
  const receipt = {
    schemaVersion: "das.das026-fictional-bounded-implementation-binding.v1",
    fixtureId: fixture.id,
    workPackHash: workPack.workPackHash,
    action,
    observer,
    packageSpecificExecutableFiles: 0,
    packageSpecificExecutableLines: 0,
    customerExecutable: false,
    credentialValuesResolved: false,
    productionAuthorityGranted: false,
    activated: false,
  };
  receipt.receiptHash = digest(receipt);
  return Object.freeze(receipt);
}

function qualificationPackage(reconstruction, implementation) {
  requireCondition(implementation.receiptHash === digest(withoutHash(implementation, "receiptHash")), "DAS-026 fictional implementation identity is invalid");
  const actionRuntime = structuredClone(reconstruction.packageInputDraft.actionRuntime);
  actionRuntime.implementationHash = implementation.action.implementationContentHash;
  const observerProof = structuredClone(reconstruction.packageInputDraft.observerProof);
  observerProof.runtime.implementationHash = implementation.observer.implementationContentHash;
  return createCustomerLocalBindingPackage({
    structuralBinding: reconstruction.prepared.structuralBinding,
    workPlan: reconstruction.prepared.workPlan,
    sourceIdentity: reconstruction.packageInputDraft.sourceIdentity,
    actionRuntime,
    writeSafety: reconstruction.packageInputDraft.writeSafety,
    observerProof,
  });
}

async function qualify({ fixture, reconstruction, workPack }) {
  const implementation = createBoundFictionalImplementation({ fixture, reconstruction, workPack });
  const generatedPackage = qualificationPackage(reconstruction, implementation);
  const packageIdentityHash = digest({
    fixtureId: fixture.id,
    workPackHash: workPack.workPackHash,
    implementationReceiptHash: implementation.receiptHash,
    qualificationPackageReceiptHash: generatedPackage.receipt.receiptHash,
  });
  const world = fixture.qualificationWorld;
  const worldContract = createDeclarativeQualificationWorldContract({
    packageIdentityHash,
    assignedWork: world.assignedWork,
    stableIdentityFields: world.stableIdentityFields,
    requiredExactFields: fixture.answers.requiredExactFields,
    resultIdentityField: world.resultIdentityField,
    statusField: world.statusField,
    completionStatus: world.completionStatus,
    allowedChangedEntityKind: world.allowedChangedEntityKind,
    partialField: world.partialField,
    incorrectField: world.incorrectField,
    incorrectValue: world.incorrectValue,
    protectedStateDigest: world.protectedStateDigest,
    observationTimeMs: FIXED_NOW_MS,
    staleObservationTimeMs: 900,
  });
  const harnessContract = createCustomerLocalQualificationHarnessContract({
    harnessId: `${fixture.id}:das026-unchanged-das023-qualification-v1`,
    worldImplementationHash: digest({ implementation: "das026-declarative-disposable-qualification-runtime-v1", workPackHash: workPack.workPackHash }),
    persistentStoreSchemaHash: digest({ schema: "das026-fictional-durable-store-v1", packageIdentityHash }),
    authenticationAuthorityHash: digest({ authority: "das026-separate-synthetic-challenge-v1", packageIdentityHash }),
    observerEvidenceSchemaHash: digest({ evidence: "das026-independent-observer-external-state-v1", packageIdentityHash }),
  });
  const result = await runCustomerLocalQualificationRuntimeBridge({
    candidate: generatedPackage.candidate,
    observerContract: generatedPackage.observerContract,
    harnessContract,
    packageIdentityHash,
    assignedWork: world.assignedWork,
    driverFactory: createDeclarativeQualificationDriverFactory({ contract: worldContract }),
    now: () => FIXED_NOW_MS,
  });
  requireCondition(result.qualificationReceipt.qualificationPassed === true && result.qualificationReceipt.controlsPassed === 10, `${fixture.id} failed unchanged DAS-023 qualification`);
  const acceptance = sealCustomerLocalAcceptanceOnly({
    qualificationReceipt: result.qualificationReceipt,
    candidate: generatedPackage.candidate,
    observerContract: generatedPackage.observerContract,
    caseContract: result.caseContract,
    harnessContract,
  });
  assertCustomerLocalAcceptanceOnly({
    receipt: acceptance,
    qualificationReceipt: result.qualificationReceipt,
    candidate: generatedPackage.candidate,
    observerContract: generatedPackage.observerContract,
    caseContract: result.caseContract,
    harnessContract,
  });
  return { implementation, generatedPackage, packageIdentityHash, worldContract, harnessContract, result, acceptance };
}

function withRehashedWorkPack(workPack, mutator) {
  const changed = structuredClone(workPack);
  mutator(changed);
  changed.workPackHash = digest(withoutHash(changed, "workPackHash"));
  return changed;
}

function qualificationAggregate(receipt) {
  return {
    businessWrites: receipt.cases.reduce((sum, entry) => sum + entry.businessWrites, 0),
    observerWrites: receipt.cases.reduce((sum, entry) => sum + entry.observerWrites, 0),
    blindRetries: 0,
    freshRuntimeReattachments: receipt.cases.filter((entry) => entry.restartedAfterLostResponse).length,
    failedControls: receipt.cases.filter((entry) => !entry.passed).length,
    unexpectedIncorrectEffects: receipt.cases.filter((entry) => !entry.passed || entry.observerWrites !== 0 || entry.businessWrites > entry.maximumBusinessWrites).length,
  };
}

function runAttacks({ reconstruction, workPack, other }) {
  const attacks = [];
  function attack(id, expected, operation) {
    try {
      operation();
      attacks.push({ id, passed: false, reason: "unsafe-input-accepted" });
    } catch (error) {
      const reason = String(error?.message ?? error);
      attacks.push({ id, passed: expected.test(reason), reason });
    }
  }
  const assertPack = (candidate, chain = reconstruction) => assertCustomerLocalTransportImplementationWorkPack({
    workPack: candidate,
    draftSession: chain.completed,
    packageInputDraft: chain.packageInputDraft,
    generatedPackage: chain.generatedPackage,
    scaffoldPlan: chain.scaffold.plan,
    scaffoldReceipt: chain.scaffold.receipt,
  });

  attack("action-response-as-proof", /independent observation|weakened/i, () => assertPack(withRehashedWorkPack(workPack, (value) => { value.evidenceMappings.actionEvidence.mayProveBusinessOutcome = true; })));
  attack("blind-retry", /authority or retry|weakened/i, () => assertPack(withRehashedWorkPack(workPack, (value) => { value.actionTransport.idempotency.automaticRetries = 1; })));
  attack("observer-write", /independent observation|weakened/i, () => assertPack(withRehashedWorkPack(workPack, (value) => { value.observerTransport.readOnly = false; value.observerTransport.writeOperations = ["unsafeWrite"]; })));
  attack("classification-omission", /omits a canonical classification/i, () => assertPack(withRehashedWorkPack(workPack, (value) => { value.classificationHooks.pop(); })));
  attack("cross-package-replay", /stale|another source|role|package|scaffold|decision chain/i, () => assertCustomerLocalTransportImplementationWorkPack({
    workPack,
    draftSession: other.completed,
    packageInputDraft: other.packageInputDraft,
    generatedPackage: other.generatedPackage,
    scaffoldPlan: other.scaffold.plan,
    scaffoldReceipt: other.scaffold.receipt,
  }));
  const mutatedReceipt = structuredClone(reconstruction.scaffold.receipt);
  mutatedReceipt.generatedProjectHash = "0".repeat(64);
  attack("generated-project-substitution", /integrity|another generated project/i, () => createCustomerLocalTransportImplementationWorkPack({
    draftSession: reconstruction.completed,
    packageInputDraft: reconstruction.packageInputDraft,
    generatedPackage: reconstruction.generatedPackage,
    scaffoldPlan: reconstruction.scaffold.plan,
    scaffoldReceipt: mutatedReceipt,
  }));
  const credentialValue = structuredClone(reconstruction.packageInputDraft);
  credentialValue.actionRuntime.credentialAliases = ["token=definitely-not-an-alias-value"];
  credentialValue.draftHash = digest(withoutHash(credentialValue, "draftHash"));
  attack("credential-value-insertion", /credential|alias|DAS-025 project/i, () => createCustomerLocalTransportImplementationWorkPack({
    draftSession: reconstruction.completed,
    packageInputDraft: credentialValue,
    generatedPackage: reconstruction.generatedPackage,
    scaffoldPlan: reconstruction.scaffold.plan,
    scaffoldReceipt: reconstruction.scaffold.receipt,
  }));
  const sourceMutation = structuredClone(reconstruction.completed);
  const selected = sourceMutation.sources.action.operations.find((operation) => operation.name === reconstruction.packageInputDraft.writeSafety[0].sourceName);
  selected.instructionLikeDescription = true;
  sourceMutation.sessionHash = digest(withoutHash(sourceMutation, "sessionHash"));
  attack("source-instruction-injection", /source identity changed|instruction-like|integrity|another reviewed session revision/i, () => createCustomerLocalTransportImplementationWorkPack({
    draftSession: sourceMutation,
    packageInputDraft: reconstruction.packageInputDraft,
    generatedPackage: reconstruction.generatedPackage,
    scaffoldPlan: reconstruction.scaffold.plan,
    scaffoldReceipt: reconstruction.scaffold.receipt,
  }));
  requireCondition(attacks.every((entry) => entry.passed), `DAS-026 attacks failed: ${JSON.stringify(attacks.filter((entry) => !entry.passed))}`);
  return attacks;
}

export async function runDAS026Fixture(fixture, { otherReconstruction = null } = {}) {
  const started = performance.now();
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), `das026-${fixture.sourceKind}-`));
  try {
    const reconstruction = reconstruct(fixture, stateRoot);
    const workPack = createCustomerLocalTransportImplementationWorkPack({
      draftSession: reconstruction.completed,
      packageInputDraft: reconstruction.packageInputDraft,
      generatedPackage: reconstruction.generatedPackage,
      scaffoldPlan: reconstruction.scaffold.plan,
      scaffoldReceipt: reconstruction.scaffold.receipt,
    });
    assertCustomerLocalTransportImplementationWorkPack({
      workPack,
      draftSession: reconstruction.completed,
      packageInputDraft: reconstruction.packageInputDraft,
      generatedPackage: reconstruction.generatedPackage,
      scaffoldPlan: reconstruction.scaffold.plan,
      scaffoldReceipt: reconstruction.scaffold.receipt,
    });
    const qualification = await qualify({ fixture, reconstruction, workPack });
    const aggregate = qualificationAggregate(qualification.result.qualificationReceipt);
    const result = {
      schemaVersion: "das.das026-transport-assistance-fixture-result.v1",
      fixtureId: fixture.id,
      sourceKind: fixture.sourceKind,
      exactIdentities: {
        packageIdentityHash: workPack.packageIdentityHash,
        workPackHash: workPack.workPackHash,
        actionTransportSkeletonHash: workPack.actionTransport.transportSkeletonHash,
        observerTransportSkeletonHash: workPack.observerTransport.transportSkeletonHash,
        fictionalImplementationReceiptHash: qualification.implementation.receiptHash,
        qualificationReceiptHash: qualification.result.qualificationReceipt.receiptHash,
        acceptanceOnlyReceiptHash: qualification.acceptance.receiptHash,
      },
      generated: structuredClone(workPack.measurements),
      manualBlockers: [...workPack.manualBlockers],
      qualification: {
        status: "passed-exact-fictional-disposable-candidate",
        controlsPassed: qualification.result.qualificationReceipt.controlsPassed,
        controlsRequired: qualification.result.qualificationReceipt.controlsRequired,
        businessWrites: aggregate.businessWrites,
        observerWrites: aggregate.observerWrites,
        blindRetries: aggregate.blindRetries,
        lostResponseFreshRuntimeReattachments: aggregate.freshRuntimeReattachments,
        unexpectedIncorrectEffects: aggregate.unexpectedIncorrectEffects,
        generatedWorkPackCustomerExecutable: false,
      },
      timings: { activeMachineMs: Math.round((performance.now() - started) * 1000) / 1000 },
      modelCalls: 0,
      spendUsd: 0,
      evidenceBoundary: "Fresh fictional local package and disposable qualification only. The work pack remains non-executable and no real provider/client/credential/authority/customer environment was used.",
    };
    result.resultHash = digest(result);
    return { result: Object.freeze(result), reconstruction, workPack };
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
}

export async function runDAS026Rehearsal({ outputRoot = OUTPUT_ROOT } = {}) {
  const started = performance.now();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "das026-paired-"));
  try {
    const reconstructions = DAS026_FRESH_FIXTURES.map((fixture, index) => reconstruct(fixture, path.join(temporary, `prebuilt-${index}`)));
    const runs = [];
    for (let index = 0; index < DAS026_FRESH_FIXTURES.length; index += 1) {
      const fixture = DAS026_FRESH_FIXTURES[index];
      const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), `das026-run-${index}-`));
      try {
        const reconstruction = reconstruct(fixture, stateRoot);
        const workPack = createCustomerLocalTransportImplementationWorkPack({
          draftSession: reconstruction.completed,
          packageInputDraft: reconstruction.packageInputDraft,
          generatedPackage: reconstruction.generatedPackage,
          scaffoldPlan: reconstruction.scaffold.plan,
          scaffoldReceipt: reconstruction.scaffold.receipt,
        });
        assertCustomerLocalTransportImplementationWorkPack({ workPack, draftSession: reconstruction.completed, packageInputDraft: reconstruction.packageInputDraft, generatedPackage: reconstruction.generatedPackage, scaffoldPlan: reconstruction.scaffold.plan, scaffoldReceipt: reconstruction.scaffold.receipt });
        const qualification = await qualify({ fixture, reconstruction, workPack });
        const aggregate = qualificationAggregate(qualification.result.qualificationReceipt);
        const attacks = runAttacks({ reconstruction, workPack, other: reconstructions[(index + 1) % reconstructions.length] });
        runs.push({
          fixtureId: fixture.id,
          sourceKind: fixture.sourceKind,
          workPack,
          qualification: {
            fictionalImplementationReceiptHash: qualification.implementation.receiptHash,
            qualificationPackageReceiptHash: qualification.generatedPackage.receipt.receiptHash,
            qualificationReceiptHash: qualification.result.qualificationReceipt.receiptHash,
            acceptanceOnlyReceiptHash: qualification.acceptance.receiptHash,
            controlsPassed: qualification.result.qualificationReceipt.controlsPassed,
            controlsRequired: qualification.result.qualificationReceipt.controlsRequired,
            aggregate,
            generatedWorkPackCustomerExecutable: false,
          },
          attacks,
        });
      } finally {
        fs.rmSync(stateRoot, { recursive: true, force: true });
      }
    }
    const report = {
      schemaVersion: "das.das026-transport-implementation-assistance-report.v1",
      preregistration: "reports/0103-das026-transport-implementation-assistance-preregistration.md",
      sourceManifest: sourceManifest(),
      freshFixtureIds: DAS026_FRESH_FIXTURES.map((fixture) => fixture.id),
      sourceFamilies: DAS026_FRESH_FIXTURES.map((fixture) => fixture.sourceKind),
      runs,
      aggregate: {
        packages: runs.length,
        workPacksGenerated: runs.length,
        transportSkeletonsGenerated: runs.reduce((sum, run) => sum + run.workPack.measurements.generatedTransportSkeletons, 0),
        classificationHooksGenerated: runs.reduce((sum, run) => sum + run.workPack.measurements.generatedClassificationHooks, 0),
        testsGenerated: runs.reduce((sum, run) => sum + run.workPack.measurements.generatedConformanceAndNegativeTests, 0),
        dependencyTasksGenerated: runs.reduce((sum, run) => sum + run.workPack.measurements.generatedDependencyOrderedTasks, 0),
        packageSpecificExecutableFilesGenerated: 0,
        packageSpecificExecutableLinesGenerated: 0,
        fictionalQualificationControlsPassed: runs.reduce((sum, run) => sum + run.qualification.controlsPassed, 0),
        fictionalQualificationControlsRequired: runs.reduce((sum, run) => sum + run.qualification.controlsRequired, 0),
        integrityAttacksPassed: runs.reduce((sum, run) => sum + run.attacks.filter((entry) => entry.passed).length, 0),
        integrityAttacksRequired: runs.reduce((sum, run) => sum + run.attacks.length, 0),
        customerExecutableOperations: 0,
        credentialValues: 0,
        modelCalls: 0,
        spendUsd: 0,
        activeMachineMs: Math.round((performance.now() - started) * 1000) / 1000,
      },
      verdict: "passed-non-executable-assistance-and-fictional-qualification",
      strongestAccurateFinding: "Across one fresh fictional OpenAPI package and one fresh fictional pinned-MCP package, the same deterministic DAS-026 compiler produced integrity-bound action/observer transport work packs, evidence mappings, authority/retry hooks, ten classification hooks, tests and dependency-ordered tasks. Separately bound fictional implementation candidates passed the unchanged DAS-023 disposable ten-control qualification. No real transport, credential, customer authority or activation was established.",
      remainingBlocker: "A customer-local engineer must still implement and authenticate the exact provider clients, authority enforcement, action/reconciliation serialization, independent observer and proof mappings, then run customer-environment acceptance. A fresh non-author user study also remains an external human evidence gate.",
      evidenceBoundary: "Private fictional deterministic local evidence only. It is not self-serve onboarding, customer execution, arbitrary OpenAPI/MCP support, production reliability, customer validation, deployment or activation.",
    };
    report.resultHash = digest(report);
    fs.mkdirSync(outputRoot, { recursive: false, mode: 0o700 });
    writePrivate(path.join(outputRoot, "result.json"), report);
    const summary = {
      schemaVersion: "das.das026-summary.v1",
      resultHash: report.resultHash,
      verdict: report.verdict,
      aggregate: report.aggregate,
      workPackHashes: Object.fromEntries(runs.map((run) => [run.fixtureId, run.workPack.workPackHash])),
      evidenceBoundary: report.evidenceBoundary,
    };
    summary.summaryHash = digest(summary);
    writePrivate(path.join(outputRoot, "summary.json"), summary);
    return Object.freeze(report);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runDAS026Rehearsal().then((report) => process.stdout.write(`${JSON.stringify({ verdict: report.verdict, resultHash: report.resultHash, aggregate: report.aggregate }, null, 2)}\n`)).catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
