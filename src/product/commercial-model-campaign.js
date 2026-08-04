import path from "node:path";
import { digest } from "../core/canonical.js";
import { DurableBudgetGuard, PersistentModelResponseCache } from "../core/durable-model-campaign.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway } from "../core/model-gateway.js";
import { CURRENT_MODEL_PRICING_USD } from "../providers/model-pricing.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { assertCommercialComparisonFreeze } from "./commercial-comparison.js";

export const COMMERCIAL_CAMPAIGN_ID = "commercial-procurement-model-campaign-v1";
export const COMMERCIAL_CAMPAIGN_APPROVAL = "JOEL_APPROVED_COMMERCIAL_PROCUREMENT_V1";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function utcDate() { return new Date().toISOString().slice(0, 10); }

export function createCommercialModelCampaignPlan({ contract, participants, maxTurns = 24 }) {
  assertCommercialComparisonFreeze(contract);
  requireCondition(Array.isArray(participants) && participants.length === contract.participants.length, "Campaign plan requires every frozen participant");
  const baseCasesPerParticipant = contract.cases.development.length + contract.cases.validation.length + contract.cases.adversarial.length + contract.cases.unseen.count;
  const repeatCases = contract.thresholds.minimumRepeatRuns * contract.cases.unseen.count;
  const maximumTaskEvaluations = participants.length * baseCasesPerParticipant + repeatCases;
  const models = [...new Set(participants.map((item) => item.candidate?.model?.family).filter(Boolean))];
  const plan = {
    schemaVersion: "das.commercial-model-campaign-plan.v1",
    campaignId: COMMERCIAL_CAMPAIGN_ID,
    contractFreezeHash: contract.freezeHash,
    participantCount: participants.length,
    participants: participants.map((item) => ({ id: item.id, type: item.type, configurationHash: item.configurationHash, model: item.candidate?.model?.family, taskCostLimitUsd: item.candidate?.limits?.maxCostPerTaskUsd })),
    stages: { development: contract.cases.development.length, validation: contract.cases.validation.length, adversarial: contract.cases.adversarial.length, unseen: contract.cases.unseen.count, repeatRuns: contract.thresholds.minimumRepeatRuns },
    maximumTaskEvaluations,
    maximumModelTurns: maximumTaskEvaluations * maxTurns,
    maxTurnsPerTask: maxTurns,
    contractHardSpendLimitUsd: contract.budget.maximumModelSpendUsd,
    exactModels: models,
    pricingTableHash: digest(CURRENT_MODEL_PRICING_USD),
    resumeSafety: { persistentResponseCache: true, durablePerCallBudget: true, interruptedReservationRemainsReserved: true, cachedOperationalCostSeparatedFromNewSpend: true },
    gates: {
      paidCallsDefault: "disabled",
      requiredGlobalApproval: "DAS_ENABLE_PAID_MODEL_CALLS=JOEL_APPROVED",
      requiredCampaignApproval: `DAS_COMMERCIAL_MODEL_CAMPAIGN_APPROVAL=${COMMERCIAL_CAMPAIGN_APPROVAL}`,
      requiredExplicitLimit: "DAS_COMMERCIAL_MODEL_CAMPAIGN_LIMIT_USD=<positive number no greater than frozen contract limit>",
      requiredPricingDate: "DAS_COMMERCIAL_PRICING_VERIFIED_ON=<current UTC date>",
      requiredPricingHash: `DAS_COMMERCIAL_PRICING_TABLE_HASH=${digest(CURRENT_MODEL_PRICING_USD)}`,
    },
    evidenceBoundary: "Zero-cost execution plan. Maximum task/turn counts are structural ceilings if every participant survives. No model call, candidate result or improvement is implied.",
  };
  plan.planHash = digest(plan);
  return Object.freeze(plan);
}

export function assertCommercialModelCampaignAuthorization({ environment = process.env, contract, pricingVerifiedDate = utcDate() }) {
  assertCommercialComparisonFreeze(contract);
  requireCondition(environment.DAS_ENABLE_PAID_MODEL_CALLS === "JOEL_APPROVED", "Global paid model calls are not approved");
  requireCondition(environment.DAS_COMMERCIAL_MODEL_CAMPAIGN_APPROVAL === COMMERCIAL_CAMPAIGN_APPROVAL, "Commercial procurement model campaign is not explicitly approved");
  const limit = Number(environment.DAS_COMMERCIAL_MODEL_CAMPAIGN_LIMIT_USD);
  requireCondition(Number.isFinite(limit) && limit > 0 && limit <= contract.budget.maximumModelSpendUsd, "Commercial model campaign needs an explicit positive limit within the frozen contract ceiling");
  requireCondition(environment.DAS_COMMERCIAL_PRICING_VERIFIED_ON === pricingVerifiedDate, "Commercial model pricing was not freshly verified today");
  requireCondition(environment.DAS_COMMERCIAL_PRICING_TABLE_HASH === digest(CURRENT_MODEL_PRICING_USD), "Commercial model pricing table hash is not approved");
  requireCondition(environment.OPENAI_API_KEY, "OPENAI_API_KEY is missing");
  return Object.freeze({ limitUsd: limit, pricingVerifiedDate, pricingTableHash: digest(CURRENT_MODEL_PRICING_USD) });
}

export function createCommercialModelCampaignRuntime({ environment = process.env, contract, stateDirectory = "artifacts/commercial/procurement-v1/model-campaign-v1", fetchImpl = fetch }) {
  const authorization = assertCommercialModelCampaignAuthorization({ environment, contract });
  const root = path.resolve(stateDirectory);
  const budget = new DurableBudgetGuard({ filePath: path.join(root, "budget.json"), hardLimitUsd: authorization.limitUsd, campaignId: COMMERCIAL_CAMPAIGN_ID });
  const cache = new PersistentModelResponseCache({ filePath: path.join(root, "response-cache.json") });
  const evidence = new EvidenceLedger(path.join(root, "evidence.jsonl"));
  const provider = new OpenAIResponsesProvider({ apiKey: environment.OPENAI_API_KEY, pricingByModel: CURRENT_MODEL_PRICING_USD, fetchImpl, allowPaidCalls: true, environment });
  const gateway = new MeteredModelGateway({ provider, budget, cache, evidence, secrets: [environment.OPENAI_API_KEY] });
  return Object.freeze({ root, authorization, budget, cache, evidence, provider, gateway });
}
