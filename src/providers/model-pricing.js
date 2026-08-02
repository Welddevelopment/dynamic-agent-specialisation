export const CURRENT_MODEL_PRICING_USD = Object.freeze({
  "gpt-5.6-luna": Object.freeze({ inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 }),
  "gpt-5.6-terra": Object.freeze({ inputPerMillionUsd: 2, cachedInputPerMillionUsd: .2, outputPerMillionUsd: 12 }),
  "gpt-5.6-sol": Object.freeze({ inputPerMillionUsd: 5, cachedInputPerMillionUsd: .5, outputPerMillionUsd: 30 }),
});

export function pricingForModel(model) {
  const pricing = CURRENT_MODEL_PRICING_USD[model];
  if (!pricing) throw new Error(`No explicit current pricing registered for model: ${model}`);
  return pricing;
}
