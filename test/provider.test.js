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

test("provider extracts text from the raw Responses REST payload and sends structured format", async () => {
  let sent;
  const provider = new OpenAIResponsesProvider({
    apiKey: "test-key", pricing, allowPaidCalls: true, environment: { DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED" }, modelMap: { architect: "gpt-test" },
    fetchImpl: async (_url, options) => { sent = JSON.parse(options.body); return { ok: true, json: async () => ({ id: "resp_1", output: [{ type: "message", content: [{ type: "output_text", text: "{\"ok\":true}" }] }], usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 0 } } }) }; },
  });
  const result = await provider.generate({ model: "architect", input: "test", responseFormat: "json", maxOutputTokens: 20 });
  assert.equal(result.output, '{"ok":true}');
  assert.equal(result.resolvedModel, "gpt-test");
  assert.deepEqual(sent.text, { format: { type: "json_object" } });
  assert.equal(sent.store, false);
  assert.equal(sent.model, "gpt-test");
  assert.equal(sent.input, "test");
});

test("provider fails closed when the REST payload has no model output", async () => {
  const provider = new OpenAIResponsesProvider({
    apiKey: "test-key", pricing, allowPaidCalls: true, environment: { DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED" },
    fetchImpl: async () => ({ ok: true, json: async () => ({ output: [], usage: { input_tokens: 1, output_tokens: 0 } }) }),
  });
  await assert.rejects(() => provider.generate({ model: "x", input: "x" }), /no extractable model output/);
});
