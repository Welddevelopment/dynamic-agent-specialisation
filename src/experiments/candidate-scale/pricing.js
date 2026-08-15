import { digest } from "../../core/canonical.js";

// Frozen locally for this experiment from the official OpenAI API pricing page.
// Keeping the snapshot here avoids changing the pricing evidence attached to older
// DAS campaigns that used the repository-wide historical table.
export const CANDIDATE_SCALE_PILOT_PRICING = Object.freeze({
  schemaVersion: "das.candidate-scale-pricing-snapshot.v1",
  verifiedOn: "2026-08-12",
  source: "https://developers.openai.com/api/docs/pricing",
  serviceTier: "standard",
  contextClass: "short-context",
  unit: "usd-per-million-tokens",
  models: Object.freeze({
    "gpt-5.6-sol": Object.freeze({
      inputPerMillionUsd: 5,
      cachedInputPerMillionUsd: 0.5,
      cacheWritePerMillionUsd: 6.25,
      outputPerMillionUsd: 30,
    }),
    "gpt-5.6-terra": Object.freeze({
      inputPerMillionUsd: 2,
      cachedInputPerMillionUsd: 0.2,
      cacheWritePerMillionUsd: 2.5,
      outputPerMillionUsd: 12,
    }),
    "gpt-5.6-luna": Object.freeze({
      inputPerMillionUsd: 0.2,
      cachedInputPerMillionUsd: 0.02,
      cacheWritePerMillionUsd: 0.25,
      outputPerMillionUsd: 1.2,
    }),
  }),
  evidenceBoundary: "Standard short-context text-token pricing copied from the official OpenAI API pricing page on 2026-08-12. It is not a quote, credit confirmation, or permission to spend.",
});

export const CANDIDATE_SCALE_PILOT_PRICING_HASH = digest(CANDIDATE_SCALE_PILOT_PRICING);
