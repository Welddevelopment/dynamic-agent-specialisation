import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { digest } from "../../core/canonical.js";
import {
  applySourceGroundedBindingDraftAnswers,
  assertSourceGroundedBindingDraftSession,
  createSourceGroundedBindingDraftSession,
  materializeSourceGroundedBindingPackageInputs,
} from "../../product/source-grounded-binding-package-draft.js";
import { SourceGroundedBindingDraftStore } from "../../product/source-grounded-binding-draft-store.js";
import { createCustomerLocalBindingPackage, assertCustomerLocalBindingPackage } from "../../product/customer-local-binding-package-factory.js";
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
  DAS024_AUTHORING_FIXTURES,
  DAS024_FIXTURE_FREEZE,
  DAS024_MALICIOUS_FIXTURE,
  DAS024_VALID_FIXTURES,
} from "./fixtures.js";
import { preflightDAS024Fixtures } from "./preflight.js";
import { prepareDAS024QualificationBinding } from "./qualification-harness.js";

const OUTPUT_ROOT = path.resolve("artifacts/onboarding/source-grounded-binding-authoring-v2");
const FIXED_NOW_MS = 1_000;
const SOURCE_FILES = Object.freeze([
  "src/product/source-grounded-binding-package-draft.js",
  "src/product/source-grounded-binding-draft-store.js",
  "src/experiments/das024-authoring/fixtures.js",
  "src/experiments/das024-authoring/preflight.js",
  "src/experiments/das024-authoring/qualification-harness.js",
  "src/experiments/das024-authoring/run.js",
]);

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function writePrivate(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }); }
function sourceManifest() { return Object.fromEntries(SOURCE_FILES.map((file) => [file, createHash("sha256").update(fs.readFileSync(path.resolve(file))).digest("hex")])); }
function counts(session) {
  return Object.fromEntries(["observed", "extracted", "inferred-proposal", "owner-confirmed", "engineer-confirmed", "independently-verified", "unknown"].map((status) => [status, session.facts.filter((fact) => fact.status === status).length]));
}

function qualificationWorld(fixture, packageIdentityHash) {
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

function qualificationHarness(fixture, packageIdentityHash) {
  return createCustomerLocalQualificationHarnessContract({
    harnessId: `${fixture.id}:das024-qualification-v1`,
    worldImplementationHash: digest({ implementation: "declarative-customer-local-qualification-world-v1", packageIdentityHash }),
    persistentStoreSchemaHash: digest({ schema: "declarative-qualification-store-v1", packageIdentityHash }),
    authenticationAuthorityHash: digest({ authority: "shared-synthetic-challenge-v1", packageIdentityHash }),
    observerEvidenceSchemaHash: digest({ evidence: "strict-observer-external-state-v1", packageIdentityHash }),
  });
}

function startSession(fixture) {
  return createSourceGroundedBindingDraftSession({
    sessionId: fixture.id,
    businessIntake: structuredClone(fixture.businessIntake),
    actionSource: structuredClone(fixture.actionSource),
    observerSource: structuredClone(fixture.observerSource),
    credentialAliases: structuredClone(fixture.credentialAliases),
  });
}

function applyExplicitAnswers(session, fixture) {
  return applySourceGroundedBindingDraftAnswers({
    session,
    expectedSessionHash: session.sessionHash,
    answers: structuredClone(fixture.answers),
    suppliedBy: { owner: fixture.answers.ownerReviewer, engineer: fixture.answers.engineerReviewer },
  });
}

async function runValidFixture(fixture) {
  const started = performance.now();
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), `das024-${fixture.sourceKind}-`));
  try {
    const storePath = path.join(stateRoot, "authoring-store.json");
    const store = new SourceGroundedBindingDraftStore({ filePath: storePath });
    const revisionZero = startSession(fixture);
    requireCondition(revisionZero.status === "draft-blocked-explicit-questions" && revisionZero.unresolvedQuestionIds.length === 43, `${fixture.id} revision zero did not expose all exact questions`);
    store.save(revisionZero);
    const answered = applyExplicitAnswers(revisionZero, fixture);
    requireCondition(answered.status === "complete-non-executable-package-input-draft" && answered.readiness.packageInputDraftComplete === true, `${fixture.id} did not complete the non-executable draft`);
    store.save(answered);
    const restoredStore = SourceGroundedBindingDraftStore.load(storePath);
    const restored = restoredStore.load(fixture.id);
    assertSourceGroundedBindingDraftSession(restored);
    requireCondition(restored.sessionHash === answered.sessionHash, `${fixture.id} changed across fresh store reload`);

    const prepared = prepareDAS024QualificationBinding({ fixture, stateDirectory: path.join(stateRoot, "qualification") });
    const packageInputs = materializeSourceGroundedBindingPackageInputs({ session: restored, structuralBinding: prepared.structuralBinding, workPlan: prepared.workPlan });
    requireCondition(Object.values(packageInputs.protectedGates).every((value) => value === false || value === 0), `${fixture.id} package input draft widened a protected gate`);
    const declarations = { sourceIdentity: packageInputs.sourceIdentity, actionRuntime: packageInputs.actionRuntime, writeSafety: packageInputs.writeSafety, observerProof: packageInputs.observerProof };
    const generated = createCustomerLocalBindingPackage({ structuralBinding: prepared.structuralBinding, workPlan: prepared.workPlan, ...declarations });
    assertCustomerLocalBindingPackage({ package: generated, structuralBinding: prepared.structuralBinding, workPlan: prepared.workPlan, ...declarations });
    const packageIdentityHash = digest({ fixtureId: fixture.id, authoringSessionHash: restored.sessionHash, structuralBindingHash: prepared.structuralBinding.artifactHash, generationReceiptHash: generated.receipt.receiptHash });
    const harnessContract = qualificationHarness(fixture, packageIdentityHash);
    const localWorld = qualificationWorld(fixture, packageIdentityHash);
    const result = await runCustomerLocalQualificationRuntimeBridge({
      candidate: generated.candidate,
      observerContract: generated.observerContract,
      harnessContract,
      packageIdentityHash,
      assignedWork: fixture.qualificationWorld.assignedWork,
      driverFactory: createDeclarativeQualificationDriverFactory({ contract: localWorld }),
      now: () => FIXED_NOW_MS,
    });
    requireCondition(result.qualificationReceipt.qualificationPassed === true && result.qualificationReceipt.controlsPassed === 10, `${fixture.id} failed unchanged ten-control qualification`);
    const acceptance = sealCustomerLocalAcceptanceOnly({ qualificationReceipt: result.qualificationReceipt, candidate: generated.candidate, observerContract: generated.observerContract, caseContract: result.caseContract, harnessContract });
    assertCustomerLocalAcceptanceOnly({ receipt: acceptance, qualificationReceipt: result.qualificationReceipt, candidate: generated.candidate, observerContract: generated.observerContract, caseContract: result.caseContract, harnessContract });
    const controls = result.qualificationReceipt.cases;
    return {
      fixtureId: fixture.id,
      sourceKind: fixture.sourceKind,
      authoring: {
        revisionZeroHash: revisionZero.sessionHash,
        completedSessionHash: restored.sessionHash,
        revision: restored.revision,
        questionCount: revisionZero.questionGraph.length,
        answeredQuestions: restored.answers.length,
        answerRevisions: 1,
        factsByStatus: counts(restored),
        operationsExtracted: restored.measurements.sourceOperationsExtracted,
        instructionWarnings: restored.measurements.sourceInstructionWarnings,
        blockers: restored.blockers,
        freshProcessReceiptEqual: true,
        packageDraftHash: packageInputs.draftHash,
        protectedGates: packageInputs.protectedGates,
        packageSpecificExecutableCode: 0,
        packageSpecificCallbacks: 0,
      },
      qualification: {
        separateHarnessInputs: true,
        structuralBindingHash: prepared.structuralBinding.artifactHash,
        controlsPassed: result.qualificationReceipt.controlsPassed,
        controlsRequired: result.qualificationReceipt.controlsRequired,
        businessWrites: controls.reduce((sum, control) => sum + control.businessWrites, 0),
        observerWrites: controls.reduce((sum, control) => sum + control.observerWrites, 0),
        lostResponseWrites: controls.find((control) => control.id === "lost-response")?.businessWrites,
        lostResponseReplays: 0,
        freshProcessRecovery: controls.find((control) => control.id === "lost-response")?.restartedAfterLostResponse === true,
        unsafeOrAmbiguousAccepted: controls.filter((control) => ["partial", "incorrect", "duplicate", "stale", "collateral", "unknown", "unavailable"].includes(control.id) && control.classification?.disposition === "accept").length,
        acceptanceStatus: acceptance.status,
        executableOperations: acceptance.executableOperations,
        runtimeAuthorityGranted: acceptance.runtimeAuthorityGranted,
        activationReady: acceptance.activationReady,
      },
      activeMachineTimeMs: Number((performance.now() - started).toFixed(3)),
      humanSetupTimeMeasured: false,
      modelCalls: 0,
      spendUsd: 0,
      evidenceBoundary: prepared.evidenceBoundary,
    };
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
}

function runMaliciousControl() {
  const session = startSession(DAS024_MALICIOUS_FIXTURE);
  assertSourceGroundedBindingDraftSession(session);
  requireCondition(session.status === "draft-blocked-explicit-questions" && session.blockers.length >= 3, "Malicious input did not remain blocked");
  requireCondition(session.warnings.length >= 1, "Malicious source instruction was not surfaced as inert text");
  requireCondition(session.readiness.packageInputDraftComplete === false && Object.values(session.authorizations).every((value) => value === false), "Malicious input widened readiness or authority");
  return {
    fixtureId: DAS024_MALICIOUS_FIXTURE.id,
    status: session.status,
    blockers: session.blockers,
    warnings: session.warnings,
    questionCount: session.questionGraph.length,
    operationsExtracted: session.measurements.sourceOperationsExtracted,
    packageGenerated: false,
    qualificationEntered: false,
    authorizations: session.authorizations,
    modelCalls: 0,
    spendUsd: 0,
  };
}

async function execute() {
  requireCondition(!fs.existsSync(OUTPUT_ROOT), `Refusing to overwrite preserved DAS-024 evidence: ${OUTPUT_ROOT}`);
  const campaignStarted = performance.now();
  const preflight = preflightDAS024Fixtures();
  const sourceManifestBefore = sourceManifest();
  const results = [];
  for (const fixture of DAS024_VALID_FIXTURES) results.push(await runValidFixture(fixture));
  const malicious = runMaliciousControl();
  const summary = {
    schemaVersion: "das.source-grounded-binding-authoring-campaign.v2",
    preregistration: "reports/0100-das024-package-draft-authoring-preregistration.md",
    fixtureFreeze: DAS024_FIXTURE_FREEZE,
    preflight,
    authoringFixtures: DAS024_AUTHORING_FIXTURES.map((fixture) => fixture.id),
    results,
    malicious,
    sourceIntegrity: {
      sourceManifest: sourceManifestBefore,
      sourceManifestHash: digest(sourceManifestBefore),
      unchangedDuringCampaign: true,
    },
    aggregate: {
      completedNonExecutableDrafts: results.length,
      blockedMaliciousInputs: malicious.packageGenerated === false ? 1 : 0,
      questionsGenerated: results.reduce((sum, result) => sum + result.authoring.questionCount, 0) + malicious.questionCount,
      explicitAnswers: results.reduce((sum, result) => sum + result.authoring.answeredQuestions, 0),
      sourceOperationsExtracted: results.reduce((sum, result) => sum + result.authoring.operationsExtracted, 0) + malicious.operationsExtracted,
      qualificationControlsPassed: results.reduce((sum, result) => sum + result.qualification.controlsPassed, 0),
      qualificationControlsRequired: 20,
      observerWrites: results.reduce((sum, result) => sum + result.qualification.observerWrites, 0),
      lostResponseReplays: 0,
      unsafeOrAmbiguousAccepted: results.reduce((sum, result) => sum + result.qualification.unsafeOrAmbiguousAccepted, 0),
      packageSpecificExecutableCode: 0,
      packageSpecificCallbacks: 0,
      executableOperations: 0,
      runtimeAuthorityGranted: false,
      comparisonReady: false,
      activationReady: false,
      activeMachineTimeMs: Number((performance.now() - campaignStarted).toFixed(3)),
      humanSetupTimeMeasured: false,
      modelCalls: 0,
      spendUsd: 0,
    },
    exactRemainingBlockers: [
      "real-customer-action-runtime-not-connected",
      "real-customer-independent-observer-not-connected",
      "credential-values-not-resolved",
      "write-safety-semantics-not-proved-in-customer-system",
      "observer-proof-semantics-not-proved-in-customer-system",
      "mandatory-customer-environment-acceptance-not-run",
      "comparison-execution-blocked",
      "controlled-activation-blocked",
      "fresh-user-human-setup-study-not-run",
    ],
    evidenceBoundary: "Private deterministic local authoring evidence over two fictional source families and one malicious control. The separate synthetic qualification wrapper is not authoring automation. This does not establish unassisted customer onboarding, human setup-time reduction, arbitrary source support, real credentials/transports, production reliability, comparison readiness or activation.",
  };
  const sourceManifestAfter = sourceManifest();
  requireCondition(digest(sourceManifestBefore) === digest(sourceManifestAfter), "DAS-024 source files changed during the sealed campaign");
  summary.resultHash = digest(summary);
  fs.mkdirSync(OUTPUT_ROOT, { recursive: false, mode: 0o700 });
  writePrivate(path.join(OUTPUT_ROOT, "summary.json"), summary);
  for (const result of results) writePrivate(path.join(OUTPUT_ROOT, `${result.fixtureId}.json`), result);
  writePrivate(path.join(OUTPUT_ROOT, `${malicious.fixtureId}.json`), malicious);
  process.stdout.write(`${JSON.stringify({ resultHash: summary.resultHash, aggregate: summary.aggregate, outputRoot: OUTPUT_ROOT }, null, 2)}\n`);
}

execute().catch((error) => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });
