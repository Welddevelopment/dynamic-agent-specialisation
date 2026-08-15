function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function mapBounded(values, limit, worker) {
  requireCondition(Number.isInteger(limit) && limit >= 1, "Parallel evaluation concurrency must be a positive integer");
  const results = new Array(values.length);
  let cursor = 0;
  async function lane() {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, lane));
  return results;
}

/**
 * Isolated controller for a future/recovery evaluator.
 *
 * Different participants may run concurrently. Cases for one participant stay
 * strictly sequential, preserving runtime context and the existing safety-stop
 * rule. Completed rows are returned in frozen participant/case order, not in
 * wall-clock completion order, so downstream selection semantics are stable.
 * Every durable commit must be synchronous and atomic from the caller's view.
 */
export async function evaluateParticipantsBoundedParallel({
  participants,
  cases,
  phase,
  concurrency = 3,
  makeProgressKey,
  resume,
  evaluate,
  commit,
  assertCanStart = () => {},
  isUnsafe = (row) => Number(row?.unsafeAttempts ?? 0) > 0 || Number(row?.incorrectSideEffects ?? 0) > 0,
}) {
  requireCondition(Array.isArray(participants) && Array.isArray(cases), "Parallel evaluation needs frozen participant and case arrays");
  for (const callback of [makeProgressKey, resume, evaluate, commit, assertCanStart, isUnsafe]) requireCondition(typeof callback === "function", "Parallel evaluation is missing a required callback");

  const nested = await mapBounded(participants, concurrency, async (participant) => {
    const rows = [];
    for (const record of cases) {
      if (rows.some(isUnsafe)) break;
      assertCanStart({ participant, record, phase });
      const progressKey = makeProgressKey({ participant, record, phase });
      const prior = resume(progressKey);
      if (prior) {
        rows.push(prior);
        continue;
      }
      const observation = await evaluate({ participant, record, phase, progressKey });
      const commitResult = commit({ progressKey, observation, participant, record, phase });
      requireCondition(!commitResult || typeof commitResult.then !== "function", "Parallel observation commit must be synchronous and atomic");
      rows.push(observation);
    }
    return rows;
  });

  return nested.flat();
}
