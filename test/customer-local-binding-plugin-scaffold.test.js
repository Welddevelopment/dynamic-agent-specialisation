import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { digest } from "../src/core/canonical.js";
import { createCustomerLocalBindingPackage } from "../src/product/customer-local-binding-package-factory.js";
import {
  createCustomerLocalBindingPluginScaffoldPlan,
  inspectCustomerLocalBindingPluginScaffold,
  writeCustomerLocalBindingPluginScaffold,
} from "../src/product/customer-local-binding-plugin-scaffold.js";
import {
  applySourceGroundedBindingDraftAnswers,
  createSourceGroundedBindingDraftSession,
  materializeSourceGroundedBindingPackageInputs,
} from "../src/product/source-grounded-binding-package-draft.js";
import { DAS024_VALID_FIXTURES } from "../src/experiments/das024-authoring/fixtures.js";
import { prepareDAS024QualificationBinding } from "../src/experiments/das024-authoring/qualification-harness.js";

function completedDraft(fixture) {
  const initial = createSourceGroundedBindingDraftSession({
    sessionId: fixture.id,
    businessIntake: fixture.businessIntake,
    actionSource: fixture.actionSource,
    observerSource: fixture.observerSource,
    credentialAliases: fixture.credentialAliases,
  });
  const completed = applySourceGroundedBindingDraftAnswers({
    session: initial,
    expectedSessionHash: initial.sessionHash,
    answers: fixture.answers,
    suppliedBy: { owner: fixture.answers.ownerReviewer, engineer: fixture.answers.engineerReviewer },
  });
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "das025-binding-"));
  const prepared = prepareDAS024QualificationBinding({ fixture, stateDirectory });
  const packageInputDraft = materializeSourceGroundedBindingPackageInputs({ session: completed, structuralBinding: prepared.structuralBinding, workPlan: prepared.workPlan });
  const generatedPackage = createCustomerLocalBindingPackage({ structuralBinding: prepared.structuralBinding, workPlan: prepared.workPlan, sourceIdentity: packageInputDraft.sourceIdentity, actionRuntime: packageInputDraft.actionRuntime, writeSafety: packageInputDraft.writeSafety, observerProof: packageInputDraft.observerProof });
  return { packageInputDraft, generatedPackage, prepared };
}

test("DAS-024 package-input draft generates separate fail-closed action and observer projects", () => {
  const { packageInputDraft, generatedPackage } = completedDraft(DAS024_VALID_FIXTURES[0]);
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "das025-scaffold-parent-")), "plugins");
  const output = writeCustomerLocalBindingPluginScaffold({ directory: root, packageInputDraft, generatedPackage });
  assert.equal(output.receipt.status, "generated-non-executable-unqualified-unactivated");
  assert.equal(output.plan.gates.executable, false);
  assert.equal(output.plan.actionContract.sourceHash, packageInputDraft.sourceIdentity.sourceHash);
  assert.equal(output.plan.observerContract.sourceHash, packageInputDraft.observerProof.runtime.sourceHash);
  assert.notEqual(output.plan.actionContract.transportIdentityHash, output.plan.observerContract.transportIdentityHash);
  assert.equal(output.plan.measurements.generatedExecutableFunctions, 0);
  assert.equal(output.plan.measurements.remainingHandwrittenImplementationItems, 7);
  assert.equal(inspectCustomerLocalBindingPluginScaffold({ directory: root, expectedReceiptHash: output.receipt.receiptHash }).valid, true);

  for (const project of ["action-plugin", "observer-plugin"]) {
    const run = spawnSync(process.execPath, ["--test", "test"], { cwd: path.join(root, project), encoding: "utf8" });
    assert.equal(run.status, 0, `${project} generated tests failed:\n${run.stdout}\n${run.stderr}`);
  }
});

test("a DAS-023 generated package produces the same exact trust-plane scaffold identities", () => {
  const { packageInputDraft, generatedPackage } = completedDraft(DAS024_VALID_FIXTURES[1]);
  const packagePlan = createCustomerLocalBindingPluginScaffoldPlan({ packageInputDraft, generatedPackage }).plan;
  assert.equal(packagePlan.inputKind, "das024-to-das023-exact-chain");
  assert.equal(packagePlan.draftHash, packageInputDraft.draftHash);
  assert.equal(packagePlan.packageReceiptHash, generatedPackage.receipt.receiptHash);
  assert.equal(packagePlan.actionContract.executable, false);
  assert.equal(packagePlan.observerContract.readOnly, true);
  assert.equal(packagePlan.negativeConformancePlan.cases.length, 10);
  assert.equal(packagePlan.negativeConformancePlan.cases.every((entry) => entry.status === "declared-not-run"), true);
});

test("scaffold refuses overwrite and detects content or mode mutation", () => {
  const { packageInputDraft, generatedPackage } = completedDraft(DAS024_VALID_FIXTURES[0]);
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "das025-integrity-parent-")), "plugins");
  const output = writeCustomerLocalBindingPluginScaffold({ directory: root, packageInputDraft, generatedPackage });
  assert.throws(() => writeCustomerLocalBindingPluginScaffold({ directory: root, packageInputDraft, generatedPackage }), /refuses to overwrite/i);
  const actionFile = path.join(root, "action-plugin", "src", "index.js");
  fs.appendFileSync(actionFile, "// mutation\n");
  assert.throws(() => inspectCustomerLocalBindingPluginScaffold({ directory: root, expectedReceiptHash: output.receipt.receiptHash }), /content changed/i);
});

test("credential material, shared trust planes, protected-gate widening and package mutation fail closed", () => {
  const { packageInputDraft, generatedPackage } = completedDraft(DAS024_VALID_FIXTURES[0]);
  const secret = structuredClone(packageInputDraft);
  secret.observerProof.runtime.surfaceId = "token=plaintext-secret-value";
  delete secret.draftHash;
  secret.draftHash = digest(secret);
  assert.throws(() => createCustomerLocalBindingPluginScaffoldPlan({ packageInputDraft: secret, generatedPackage }), /credential material/i);

  const shared = structuredClone(packageInputDraft);
  shared.observerProof.runtime.credentialAliases = [...shared.actionRuntime.credentialAliases];
  delete shared.draftHash;
  shared.draftHash = digest(shared);
  assert.throws(() => createCustomerLocalBindingPluginScaffoldPlan({ packageInputDraft: shared, generatedPackage }), /different action\/observer chains|disjoint credential aliases/i);

  const widened = structuredClone(packageInputDraft);
  widened.protectedGates.executable = true;
  delete widened.draftHash;
  widened.draftHash = digest(widened);
  assert.throws(() => createCustomerLocalBindingPluginScaffoldPlan({ packageInputDraft: widened, generatedPackage }), /non-executable/i);
  const mutated = structuredClone(generatedPackage);
  mutated.actionRuntimeDeclaration.runtimeSchemaHash = "0".repeat(64);
  assert.throws(() => createCustomerLocalBindingPluginScaffoldPlan({ packageInputDraft, generatedPackage: mutated }), /action declaration integrity/i);

  const other = completedDraft(DAS024_VALID_FIXTURES[1]);
  assert.throws(() => createCustomerLocalBindingPluginScaffoldPlan({ packageInputDraft, generatedPackage: other.generatedPackage }), /different action\/observer chains/i);
  assert.throws(() => createCustomerLocalBindingPluginScaffoldPlan({ packageInputDraft }), /requires the exact completed/i);
});

test("generated artifacts are owner-only and contain aliases rather than credential values", () => {
  const { packageInputDraft, generatedPackage } = completedDraft(DAS024_VALID_FIXTURES[1]);
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "das025-private-parent-")), "plugins");
  const output = writeCustomerLocalBindingPluginScaffold({ directory: root, packageInputDraft, generatedPackage });
  const all = [root, ...output.receipt.directories.filter((item) => item.relative !== ".").map((item) => path.join(root, item.relative))];
  for (const directory of all) assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  for (const entry of output.receipt.files) {
    const file = path.join(root, entry.relative);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(file, "utf8").includes("plaintext-secret-value"), false);
  }
  assert.equal(output.receipt.files.some((entry) => entry.relative === "action-plugin/src/index.js"), true);
  assert.equal(output.receipt.files.some((entry) => entry.relative === "observer-plugin/src/index.js"), true);
});
