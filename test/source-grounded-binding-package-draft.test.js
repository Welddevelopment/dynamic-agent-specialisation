import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCustomerLocalBindingPackage } from "../src/product/customer-local-binding-package-factory.js";
import {
  applySourceGroundedBindingDraftAnswers,
  assertSourceGroundedBindingDraftSession,
  createSourceGroundedBindingDraftSession,
  materializeSourceGroundedBindingPackageInputs,
} from "../src/product/source-grounded-binding-package-draft.js";
import { SourceGroundedBindingDraftStore } from "../src/product/source-grounded-binding-draft-store.js";
import { DAS024_MALICIOUS_FIXTURE, DAS024_VALID_FIXTURES } from "../src/experiments/das024-authoring/fixtures.js";
import { prepareDAS024QualificationBinding } from "../src/experiments/das024-authoring/qualification-harness.js";

function create(fixture) {
  return createSourceGroundedBindingDraftSession({ sessionId: fixture.id, businessIntake: fixture.businessIntake, actionSource: fixture.actionSource, observerSource: fixture.observerSource, credentialAliases: fixture.credentialAliases });
}

function answer(session, fixture, answers = fixture.answers) {
  return applySourceGroundedBindingDraftAnswers({ session, expectedSessionHash: session.sessionHash, answers, suppliedBy: { owner: fixture.answers.ownerReviewer, engineer: fixture.answers.engineerReviewer } });
}

test("fresh OpenAPI and MCP inputs produce source-grounded question graphs and explicit complete non-executable drafts", () => {
  for (const fixture of DAS024_VALID_FIXTURES) {
    const initial = create(fixture);
    assert.equal(initial.revision, 0);
    assert.equal(initial.readiness.packageInputDraftComplete, false);
    assert.equal(initial.unresolvedQuestionIds.length, 43);
    assert.equal(initial.facts.filter((item) => item.status === "extracted").length, 4);
    assert.equal(initial.facts.filter((item) => item.status === "unknown").length, 43);
    assert.equal(initial.authorizations.runtimeAuthorityGranted, false);
    const completed = answer(initial, fixture);
    assertSourceGroundedBindingDraftSession(completed);
    assert.equal(completed.status, "complete-non-executable-package-input-draft");
    assert.equal(completed.readiness.packageInputDraftComplete, true);
    assert.equal(completed.readiness.executable, false);
    assert.equal(completed.facts.some((item) => item.status === "independently-verified"), false);
    assert.equal(completed.measurements.modelCalls, 0);
  }
});

test("answers remain integrity-bound across revisions, exact replay and fresh-process restart", () => {
  const fixture = DAS024_VALID_FIXTURES[0];
  const initial = create(fixture);
  const first = answer(initial, fixture, { actionOperation: fixture.answers.actionOperation, ownerReviewer: fixture.answers.ownerReviewer });
  assert.throws(() => applySourceGroundedBindingDraftAnswers({ session: first, expectedSessionHash: initial.sessionHash, answers: { actionReadOperations: fixture.answers.actionReadOperations }, suppliedBy: { owner: fixture.answers.ownerReviewer, engineer: fixture.answers.engineerReviewer } }), /stale or belongs/);
  const replay = answer(first, fixture, { actionOperation: fixture.answers.actionOperation });
  assert.equal(replay.sessionHash, first.sessionHash);
  assert.throws(() => answer(first, fixture, { actionOperation: "releaseVendorPayment" }), /Conflicting replay/);
  const rest = Object.fromEntries(Object.entries(fixture.answers).filter(([key]) => !["actionOperation", "ownerReviewer"].includes(key)));
  const complete = answer(first, fixture, rest);
  assert.equal(complete.previousRevisionHash, first.sessionHash);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "das024-draft-"));
  const file = path.join(root, "draft-store.json");
  const store = new SourceGroundedBindingDraftStore({ filePath: file });
  store.save(initial); store.save(first); store.save(complete);
  const restored = SourceGroundedBindingDraftStore.load(file).load(fixture.id);
  assert.deepEqual(restored, complete);
  assertSourceGroundedBindingDraftSession(restored);
});

test("malicious source text is inert and shared observer trust planes remain hard blockers", () => {
  const session = create(DAS024_MALICIOUS_FIXTURE);
  assert.equal(session.warnings.length >= 2, true);
  assert.deepEqual(session.blockers.map((item) => item.id).sort(), ["action-observer-credential-alias-shared", "independent-observer-source-collapsed", "observer-source-not-read-only"]);
  assert.equal(session.authorizations.runtimeAuthorityGranted, false);
  assert.equal(session.readiness.packageInputDraftComplete, false);
  assert.throws(() => materializeSourceGroundedBindingPackageInputs({ session, structuralBinding: {}, workPlan: {} }), /questions or source-boundary blockers/);
});

test("authority, retry, identity and source-grounding attacks fail before a complete draft", () => {
  const fixture = DAS024_VALID_FIXTURES[1];
  const initial = create(fixture);
  assert.throws(() => answer(initial, fixture, { ...fixture.answers, actionOperation: "issueRepairWorkOrder" }), /explicitly rejected/);
  assert.throws(() => answer(initial, fixture, { actionOperation: fixture.answers.actionOperation, stableIdentityFields: ["mutableDisplayName"] }), /not grounded/);
  assert.throws(() => answer(initial, fixture, { ...fixture.answers, automaticRetries: 1 }), /Automatic retries/);
  assert.throws(() => answer(initial, fixture, { ...fixture.answers, maximumWritesPerAssignedItem: 2 }), /at most one write/);
  assert.throws(() => createSourceGroundedBindingDraftSession({ sessionId: "secret", businessIntake: fixture.businessIntake, actionSource: { ...structuredClone(fixture.actionSource), apiKey: "literal-secret-value" }, observerSource: fixture.observerSource, credentialAliases: fixture.credentialAliases }), /credential/);
  const changed = structuredClone(initial); changed.sources.action.sourceHash = "0".repeat(64);
  assert.throws(() => assertSourceGroundedBindingDraftSession(changed), /integrity|source identity/);
});

test("a complete authoring receipt materializes the exact non-executable inputs accepted by unchanged DAS-023", () => {
  for (const fixture of DAS024_VALID_FIXTURES) {
    const complete = answer(create(fixture), fixture);
    const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `das024-qualification-${fixture.sourceKind}-`));
    const prepared = prepareDAS024QualificationBinding({ fixture, stateDirectory });
    const draft = materializeSourceGroundedBindingPackageInputs({ session: complete, structuralBinding: prepared.structuralBinding, workPlan: prepared.workPlan });
    assert.equal(draft.protectedGates.executable, false);
    assert.equal(draft.protectedGates.independentlyVerified, false);
    const generated = createCustomerLocalBindingPackage({ structuralBinding: prepared.structuralBinding, workPlan: prepared.workPlan, sourceIdentity: draft.sourceIdentity, actionRuntime: draft.actionRuntime, writeSafety: draft.writeSafety, observerProof: draft.observerProof });
    assert.equal(generated.candidate.executable, false);
    assert.equal(generated.receipt.activated, false);
  }
});
