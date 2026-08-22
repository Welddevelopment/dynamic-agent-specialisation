import fs from "node:fs";
import path from "node:path";
import { DurableBudgetGuard, PersistentModelResponseCache } from "../../core/durable-model-campaign.js";
import { EvidenceLedger } from "../../core/evidence.js";
import { MeteredModelGateway } from "../../core/model-gateway.js";
import { withCampaignWriterLock } from "../../core/campaign-writer-lock.js";
import { OpenAIResponsesProvider } from "../../providers/openai-responses.js";
import { AdaptiveBaselinePair, assertAdaptiveBaselinePairResult } from "../../evaluation/adaptive-baseline-pair.js";
import { attestInstanceEntryPoint, attestorForSealedEntryPoints } from "../../evaluation/execution-attestation.js";
import { EngineeringKnowledgeBase } from "../../compiler/knowledge.js";
import { seedGeneralEngineeringKnowledge } from "../../compiler/default-knowledge.js";
import { analyzeDas004B2Result } from "../das004-b2/analyze-result.js";
import { LogicalCallGateway } from "../das004-b2/logical-call-gateway.js";
import { ModelAdaptiveDesigner } from "../das004-b2/model-adaptive-designer.js";
import { AccessOffboardingAdaptiveEvaluator } from "../das004-b2/model-offboarding-runner.js";
import { CompilerArchitectDesigner } from "./compiler-architect-designer.js";
import { assertDas004B3Authorization } from "./authorization.js";
import { assertDas004B3Preregistration, createDas004B3ProtocolBundle, DAS004_B3_ARTIFACT_ROOT, DAS004_B3_CAMPAIGN_ID, DAS004_B3_ENGINEERING_MODEL, DAS004_B3_EXECUTION_MODEL, DAS004_B3_PRICING_USD } from "./protocol.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function writePrivate(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, filePath); fs.chmodSync(filePath, 0o600);
}

const root = path.resolve(DAS004_B3_ARTIFACT_ROOT);
const state = path.join(root, "model-campaign");
const plan = assertDas004B3Preregistration(JSON.parse(fs.readFileSync(path.join(root, "plan.json"), "utf8")));
const authorization = assertDas004B3Authorization({ plan, environment: process.env });
const finalPath = path.join(root, "analysis.json");
requireCondition(!fs.existsSync(finalPath), "DAS-004/B3 analysis already exists; never overwrite a completed empirical result");

await withCampaignWriterLock({ stateDirectory: state, campaignId: DAS004_B3_CAMPAIGN_ID, runnerVersion: "das004-b3-runner-v1" }, async () => {
  const budget = new DurableBudgetGuard({ filePath: path.join(state, "budget.json"), hardLimitUsd: authorization.limitUsd, warningUsd: authorization.limitUsd * 0.8, campaignId: DAS004_B3_CAMPAIGN_ID });
  const before = budget.snapshot();
  requireCondition(before.calls.every((row) => !["reserved", "outcome-unknown"].includes(row.status)), "DAS-004/B3 has unresolved provider usage; reconcile it before any retry");
  requireCondition(before.spentUsd <= authorization.limitUsd, "DAS-004/B3 stored spend exceeds approval");
  const evidence = new EvidenceLedger(path.join(state, "evidence.jsonl"));

  // Both arms engineer on the same model. The compiler's internal policy names are mapped
  // onto it so neither arm gets a cheaper or stronger engine than the other.
  const modelMap = {
    "candidate-architect-policy": DAS004_B3_ENGINEERING_MODEL,
    "candidate-refiner-policy": DAS004_B3_ENGINEERING_MODEL,
  };
  const gatewaysByArm = {};
  for (const armId of plan.protocol.arms) {
    const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricingByModel: DAS004_B3_PRICING_USD, allowPaidCalls: true, environment: process.env, serviceTier: "default", modelMap });
    const cache = new PersistentModelResponseCache({ filePath: path.join(state, `${armId}-response-cache.json`) });
    gatewaysByArm[armId] = new LogicalCallGateway(new MeteredModelGateway({ provider, budget, cache, evidence, secrets: [process.env.OPENAI_API_KEY] }));
  }

  const bundle = createDas004B3ProtocolBundle();
  requireCondition(bundle.protocol.protocolHash === plan.protocol.protocolHash, "Runtime protocol differs from preregistration");

  const attestor = await attestorForSealedEntryPoints(plan.armEntryPoints, { repositoryRoot: process.cwd() });
  const knowledge = new EngineeringKnowledgeBase();
  seedGeneralEngineeringKnowledge(knowledge);

  // das  -> the real compiler. adaptive-engineer -> the unconstrained designer.
  // The attested entry point is installed on the instance the runner actually calls.
  const compilerDesigner = new CompilerArchitectDesigner({
    armId: "das",
    brief: bundle.brief,
    gateway: gatewaysByArm.das,
    executionModelFamily: DAS004_B3_EXECUTION_MODEL,
    minimumCandidates: 2,
    knowledgeEntries: knowledge.query(["general", "operations", "identity-access"]),
  });
  attestInstanceEntryPoint(attestor, "das", compilerDesigner.architect);
  const adaptiveDesigner = new ModelAdaptiveDesigner({ armId: "adaptive-engineer", brief: bundle.brief, gateway: gatewaysByArm["adaptive-engineer"], engineeringModel: DAS004_B3_ENGINEERING_MODEL });
  attestInstanceEntryPoint(attestor, "adaptive-engineer", adaptiveDesigner);
  const designers = { das: compilerDesigner, "adaptive-engineer": adaptiveDesigner };

  const evaluator = new AccessOffboardingAdaptiveEvaluator({ gatewaysByArm, evidence });
  const pair = new AdaptiveBaselinePair({ protocol: bundle.protocol, brief: bundle.brief, designers, developmentEvaluator: evaluator, confirmationEvaluator: evaluator, evidence });
  const startedAt = new Date().toISOString();
  evidence.append("das004-b3.campaign-started", { planHash: plan.planHash, protocolHash: plan.protocol.protocolHash, priorSettledSpendUsd: before.spentUsd, distinctArmEntryPoints: plan.distinctArmEntryPoints });

  const pairResult = assertAdaptiveBaselinePairResult(await pair.run({ importedAgent: bundle.importedAgent, developmentCases: bundle.developmentCases, confirmationVault: bundle.confirmationVault }), bundle.protocol);

  // THE GATE. Nothing below this line may be quoted if the declared code did not run.
  attestor.assertAllReached();
  const attestation = attestor.receipt();
  requireCondition(attestation.declarationsVerified, "DAS-004/B3 execution attestation was not verified against the declared modules");
  evidence.append("das004-b3.execution-attested", { attestationHash: attestation.attestationHash, arms: attestation.arms });

  const budgetSnapshot = budget.snapshot();
  requireCondition(budgetSnapshot.calls.every((row) => !["reserved", "outcome-unknown"].includes(row.status)), "DAS-004/B3 ended with unresolved provider usage");
  const completedAt = new Date().toISOString();
  const analysis = analyzeDas004B2Result({ plan, pairResult, budget: budgetSnapshot, confirmationReleaseCount: bundle.confirmationVault.releaseCount(), startedAt, completedAt });
  evidence.append("das004-b3.campaign-completed", { pairResultHash: pairResult.resultHash, analysisHash: analysis.analysisHash, verdict: analysis.verdict, spendUsd: budgetSnapshot.spentUsd });
  requireCondition(evidence.verify(), "DAS-004/B3 evidence ledger failed integrity verification");

  writePrivate(path.join(root, "execution-attestation.json"), attestation);
  writePrivate(path.join(root, "pair-result.json"), pairResult);
  writePrivate(finalPath, analysis);
  writePrivate(path.join(root, "completion-receipt.json"), {
    schemaVersion: "das.das004-b3-completion-receipt.v1",
    campaignId: plan.campaignId,
    planHash: plan.planHash,
    pairResultHash: pairResult.resultHash,
    analysisHash: analysis.analysisHash,
    evidenceRecords: evidence.records().length,
    evidenceTailHash: evidence.records().at(-1)?.hash ?? null,
    spendUsd: budgetSnapshot.spentUsd,
    reservedUsd: budgetSnapshot.reservedUsd,
    settledCalls: budgetSnapshot.calls.filter((row) => row.status === "settled").length,
    cancelledCalls: budgetSnapshot.calls.filter((row) => row.status === "cancelled").length,
    verdict: analysis.verdict,
    executionAttestation: attestation,
    distinctArmEntryPoints: plan.distinctArmEntryPoints,
    compilerCalls: compilerDesigner.calls,
    automaticActivation: false,
  });
  process.stdout.write(`${JSON.stringify({ status: "complete", verdict: analysis.verdict, materiallyBetterArm: analysis.materiallyBetterArm, spendUsd: budgetSnapshot.spentUsd, settledCalls: budgetSnapshot.calls.filter((row) => row.status === "settled").length, attestationHash: attestation.attestationHash, artifactRoot: root }, null, 2)}\n`);
});
