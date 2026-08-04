import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digest } from "../src/core/canonical.js";
import { assessCommercialBindingDescriptor, createCommercialBindingScaffold, sealCommercialBindingAcceptance, writeCommercialBindingScaffold } from "../src/product/commercial-binding-kit.js";
import { createCommercialSupportPack } from "../src/product/commercial-support-pack.js";

const pack = createCommercialSupportPack();

function completedDescriptor() {
  const descriptor = structuredClone(createCommercialBindingScaffold({ intake: pack.intake, roleDraft: pack.roleDraft }));
  delete descriptor.descriptorHash;
  for (const system of descriptor.systems) {
    system.adapterVersion = "1.0.0";
    system.status = "verified";
    system.credentialRefs = ["DAS_CUSTOMER_SUPPORT_TEST_TOKEN"];
    for (const operation of system.operations) {
      operation.status = "verified";
      operation.authorityAction = operation.mode === "write" ? pack.intake.authority.allowedActions[0] : "";
      operation.boundedInputSchemaHash = digest({ operation: operation.exposedName });
      if (operation.mode === "write") { operation.idempotency = "implemented"; operation.reconcileUnknown = "implemented"; }
    }
  }
  descriptor.verifier.status = "verified";
  descriptor.verifier.implementationHash = digest("independent-support-verifier");
  descriptor.verifier.readsExternalStateDirectly = true;
  descriptor.verifier.independentFromCandidate = true;
  descriptor.verifier.candidateCannotWriteVerifierInputs = true;
  descriptor.unknownOutcomeReconciler.status = "verified";
  descriptor.unknownOutcomeReconciler.implementationHash = digest("support-reconciler");
  descriptor.descriptorHash = digest(descriptor);
  return descriptor;
}

test("binding scaffold is private, non-executable and refuses overwrite", () => {
  const directory = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "das-binding-kit-")), "binding");
  const written = writeCommercialBindingScaffold({ directory, intake: pack.intake, roleDraft: pack.roleDraft });
  assert.equal(written.readyForAcceptance, false);
  assert.equal(written.descriptor.systems[0].status, "not-implemented");
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(directory, "binding.json")).mode & 0o777, 0o600);
  assert.throws(() => writeCommercialBindingScaffold({ directory, intake: pack.intake, roleDraft: pack.roleDraft }), /refuses to overwrite/);
});

test("binding assessment rejects generated declarations and accepts exact implemented coverage", () => {
  const scaffold = createCommercialBindingScaffold({ intake: pack.intake, roleDraft: pack.roleDraft });
  const incomplete = assessCommercialBindingDescriptor({ intake: pack.intake, roleDraft: pack.roleDraft, descriptor: scaffold });
  assert.equal(incomplete.readyForAcceptance, false);
  assert.equal(incomplete.gates.find((item) => item.id === "operation-coverage").passed, false);
  const descriptor = completedDescriptor();
  const complete = assessCommercialBindingDescriptor({ intake: pack.intake, roleDraft: pack.roleDraft, descriptor });
  assert.equal(complete.readyForAcceptance, true);
});

test("acceptance receipt requires ten exact independently verified safe artifacts", () => {
  const descriptor = completedDescriptor();
  const assessment = assessCommercialBindingDescriptor({ intake: pack.intake, roleDraft: pack.roleDraft, descriptor });
  const results = descriptor.acceptanceCases.map((item) => ({ id: item.id, passed: true, independentlyVerified: true, verifierId: descriptor.verifier.id, incorrectSideEffects: 0, unsafeAttempts: 0, artifactHash: digest({ case: item.id }) }));
  const receipt = sealCommercialBindingAcceptance({ descriptor, assessment, results });
  assert.equal(receipt.readyForControlledActivation, true);
  assert.equal(receipt.cases.length, 10);
  assert.throws(() => sealCommercialBindingAcceptance({ descriptor, assessment, results: results.map((item, index) => index === 0 ? { ...item, incorrectSideEffects: 1 } : item) }), /unsafe/);
});
