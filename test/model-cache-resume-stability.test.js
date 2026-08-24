import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ModelResponseCache, modelRequestCacheKey } from "../src/core/model-gateway.js";
import { PersistentModelResponseCache } from "../src/core/durable-model-campaign.js";
import { ModelDecisionEngine } from "../src/runtime/model-decision-engine.js";

const baseRequest = (remaining) => ({
  model: "gpt-5.6-luna",
  purpose: "specialist-runtime-decision",
  input: { instruction: "decide", goal: "g", turn: 3, observations: [], remainingBudget: remaining },
  responseFormat: { type: "json_schema" },
  maxOutputTokens: 1_200,
  cacheKeyExclusions: ["input.remainingBudget"],
});

test("report 0118 regression: wall-clock advisory fields do not change cache identity", () => {
  const first = baseRequest({ modelCostUsd: 0.0821, latencyMs: 171_204 });
  const resumed = baseRequest({ modelCostUsd: 0.0799, latencyMs: 98_411 });
  assert.equal(modelRequestCacheKey(first), modelRequestCacheKey(resumed));
});

test("decision-relevant fields still change cache identity", () => {
  const a = baseRequest({ modelCostUsd: 1, latencyMs: 1 });
  const b = baseRequest({ modelCostUsd: 1, latencyMs: 1 });
  b.input.goal = "a different goal";
  assert.notEqual(modelRequestCacheKey(a), modelRequestCacheKey(b));
  const c = baseRequest({ modelCostUsd: 1, latencyMs: 1 });
  c.input.observations = [{ tool: "read", output: 1 }];
  assert.notEqual(modelRequestCacheKey(a), modelRequestCacheKey(c));
});

test("the exclusion list itself is part of the identity", () => {
  const excluded = baseRequest({ modelCostUsd: 1, latencyMs: 1 });
  const notExcluded = { ...structuredClone(excluded) };
  delete notExcluded.cacheKeyExclusions;
  assert.notEqual(modelRequestCacheKey(excluded), modelRequestCacheKey(notExcluded));
});

test("a request without exclusions keys exactly as before", () => {
  const plain = { model: "m", input: { a: 1 } };
  assert.equal(modelRequestCacheKey(plain), modelRequestCacheKey(structuredClone(plain)));
});

test("both cache classes replay across differing wall-clock values", () => {
  const memoryCache = new ModelResponseCache();
  memoryCache.set(baseRequest({ modelCostUsd: 0.08, latencyMs: 170_000 }), { output: "cached" });
  assert.deepEqual(memoryCache.get(baseRequest({ modelCostUsd: 0.02, latencyMs: 9_000 })), { output: "cached" });

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "das-cache-")), "cache.json");
  const persistent = new PersistentModelResponseCache({ filePath: file });
  persistent.set(baseRequest({ modelCostUsd: 0.08, latencyMs: 170_000 }), { output: "durable" });
  const reloaded = new PersistentModelResponseCache({ filePath: file });
  assert.deepEqual(reloaded.get(baseRequest({ modelCostUsd: 0.01, latencyMs: 4 })), { output: "durable" });
});

test("end to end: a resumed engine turn is a cache hit, not a fresh call", async () => {
  let generateCalls = 0;
  const decision = { kind: "complete", name: null, input: null, reason: null, blocker: null, escalationScope: null, subjectId: null, confidence: 0.9 };
  const makeGateway = (cache) => ({
    projectCost: () => 0.01,
    async generate(request) {
      const hit = cache.get(request);
      if (hit) return hit;
      generateCalls += 1;
      const response = { output: JSON.stringify(decision), actualUsd: 0.01, elapsedMs: 5 };
      cache.set(request, response);
      return response;
    },
  });
  const cacheFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "das-cache-")), "engine.json");
  const candidate = { model: { family: "gpt-5.6-luna" }, instructions: {}, context: {}, authority: {}, escalation: {}, strategy: {}, limits: {}, memory: {} };
  const args = { candidate, goal: "g", turn: 1, observations: [], memory: [], tools: [] };

  const firstRun = new ModelDecisionEngine({ gateway: makeGateway(new PersistentModelResponseCache({ filePath: cacheFile })) });
  await firstRun.next({ ...args, remainingCostUsd: 0.5, remainingLatencyMs: 100_000 });
  assert.equal(generateCalls, 1);

  // The "resume": new process, same durable cache, different wall-clock remainders.
  const resumedRun = new ModelDecisionEngine({ gateway: makeGateway(new PersistentModelResponseCache({ filePath: cacheFile })) });
  const replayed = await resumedRun.next({ ...args, remainingCostUsd: 0.31, remainingLatencyMs: 42_000 });
  assert.equal(generateCalls, 1, "the resumed turn must replay from cache");
  assert.equal(replayed.kind, "complete");
});
