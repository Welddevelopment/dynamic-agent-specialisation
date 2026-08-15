import fs from "node:fs";
import path from "node:path";
import { digest } from "../../core/canonical.js";
import { withCampaignWriterLock } from "../../core/campaign-writer-lock.js";
import { DurableBudgetGuard, PersistentModelResponseCache } from "../../core/durable-model-campaign.js";
import { EvidenceLedger } from "../../core/evidence.js";
import { MeteredModelGateway } from "../../core/model-gateway.js";
import { createCommercialSupportPack } from "../../product/commercial-support-pack.js";
import { generateBatchedCandidatePortfolio } from "./batched-architect.js";
import { assertPairedCampaignClock, createPairedCampaignClock, pairedCampaignRemainingMs } from "./paired-campaign-clock.js";
import { PairedScaleOpenAIProvider } from "./paired-openai-provider.js";
import { PAIRED_SCALE_ARTIFACT_ROOT } from "./paired-protocol.js";
import { freezePairedStructuralSelection } from "./paired-selection.js";
import { PAIRED_V6_ARTIFACT_ROOT, V5_BUDGET_SOURCE_HASH, V5_FAILURE_RECEIPT_HASH, V5_PRIOR_SPEND_USD } from "./paired-v6-protocol.js";
import { PairedV7ModelBatchArchitect } from "./paired-v7-architect.js";
import { assertPairedV7ContextInvariant } from "./paired-v7-contract.js";
import { assertPairedV7PrivateCasePack, pairedV7PrivateCasePackHash } from "./paired-v7-private-case-pack.js";
import { assertPairedV7Authorization, createPairedV7ProtocolCore, PAIRED_V7_ARTIFACT_ROOT, V6_CONSERVATIVE_SPEND_UPPER_BOUND_USD, V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH, V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD } from "./paired-v7-protocol.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function writePrivate(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); const temporary = `${filePath}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" }); fs.renameSync(temporary, filePath); fs.chmodSync(filePath, 0o600); }
function verifyReceipt(value, key = "receiptHash") { const copy = structuredClone(value); const expected = copy[key]; delete copy[key]; return Boolean(expected) && digest(copy) === expected; }

const root = path.resolve(PAIRED_V7_ARTIFACT_ROOT);
const state = path.join(root, "model-campaign");
const plan = JSON.parse(fs.readFileSync(path.join(root, "live-plan.json"), "utf8"));
const casePack = JSON.parse(fs.readFileSync(path.join(root, "private-case-pack.json"), "utf8"));
const v5Failure = JSON.parse(fs.readFileSync(path.resolve(PAIRED_SCALE_ARTIFACT_ROOT, "model-campaign/generation-failure-receipt.json"), "utf8"));
const v6InfrastructureFailure = JSON.parse(fs.readFileSync(path.resolve(PAIRED_V6_ARTIFACT_ROOT, "infrastructure-failure-receipt.json"), "utf8"));
const v5FailureCopy = structuredClone(v5Failure); delete v5FailureCopy.receiptHash;
requireCondition(v5Failure.receiptHash === V5_FAILURE_RECEIPT_HASH && digest(v5FailureCopy) === v5Failure.receiptHash && v5Failure.sourceBindings.budgetSha256 === V5_BUDGET_SOURCE_HASH && v5Failure.actualSpendUsd === V5_PRIOR_SPEND_USD, "V7 launch V5 failure/spend binding changed");
requireCondition(verifyReceipt(v6InfrastructureFailure) && v6InfrastructureFailure.receiptHash === V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH, "V7 launch V6 infrastructure-failure binding changed");
requireCondition(v6InfrastructureFailure.scientificResultUsable === false && v6InfrastructureFailure.performanceEvaluationStarted === false && v6InfrastructureFailure.accounting.conservativeProviderSpendUpperBoundUsd === V6_CONSERVATIVE_SPEND_UPPER_BOUND_USD, "V7 launch V6 failure boundary changed");
const protocol = createPairedV7ProtocolCore();
assertPairedV7PrivateCasePack(casePack, { protocol });
requireCondition(pairedV7PrivateCasePackHash(casePack) === plan.casePackHash, "V7 plan/private pack binding mismatch");
const authorization = assertPairedV7Authorization({ plan, environment: process.env, currentUtcDate: new Date().toISOString().slice(0, 10) });

const summary = await withCampaignWriterLock({ stateDirectory: state, campaignId: protocol.campaignId, runnerVersion: "paired-v7-generation.v1" }, async (writerLock) => {
  const forbiddenOutputs = ["generated-portfolio.json", "generation-checkpoint.json", "structural-selection-freeze.json", "single-writer-generation-receipt.json"];
  requireCondition(forbiddenOutputs.every((name) => !fs.existsSync(path.join(state, name))), "V7 already has a sealed generation output; preserve it instead of overwriting");
  const clockPath = path.join(state, "campaign-clock.json");
  const campaignClock = fs.existsSync(clockPath) ? JSON.parse(fs.readFileSync(clockPath, "utf8")) : createPairedCampaignClock({ planHash: plan.planHash });
  assertPairedCampaignClock(campaignClock, { planHash: plan.planHash });
  if (!fs.existsSync(clockPath)) writePrivate(clockPath, campaignClock);
  const budget = new DurableBudgetGuard({ filePath: path.join(state, "budget.json"), hardLimitUsd: authorization.limitUsd, campaignId: protocol.campaignId });
  const cache = new PersistentModelResponseCache({ filePath: path.join(state, "response-cache.json") });
  const evidence = new EvidenceLedger(path.join(state, "evidence.jsonl"));
  const provider = new PairedScaleOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY, pricingByModel: protocol.pricing.models, modelMap: { "candidate-architect-policy": protocol.generation.architectModel }, environment: process.env });
  const gateway = new MeteredModelGateway({ provider, budget, cache, evidence, secrets: [process.env.OPENAI_API_KEY] });
  const architect = new PairedV7ModelBatchArchitect({ gateway, maxOutputTokens: protocol.generation.maxOutputTokensPerArchitectBatch, reasoningEffort: protocol.generation.architectReasoningEffort });
  const brief = createCommercialSupportPack().roleDraft.compiled.brief;
  const generated = await generateBatchedCandidatePortfolio({
    brief,
    architect,
    targetCount: protocol.targetCandidateCount,
    batchSize: protocol.batchSize,
    executionModel: { family: protocol.generation.executionModel, tier: "paired-v6-normalized-execution" },
    maximumWallClockMs: pairedCampaignRemainingMs(campaignClock, protocol.budget.maximumWallClockMs),
    onBatch: async (batch) => writePrivate(path.join(state, "generation-progress.json"), { planHash: plan.planHash, writerLockHash: writerLock.metadata.integrityHash, completedBatch: batch.batchIndex, batchHash: batch.batchHash, contextMode: batch.modelReceipt.contextMode, budget: budget.snapshot() }),
  });
  requireCondition(generated.receipt.returnedCount === 150 && generated.candidates.length === 150 && generated.rejected.length === 0, `V7 produced ${generated.candidates.length}/150 valid packages; preserve the negative result and do not evaluate`);
  for (const candidate of generated.candidates) assertPairedV7ContextInvariant(candidate, brief);
  requireCondition(evidence.verify(), "V7 evidence ledger is not one intact linear chain");
  const budgetSnapshot = budget.snapshot();
  requireCondition(budgetSnapshot.reservedUsd === 0 && budgetSnapshot.calls.every((call) => call.status === "settled"), "V7 generation has unresolved reservations");
  const selection = freezePairedStructuralSelection({ candidates: generated.candidates, brief, prefixCount: protocol.prefixCandidateCount, globalCount: protocol.structuralScreen.globalFinalistCount, meaningfulDistance: protocol.structuralScreen.meaningfulDistanceThreshold });
  const portfolio = {
    schemaVersion: "das.candidate-scale-paired-generated-portfolio.v7-single-writer-recovery",
    planHash: plan.planHash,
    protocolCoreHash: protocol.protocolCoreHash,
    roleHash: protocol.bindings.roleHash,
    model: protocol.generation.architectModel,
    candidates: generated.candidates,
    rejected: generated.rejected,
    receipt: generated.receipt,
    v5FailureReceiptHash: V5_FAILURE_RECEIPT_HASH,
    v6InfrastructureFailureReceiptHash: V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH,
    v6ConservativeSpendUpperBoundUsd: V6_CONSERVATIVE_SPEND_UPPER_BOUND_USD,
    priorSharedSpendUpperBoundUsd: V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD,
    cumulativePriorAndV7SpendUsd: V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD + budget.spentUsd,
    writerLockHash: writerLock.metadata.integrityHash,
    budget: budgetSnapshot,
    evidenceLedgerValid: true,
  };
  portfolio.integrityHash = digest(portfolio);
  const checkpoint = {
    schemaVersion: "das.candidate-scale-paired-generation-checkpoint.v7-single-writer-recovery",
    planHash: plan.planHash,
    protocolCoreHash: protocol.protocolCoreHash,
    casePackHash: plan.casePackHash,
    pricingHash: protocol.pricingHash,
    generationReceiptHash: digest(generated.receipt),
    portfolioIntegrityHash: portfolio.integrityHash,
    firstFiveCandidateIds: selection.firstFiveCandidateIds,
    globalFinalistIds: selection.globalFinalistIds,
    protectedFirstFiveFinalistIds: selection.protectedFirstFiveFinalistIds,
    evaluationUnionIds: selection.evaluationUnionIds,
    structuralSelectionFreezeHash: selection.freezeHash,
    generatedCount: 150,
    validCount: 150,
    rejectedCount: 0,
    exactUniqueCount: selection.exactUniqueCount,
    exactDuplicateCount: selection.exactDuplicates.length,
    v6InfrastructureFailureReceiptHash: V6_INFRASTRUCTURE_FAILURE_RECEIPT_HASH,
    v6ConservativeSpendUpperBoundUsd: V6_CONSERVATIVE_SPEND_UPPER_BOUND_USD,
    priorSharedSpendUpperBoundUsd: V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD,
    writerLockHash: writerLock.metadata.integrityHash,
    budget: budgetSnapshot,
    cumulativePriorAndV7SpendUsd: V7_PRIOR_SHARED_SPEND_UPPER_BOUND_USD + budget.spentUsd,
    evidenceLedgerValid: true,
  };
  checkpoint.integrityHash = digest(checkpoint);
  const writerReceipt = {
    schemaVersion: "das.candidate-scale-paired-single-writer-generation-receipt.v7-single-writer-recovery",
    planHash: plan.planHash,
    campaignId: protocol.campaignId,
    writerLockHash: writerLock.metadata.integrityHash,
    writerOwnerIdHash: digest(writerLock.metadata.ownerId),
    writerPid: writerLock.metadata.pid,
    acquiredAt: writerLock.metadata.acquiredAt,
    runnerVersion: writerLock.metadata.runnerVersion,
    checkpointIntegrityHash: checkpoint.integrityHash,
    evidenceLedgerValid: true,
    unresolvedReservations: 0,
    rule: "The exclusive lock was acquired before campaign-state construction and remained owned through the final portfolio/checkpoint writes. Normal wrapper exit releases it after this receipt is sealed.",
  };
  writerReceipt.receiptHash = digest(writerReceipt);
  writePrivate(path.join(state, "generated-portfolio.json"), portfolio);
  writePrivate(path.join(state, "structural-selection-freeze.json"), selection);
  writePrivate(path.join(state, "generation-checkpoint.json"), checkpoint);
  writePrivate(path.join(state, "single-writer-generation-receipt.json"), writerReceipt);
  return {
    status: "paired-v7-portfolio-generated-and-structurally-frozen",
    planHash: plan.planHash,
    generatedCount: checkpoint.generatedCount,
    validCount: checkpoint.validCount,
    exactUniqueCount: checkpoint.exactUniqueCount,
    evaluationUnionCount: selection.evaluationUnionIds.length,
    v7SpendUsd: budget.spentUsd,
    cumulativePriorAndV7SpendUsd: checkpoint.cumulativePriorAndV7SpendUsd,
    v7LimitUsd: budget.hardLimitUsd,
    structuralSelectionFreezeHash: selection.freezeHash,
    checkpointHash: checkpoint.integrityHash,
    writerReceiptHash: writerReceipt.receiptHash,
  };
});

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
