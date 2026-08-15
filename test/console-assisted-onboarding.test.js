import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildAssistedOnboardingProjection } from "../src/console/assisted-onboarding-projection.js";

function savedIntake({ templateId = "support-operations", oldActivationReady = false } = {}) {
  return {
    sessionId: "session-1",
    revision: 3,
    recordHash: "saved-record-3",
    intake: {
      sessionId: "session-1",
      company: { name: "Example Co" },
      role: { templateId, title: "Support operations specialist" },
      systems: [
        { name: "Ticket system", access: oldActivationReady ? "customer-local-test" : "none", adapterStatus: oldActivationReady ? "verified" : "missing" },
      ],
    },
    readiness: {
      stages: {
        draft: { ready: true },
        comparison: { ready: true },
        activation: { ready: oldActivationReady },
      },
    },
  };
}

function readySetup(overrides = {}) {
  return {
    sessionId: "session-1",
    sessionRevision: 3,
    savedRecordHash: "saved-record-3",
    mutationDetected: false,
    imports: { status: "reviewed" },
    binding: {
      scaffoldStatus: "generated",
      structuralReadiness: "passed",
      proposedOperations: [{ id: "read-ticket" }, { id: "reply-ticket" }],
    },
    environment: {
      verifierStatus: "executable-verified",
      mandatoryAcceptance: {
        status: "passed",
        passed: 10,
        required: 10,
        unsafeAttempts: 0,
        incorrectSideEffects: 0,
      },
    },
    comparisonPlan: {
      status: "frozen",
      zeroCostDryRunStatus: "passed",
      projectedMaximumSpendUsd: 4.25,
    },
    spendApproval: { status: "awaiting-explicit-approval" },
    comparison: { status: "not-run", recommendationStatus: "not-ready" },
    package: { status: "not-ready" },
    activation: { status: "blocked", authorized: false },
    ...overrides,
  };
}

function authoritativeSetup({
  business = true,
  design = true,
  scaffold = true,
  structural = false,
  acceptance = false,
  environment = false,
  awaitingApproval = false,
  comparison = false,
  activation = false,
} = {}) {
  return {
    schemaVersion: "das.assisted-onboarding-projection.v1",
    sessionId: "session-1",
    revision: 3,
    supportedRole: true,
    previewOnly: false,
    status: awaitingApproval ? "awaiting-explicit-model-spend-approval" : "comparison-design-complete-binding-required",
    stages: {
      businessRoleDraftComplete: business,
      comparisonDesignContractComplete: design,
      customerBindingScaffoldGenerated: scaffold,
      structuralBindingReady: structural,
      mandatoryAcceptanceComplete: acceptance,
      executableComparisonEnvironmentReady: environment,
      awaitingExplicitModelSpendApproval: awaitingApproval,
      comparisonCompleteRecommendationReady: comparison,
      controlledActivationReady: activation,
    },
    checklist: [
      { id: "customer:review", owner: "customer", status: design ? "completed" : "required", detail: "Review consequential assumptions." },
      { id: "das:role-draft", owner: "das", status: business ? "generated" : "waiting", detail: "Normalized role contract generated from the exact saved intake." },
      { id: "das:binding-scaffold", owner: "das", status: scaffold ? "generated" : "waiting", detail: "Private fail-closed customer-binding scaffold." },
      { id: "engineer:binding", owner: "engineer", status: structural ? "completed" : "required", detail: "Implement the bounded customer-local adapters." },
      { id: "verifier:acceptance", owner: "independent-verifier", status: acceptance ? "verified" : "blocked", detail: "Pass every mandatory binding acceptance case." },
      { id: "customer:model-spend", owner: "customer", status: awaitingApproval ? "approval-required" : comparison ? "completed" : "blocked", detail: "Approve the exact plan and spend ceiling separately." },
      { id: "verifier:comparison", owner: "independent-verifier", status: comparison ? "verified" : "not-run", detail: "Verify the frozen comparison result." },
      { id: "engineer:activation", owner: "engineer", status: activation ? "verified" : "blocked", detail: "Package the proved bundle for controlled activation." },
    ],
    questions: [],
    generated: {
      roleDraft: business,
      setupPlan: business,
      bindingScaffold: scaffold,
      comparisonContract: environment,
      zeroCostModelPlan: awaitingApproval || comparison,
      systemImportProposals: 1,
    },
    spend: awaitingApproval || comparison ? { modelCallsMade: 0, spendAuthorized: false, projectedMaximumUsd: 3.75 } : { modelCallsMade: 0, spendAuthorized: false, projectedMaximumUsd: null },
    evidenceBoundary: "Assisted customer-local onboarding state. Setup readiness is not a customer result.",
  };
}

test("form-complete named systems never appear executable without joined binding evidence", () => {
  const projection = buildAssistedOnboardingProjection({ selected: savedIntake({ oldActivationReady: true }), supportedRoleTemplateIds: ["support-operations"] });
  assert.equal(projection.stages[0].status, "complete");
  assert.equal(projection.stages[1].status, "complete");
  assert.equal(projection.stages[2].status, "current");
  assert.equal(projection.stages[2].label, "Executable comparison environment ready");
  assert.ok(projection.stages[2].blockers.includes("Binding scaffold has not been generated"));
  assert.ok(projection.stages[2].blockers.includes("Independent verifier is declared but not executable and verified"));
  assert.equal(projection.summary.currentStageId, "executable-environment");
  assert.equal(projection.summary.completeStages, 2);
  assert.equal(projection.spend.status, "not-ready");
});

test("a joined zero-cost assisted setup stops at explicit model-spend approval", () => {
  const projection = buildAssistedOnboardingProjection({ selected: savedIntake(), setup: readySetup(), supportedRoleTemplateIds: ["support-operations"] });
  assert.deepEqual(projection.stages.map((item) => item.status), ["complete", "complete", "complete", "current", "blocked", "blocked"]);
  assert.equal(projection.summary.currentStageId, "spend-approval");
  assert.equal(projection.spend.status, "awaiting-explicit-approval");
  assert.equal(projection.spend.projectedMaximumUsd, 4.25);
  assert.equal(projection.spend.approved, false);
  assert.match(projection.boundary, /not claim self-serve activation/i);
});

test("a changed saved intake invalidates generated setup rather than preserving readiness", () => {
  const setup = readySetup({ sessionRevision: 2, savedRecordHash: "saved-record-2" });
  const projection = buildAssistedOnboardingProjection({ selected: savedIntake(), setup, supportedRoleTemplateIds: ["support-operations"] });
  assert.equal(projection.session.current, false);
  assert.equal(projection.stages[2].status, "current");
  assert.ok(projection.blockers.some((item) => /changed after setup artifacts/i.test(item.text)));
  assert.equal(projection.spend.status, "not-ready");
});

test("unsupported roles are explicitly preview-only and cannot advance", () => {
  const projection = buildAssistedOnboardingProjection({ selected: savedIntake({ templateId: "finance-close" }), setup: readySetup(), supportedRoleTemplateIds: ["support-operations", "frontend-implementation"] });
  assert.equal(projection.session.roleMode, "unsupported-preview");
  assert.equal(projection.stages[0].status, "current");
  assert.match(projection.stages[0].blockers[0], /outside the supported families/i);
  assert.equal(projection.summary.completeStages, 0);
});

test("comparison and activation require distinct later receipts", () => {
  const setup = readySetup({
    spendApproval: { status: "approved" },
    comparison: { status: "complete", recommendationStatus: "ready" },
    package: { status: "ready" },
    activation: { status: "ready-for-controlled-activation", authorized: false },
  });
  const projection = buildAssistedOnboardingProjection({ selected: savedIntake(), setup, supportedRoleTemplateIds: ["support-operations"] });
  assert.deepEqual(projection.stages.map((item) => item.status), ["complete", "complete", "complete", "complete", "complete", "complete"]);
  assert.equal(projection.spend.approved, true);
  assert.match(projection.stages[5].summary, /not active yet/i);
  assert.match(projection.spend.boundary, /cannot authorize or start paid execution/i);
});

test("the browser projection stays sanitized", () => {
  const selected = savedIntake();
  selected.intake.systems[0].name = "Secret Internal Support System";
  const projection = buildAssistedOnboardingProjection({ selected, setup: readySetup(), supportedRoleTemplateIds: ["support-operations"] });
  const serialized = JSON.stringify(projection);
  assert.doesNotMatch(serialized, /Secret Internal Support System/);
  assert.doesNotMatch(serialized, /saved-record-3/);
  assert.doesNotMatch(serialized, /read-ticket|reply-ticket/);
});

test("the console treats the backend journey projection as authoritative", () => {
  const selected = savedIntake({ oldActivationReady: true });
  const projection = buildAssistedOnboardingProjection({ selected, setup: authoritativeSetup(), supportedRoleTemplateIds: ["support-operations"] });
  assert.deepEqual(projection.stages.map((item) => item.status), ["complete", "complete", "current", "blocked", "blocked", "blocked"]);
  assert.equal(projection.summary.currentStageId, "executable-environment");
  assert.equal(projection.spend.status, "not-ready");
  assert.ok(projection.blockers.some((item) => /bounded customer-local adapters/i.test(item.text)));
});

test("authoritative zero-cost plan renders only the explicit approval gate", () => {
  const setup = authoritativeSetup({ structural: true, acceptance: true, environment: true, awaitingApproval: true });
  const projection = buildAssistedOnboardingProjection({ selected: savedIntake(), setup, supportedRoleTemplateIds: ["support-operations"] });
  assert.deepEqual(projection.stages.map((item) => item.status), ["complete", "complete", "complete", "current", "blocked", "blocked"]);
  assert.equal(projection.summary.currentStageId, "spend-approval");
  assert.equal(projection.spend.status, "awaiting-explicit-approval");
  assert.equal(projection.spend.projectedMaximumUsd, 3.75);
  assert.equal(projection.spend.approved, false);
});

test("the console exposes a local review-only OpenAPI and MCP import surface", () => {
  const source = fs.readFileSync(new URL("../src/console/app.js", import.meta.url), "utf8");
  assert.match(source, /OpenAPI 3\.x JSON/);
  assert.match(source, /Pinned MCP tools\/list JSON/);
  assert.match(source, /0<\/strong><span>authority granted/);
  assert.match(source, /Credential material and external schema references fail closed/);
  assert.match(source, /Generate review proposal/);
  assert.match(source, /operations\.map/);
  assert.match(source, /operation\.executable \? "yes" : "no"/);
  assert.doesNotMatch(source, /sourceHash|proposalHash|intakeHash/);
});

test("plain-English discovery remains a zero-cost preview beside the intact structured route", () => {
  const source = fs.readFileSync(new URL("../src/console/app.js", import.meta.url), "utf8");
  assert.match(source, /Local role discovery preview/);
  assert.match(source, /Use the structured 8-step setup/);
  assert.match(source, /Generate zero-cost preview/);
  assert.match(source, /Deterministic preview/);
  assert.match(source, /Safely proposable/);
  assert.match(source, /Needs your confirmation/);
  assert.match(source, /Needs executable evidence/);
  assert.match(source, /Prioritized clarification queue/);
  assert.match(source, /Engineering blockers/);
  assert.match(source, /Zero authority · non-executable/);
  assert.match(source, /Editable preview draft/);
  assert.match(source, /Continuing does not confirm the proposal, grant authority, save a role, or make any system executable/);
  assert.match(source, /\/api\/commercial\/discover-role/);
  const handoffStart = source.indexOf('document.querySelector("#continue-discovery")');
  const handoffEnd = source.indexOf("function bindCommercial", handoffStart);
  const handoff = source.slice(handoffStart, handoffEnd);
  assert.ok(handoffStart > 0 && handoffEnd > handoffStart);
  assert.match(handoff, /commercialDraft\.company\.name/);
  assert.match(handoff, /commercialDraft\.role\.templateId/);
  assert.match(handoff, /access: "none"/);
  assert.match(handoff, /adapterStatus: "missing"/);
  assert.doesNotMatch(handoff, /commercialDraft\.(?:authority|policies|success|priorities|currentAgent|dataHandling)/);
  assert.doesNotMatch(handoff, /\/api\/commercial\/intake|save-commercial|comparison\/start|improvement\/start/);
});
