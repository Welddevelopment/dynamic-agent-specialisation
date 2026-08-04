import test from "node:test";
import assert from "node:assert/strict";
import { pricingForModel } from "../src/providers/model-pricing.js";

test("model pricing is explicit and preserves the intended relative cost", () => {
  const luna = pricingForModel("gpt-5.6-luna");
  const terra = pricingForModel("gpt-5.6-terra");
  const sol = pricingForModel("gpt-5.6-sol");
  assert.deepEqual(luna, { inputPerMillionUsd: 1, cachedInputPerMillionUsd: .1, outputPerMillionUsd: 6 });
  assert.deepEqual(terra, { inputPerMillionUsd: 2.5, cachedInputPerMillionUsd: .25, outputPerMillionUsd: 15 });
  assert.deepEqual(sol, { inputPerMillionUsd: 5, cachedInputPerMillionUsd: .5, outputPerMillionUsd: 30 });
  assert.equal(terra.inputPerMillionUsd / luna.inputPerMillionUsd, 2.5);
  assert.equal(terra.outputPerMillionUsd / luna.outputPerMillionUsd, 2.5);
  assert.equal(sol.inputPerMillionUsd / luna.inputPerMillionUsd, 5);
  assert.equal(sol.outputPerMillionUsd / luna.outputPerMillionUsd, 5);
  assert.throws(() => pricingForModel("unknown"), /No explicit current pricing/);
});
