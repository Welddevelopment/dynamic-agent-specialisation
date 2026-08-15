import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applySourceGroundedBindingDraftAnswers,
  assertSourceGroundedBindingDraftSession,
  createSourceGroundedBindingDraftSession,
  materializeSourceGroundedBindingPackageInputs,
} from "../src/product/source-grounded-binding-package-draft.js";
import { SourceGroundedBindingDraftStore } from "../src/product/source-grounded-binding-draft-store.js";
import {
  DAS024_MALICIOUS_FIXTURE,
  DAS024_VALID_FIXTURES,
} from "../src/experiments/das024-authoring/fixtures.js";
import { preflightDAS024Fixtures } from "../src/experiments/das024-authoring/preflight.js";
import { prepareDAS024QualificationBinding } from "../src/experiments/das024-authoring/qualification-harness.js";

function start(fixture) {
  return createSourceGroundedBindingDraftSession({
    sessionId: fixture.id,
    businessIntake: fixture.businessIntake,
    actionSource: fixture.actionSource,
    observerSource: fixture.observerSource,
    credentialAliases: fixture.credentialAliases,
  });
}

test("DAS-024 frozen fixtures remain exact and bounded", () => {
  const result = preflightDAS024Fixtures();
  assert.equal(result.fixtureCount, 3);
  assert.equal(result.validFixtureCount, 2);
  assert.equal(result.maliciousControlCount, 1);
});

test("both fresh source families complete only after explicit owner and engineer answers", () => {
  for (const fixture of DAS024_VALID_FIXTURES) {
    const revisionZero = start(fixture);
    assert.equal(revisionZero.status, "draft-blocked-explicit-questions");
    assert.equal(revisionZero.unresolvedQuestionIds.length, 43);
    assert.equal(revisionZero.readiness.executable, false);
    const complete = applySourceGroundedBindingDraftAnswers({
      session: revisionZero,
      expectedSessionHash: revisionZero.sessionHash,
      expectedSessionHash: revisionZero.sessionHash,
      answers: fixture.answers,
      suppliedBy: { owner: fixture.answers.ownerReviewer, engineer: fixture.answers.engineerReviewer },
    });
    assert.equal(complete.status, "complete-non-executable-package-input-draft");
    assert.equal(complete.answers.length, 43);
    assert.equal(complete.readiness.packageInputDraftComplete, true);
    assert.equal(complete.readiness.executable, false);
    assert.ok(complete.answers.every((answer) => ["owner-confirmed", "engineer-confirmed"].includes(answer.status)));
  }
});

test("fresh-process store replay preserves the exact completed receipt", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "das024-store-test-"));
  try {
    const fixture = DAS024_VALID_FIXTURES[0];
    const storePath = path.join(root, "store.json");
    const store = new SourceGroundedBindingDraftStore({ filePath: storePath });
    const initial = start(fixture);
    store.save(initial);
    const completed = applySourceGroundedBindingDraftAnswers({ session: initial, expectedSessionHash: initial.sessionHash, answers: fixture.answers, suppliedBy: { owner: fixture.answers.ownerReviewer, engineer: fixture.answers.engineerReviewer } });
    store.save(completed);
    const restored = SourceGroundedBindingDraftStore.load(storePath).load(fixture.id);
    assertSourceGroundedBindingDraftSession(restored);
    assert.equal(restored.sessionHash, completed.sessionHash);
    assert.equal(fs.statSync(storePath).mode & 0o777, 0o600);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("malicious same-plane source stays blocked and instruction-like text grants nothing", () => {
  const session = start(DAS024_MALICIOUS_FIXTURE);
  assert.deepEqual(session.blockers.map((item) => item.id).sort(), [
    "action-observer-credential-alias-shared",
    "independent-observer-source-collapsed",
    "observer-source-not-read-only",
  ]);
  assert.ok(session.warnings.length >= 1);
  assert.equal(session.readiness.packageInputDraftComplete, false);
  assert.equal(session.authorizations.runtimeAuthorityGranted, false);
  assert.equal(session.authorizations.activation, false);
});

test("materialized inputs remain unproved and non-executable after structural-chain binding", () => {
  for (const fixture of DAS024_VALID_FIXTURES) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "das024-materialize-test-"));
    try {
      const initial = start(fixture);
      const completed = applySourceGroundedBindingDraftAnswers({ session: initial, expectedSessionHash: initial.sessionHash, answers: fixture.answers, suppliedBy: { owner: fixture.answers.ownerReviewer, engineer: fixture.answers.engineerReviewer } });
      const prepared = prepareDAS024QualificationBinding({ fixture, stateDirectory: root });
      const output = materializeSourceGroundedBindingPackageInputs({ session: completed, structuralBinding: prepared.structuralBinding, workPlan: prepared.workPlan });
      assert.deepEqual(output.protectedGates, {
        credentialValues: 0,
        runtimeAuthorityGranted: false,
        independentlyVerified: false,
        executable: false,
        comparisonReady: false,
        activationReady: false,
      });
      assert.notEqual(output.actionRuntime.authenticationIdentityHash, output.observerProof.runtime.authenticationIdentityHash);
      assert.notEqual(output.sourceIdentity.sourceHash, output.observerProof.runtime.sourceHash);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test("stale, conflicting and cross-source answer/session attacks fail closed", () => {
  const [left, right] = DAS024_VALID_FIXTURES;
  const initial = start(left);
  const first = applySourceGroundedBindingDraftAnswers({ session: initial, expectedSessionHash: initial.sessionHash, answers: { actionOperation: left.answers.actionOperation }, suppliedBy: { owner: left.answers.ownerReviewer } });
  assert.throws(() => applySourceGroundedBindingDraftAnswers({ session: first, expectedSessionHash: first.sessionHash, answers: { actionOperation: left.answers.rejectedOperations[0] }, suppliedBy: { owner: left.answers.ownerReviewer } }), /Conflicting replay|not one exact source-grounded write/);

  const complete = applySourceGroundedBindingDraftAnswers({ session: initial, expectedSessionHash: initial.sessionHash, answers: left.answers, suppliedBy: { owner: left.answers.ownerReviewer, engineer: left.answers.engineerReviewer } });
  const rightRoot = fs.mkdtempSync(path.join(os.tmpdir(), "das024-cross-source-"));
  try {
    const prepared = prepareDAS024QualificationBinding({ fixture: right, stateDirectory: rightRoot });
    assert.throws(() => materializeSourceGroundedBindingPackageInputs({ session: complete, structuralBinding: prepared.structuralBinding, workPlan: prepared.workPlan }), /action source differs/);
  } finally { fs.rmSync(rightRoot, { recursive: true, force: true }); }
});
