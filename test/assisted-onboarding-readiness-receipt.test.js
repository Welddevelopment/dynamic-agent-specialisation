import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digest } from "../src/core/canonical.js";
import { assertAssistedOnboardingReadinessReceipt } from "../src/product/assisted-onboarding-readiness-receipt.js";
import { AssistedCommercialOnboardingJourney } from "../src/product/assisted-onboarding-journey.js";

function frontendInput() {
  return {
    sessionId: "receipt-frontend-v1",
    company: { name: "Example Design Co", industry: "Software", operatingContext: "Approved design tasks end at a reviewable draft pull request." },
    role: { templateId: "frontend-implementation", title: "Frontend implementation specialist", outcome: "Turn approved designs into responsive React source.", completionRule: "Complete only after independent repository checks pass and a draft pull request exists without merge or deployment.", escalationOwner: "Frontend lead" },
    systems: [
      { id: "design-source", name: "Approved Figma handoff", kind: "customer system", access: "none", adapterStatus: "verified", contextSources: ["approved design"], tools: [{ name: "read-approved-design", mode: "read" }] },
      { id: "repository", name: "React repository", kind: "customer system", access: "none", adapterStatus: "verified", contextSources: ["repository", "component library"], tools: [{ name: "read-repository", mode: "read" }, { name: "write-assigned-source", mode: "write" }, { name: "open-draft-pr", mode: "write" }] },
    ],
    knowledgeSources: [{ name: "Repository policy", kind: "policy", contentHash: digest("repository-policy"), current: true }],
    policies: [
      { rule: "Check approved design and assigned paths.", kind: "required-check", confirmed: true },
      { rule: "Missing components require review.", kind: "approval", confirmed: true },
      { rule: "Never merge, deploy or change protected files.", kind: "forbidden", confirmed: true },
    ],
    authority: { allowedActions: ["write-assigned-source", "open-draft-pr"], approvalActions: ["propose-component"], forbiddenActions: ["merge", "deploy", "write-protected-files"] },
    examples: Array.from({ length: 5 }, (_, index) => ({ situation: `Frontend case ${index + 1}`, expected: `Verified bounded result ${index + 1}`, source: "customer-authored", redacted: true })),
    success: { measures: ["approved source outcome", "only assigned files changed", "draft PR exists without merge or deploy"], verifierMode: "independent-external-state", verifierStatus: "verified", owner: "Customer test owner" },
    priorities: { quality: 1, cost: .25, speed: .2, maximumCostPerTaskUsd: .5, maximumLatencyMs: 300_000, goal: "Preserve verified quality first." },
    currentAgent: { mode: "none" },
    dataHandling: { localOnly: true, productionDataIncluded: false, redactionConfirmed: true },
  };
}

test("frontend readiness receipt separates declarations, proposals, engineering and independent proof", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "das-readiness-receipt-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const journey = new AssistedCommercialOnboardingJourney({ stateDirectory: root });
  const projection = journey.saveBusinessIntake(frontendInput());
  const record = journey.record("receipt-frontend-v1");
  const receipt = journey.readinessReceipt("receipt-frontend-v1");

  assert.equal(receipt.readiness.comparisonDesign.complete, true);
  assert.equal(receipt.readiness.execution.ready, false);
  assert.equal(receipt.readiness.activation.ready, false);
  assert.equal(receipt.readiness.activation.authorizationGranted, false);
  assert.equal(receipt.provenance.customerSuppliedFacts.find((item) => item.id === "systems").value.every((system) => system.declaredAdapterStatus === "verified"), true);
  assert.equal(receipt.provenance.engineerOwnedBindings.customerDeclarationsAreProof, false);
  assert.equal(receipt.provenance.engineerOwnedBindings.status, "engineering-required");
  assert.equal(receipt.provenance.independentProof.bindingAcceptance.status, "not-run");
  assert.equal(receipt.provenance.dasProposalsAndInferences.find((item) => item.id === "customer-binding-scaffold").status, "generated-non-executable");
  assert.deepEqual(receipt.exactBlockers, projection.roleAvailability.blockers);
  assert.equal(receipt.exactBlockers.length, 3);
  assert.equal(assertAssistedOnboardingReadinessReceipt({ receipt, record, projection }), true);
});

test("readiness receipt rejects tampering and another onboarding revision", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "das-readiness-receipt-integrity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const journey = new AssistedCommercialOnboardingJourney({ stateDirectory: root });
  const first = frontendInput();
  const projection = journey.saveBusinessIntake(first);
  const record = journey.record(first.sessionId);
  const receipt = journey.readinessReceipt(first.sessionId);
  const tampered = structuredClone(receipt);
  tampered.readiness.execution.ready = true;
  assert.throws(() => assertAssistedOnboardingReadinessReceipt({ receipt: tampered, record, projection }), /integrity mismatch/);

  const changed = frontendInput();
  changed.role.outcome = "Implement only one newly approved design task.";
  const secondProjection = journey.saveBusinessIntake(changed);
  const secondRecord = journey.record(changed.sessionId);
  assert.throws(() => assertAssistedOnboardingReadinessReceipt({ receipt, record: secondRecord, projection: secondProjection }), /no longer matches|another onboarding revision/);
});

test("readiness receipt does not relabel omitted template and safe defaults as customer supplied", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "das-readiness-provenance-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const journey = new AssistedCommercialOnboardingJourney({ stateDirectory: root });
  const input = frontendInput();
  delete input.role.title;
  delete input.role.outcome;
  delete input.role.completionRule;
  delete input.priorities;
  journey.saveBusinessIntake(input);
  const receipt = journey.readinessReceipt(input.sessionId);
  const role = receipt.provenance.customerSuppliedFacts.find((item) => item.id === "role");
  const priorities = receipt.provenance.customerSuppliedFacts.find((item) => item.id === "priorities");
  assert.equal(role.status, "mixed-customer-and-generated-defaults");
  assert.equal(priorities.status, "das-safe-default");
  assert.equal(receipt.provenance.intakeFieldProvenance.templateDefaultCount, 3);
  assert.ok(receipt.provenance.intakeFieldProvenance.dasSafeDefaultCount >= 6);
});
