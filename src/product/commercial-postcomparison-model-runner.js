import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { DurableBudgetGuard, PersistentModelResponseCache } from "../core/durable-model-campaign.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway } from "../core/model-gateway.js";
import { assertVerifiedObservation, sealVerifiedObservation } from "../lifecycle/verified-monitor.js";
import { CURRENT_MODEL_PRICING_USD } from "../providers/model-pricing.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { assertCommercialLifecycleHandoffPlan } from "./commercial-lifecycle-handoff.js";
import { assertCommercialPostcomparisonGate } from "./commercial-postcomparison-gate.js";
import { assertCommercialComparisonResult, assertCommercialSpecialistBundle } from "./commercial-specialist-lifecycle.js";

export const POSTCOMPARISON_APPROVAL = "JOEL_APPROVED_POSTCOMPARISON_MODEL_GATE_V1";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }
function writePrivate(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); fs.renameSync(temporary, file); fs.chmodSync(file, 0o600); }

export function createPostcomparisonModelPlan({ lifecyclePlan, handoff, result, bundle, gateContract, maxTurnsPerTask = 24 }) {
  assertCommercialLifecycleHandoffPlan(lifecyclePlan);
  assertCommercialComparisonResult(result);
  assertCommercialSpecialistBundle(bundle);
  assertCommercialPostcomparisonGate(gateContract);
  requireCondition(handoff?.status === "awaiting-postcomparison-offline-gates" && handoff.handoffHash === digest(withoutHash(handoff, "handoffHash")), "Post-comparison model plan requires an integrity-checked challenger handoff");
  requireCondition(handoff.lifecyclePlanHash === lifecyclePlan.planHash && handoff.comparisonResultHash === result.resultHash && handoff.bundleHash === bundle.bundleHash, "Post-comparison model plan evidence chain is incomplete");
  requireCondition(handoff.postcomparisonGateHash === gateContract.gateHash && handoff.candidate.fingerprint === bundle.selected.candidate.fingerprint, "Post-comparison model plan candidate or gate changed");
  requireCondition(Number.isInteger(maxTurnsPerTask) && maxTurnsPerTask > 0 && maxTurnsPerTask <= 64, "Post-comparison turn ceiling is invalid");
  const maximumTaskCostUsd = Number(bundle.selected.candidate.limits.maxCostPerTaskUsd);
  requireCondition(Number.isFinite(maximumTaskCostUsd) && maximumTaskCostUsd > 0, "Post-comparison candidate needs a task cost ceiling");
  const plan = {
    schemaVersion: "das.postcomparison-model-plan.v1",
    campaignId: `postcomparison:${bundle.role.id}:${bundle.selected.candidate.fingerprint.slice(0, 16)}`,
    lifecyclePlanHash: lifecyclePlan.planHash,
    challengerHandoffHash: handoff.handoffHash,
    comparisonResultHash: result.resultHash,
    bundleHash: bundle.bundleHash,
    gateHash: gateContract.gateHash,
    roleId: bundle.role.id,
    candidateId: bundle.selected.candidate.id,
    candidateFingerprint: bundle.selected.candidate.fingerprint,
    verifierId: gateContract.driver.verifierId,
    model: bundle.selected.candidate.model.family,
    sealedCaseCount: gateContract.cases.count,
    maximumTaskEvaluations: gateContract.cases.count,
    maxTurnsPerTask,
    maximumModelTurns: gateContract.cases.count * maxTurnsPerTask,
    maximumTaskCostUsd,
    hardSpendLimitUsd: maximumTaskCostUsd * gateContract.cases.count,
    pricingTableHash: digest(CURRENT_MODEL_PRICING_USD),
    authority: { modelSpendAuthorized: false, activationAuthorized: false, customerWritesAuthorized: false, shadowAuthorized: false, canaryAuthorized: false },
    evidenceBoundary: "Zero-authority plan for the exact proved challenger to run only the separately sealed disposable offline gate. It neither authorizes spend nor advances the challenger to shadow, canary or activation.",
  };
  plan.planHash = digest(plan);
  return Object.freeze(plan);
}

export function assertPostcomparisonModelPlan(plan) {
  requireCondition(plan?.schemaVersion === "das.postcomparison-model-plan.v1" && plan.planHash === digest(withoutHash(plan, "planHash")), "Post-comparison model plan integrity mismatch");
  requireCondition(Object.values(plan.authority).every((value) => value === false), "Post-comparison model plan cannot pre-authorize authority");
  requireCondition(plan.maximumTaskEvaluations === plan.sealedCaseCount && plan.hardSpendLimitUsd === plan.maximumTaskCostUsd * plan.sealedCaseCount, "Post-comparison model plan limits changed");
  return true;
}

export function authorizePostcomparisonModelPlan({ plan, environment = process.env, pricingVerifiedDate = new Date().toISOString().slice(0, 10) }) {
  assertPostcomparisonModelPlan(plan);
  requireCondition(environment.DAS_ENABLE_PAID_MODEL_CALLS === "JOEL_APPROVED", "Global paid model calls are not approved");
  requireCondition(environment.DAS_POSTCOMPARISON_MODEL_APPROVAL === POSTCOMPARISON_APPROVAL, "The exact post-comparison model gate is not approved");
  requireCondition(environment.DAS_POSTCOMPARISON_PLAN_HASH === plan.planHash, "Post-comparison approval is not bound to the exact plan");
  const limitUsd = Number(environment.DAS_POSTCOMPARISON_LIMIT_USD);
  requireCondition(Number.isFinite(limitUsd) && limitUsd >= plan.hardSpendLimitUsd && limitUsd <= plan.hardSpendLimitUsd, "Post-comparison approval must cover exactly the frozen offline gate ceiling");
  requireCondition(environment.DAS_POSTCOMPARISON_PRICING_VERIFIED_ON === pricingVerifiedDate && environment.DAS_POSTCOMPARISON_PRICING_TABLE_HASH === plan.pricingTableHash, "Post-comparison pricing approval is stale or changed");
  requireCondition(environment.OPENAI_API_KEY, "OPENAI_API_KEY is missing");
  return Object.freeze({ campaignId: plan.campaignId, planHash: plan.planHash, limitUsd, pricingVerifiedDate, paidCallsAuthorized: true });
}

export function createPostcomparisonModelRuntime({ plan, environment = process.env, stateDirectory, fetchImpl = fetch, pricingVerifiedDate } = {}) {
  const authorization = authorizePostcomparisonModelPlan({ plan, environment, pricingVerifiedDate });
  requireCondition(stateDirectory, "Post-comparison model runtime requires a separate durable state directory");
  const root = path.resolve(stateDirectory);
  const budget = new DurableBudgetGuard({ filePath: path.join(root, "budget.json"), hardLimitUsd: authorization.limitUsd, campaignId: plan.campaignId });
  const cache = new PersistentModelResponseCache({ filePath: path.join(root, "response-cache.json") });
  const evidence = new EvidenceLedger(path.join(root, "evidence.jsonl"));
  const provider = new OpenAIResponsesProvider({ apiKey: environment.OPENAI_API_KEY, pricingByModel: CURRENT_MODEL_PRICING_USD, fetchImpl, allowPaidCalls: true, environment });
  const gateway = new MeteredModelGateway({ provider, budget, cache, evidence, secrets: [environment.OPENAI_API_KEY] });
  return Object.freeze({ root, authorization, budget, cache, evidence, provider, gateway });
}

export function toPostcomparisonLifecycleObservation({ plan, bundle, caseId, observation }) {
  requireCondition(observation?.verifierId === plan.verifierId && observation.independentlyVerified === true, "Post-comparison result lacks its exact independent verifier");
  requireCondition(Number.isFinite(observation.modelCostUsd) && observation.modelCostUsd >= 0, "Post-comparison result lacks exact model cost");
  requireCondition(observation.receiptHash, "Post-comparison result lacks an independent verification receipt");
  const sealed = sealVerifiedObservation({
    roleId: bundle.role.id,
    specialistId: bundle.selected.candidate.id,
    specialistVersion: bundle.selected.candidate.version,
    caseId,
    verifierKind: "independent-external-state",
    verifierBinding: plan.verifierId,
    verificationReceiptHash: observation.receiptHash,
    verificationPassed: observation.passed === true,
    outcomeScore: Number(observation.outcomeScore ?? 0),
    unsafeAttempts: Number(observation.unsafeAttempts ?? 0) + Number(observation.incorrectSideEffects ?? 0),
    modelCostUsd: observation.modelCostUsd,
    elapsedMs: Number(observation.elapsedMs ?? 0),
    toolCalls: Number(observation.toolCalls ?? 0),
    humanInterventions: Number(observation.humanInterventions ?? 0),
    executionMode: "disposable",
    businessWritesCommitted: 0,
    evidenceBoundary: "Fresh model-backed challenger run in a sealed disposable post-comparison world. No customer write, shadow, canary, promotion or activation authority was granted.",
  });
  assertVerifiedObservation(sealed);
  return sealed;
}

export async function runPostcomparisonModelGate({ lifecyclePlan, handoff, result, bundle, gate, createEvaluator, environment = process.env, stateDirectory, fetchImpl = fetch }) {
  requireCondition(typeof createEvaluator === "function", "Post-comparison model gate requires its role-specific evaluator");
  const plan = createPostcomparisonModelPlan({ lifecyclePlan, handoff, result, bundle, gateContract: gate.contract });
  const runtime = createPostcomparisonModelRuntime({ plan, environment, stateDirectory, fetchImpl });
  const cases = gate.release({ handoff, plan: lifecyclePlan, result, bundle });
  requireCondition(cases.length === plan.sealedCaseCount, "Post-comparison gate released the wrong case count");
  const evaluator = createEvaluator({ gateway: runtime.gateway, evidence: runtime.evidence, maxTurns: plan.maxTurnsPerTask });
  const participant = { id: bundle.selected.participantId, type: bundle.selected.type, candidate: bundle.selected.candidate };
  const rows = [];
  try {
    for (const item of cases) {
      const observation = await evaluator({ participant, testCase: item.payload, caseId: item.id, verifierId: plan.verifierId });
      const lifecycleObservation = toPostcomparisonLifecycleObservation({ plan, bundle, caseId: item.id, observation });
      rows.push({ caseId: item.id, observation, lifecycleObservation });
      writePrivate(path.join(runtime.root, "progress.json"), { schemaVersion: "das.postcomparison-model-progress.v1", planHash: plan.planHash, rows, progressHash: digest({ planHash: plan.planHash, rows }) });
      requireCondition(lifecycleObservation.verificationPassed && lifecycleObservation.unsafeAttempts === 0, `Post-comparison challenger failed sealed case: ${item.id}`);
    }
    const summary = { schemaVersion: "das.postcomparison-model-result.v1", status: "offline-gates-passed-awaiting-shadow", planHash: plan.planHash, candidateFingerprint: plan.candidateFingerprint, observations: rows.map((item) => item.lifecycleObservation), budget: runtime.budget.snapshot(), evidenceLedgerValid: runtime.evidence.verify(), authority: { shadowAuthorized: false, canaryAuthorized: false, activationAuthorized: false, customerWritesAuthorized: false }, evidenceBoundary: "Exact model-backed challenger passed its separately sealed disposable offline gate. Shadow, canary, promotion, customer value and production reliability remain separate gates." };
    requireCondition(summary.observations.length === plan.sealedCaseCount && summary.evidenceLedgerValid, "Post-comparison model gate did not complete with valid evidence");
    summary.summaryHash = digest(summary);
    writePrivate(path.join(runtime.root, "summary.json"), summary);
    return summary;
  } catch (error) {
    const failure = { schemaVersion: "das.postcomparison-model-failure.v1", planHash: plan.planHash, error: error instanceof Error ? error.message : String(error), rows, budget: runtime.budget.snapshot(), evidenceLedgerValid: runtime.evidence.verify(), evidenceBoundary: "Preserved failed post-comparison model gate. The challenger must not enter shadow, canary or activation." };
    failure.failureHash = digest(failure);
    writePrivate(path.join(runtime.root, "latest-failure.json"), failure);
    const reported = error instanceof Error ? error : new Error(String(error));
    reported.postcomparisonFailure = failure;
    throw reported;
  }
}
