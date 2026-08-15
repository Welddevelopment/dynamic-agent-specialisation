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
  sealCustomerLocalAcceptanceOnly,
} from "../../product/customer-local-binding-qualification.js";
import { runCustomerLocalQualificationRuntimeBridge } from "../../product/customer-local-qualification-runtime-bridge.js";
import {
  createCustomerLocalBindingPluginScaffoldPlan,
  inspectCustomerLocalBindingPluginScaffold,
  writeCustomerLocalBindingPluginScaffold,
} from "../../product/customer-local-binding-plugin-scaffold.js";
import { DAS024_VALID_FIXTURES } from "../das024-authoring/fixtures.js";
import { prepareDAS024QualificationBinding } from "../das024-authoring/qualification-harness.js";
import {
  DAS025_FIXED_NOW_MS,
  assertDAS025FictionalImplementationBinding,
  createDAS025FictionalImplementationBinding,
  createDAS025QualificationDriver,
  createDAS025QualificationHarness,
  createDAS025QualificationPackage,
} from "./fictional-runtime.js";

const OUTPUT_ROOT = path.resolve("artifacts/onboarding/das025-plugin-project-rehearsal-v2");
const SUPERSEDED_V1_ARTIFACT_SHA256 = "1e68db507240205449894a683fe912a52b16b92db25fbce147eb8c97248ec48b";
const FROZEN_SOURCE_FILES = Object.freeze([
  "reports/0101-das025-plugin-project-preregistration.md",
  "src/product/customer-local-binding-plugin-scaffold.js",
  "src/product/source-grounded-binding-package-draft.js",
  "src/product/customer-local-binding-package-factory.js",
  "src/product/customer-local-binding-qualification.js",
  "src/product/customer-local-qualification-runtime-bridge.js",
  "src/product/declarative-customer-local-qualification-world.js",
  "src/experiments/das024-authoring/fixtures.js",
  "src/experiments/das024-authoring/qualification-harness.js",
  "src/experiments/das025-plugin-project/fictional-runtime.js",
  "src/experiments/das025-plugin-project/rehearsal.js",
]);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
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
  requireCondition(completed.status === "complete-non-executable-package-input-draft", `${fixture.id} did not complete the fresh DAS-024 reconstruction`);
  const prepared = prepareDAS024QualificationBinding({ fixture, stateDirectory: path.join(stateRoot, "qualification-binding") });
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
  return { initial, completed, prepared, packageInputDraft, generatedPackage };
}

function runIntegrityAttacks({ fixture, reconstruction, scaffold, implementationBinding, stateRoot }) {
  const attacks = [];
  function attack(id, expectedPattern, operation) {
    try {
      operation();
      attacks.push({ id, passed: false, reason: "unsafe-input-accepted" });
    } catch (error) {
      const reason = String(error?.message ?? error);
      attacks.push({ id, passed: expectedPattern.test(reason), reason });
    }
  }

  inspectCustomerLocalBindingPluginScaffold({ directory: scaffold.root, expectedReceiptHash: scaffold.receipt.receiptHash });
  const actionIndex = path.join(scaffold.root, "action-plugin", "src", "index.js");
  const originalActionIndex = fs.readFileSync(actionIndex);
  fs.appendFileSync(actionIndex, "\n// integrity attack\n");
  attack("generated-file-mutation", /content changed|project integrity|generated project/i, () => inspectCustomerLocalBindingPluginScaffold({ directory: scaffold.root, expectedReceiptHash: scaffold.receipt.receiptHash }));
  fs.writeFileSync(actionIndex, originalActionIndex, { mode: 0o600 });
  fs.chmodSync(actionIndex, 0o600);
  inspectCustomerLocalBindingPluginScaffold({ directory: scaffold.root, expectedReceiptHash: scaffold.receipt.receiptHash });

  const mutatedPackage = structuredClone(reconstruction.generatedPackage);
  mutatedPackage.actionRuntimeDeclaration.runtimeSchemaHash = "0".repeat(64);
  attack("stale-mutated-das023-package", /integrity|mismatch/i, () => createCustomerLocalBindingPluginScaffoldPlan({
    packageInputDraft: reconstruction.packageInputDraft,
    generatedPackage: mutatedPackage,
  }));

  const substitutedBinding = structuredClone(implementationBinding);
  substitutedBinding.action.implementationContentHash = "f".repeat(64);
  attack("implementation-content-substitution", /integrity|stale|another package|implementation/i, () => assertDAS025FictionalImplementationBinding({
    receipt: substitutedBinding,
    fixture,
    packageInputDraft: reconstruction.packageInputDraft,
    generatedPackage: reconstruction.generatedPackage,
    scaffoldPlan: scaffold.plan,
    scaffoldReceipt: scaffold.receipt,
  }));

  const secondRoot = path.join(stateRoot, "cross-package-scaffold");
  const otherFixture = DAS024_VALID_FIXTURES.find((candidate) => candidate.id !== fixture.id);
  const other = reconstruct(otherFixture, path.join(stateRoot, "cross-package-reconstruction"));
  const otherScaffold = writeCustomerLocalBindingPluginScaffold({
    directory: secondRoot,
    packageInputDraft: other.packageInputDraft,
    generatedPackage: other.generatedPackage,
  });
  attack("cross-package-scaffold-receipt", /expected generation|does not match|another/i, () => inspectCustomerLocalBindingPluginScaffold({ directory: scaffold.root, expectedReceiptHash: otherScaffold.receipt.receiptHash }));

  const wrongFixture = otherFixture;
  attack("cross-role-implementation-replay", /stale|another package|role|scaffold/i, () => assertDAS025FictionalImplementationBinding({
    receipt: implementationBinding,
    fixture: wrongFixture,
    packageInputDraft: other.packageInputDraft,
    generatedPackage: other.generatedPackage,
    scaffoldPlan: otherScaffold.plan,
    scaffoldReceipt: otherScaffold.receipt,
  }));

  requireCondition(attacks.every((entry) => entry.passed), `${fixture.id} did not reject every integrity attack: ${JSON.stringify(attacks.filter((entry) => !entry.passed))}`);
  return attacks;
}

export async function runDAS025FixtureRehearsal(fixture, { keepState = false } = {}) {
  const started = performance.now();
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), `das025-${fixture.sourceKind}-`));
  try {
    const reconstruction = reconstruct(fixture, stateRoot);
    const scaffoldRoot = path.join(stateRoot, "generated-plugin-projects");
    const scaffold = writeCustomerLocalBindingPluginScaffold({
      directory: scaffoldRoot,
      packageInputDraft: reconstruction.packageInputDraft,
      generatedPackage: reconstruction.generatedPackage,
    });
    inspectCustomerLocalBindingPluginScaffold({ directory: scaffold.root, expectedReceiptHash: scaffold.receipt.receiptHash });
    const implementationBinding = createDAS025FictionalImplementationBinding({
      fixture,
      packageInputDraft: reconstruction.packageInputDraft,
      generatedPackage: reconstruction.generatedPackage,
      scaffoldPlan: scaffold.plan,
      scaffoldReceipt: scaffold.receipt,
    });
    assertDAS025FictionalImplementationBinding({
      receipt: implementationBinding,
      fixture,
      packageInputDraft: reconstruction.packageInputDraft,
      generatedPackage: reconstruction.generatedPackage,
      scaffoldPlan: scaffold.plan,
      scaffoldReceipt: scaffold.receipt,
    });
    const qualificationPackage = createDAS025QualificationPackage({
      structuralBinding: reconstruction.prepared.structuralBinding,
      workPlan: reconstruction.prepared.workPlan,
      packageInputDraft: reconstruction.packageInputDraft,
      implementationBinding,
    });
    requireCondition(qualificationPackage.candidate.action.implementationHash === implementationBinding.action.implementationContentHash, "Qualification candidate did not bind the exact action implementation content");
    requireCondition(qualificationPackage.candidate.observer.implementationHash === implementationBinding.observer.implementationContentHash, "Qualification candidate did not bind the exact observer implementation content");
    const packageIdentityHash = digest({
      fixtureId: fixture.id,
      das024DraftHash: reconstruction.packageInputDraft.draftHash,
      originalDas023PackageReceiptHash: reconstruction.generatedPackage.receipt.receiptHash,
      scaffoldReceiptHash: scaffold.receipt.receiptHash,
      implementationBindingReceiptHash: implementationBinding.receiptHash,
      qualificationPackageReceiptHash: qualificationPackage.receipt.receiptHash,
    });
    const harnessContract = createDAS025QualificationHarness({ fixture, packageIdentityHash, implementationBinding });
    const qualification = await runCustomerLocalQualificationRuntimeBridge({
      candidate: qualificationPackage.candidate,
      observerContract: qualificationPackage.observerContract,
      harnessContract,
      packageIdentityHash,
      assignedWork: fixture.qualificationWorld.assignedWork,
      driverFactory: createDAS025QualificationDriver({ fixture, packageIdentityHash }),
      now: () => DAS025_FIXED_NOW_MS,
    });
    requireCondition(qualification.qualificationReceipt.qualificationPassed === true && qualification.qualificationReceipt.controlsPassed === 10, `${fixture.id} failed unchanged DAS-023 ten-control qualification`);
    const acceptance = sealCustomerLocalAcceptanceOnly({
      qualificationReceipt: qualification.qualificationReceipt,
      candidate: qualificationPackage.candidate,
      observerContract: qualificationPackage.observerContract,
      caseContract: qualification.caseContract,
      harnessContract,
    });
    assertCustomerLocalAcceptanceOnly({
      receipt: acceptance,
      qualificationReceipt: qualification.qualificationReceipt,
      candidate: qualificationPackage.candidate,
      observerContract: qualificationPackage.observerContract,
      caseContract: qualification.caseContract,
      harnessContract,
    });
    const conformanceReceipt = {
      schemaVersion: "das.das025-fictional-implementation-conformance-receipt.v1",
      fixtureId: fixture.id,
      implementationBindingReceiptHash: implementationBinding.receiptHash,
      actionImplementationContentHash: implementationBinding.action.implementationContentHash,
      observerImplementationContentHash: implementationBinding.observer.implementationContentHash,
      exactImplementationSourceFiles: structuredClone(implementationBinding.action.implementationSourceFiles),
      qualificationPackageReceiptHash: qualificationPackage.receipt.receiptHash,
      caseContractHash: qualification.caseContract.contractHash,
      qualificationReceiptHash: qualification.qualificationReceipt.receiptHash,
      acceptanceOnlyReceiptHash: acceptance.receiptHash,
      controlsPassed: qualification.qualificationReceipt.controlsPassed,
      controlsRequired: qualification.qualificationReceipt.controlsRequired,
      executableCustomerOperations: 0,
      runtimeAuthorityGranted: false,
      activationReady: false,
      modelCalls: 0,
      spendUsd: 0,
      evidenceBoundary: "Exact implementation-content and disposable local qualification receipt only. This does not upgrade the generated scaffold itself or establish a customer-executable plugin, credential, authority, activation or production conformance.",
    };
    conformanceReceipt.conformanceReceiptHash = digest(conformanceReceipt);
    const integrityAttacks = runIntegrityAttacks({ fixture, reconstruction, scaffold, implementationBinding, stateRoot });
    const controls = qualification.qualificationReceipt.cases;
    const result = {
      schemaVersion: "das.das025-plugin-project-fixture-rehearsal.v1",
      fixtureId: fixture.id,
      sourceKind: fixture.sourceKind,
      reconstruction: {
        freshDAS024Session: true,
        explicitQuestions: reconstruction.initial.questionGraph.length,
        ownerDecisions: reconstruction.completed.answers.filter((answer) => answer.actorRole === "owner").length,
        engineerDecisions: reconstruction.completed.answers.filter((answer) => answer.actorRole === "engineer").length,
        das024DraftHash: reconstruction.packageInputDraft.draftHash,
        originalDAS023PackageReceiptHash: reconstruction.generatedPackage.receipt.receiptHash,
      },
      scaffold: {
        planHash: scaffold.plan.planHash,
        receiptHash: scaffold.receipt.receiptHash,
        generatedProjectHash: scaffold.receipt.generatedProjectHash,
        generatedFiles: scaffold.plan.measurements.generatedFiles,
        generatedSourceFiles: scaffold.plan.measurements.generatedScaffoldSourceFiles,
        generatedSourceLines: scaffold.plan.measurements.generatedScaffoldSourceLines,
        generatedExecutableFunctions: scaffold.plan.measurements.generatedExecutableFunctions,
        remainingImplementationItems: scaffold.plan.measurements.remainingHandwrittenImplementationItems,
        protectedGates: structuredClone(scaffold.plan.gates),
      },
      implementation: {
        receiptHash: implementationBinding.receiptHash,
        actionImplementationIntentHash: implementationBinding.action.implementationIntentHash,
        actionImplementationContentHash: implementationBinding.action.implementationContentHash,
        observerImplementationIntentHash: implementationBinding.observer.implementationIntentHash,
        observerImplementationContentHash: implementationBinding.observer.implementationContentHash,
        conformanceReceiptHash: conformanceReceipt.conformanceReceiptHash,
        conformanceReceipt,
        sharedImplementationFiles: implementationBinding.measurements.sharedImplementationFiles,
        sharedImplementationNonBlankLines: implementationBinding.measurements.sharedImplementationNonBlankLines,
        packageSpecificExecutableFiles: 0,
        packageSpecificExecutableLines: 0,
        explicitPackageProfileFields: implementationBinding.measurements.explicitPackageProfileFields,
      },
      qualification: {
        controlsPassed: qualification.qualificationReceipt.controlsPassed,
        controlsRequired: qualification.qualificationReceipt.controlsRequired,
        businessWrites: controls.reduce((sum, control) => sum + control.businessWrites, 0),
        observerWrites: controls.reduce((sum, control) => sum + control.observerWrites, 0),
        lostResponseWrites: controls.find((control) => control.id === "lost-response")?.businessWrites,
        lostResponseReplays: 0,
        freshProcessRecovery: controls.find((control) => control.id === "lost-response")?.restartedAfterLostResponse === true,
        acceptanceStatus: acceptance.status,
        executableCustomerOperations: acceptance.executableOperations,
        runtimeAuthorityGranted: acceptance.runtimeAuthorityGranted,
        activationReady: acceptance.activationReady,
      },
      integrityAttacks,
      activeMachineTimeMs: Number((performance.now() - started).toFixed(3)),
      humanSetupTimeMeasured: false,
      modelCalls: 0,
      spendUsd: 0,
      evidenceBoundary: "Private deterministic fictional local rehearsal. Generated plugin projects remained non-executable; qualification used a separate exact implementation layer outside generated directories. No customer binding, credential, production authority, activation, human setup-time result, model call or spend is established.",
    };
    result.resultHash = digest(result);
    return result;
  } finally {
    if (!keepState) fs.rmSync(stateRoot, { recursive: true, force: true });
  }
}

export async function runDAS025PluginProjectRehearsal({ outputRoot = OUTPUT_ROOT, writeArtifacts = true } = {}) {
  const campaignStarted = performance.now();
  const sourceManifestBefore = sourceManifest();
  const results = [];
  for (const fixture of DAS024_VALID_FIXTURES) results.push(await runDAS025FixtureRehearsal(fixture));
  const sourceManifestAfter = sourceManifest();
  requireCondition(digest(sourceManifestBefore) === digest(sourceManifestAfter), "DAS-025 frozen source files changed during the campaign");
  const summary = {
    schemaVersion: "das.das025-plugin-project-rehearsal-summary.v1",
    evidenceRevision: "v2-raw-file-sha256-repair",
    supersededV1ArtifactSha256: SUPERSEDED_V1_ARTIFACT_SHA256,
    fixtureCount: results.length,
    sourceKinds: [...new Set(results.map((result) => result.sourceKind))].sort(),
    controlsPassed: results.reduce((sum, result) => sum + result.qualification.controlsPassed, 0),
    controlsRequired: results.reduce((sum, result) => sum + result.qualification.controlsRequired, 0),
    integrityAttacksPassed: results.reduce((sum, result) => sum + result.integrityAttacks.filter((entry) => entry.passed).length, 0),
    integrityAttacksRequired: results.reduce((sum, result) => sum + result.integrityAttacks.length, 0),
    generatedFiles: results.reduce((sum, result) => sum + result.scaffold.generatedFiles, 0),
    generatedSourceLines: results.reduce((sum, result) => sum + result.scaffold.generatedSourceLines, 0),
    packageSpecificExecutableFiles: 0,
    packageSpecificExecutableLines: 0,
    observerWrites: results.reduce((sum, result) => sum + result.qualification.observerWrites, 0),
    lostResponseReplays: results.reduce((sum, result) => sum + result.qualification.lostResponseReplays, 0),
    protectedGatesPreserved: results.every((result) => result.qualification.executableCustomerOperations === 0 && result.qualification.runtimeAuthorityGranted === false && result.qualification.activationReady === false),
    sourceIntegrity: {
      files: sourceManifestAfter,
      manifestHash: digest(sourceManifestAfter),
      unchangedDuringCampaign: true,
    },
    activeMachineTimeMs: Number((performance.now() - campaignStarted).toFixed(3)),
    humanSetupTimeMeasured: false,
    modelCalls: 0,
    spendUsd: 0,
    status: "private-local-fictional-rehearsal-only",
    evidenceBoundary: "Two fresh fictional source families only. The generator produced non-executable plugin projects; separately bound disposable implementations passed local controls. This is not customer code generation, customer execution, arbitrary source support, activation, usability, production reliability or public evidence.",
    results,
  };
  summary.summaryHash = digest(summary);
  if (writeArtifacts) {
    requireCondition(!fs.existsSync(outputRoot), `DAS-025 output already exists: ${outputRoot}`);
    fs.mkdirSync(outputRoot, { recursive: false, mode: 0o700 });
    writePrivate(path.join(outputRoot, "result.json"), summary);
  }
  return summary;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await runDAS025PluginProjectRehearsal();
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    fixtureCount: result.fixtureCount,
    controls: `${result.controlsPassed}/${result.controlsRequired}`,
    integrityAttacks: `${result.integrityAttacksPassed}/${result.integrityAttacksRequired}`,
    generatedFiles: result.generatedFiles,
    packageSpecificExecutableLines: result.packageSpecificExecutableLines,
    modelCalls: result.modelCalls,
    spendUsd: result.spendUsd,
    outputRoot: OUTPUT_ROOT,
  }, null, 2)}\n`);
}
