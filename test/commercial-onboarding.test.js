import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assessCommercialReadiness, buildCommercialJobDraft, normalizeCommercialIntake } from "../src/product/commercial-intake.js";
import { listCommercialRoleTemplates } from "../src/product/commercial-role-templates.js";
import { CommercialOnboardingStore } from "../src/product/onboarding-store.js";

function completeInput(templateId = "support-operations") {
  return {
    sessionId: `acme-${templateId}`,
    company: { name: "Acme", industry: "B2B software", operatingContext: "Acme supports business customers through a bounded assigned queue." },
    role: { templateId, outcome: "Resolve every assigned in-scope item correctly.", completionRule: "Complete only when external state confirms every assigned item is handled.", escalationOwner: "Operations lead" },
    systems: [{ name: "Operations system", kind: "customer-local test fixture", access: "customer-local-test", adapterStatus: "verified", contextSources: ["assigned queue", "policy"], tools: [{ name: "read-item", mode: "read" }, { name: "write-resolution", mode: "write" }] }],
    knowledgeSources: [{ name: "Current operating policy", kind: "policy", contentHash: "abc123", current: true }],
    policies: [{ rule: "Check the assigned scope", kind: "required-check", confirmed: true }, { rule: "Require approval above the delegated limit", kind: "approval", confirmed: true }, { rule: "Never change unrelated records", kind: "forbidden", confirmed: true }],
    authority: { allowedActions: ["write-resolution"], approvalActions: ["high-value-resolution"], forbiddenActions: ["change-unrelated-record"] },
    examples: Array.from({ length: 5 }, (_, index) => ({ situation: `Representative case ${index + 1}`, expected: `Verified outcome ${index + 1}`, source: "historical-redacted", redacted: true })),
    success: { measures: ["all assigned items handled", "no unrelated writes", "no denied attempts"], verifierMode: "independent-external-state", verifierStatus: "verified", owner: "Independent test adapter" },
    priorities: { quality: 1, cost: .25, speed: .2, maximumCostPerTaskUsd: .5, maximumLatencyMs: 300000, goal: "Preserve perfect quality while reducing cost." },
    currentAgent: { mode: "none" },
    dataHandling: { localOnly: true, productionDataIncluded: false, redactionConfirmed: true },
  };
}

test("an ordinary incomplete description becomes questions rather than false readiness", () => {
  const intake = normalizeCommercialIntake({ company: { name: "Acme" }, role: { templateId: "support-operations", outcome: "Handle support" } });
  const readiness = assessCommercialReadiness(intake);
  assert.equal(readiness.highestReadyStage, "not-ready");
  assert.ok(readiness.questions.some((item) => item.id === "escalation-owner"));
  assert.ok(readiness.questions.some((item) => item.id === "representative-cases"));
});

test("a complete supported intake produces a compiler-ready draft without claiming evidence", () => {
  const intake = normalizeCommercialIntake(completeInput());
  const draft = buildCommercialJobDraft(intake);
  assert.equal(draft.readiness.highestReadyStage, "controlled-activation");
  assert.equal(draft.compiled.readiness, "ready");
  assert.equal(draft.generatedEvidenceClaim, false);
  assert.equal(draft.comparisonDesignComplete, true);
  assert.equal(draft.executableComparisonAuthorized, false);
  assert.equal(draft.compiled.brief.examples.length, 5);
  assert.equal(draft.compiled.brief.successCriteria.independent, true);
});

test("declared systems and verifier do not masquerade as executable activation", () => {
  const input = completeInput();
  input.systems[0].adapterStatus = "declared";
  input.success.verifierStatus = "declared";
  const readiness = assessCommercialReadiness(normalizeCommercialIntake(input));
  assert.equal(readiness.stages.comparison.ready, true);
  assert.equal(readiness.stages.activation.ready, false);
  assert.equal(readiness.highestReadyStage, "comparison-ready");
});

test("onboarding records reject credentials at any nesting depth", () => {
  const input = completeInput();
  input.systems[0].credentials = { apiKey: "must-not-be-here" };
  assert.throws(() => normalizeCommercialIntake(input), /Credentials must not be stored/);
});

test("the same commercial engine drafts every supported role family", () => {
  const templateIds = listCommercialRoleTemplates().map((item) => item.id);
  assert.deepEqual(templateIds, ["support-operations", "procurement-coverage", "revenue-operations", "frontend-implementation"]);
  for (const templateId of templateIds) assert.equal(buildCommercialJobDraft(normalizeCommercialIntake(completeInput(templateId))).compiled.readiness, "ready");
});

test("frontend reference evidence does not imply customer binding or executable lifecycle support", () => {
  const frontend = listCommercialRoleTemplates().find((item) => item.id === "frontend-implementation");
  assert.equal(frontend.referenceEvidence.scope, "local-fictional-role-pack");
  assert.equal(frontend.referenceEvidence.customerBindingEvidence, false);
  assert.equal(frontend.lifecycle.discovery, true);
  assert.equal(frontend.lifecycle.businessIntake, true);
  assert.equal(frontend.lifecycle.bindingScaffold, true);
  assert.equal(frontend.lifecycle.bindingDescriptorReview, false);
  assert.equal(frontend.lifecycle.bindingAcceptance, false);
  assert.equal(frontend.lifecycle.comparisonPlanning, false);
  assert.equal(frontend.lifecycle.controlledActivation, false);
});

test("versioned onboarding state survives restart and rejects mutation", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "das-onboarding-"));
  const file = path.join(directory, "state.json");
  const store = new CommercialOnboardingStore({ filePath: file, now: () => "2026-08-04T00:00:00.000Z" });
  store.saveIntake(completeInput());
  const changed = completeInput();
  changed.role.outcome = "Resolve assigned support and preserve exact evidence.";
  store.saveIntake(changed);
  const restored = CommercialOnboardingStore.load(file);
  assert.equal(restored.latest(changed.sessionId).revision, 2);
  const tampered = JSON.parse(fs.readFileSync(file, "utf8"));
  tampered.sessions[0].intake.company.name = "Altered";
  fs.writeFileSync(file, JSON.stringify(tampered));
  assert.throws(() => CommercialOnboardingStore.load(file), /integrity mismatch/);
});
