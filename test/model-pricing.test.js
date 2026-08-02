import test from "node:test";
import assert from "node:assert/strict";
import { pricingForModel } from "../src/providers/model-pricing.js";

test("model pricing is explicit and preserves the intended relative cost", () => {
  const luna = pricingForModel("gpt-5.6-luna");
  const terra = pricingForModel("gpt-5.6-terra");
  const sol = pricingForModel("gpt-5.6-sol");
  assert.equal(terra.inputPerMillionUsd / luna.inputPerMillionUsd, 10);
  assert.equal(terra.outputPerMillionUsd / luna.outputPerMillionUsd, 10);
  assert.equal(sol.inputPerMillionUsd / luna.inputPerMillionUsd, 25);
  assert.equal(sol.outputPerMillionUsd / luna.outputPerMillionUsd, 25);
  assert.throws(() => pricingForModel("unknown"), /No explicit current pricing/);
});
