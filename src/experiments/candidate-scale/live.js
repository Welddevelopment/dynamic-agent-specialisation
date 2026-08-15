import fs from "node:fs";
import path from "node:path";
import { createCaseVault } from "../../evaluation/case-vault.js";
import { DurableBudgetGuard, PersistentModelResponseCache } from "../../core/durable-model-campaign.js";
import { EvidenceLedger } from "../../core/evidence.js";
import { MeteredModelGateway } from "../../core/model-gateway.js";
import { OpenAIResponsesProvider } from "../../providers/openai-responses.js";
import { CURRENT_MODEL_PRICING_USD } from "../../providers/model-pricing.js";
import { createCommercialSupportModelEvaluator, createCommercialSupportPack } from "../../product/commercial-support-pack.js";
import { generateBatchedCandidatePortfolio, CandidateScaleModelBatchArchitect } from "./batched-architect.js";
import { assertCandidateScaleLiveAuthorization } from "./execution-plan.js";
import { CandidateScaleFunnel } from "./funnel.js";
import { assertCandidateScaleLiveCasePack, candidateScaleCasePackHash } from "./live-case-pack.js";
import { analyzeCandidateScalingCurve } from "./scaling-analysis.js";

const root = path.resolve("artifacts/candidate-scale/v1");
const planPath = path.join(root, "live-execution-plan.json");
const casePackPath = path.join(root, "private-live-case-pack.json");
if (!fs.existsSync(planPath) || !fs.existsSync(casePackPath)) throw new Error("Seal a fresh private case pack and live execution plan before candidate-scale launch");
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const casePack = JSON.parse(fs.readFileSync(casePackPath, "utf8"));
const pack = createCommercialSupportPack();
const role = pack.roleDraft.compiled.brief;
assertCandidateScaleLiveCasePack(casePack, { roleId: role.id, verifierId: pack.driver.verifier.id });
if (candidateScaleCasePackHash(casePack) !== plan.casePackHash) throw new Error("Candidate-scale live plan is not bound to this private case pack");
const authorization = assertCandidateScaleLiveAuthorization({ plan });

const state = path.join(root, "model-campaign");
fs.mkdirSync(state, { recursive: true });
const budget = new DurableBudgetGuard({ filePath: path.join(state, "budget.json"), hardLimitUsd: authorization.limitUsd, campaignId: plan.campaignId });
const cache = new PersistentModelResponseCache({ filePath: path.join(state, "response-cache.json") });
const evidence = new EvidenceLedger(path.join(state, "evidence.jsonl"));
const provider = new OpenAIResponsesProvider({
  apiKey: process.env.OPENAI_API_KEY,
  pricingByModel: CURRENT_MODEL_PRICING_USD,
  allowPaidCalls: true,
  environment: process.env,
  modelMap: { "candidate-architect-policy": "gpt-5.6-terra" },
});
const gateway = new MeteredModelGateway({ provider, budget, cache, evidence, secrets: [process.env.OPENAI_API_KEY] });
const architect = new CandidateScaleModelBatchArchitect({ gateway });
const generated = await generateBatchedCandidatePortfolio({
  brief: role,
  architect,
  targetCount: plan.targetCount,
  batchSize: plan.batchSize,
  executionModel: { family: "gpt-5.6-luna", tier: "normalized-scale-execution" },
  maximumWallClockMs: plan.maximumWallClockMs,
});
if (generated.candidates.length !== plan.targetCount) throw new Error(`Candidate-scale architect produced only ${generated.candidates.length}/${plan.targetCount} valid packages; preserve the failed run and do not weaken validation`);

const evaluators = Object.fromEntries(Object.entries(plan.maximumTurns).map(([stage, maxTurns]) => [stage, createCommercialSupportModelEvaluator({ gateway, evidence, maxTurns })]));
const evaluate = async ({ candidate, stage, ...input }) => {
  const evaluator = evaluators[stage];
  if (!evaluator) throw new Error(`Candidate-scale stage has no bounded evaluator: ${stage}`);
  const callsBefore = budget.calls.length;
  const observation = await evaluator({ participant: { id: candidate.id, candidate }, stage, ...input });
  return { ...observation, modelCalls: budget.calls.length - callsBefore };
};
const funnel = new CandidateScaleFunnel({ evaluate, verifierId: pack.driver.verifier.id, evidence });
const holdoutVault = createCaseVault(`candidate-scale:${role.id}:holdout`, casePack.cases.holdout);
const repeatVault = createCaseVault(`candidate-scale:${role.id}:repeat`, casePack.cases.repeat);
const result = await funnel.run({
  brief: role,
  candidates: generated.candidates,
  cases: {
    viability: casePack.cases.viability.map((payload) => ({ id: payload.id, payload })),
    development: casePack.cases.development.map((payload) => ({ id: payload.id, payload })),
    validation: casePack.cases.validation.map((payload) => ({ id: payload.id, payload })),
    adversarial: casePack.cases.adversarial.map((payload) => ({ id: payload.id, payload })),
  },
  holdoutVault,
  repeatVault,
  baselineHashes: casePack.baselineHashes,
  stageLimits: plan.stageSurvivors,
  maximumSpendUsd: authorization.limitUsd,
  maximumWallClockMs: plan.maximumWallClockMs,
});
const viability = result.history.find((stage) => stage.stage === "viability");
const curve = analyzeCandidateScalingCurve({ candidates: generated.candidates, comparableSummaries: viability.summaries, randomTrials: 1_000, seed: plan.planHash });
const output = { planHash: plan.planHash, casePackHash: plan.casePackHash, portfolio: generated.receipt, result, curve, budget: budget.snapshot(), evidenceLedgerValid: evidence.verify() };
output.outputHash = (await import("../../core/canonical.js")).digest(output);
fs.writeFileSync(path.join(state, "completed-result.json"), `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ status: "candidate-scale-model-campaign-complete", selectedCandidateId: result.selectedCandidateId, spendUsd: budget.spentUsd, planHash: plan.planHash, outputHash: output.outputHash }, null, 2)}\n`);
