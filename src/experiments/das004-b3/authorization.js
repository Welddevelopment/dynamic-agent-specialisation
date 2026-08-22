import { assertDas004B3Preregistration, DAS004_B3_APPROVAL, DAS004_B3_HARD_LIMIT_USD, DAS004_B3_PRICING_DATE, DAS004_B3_PRICING_HASH } from "./protocol.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }

/**
 * Six environment variables, all required, none of them guessable in advance:
 * DAS_ENABLE_PAID_MODEL_CALLS, DAS004_B3_APPROVAL, DAS004_B3_PLAN_HASH,
 * DAS004_B3_PRICING_HASH, DAS004_B3_PRICING_DATE, DAS004_B3_LIMIT_USD (+ OPENAI_API_KEY).
 *
 * The plan hash binds the approval to this exact preregistration, and the date check forces
 * pricing to be current on the day of the run rather than inherited from a stale freeze.
 */
export function assertDas004B3Authorization({ plan, environment, now = () => new Date() }) {
  assertDas004B3Preregistration(plan);
  requireCondition(environment.DAS_ENABLE_PAID_MODEL_CALLS === "JOEL_APPROVED", "Global paid-model approval is absent");
  requireCondition(environment.DAS004_B3_APPROVAL === DAS004_B3_APPROVAL, "DAS-004/B3 campaign-specific approval is absent");
  requireCondition(environment.DAS004_B3_PLAN_HASH === plan.planHash, "DAS-004/B3 approval is not bound to the exact preregistration");
  requireCondition(environment.DAS004_B3_PRICING_HASH === DAS004_B3_PRICING_HASH, "DAS-004/B3 pricing approval hash mismatch");
  requireCondition(environment.DAS004_B3_PRICING_DATE === DAS004_B3_PRICING_DATE, "DAS-004/B3 pricing approval date mismatch");
  requireCondition(now().toISOString().slice(0, 10) === DAS004_B3_PRICING_DATE, "DAS-004/B3 pricing approval is not the current UTC date; re-verify pricing and bump the constant");
  const limit = Number(environment.DAS004_B3_LIMIT_USD);
  requireCondition(Number.isFinite(limit) && limit === DAS004_B3_HARD_LIMIT_USD, `DAS-004/B3 explicit limit must equal the frozen $${DAS004_B3_HARD_LIMIT_USD} ceiling`);
  requireCondition(typeof environment.OPENAI_API_KEY === "string" && environment.OPENAI_API_KEY.length >= 20, "DAS-004/B3 needs an API key");
  return Object.freeze({ limitUsd: limit, approval: DAS004_B3_APPROVAL, planHash: plan.planHash, pricingHash: DAS004_B3_PRICING_HASH, pricingDate: DAS004_B3_PRICING_DATE });
}
