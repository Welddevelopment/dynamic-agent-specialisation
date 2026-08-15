import { assertDas004B2Preregistration, DAS004_B2_APPROVAL, DAS004_B2_HARD_LIMIT_USD, DAS004_B2_PRICING_DATE, DAS004_B2_PRICING_HASH } from "./protocol.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }

export function assertDas004B2Authorization({ plan, environment, now = () => new Date() }) {
  assertDas004B2Preregistration(plan);
  requireCondition(environment.DAS_ENABLE_PAID_MODEL_CALLS === "JOEL_APPROVED", "Global paid-model approval is absent");
  requireCondition(environment.DAS004_B2_APPROVAL === DAS004_B2_APPROVAL, "DAS-004/B2 campaign-specific approval is absent");
  requireCondition(environment.DAS004_B2_PLAN_HASH === plan.planHash, "DAS-004/B2 approval is not bound to the exact preregistration");
  requireCondition(environment.DAS004_B2_PRICING_HASH === DAS004_B2_PRICING_HASH, "DAS-004/B2 pricing approval hash mismatch");
  requireCondition(environment.DAS004_B2_PRICING_DATE === DAS004_B2_PRICING_DATE, "DAS-004/B2 pricing approval date mismatch");
  requireCondition(now().toISOString().slice(0, 10) === DAS004_B2_PRICING_DATE, "DAS-004/B2 pricing approval is not current UTC date");
  const limit = Number(environment.DAS004_B2_LIMIT_USD);
  requireCondition(Number.isFinite(limit) && limit === DAS004_B2_HARD_LIMIT_USD, "DAS-004/B2 explicit limit must equal the frozen $3 ceiling");
  requireCondition(typeof environment.OPENAI_API_KEY === "string" && environment.OPENAI_API_KEY.length >= 20, "DAS-004/B2 needs an API key");
  return Object.freeze({ limitUsd: limit, approval: DAS004_B2_APPROVAL, planHash: plan.planHash, pricingHash: DAS004_B2_PRICING_HASH, pricingDate: DAS004_B2_PRICING_DATE });
}
