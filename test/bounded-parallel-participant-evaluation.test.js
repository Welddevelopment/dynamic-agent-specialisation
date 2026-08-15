import test from "node:test";
import assert from "node:assert/strict";
import { evaluateParticipantsBoundedParallel } from "../src/experiments/candidate-scale/bounded-parallel-participant-evaluation.js";

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

test("parallelizes participants but keeps each participant cases sequential and output ordered", async () => {
  const participants = ["a", "b", "c", "d"].map((id) => ({ id }));
  const cases = [1, 2, 3].map((id) => ({ id }));
  const activeByParticipant = new Map();
  const observedOrderByParticipant = new Map();
  let active = 0;
  let maximumActive = 0;
  const committed = [];

  const rows = await evaluateParticipantsBoundedParallel({
    participants,
    cases,
    phase: "selection",
    concurrency: 3,
    makeProgressKey: ({ participant, record }) => `${participant.id}:${record.id}`,
    resume: () => null,
    evaluate: async ({ participant, record }) => {
      assert.equal(activeByParticipant.get(participant.id) ?? 0, 0);
      activeByParticipant.set(participant.id, 1);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await delay(participant.id === "a" ? 5 : 2);
      const prior = observedOrderByParticipant.get(participant.id) ?? [];
      prior.push(record.id);
      observedOrderByParticipant.set(participant.id, prior);
      active -= 1;
      activeByParticipant.set(participant.id, 0);
      return { participantId: participant.id, caseId: record.id, unsafeAttempts: 0, incorrectSideEffects: 0 };
    },
    commit: ({ progressKey }) => { committed.push(progressKey); },
  });

  assert.equal(maximumActive, 3);
  for (const participant of participants) assert.deepEqual(observedOrderByParticipant.get(participant.id), [1, 2, 3]);
  assert.deepEqual(rows.map((row) => `${row.participantId}:${row.caseId}`), participants.flatMap((participant) => cases.map((record) => `${participant.id}:${record.id}`)));
  assert.equal(new Set(committed).size, 12);
});

test("resumes exact prior rows and preserves the safety early-stop rule", async () => {
  const evaluated = [];
  const prior = { participantId: "a", caseId: 1, unsafeAttempts: 0, incorrectSideEffects: 0, prior: true };
  const rows = await evaluateParticipantsBoundedParallel({
    participants: [{ id: "a" }, { id: "b" }],
    cases: [{ id: 1 }, { id: 2 }, { id: 3 }],
    phase: "selection",
    concurrency: 2,
    makeProgressKey: ({ participant, record }) => `${participant.id}:${record.id}`,
    resume: (key) => key === "a:1" ? prior : null,
    evaluate: async ({ participant, record }) => {
      evaluated.push(`${participant.id}:${record.id}`);
      return { participantId: participant.id, caseId: record.id, unsafeAttempts: record.id === 2 ? 1 : 0, incorrectSideEffects: 0 };
    },
    commit: () => {},
  });
  assert.equal(rows.find((row) => row.prior), prior);
  assert.deepEqual(evaluated.sort(), ["a:2", "b:1", "b:2"].sort());
  assert.equal(rows.some((row) => row.caseId === 3), false);
});

test("rejects an asynchronous durable commit", async () => {
  await assert.rejects(() => evaluateParticipantsBoundedParallel({
    participants: [{ id: "a" }], cases: [{ id: 1 }], phase: "selection", concurrency: 1,
    makeProgressKey: () => "a:1", resume: () => null,
    evaluate: async () => ({ unsafeAttempts: 0, incorrectSideEffects: 0 }),
    commit: async () => {},
  }), /commit must be synchronous/);
});
