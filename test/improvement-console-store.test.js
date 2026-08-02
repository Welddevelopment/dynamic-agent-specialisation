import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ImprovementConsoleStore } from "../src/console/improvement-store.js";

const input = { enabled: true, id: "company-goal", baselineId: "current-agent", objectives: [{ metric: "modelCostUsd", direction: "decrease", minimumRelativeImprovement: .1 }, { metric: "medianElapsedMs", direction: "decrease", minimumRelativeImprovement: .1 }], maximumModelSpendUsd: 7, maximumWallClockMinutes: 90, maximumRounds: 6, minimumRepeatedObservations: 3, persistence: "persistent" };

test("optional improvement is disabled by default and persists an explicit company contract", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "das-console-"));
  const filePath = path.join(dir, "state.json");
  const store = new ImprovementConsoleStore({ filePath, now: () => "2026-08-02T00:00:00.000Z" });
  assert.equal(store.snapshot().enabled, false);
  const saved = store.configure(input);
  assert.equal(saved.enabled, true);
  assert.equal(saved.draft.contract.limits.maximumModelSpendUsd, 7);
  assert.equal(saved.draft.contract.limits.maximumWallClockMs, 5_400_000);
  assert.equal(saved.draft.contract.stopPolicy.minimumEstimatedSuccessProbability, .03);
  const restored = new ImprovementConsoleStore({ filePath });
  assert.equal(restored.snapshot().draft.contract.id, "company-goal");
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
});

test("starting requires enablement, explicit confirmation, and an attached runner", async () => {
  const store = new ImprovementConsoleStore();
  await assert.rejects(() => store.start({ confirmation: "START_OPTIONAL_IMPROVEMENT" }), /not enabled/);
  store.configure(input);
  await assert.rejects(() => store.start({ confirmation: "wrong" }), /confirmation/);
  await assert.rejects(() => store.start({ confirmation: "START_OPTIONAL_IMPROVEMENT" }), /runner/);
});

test("console records transparent run events and the exact stop reason", async () => {
  const store = new ImprovementConsoleStore({ runner: async ({ onEvent }) => { onEvent({ status: "evaluating", candidateId: "candidate-a", spendUsd: .12 }); return { status: "target-not-achieved-within-limits", stopReason: "marginal-progress-too-low", bestCandidateFound: { candidate: { id: "candidate-a" } } }; } });
  store.configure(input);
  const finished = await store.start({ confirmation: "START_OPTIONAL_IMPROVEMENT" });
  assert.equal(finished.activeRun, null);
  assert.equal(finished.completedRuns[0].events[0].candidateId, "candidate-a");
  assert.equal(finished.completedRuns[0].result.stopReason, "marginal-progress-too-low");
});
