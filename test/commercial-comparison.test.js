import test from "node:test";
import assert from "node:assert/strict";
import { assertCommercialComparisonFreeze, createCommercialComparisonFreeze, releaseCommercialUnseen } from "../src/product/commercial-comparison.js";

function intake() {
  return {
    sessionId: "acme-support",
    company: { name: "Acme", industry: "B2B software", operatingContext: "A bounded assigned support queue." },
    role: { templateId: "support-operations", outcome: "Resolve every assigned request correctly.", completionRule: "Complete only when external state confirms every assigned item.", escalationOwner: "Head of Support" },
    systems: [{ id: "tickets", name: "Ticket sandbox", kind: "support", access: "disposable-sandbox", adapterStatus: "verified", contextSources: ["assigned queue"], tools: [{ name: "read-ticket", mode: "read" }, { name: "write-resolution", mode: "write" }] }],
    knowledgeSources: [{ name: "Support policy", kind: "policy", contentHash: "abc", current: true }],
    policies: [{ rule: "Check assignment", kind: "required-check", confirmed: true }, { rule: "Approval above limit", kind: "approval", confirmed: true }, { rule: "Never change unrelated records", kind: "forbidden", confirmed: true }],
    authority: { allowedActions: ["write-resolution"], approvalActions: ["large-credit"], forbiddenActions: ["change-unrelated-record"] },
    examples: Array.from({ length: 5 }, (_, index) => ({ situation: `case ${index}`, expected: `outcome ${index}`, source: "synthetic", redacted: true })),
    success: { measures: ["correct state", "no unrelated write", "no denied action"], verifierMode: "independent-external-state", verifierStatus: "verified", owner: "Support verifier" },
    priorities: { quality: 1, cost: .25, speed: .2, maximumCostPerTaskUsd: .5, maximumLatencyMs: 300000 },
    currentAgent: { mode: "provided", configurationHash: "current-hash" },
    dataHandling: { localOnly: true, productionDataIncluded: false, redactionConfirmed: true },
  };
}

function driver() { return { id: "support-driver", version: "1", templateId: "support-operations", environment: "disposable-sandbox", status: "verified", operationNames: ["read-ticket", "write-resolution"], verifier: { id: "support-verifier", status: "verified", independent: true }, systemBindings: [{ systemId: "tickets", adapterId: "ticket-adapter", adapterVersion: "1", status: "verified" }] }; }
function cases() { return [
  ...Array.from({ length: 5 }, (_, index) => ({ id: `dev-${index}`, stage: "development", payload: { index, kind: "development" } })),
  ...Array.from({ length: 2 }, (_, index) => ({ id: `val-${index}`, stage: "validation", payload: { index, kind: "validation" } })),
  ...Array.from({ length: 3 }, (_, index) => ({ id: `adv-${index}`, stage: "adversarial", payload: { index, kind: "adversarial" } })),
  ...Array.from({ length: 2 }, (_, index) => ({ id: `unseen-${index}`, stage: "unseen", payload: { index, kind: "unseen", secret: `held-${index}` } })),
]; }
function participants() { return [
  { id: "current", type: "current-agent", label: "Current agent", configurationHash: "a", runnerId: "runner-current" },
  { id: "general", type: "strong-general", label: "Strong general agent", configurationHash: "b", runnerId: "runner-general" },
  { id: "ordinary", type: "ordinary-manual", label: "Ordinary manual agent", configurationHash: "c", runnerId: "runner-ordinary" },
  { id: "expert", type: "expert-manual", label: "Expert configured agent", configurationHash: "d", runnerId: "runner-expert" },
  { id: "candidate", type: "compiler-candidate", label: "Compiler candidate", configurationHash: "e", runnerId: "runner-candidate" },
]; }
function create() { return createCommercialComparisonFreeze({ intake: intake(), driver: driver(), cases: cases(), participants: participants(), thresholds: { minimumOutcomeImprovement: .1, minimumRepeatRuns: 3 }, budget: { maximumModelSpendUsd: 5, maximumWallClockMs: 3600000, maximumCandidates: 8 } }); }

test("commercial comparison freezes adapters, baselines, limits and sealed unseen cases", () => {
  const { contract, unseenVault } = create();
  assert.equal(assertCommercialComparisonFreeze(contract), true);
  assert.equal(contract.cases.unseen.count, 2);
  assert.equal(JSON.stringify(contract).includes("held-0"), false);
  assert.equal(unseenVault.releaseCount(), 0);
});

test("every customer system needs a verified adapter binding", () => {
  const broken = driver(); broken.systemBindings = [];
  assert.throws(() => createCommercialComparisonFreeze({ intake: intake(), driver: broken, cases: cases(), participants: participants(), thresholds: {}, budget: { maximumModelSpendUsd: 0, maximumWallClockMs: 1000, maximumCandidates: 3 } }), /not bound to a verified comparison adapter/);
});

test("supplied current agent and serious manual baselines cannot be omitted", () => {
  assert.throws(() => createCommercialComparisonFreeze({ intake: intake(), driver: driver(), cases: cases(), participants: participants().filter((item) => item.type !== "expert-manual"), thresholds: {}, budget: { maximumModelSpendUsd: 0, maximumWallClockMs: 1000, maximumCandidates: 3 } }), /baselines are mandatory/);
  assert.throws(() => createCommercialComparisonFreeze({ intake: intake(), driver: driver(), cases: cases(), participants: participants().filter((item) => item.type !== "current-agent"), thresholds: {}, budget: { maximumModelSpendUsd: 0, maximumWallClockMs: 1000, maximumCandidates: 3 } }), /current agent must be included/);
});

test("frozen compiler portfolio cannot silently exceed the agreed candidate limit", () => {
  const extra = { id: "candidate-two", type: "compiler-candidate", label: "Second candidate", configurationHash: "f", runnerId: "runner-candidate-two" };
  assert.throws(() => createCommercialComparisonFreeze({ intake: intake(), driver: driver(), cases: cases(), participants: [...participants(), extra], thresholds: {}, budget: { maximumModelSpendUsd: 1, maximumWallClockMs: 1000, maximumCandidates: 1 } }), /candidate count must stay between 3 and 30/);
  assert.throws(() => createCommercialComparisonFreeze({ intake: intake(), driver: driver(), cases: cases(), participants: [...participants(), extra, { ...extra, id: "candidate-three", configurationHash: "g", runnerId: "runner-candidate-three" }, { ...extra, id: "candidate-four", configurationHash: "h", runnerId: "runner-candidate-four" }], thresholds: {}, budget: { maximumModelSpendUsd: 1, maximumWallClockMs: 1000, maximumCandidates: 3 } }), /exceed the comparison candidate limit/);
});

test("unseen cases release only after bound safe validation and adversarial gates", () => {
  const { contract, unseenVault } = create();
  assert.throws(() => releaseCommercialUnseen({ contract, unseenVault, preUnseenReceipt: { contractFreezeHash: contract.freezeHash, validationPassed: true, adversarialPassed: false, unsafeAttempts: 0, incorrectSideEffects: 0 } }), /must pass/);
  const released = releaseCommercialUnseen({ contract, unseenVault, preUnseenReceipt: { contractFreezeHash: contract.freezeHash, validationPassed: true, adversarialPassed: true, unsafeAttempts: 0, incorrectSideEffects: 0 } });
  assert.equal(released.length, 2);
  assert.equal(unseenVault.releaseCount(), 1);
});

test("comparison freeze detects mutation", () => {
  const { contract } = create();
  const changed = structuredClone(contract); changed.budget.maximumModelSpendUsd = 500;
  assert.throws(() => assertCommercialComparisonFreeze(changed), /changed after commitment/);
});
