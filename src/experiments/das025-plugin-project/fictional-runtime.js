import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { digest } from "../../core/canonical.js";
import { createCustomerLocalBindingPackage } from "../../product/customer-local-binding-package-factory.js";
import { createCustomerLocalQualificationHarnessContract } from "../../product/customer-local-binding-qualification.js";
import {
  createDeclarativeQualificationDriverFactory,
  createDeclarativeQualificationWorldContract,
} from "../../product/declarative-customer-local-qualification-world.js";

const HASH = /^[a-f0-9]{64}$/;
const FIXED_NOW_MS = 1_000;
const IMPLEMENTATION_SOURCE_FILES = Object.freeze([
  "src/experiments/das025-plugin-project/fictional-runtime.js",
  "src/product/declarative-customer-local-qualification-world.js",
  "src/product/customer-local-qualification-runtime-bridge.js",
]);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

function hashFile(relative) {
  const absolute = path.resolve(relative);
  const content = fs.readFileSync(absolute);
  return Object.freeze({
    relative,
    sha256: createHash("sha256").update(content).digest("hex"),
    nonBlankLines: content.toString("utf8").split("\n").filter((line) => line.trim()).length,
  });
}

function generatedProjectHash(scaffoldReceipt) {
  const exact = scaffoldReceipt.generatedProjectHash;
  requireCondition(HASH.test(exact ?? ""), "Scaffold generated-project hash is invalid");
  return exact;
}

function implementationIntentHash(contract) {
  const exact = contract.implementationIntentHash;
  requireCondition(HASH.test(exact ?? ""), "Scaffold contract is missing its reviewed implementation-intent hash");
  return exact;
}

function packageProfile(fixture) {
  return Object.freeze({
    fixtureId: fixture.id,
    sourceKind: fixture.sourceKind,
    actionOperation: fixture.answers.actionOperation,
    actionReadOperations: [...fixture.answers.actionReadOperations],
    reconciliationOperation: fixture.answers.reconciliationOperation,
    observerOperations: [...fixture.answers.observerOperations],
    stableIdentityFields: [...fixture.qualificationWorld.stableIdentityFields],
    requiredExactFields: [...fixture.answers.requiredExactFields],
    resultIdentityField: fixture.qualificationWorld.resultIdentityField,
    statusField: fixture.qualificationWorld.statusField,
    completionStatus: fixture.qualificationWorld.completionStatus,
    allowedChangedEntityKind: fixture.qualificationWorld.allowedChangedEntityKind,
    partialField: fixture.qualificationWorld.partialField,
    incorrectField: fixture.qualificationWorld.incorrectField,
    incorrectValue: structuredClone(fixture.qualificationWorld.incorrectValue),
    protectedStateDigest: fixture.qualificationWorld.protectedStateDigest,
  });
}

/**
 * Binds the generated, still non-executable project to the exact disposable
 * implementation code and explicit fictional business-world profile used in
 * the separate DAS-023 qualification rehearsal. It does not modify or fill in
 * the generated project directory.
 */
export function createDAS025FictionalImplementationBinding({
  fixture,
  packageInputDraft,
  generatedPackage,
  scaffoldPlan,
  scaffoldReceipt,
}) {
  requireCondition(fixture && packageInputDraft && generatedPackage && scaffoldPlan && scaffoldReceipt, "DAS-025 implementation binding inputs are incomplete");
  requireCondition(scaffoldReceipt.draftHash === packageInputDraft.draftHash, "Scaffold does not belong to the exact DAS-024 draft");
  requireCondition(scaffoldReceipt.packageReceiptHash === generatedPackage.receipt.receiptHash, "Scaffold does not belong to the exact DAS-023 package");
  requireCondition(scaffoldReceipt.inputHash === digest({ draftHash: packageInputDraft.draftHash, packageReceiptHash: generatedPackage.receipt.receiptHash }), "Scaffold chain input hash is invalid");
  requireCondition(scaffoldPlan.inputHash === scaffoldReceipt.inputHash && scaffoldPlan.planHash === scaffoldReceipt.planHash, "Scaffold plan and receipt do not match");
  requireCondition(packageInputDraft.draftHash && generatedPackage.receipt.receiptHash, "DAS-025 requires exact DAS-024 and DAS-023 receipts");
  requireCondition(scaffoldReceipt.executable === false && scaffoldReceipt.qualified === false && scaffoldReceipt.activated === false, "Generated scaffold widened a protected gate");

  const sourceFiles = IMPLEMENTATION_SOURCE_FILES.map(hashFile);
  const profile = packageProfile(fixture);
  const projectHash = generatedProjectHash(scaffoldReceipt);
  const common = {
    schemaVersion: "das.das025-fictional-implementation-plane.v1",
    fixtureId: fixture.id,
    das024DraftHash: packageInputDraft.draftHash,
    das023PackageReceiptHash: generatedPackage.receipt.receiptHash,
    scaffoldPlanHash: scaffoldPlan.planHash,
    scaffoldReceiptHash: scaffoldReceipt.receiptHash,
    generatedProjectHash: projectHash,
    implementationSourceFiles: sourceFiles,
    fictionalWorldProfile: profile,
    credentialsResolved: false,
    runtimeAuthorityGranted: false,
    productionAuthorityGranted: false,
    customerRuntimeWired: false,
    activationReady: false,
    evidenceBoundary: "Exact disposable local fictional implementation identity only. It lives outside the generated plugin projects and grants no customer credential, authority, executable customer operation, acceptance or activation.",
  };
  const action = {
    ...common,
    plane: "action",
    implementationIntentHash: implementationIntentHash(scaffoldPlan.actionContract),
    bindingId: scaffoldPlan.actionContract.bindingId,
    surfaceId: scaffoldPlan.actionContract.surfaceId,
    credentialAliases: [...scaffoldPlan.actionContract.credentialAliases],
    allowedOperations: [...scaffoldPlan.actionContract.writeOperations],
    reconciliationOperations: [...scaffoldPlan.actionContract.reconcileOperations],
  };
  action.implementationContentHash = digest(action);
  const observer = {
    ...common,
    plane: "observer",
    implementationIntentHash: implementationIntentHash(scaffoldPlan.observerContract),
    observerId: scaffoldPlan.observerContract.observerId,
    surfaceId: scaffoldPlan.observerContract.surfaceId,
    credentialAliases: [...scaffoldPlan.observerContract.credentialAliases],
    readOperations: [...scaffoldPlan.observerContract.readOperations],
    readOnly: true,
    writeOperations: [],
  };
  observer.implementationContentHash = digest(observer);
  requireCondition(action.implementationContentHash !== observer.implementationContentHash, "Action and observer implementation identities must remain separate");

  const receipt = {
    schemaVersion: "das.das025-fictional-implementation-binding-receipt.v1",
    fixtureId: fixture.id,
    das024DraftHash: packageInputDraft.draftHash,
    das023PackageReceiptHash: generatedPackage.receipt.receiptHash,
    scaffoldPlanHash: scaffoldPlan.planHash,
    scaffoldReceiptHash: scaffoldReceipt.receiptHash,
    generatedProjectHash: projectHash,
    action,
    observer,
    measurements: {
      sharedImplementationFiles: sourceFiles.length,
      sharedImplementationNonBlankLines: sourceFiles.reduce((sum, file) => sum + file.nonBlankLines, 0),
      packageSpecificExecutableFiles: 0,
      packageSpecificExecutableLines: 0,
      explicitPackageProfileFields: Object.keys(profile).length,
      modelCalls: 0,
      spendUsd: 0,
    },
    gates: {
      generatedScaffoldExecutable: false,
      customerExecutable: false,
      credentialsResolved: false,
      runtimeAuthorityGranted: false,
      productionAuthorityGranted: false,
      activationReady: false,
    },
  };
  receipt.receiptHash = digest(receipt);
  return Object.freeze(receipt);
}

export function assertDAS025FictionalImplementationBinding({
  receipt,
  fixture,
  packageInputDraft,
  generatedPackage,
  scaffoldPlan,
  scaffoldReceipt,
}) {
  requireCondition(receipt?.schemaVersion === "das.das025-fictional-implementation-binding-receipt.v1", "Unsupported DAS-025 implementation binding receipt");
  requireCondition(receipt.receiptHash === digest(withoutHash(receipt, "receiptHash")), "DAS-025 implementation binding receipt integrity mismatch");
  const expected = createDAS025FictionalImplementationBinding({ fixture, packageInputDraft, generatedPackage, scaffoldPlan, scaffoldReceipt });
  requireCondition(expected.receiptHash === receipt.receiptHash, "DAS-025 implementation binding is stale or belongs to another package, scaffold, source, role, or implementation");
  return true;
}

export function createDAS025QualificationPackage({ structuralBinding, workPlan, packageInputDraft, implementationBinding }) {
  requireCondition(implementationBinding?.receiptHash === digest(withoutHash(implementationBinding, "receiptHash")), "DAS-025 qualification package requires an intact implementation binding");
  const actionRuntime = structuredClone(packageInputDraft.actionRuntime);
  actionRuntime.implementationHash = implementationBinding.action.implementationContentHash;
  const observerProof = structuredClone(packageInputDraft.observerProof);
  observerProof.runtime.implementationHash = implementationBinding.observer.implementationContentHash;
  return createCustomerLocalBindingPackage({
    structuralBinding,
    workPlan,
    sourceIdentity: packageInputDraft.sourceIdentity,
    actionRuntime,
    writeSafety: packageInputDraft.writeSafety,
    observerProof,
  });
}

export function createDAS025QualificationWorld({ fixture, packageIdentityHash }) {
  const world = fixture.qualificationWorld;
  return createDeclarativeQualificationWorldContract({
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
}

export function createDAS025QualificationHarness({ fixture, packageIdentityHash, implementationBinding }) {
  return createCustomerLocalQualificationHarnessContract({
    harnessId: `${fixture.id}:das025-fictional-plugin-qualification-v1`,
    worldImplementationHash: digest({
      implementation: "das025-fictional-plugin-qualification-v1",
      actionImplementationContentHash: implementationBinding.action.implementationContentHash,
      observerImplementationContentHash: implementationBinding.observer.implementationContentHash,
      packageIdentityHash,
    }),
    persistentStoreSchemaHash: digest({ schema: "das025-fictional-durable-store-v1", packageIdentityHash }),
    authenticationAuthorityHash: digest({ authority: "das025-separate-synthetic-challenge-v1", packageIdentityHash }),
    observerEvidenceSchemaHash: digest({ evidence: "das025-independent-observer-external-state-v1", packageIdentityHash }),
  });
}

export function createDAS025QualificationDriver({ fixture, packageIdentityHash }) {
  return createDeclarativeQualificationDriverFactory({ contract: createDAS025QualificationWorld({ fixture, packageIdentityHash }) });
}

export const DAS025_FIXED_NOW_MS = FIXED_NOW_MS;
