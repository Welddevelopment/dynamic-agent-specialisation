import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIResponsesProvider } from "../src/providers/openai-responses.js";

const pricing = { inputPerMillionUsd: 1, cachedInputPerMillionUsd: .1, outputPerMillionUsd: 2 };

test("real provider remains disabled even with a key unless both approval gates are present", async () => {
  const provider = new OpenAIResponsesProvider({ apiKey: "test-key", pricing, allowPaidCalls: false, environment: { DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED" }, fetchImpl: async () => { throw new Error("must not call network"); } });
  await assert.rejects(() => provider.generate({ model: "x", input: "x" }), /require Joel approval/);
});

test("provider cost calculation uses returned usage and injected current pricing", async () => {
  let calls = 0;
  const provider = new OpenAIResponsesProvider({
    apiKey: "test-key", pricing, allowPaidCalls: true, environment: { DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED" },
    fetchImpl: async () => { calls += 1; return { ok: true, json: async () => ({ output_parsed: { kind: "complete" }, usage: { input_tokens: 1000, output_tokens: 500, input_tokens_details: { cached_tokens: 200 } } }) }; },
  });
  const result = await provider.generate({ model: "x", input: "x" });
  assert.equal(calls, 1);
  assert.equal(result.actualUsd, .00182);
  assert.deepEqual(result.output, { kind: "complete" });
});

