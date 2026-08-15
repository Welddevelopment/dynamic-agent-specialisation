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

test("provider prices each resolved model from its own explicit table", async () => {
  const provider = new OpenAIResponsesProvider({
    apiKey: "test-key",
    pricingByModel: {
      "cheap-model": { inputPerMillionUsd: 1, outputPerMillionUsd: 2 },
      "expensive-model": { inputPerMillionUsd: 10, outputPerMillionUsd: 20 },
    },
    modelMap: { cheap: "cheap-model", expensive: "expensive-model" },
    allowPaidCalls: true,
    environment: { DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED" },
    fetchImpl: async (_url, options) => ({ ok: true, json: async () => ({ output_parsed: { kind: "complete" }, usage: { input_tokens: 1000, output_tokens: 500, input_tokens_details: { cached_tokens: 0 } }, requested: JSON.parse(options.body).model }) }),
  });
  const cheap = await provider.generate({ model: "cheap", input: "x" });
  const expensive = await provider.generate({ model: "expensive", input: "x" });
  assert.equal(cheap.actualUsd, .002);
  assert.equal(expensive.actualUsd, .02);
  assert.ok(provider.projectCost({ model: "expensive", input: "x", maxOutputTokens: 10 }) > provider.projectCost({ model: "cheap", input: "x", maxOutputTokens: 10 }));
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
  assert.equal(sent.service_tier, "default");
  assert.equal(sent.model, "gpt-test");
  assert.equal(sent.input, "test");
  assert.equal(result.requestedServiceTier, "default");
  assert.equal(result.resolvedServiceTier, "default");
});

test("provider separately meters GPT-5.6 cache writes and preserves raw usage", async () => {
  const current = { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, cacheWritePerMillionUsd: .25, outputPerMillionUsd: 1.2 };
  const usage = { input_tokens: 1_000, output_tokens: 200, input_tokens_details: { cached_tokens: 200, cache_write_tokens: 500 } };
  const provider = new OpenAIResponsesProvider({
    apiKey: "test-key", pricing: current, allowPaidCalls: true, environment: { DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED" },
    fetchImpl: async (_url, options) => {
      assert.equal(JSON.parse(options.body).service_tier, "default");
      return { ok: true, json: async () => ({ output_parsed: { kind: "complete" }, usage, service_tier: "default" }) };
    },
  });
  const result = await provider.generate({ model: "gpt-5.6-luna", input: "x" });
  const expected = 300 / 1_000_000 * .2 + 200 / 1_000_000 * .02 + 500 / 1_000_000 * .25 + 200 / 1_000_000 * 1.2;
  assert.equal(result.actualUsd, expected);
  assert.deepEqual(result.usage, usage);
});

test("provider fails closed when cache writes are reported without explicit write pricing", async () => {
  const provider = new OpenAIResponsesProvider({
    apiKey: "test-key", pricing, allowPaidCalls: true, environment: { DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED" },
    fetchImpl: async () => ({ ok: true, json: async () => ({ output_parsed: { kind: "complete" }, usage: { input_tokens: 10, output_tokens: 1, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 10 } } }) }),
  });
  await assert.rejects(() => provider.generate({ model: "x", input: "x" }), /cache-write pricing is missing/);
});

test("provider rejects a request tier that does not match the priced provider tier", async () => {
  const provider = new OpenAIResponsesProvider({
    apiKey: "test-key", pricing, serviceTier: "default", allowPaidCalls: true, environment: { DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED" },
    fetchImpl: async () => { throw new Error("must not call network"); },
  });
  await assert.rejects(() => provider.generate({ model: "x", input: "x", serviceTier: "fast" }), /does not match the provider pricing tier/);
});

test("provider fails closed when the REST payload has no model output", async () => {
  const provider = new OpenAIResponsesProvider({
    apiKey: "test-key", pricing, allowPaidCalls: true, environment: { DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED" },
    fetchImpl: async () => ({ ok: true, json: async () => ({ output: [], usage: { input_tokens: 1, output_tokens: 0 } }) }),
  });
  await assert.rejects(() => provider.generate({ model: "x", input: "x" }), /no extractable model output/);
});

test("provider classifies exhausted funding as a safe resumable rejection", async () => {
  const provider = new OpenAIResponsesProvider({
    apiKey: "test-key", pricing, allowPaidCalls: true, environment: { DAS_ENABLE_PAID_MODEL_CALLS: "JOEL_APPROVED" },
    fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { code: "insufficient_quota", type: "insufficient_quota", message: "Please add credits" } }) }),
  });
  await assert.rejects(
    () => provider.generate({ model: "x", input: "x" }),
    (error) => error.retryClass === "funding" && error.resumable === true && error.definitivelyNotCharged === true,
  );
});
