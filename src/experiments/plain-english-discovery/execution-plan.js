import { digest } from "../../core/canonical.js";
import { createRoleDiscoveryRequest } from "../../product/plain-english-role-discovery.js";
import { benchmarkCase, PLAIN_ENGLISH_DISCOVERY_BENCHMARK_HASH } from "./benchmark.js";
import { createDiscoveryModelRequest } from "./model-provider.js";
import { OpenAIPlainEnglishDiscoveryProvider } from "./openai-metered-provider.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }

export const PLAIN_ENGLISH_DISCOVERY_APPROVAL = "JOEL_APPROVED_FRONTEND_DISCOVERY_SMOKE_V1";
export const PLAIN_ENGLISH_DISCOVERY_PRICING = Object.freeze({
  model: "gpt-5.6-luna",
  serviceTier: "standard",
  shortContextMaximumTokens: 272_000,
  inputPerMillionUsd: .20,
  cachedInputPerMillionUsd: .02,
  cacheWritePerMillionUsd: .25,
  outputPerMillionUsd: 1.20,
  source: "https://developers.openai.com/api/docs/pricing",
  modelSource: "https://developers.openai.com/api/docs/models/gpt-5.6-luna",
  // Authorization compares ISO/UTC dates; Seoul was already 2026-08-14 when
  // the official pricing page was fetched, while the UTC ledger date was 13.
  verifiedOn: "2026-08-13",
});
export const PLAIN_ENGLISH_DISCOVERY_PRICING_HASH = digest(PLAIN_ENGLISH_DISCOVERY_PRICING);

export function createPlainEnglishDiscoverySmokePlan({ fetchImpl = fetch } = {}) {
  const testCase = benchmarkCase("frontend-canonical");
  const discoveryRequest = createRoleDiscoveryRequest({
    requestId: `benchmark:${testCase.id}:v1`,
    description: testCase.description,
    approvedArtifacts: testCase.approvedArtifacts,
    currentAgentConfiguration: testCase.currentAgentConfiguration,
  });
  const modelRequest = createDiscoveryModelRequest(discoveryRequest);
  const projector = new OpenAIPlainEnglishDiscoveryProvider({
    apiKey: "projection-only-not-a-real-key",
    pricing: PLAIN_ENGLISH_DISCOVERY_PRICING,
    fetchImpl,
    environment: {},
    allowPaidCalls: false,
  });
  const plan = {
    schemaVersion: "das.plain-english-discovery-smoke-plan.v1",
    campaignId: "plain-english-discovery-smoke-v1",
    benchmarkHash: PLAIN_ENGLISH_DISCOVERY_BENCHMARK_HASH,
    caseId: testCase.id,
    expectedContractHash: digest(testCase.expected),
    discoveryRequestHash: discoveryRequest.requestHash,
    modelRequestHash: digest(modelRequest),
    model: modelRequest.model,
    reasoningEffort: modelRequest.reasoningEffort,
    maxOutputTokens: modelRequest.maxOutputTokens,
    pricingTableHash: PLAIN_ENGLISH_DISCOVERY_PRICING_HASH,
    pricingVerifiedOn: PLAIN_ENGLISH_DISCOVERY_PRICING.verifiedOn,
    maximumCalls: 1,
    projectedMaximumSpendUsd: projector.projectCost(modelRequest),
    hardExperimentLimitUsd: .50,
    widerWorkstreamAllocationUsd: 8,
    sharedNewSpendCeilingUsd: 24,
    gates: {
      exactJoelApproval: PLAIN_ENGLISH_DISCOVERY_APPROVAL,
      exactPlanHashRequired: true,
      freshPricingRequired: true,
      creditsConfirmationRequired: true,
      safetyCoreMustPass: true,
      scaleAfterSmokeReview: false,
      specialistCompetitionAuthorized: false,
    },
    evidenceBoundary: "One model-backed contract-discovery smoke case only. It cannot prove universal self-serve onboarding, executable customer bindings, comparison readiness, specialist quality, or customer value.",
  };
  plan.planHash = digest(plan);
  return Object.freeze(plan);
}

export function assertPlainEnglishDiscoverySmokePlan(plan) {
  requireCondition(plan?.schemaVersion === "das.plain-english-discovery-smoke-plan.v1", "Unsupported plain-English discovery plan");
  requireCondition(plan.planHash === digest(withoutHash(plan, "planHash")), "Plain-English discovery plan integrity mismatch");
  const expected = createPlainEnglishDiscoverySmokePlan();
  requireCondition(plan.planHash === expected.planHash, "Plain-English discovery plan no longer matches current frozen inputs or pricing");
  requireCondition(plan.maximumCalls === 1 && plan.hardExperimentLimitUsd === .50 && plan.projectedMaximumSpendUsd <= .50, "Plain-English discovery smoke exceeds its authorized one-call/$0.50 boundary");
  requireCondition(plan.benchmarkHash === PLAIN_ENGLISH_DISCOVERY_BENCHMARK_HASH && plan.pricingTableHash === PLAIN_ENGLISH_DISCOVERY_PRICING_HASH, "Plain-English discovery plan has stale evidence or pricing");
  requireCondition(plan.gates?.scaleAfterSmokeReview === false && plan.gates?.specialistCompetitionAuthorized === false, "Plain-English discovery plan widened experiment scope");
  return true;
}

export function assertPlainEnglishDiscoveryAuthorization({ plan, environment = process.env, today = new Date().toISOString().slice(0, 10) }) {
  assertPlainEnglishDiscoverySmokePlan(plan);
  requireCondition(environment.DAS_ENABLE_PAID_MODEL_CALLS === "JOEL_APPROVED", "Global paid model approval is missing");
  requireCondition(environment.DAS_PLAIN_ENGLISH_DISCOVERY_APPROVAL === PLAIN_ENGLISH_DISCOVERY_APPROVAL, "Exact plain-English discovery approval is missing");
  requireCondition(environment.DAS_PLAIN_ENGLISH_DISCOVERY_PLAN_HASH === plan.planHash, "Exact plain-English discovery plan hash is not approved");
  requireCondition(environment.DAS_PLAIN_ENGLISH_DISCOVERY_CREDITS_CONFIRMED === "YES", "Available API credits are not explicitly confirmed");
  requireCondition(environment.DAS_PLAIN_ENGLISH_DISCOVERY_PRICING_VERIFIED_ON === today && today === plan.pricingVerifiedOn, "Plain-English discovery pricing is not freshly verified today");
  requireCondition(environment.DAS_PLAIN_ENGLISH_DISCOVERY_PRICING_HASH === plan.pricingTableHash, "Exact plain-English discovery pricing hash is not approved");
  const limit = Number(environment.DAS_PLAIN_ENGLISH_DISCOVERY_SPEND_LIMIT_USD);
  requireCondition(Number.isFinite(limit) && limit === plan.hardExperimentLimitUsd && limit <= .50, "Plain-English discovery needs the exact $0.50 smoke limit");
  requireCondition(environment.DAS_PLAIN_ENGLISH_DISCOVERY_SAFETY_CORE === "PASSED", "Repaired discovery safety core has not been explicitly confirmed passing");
  requireCondition(environment.OPENAI_API_KEY, "OpenAI API key is required");
  return Object.freeze({
    campaignId: plan.campaignId,
    planHash: plan.planHash,
    hardLimitUsd: limit,
    paidCallsAuthorized: true,
    discoveryUsageAuthorization: Object.freeze({
      schemaVersion: "das.role-discovery-usage-authorization.v1",
      campaignId: plan.campaignId,
      planHash: plan.planHash,
      providerId: "openai-structured-role-discovery",
      maximumCalls: plan.maximumCalls,
      maximumExternalRequests: plan.maximumCalls,
      maximumSpendUsd: limit,
    }),
  });
}
