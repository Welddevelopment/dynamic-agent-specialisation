import fs from "node:fs";
import path from "node:path";
import { digest } from "../../core/canonical.js";
import { DurableBudgetGuard, PersistentModelResponseCache } from "../../core/durable-model-campaign.js";
import { EvidenceLedger } from "../../core/evidence.js";
import { MeteredModelGateway } from "../../core/model-gateway.js";
import { createCommercialSupportPack } from "../../product/commercial-support-pack.js";
import { CandidateScaleModelBatchArchitect, generateBatchedCandidatePortfolio } from "./batched-architect.js";
import { assertPairedPrivateCasePack, pairedPrivateCasePackHash } from "./paired-private-case-pack.js";
import { PairedScaleOpenAIProvider } from "./paired-openai-provider.js";
import { assertPairedScaleAuthorization, createPairedScaleProtocolCore, PAIRED_SCALE_ARTIFACT_ROOT } from "./paired-protocol.js";
import { freezePairedStructuralSelection } from "./paired-selection.js";
import { assertPairedCampaignClock, createPairedCampaignClock, pairedCampaignRemainingMs } from "./paired-campaign-clock.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function writePrivate(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); const temporary = `${filePath}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); fs.renameSync(temporary, filePath); fs.chmodSync(filePath, 0o600); }

const root = path.resolve(PAIRED_SCALE_ARTIFACT_ROOT); const state = path.join(root, "model-campaign");
const planPath = path.join(root, "live-plan.json"); const casePackPath = path.join(root, "private-case-pack.json");
requireCondition(fs.existsSync(planPath) && fs.existsSync(casePackPath), "Prepare and seal the paired plan/private cases before generation");
const plan = JSON.parse(fs.readFileSync(planPath, "utf8")); const casePack = JSON.parse(fs.readFileSync(casePackPath, "utf8")); const protocol = createPairedScaleProtocolCore();
assertPairedPrivateCasePack(casePack, { protocol }); requireCondition(pairedPrivateCasePackHash(casePack) === plan.casePackHash, "Paired plan is not bound to this private case pack");
const currentUtcDate = new Date().toISOString().slice(0, 10); const authorization = assertPairedScaleAuthorization({ plan, environment: process.env, currentUtcDate });
fs.mkdirSync(state, { recursive: true });
const clockPath = path.join(state, "campaign-clock.json");
const campaignClock = fs.existsSync(clockPath) ? JSON.parse(fs.readFileSync(clockPath, "utf8")) : createPairedCampaignClock({ planHash: plan.planHash });
assertPairedCampaignClock(campaignClock, { planHash: plan.planHash }); if (!fs.existsSync(clockPath)) writePrivate(clockPath, campaignClock);
const budget = new DurableBudgetGuard({ filePath: path.join(state, "budget.json"), hardLimitUsd: authorization.limitUsd, campaignId: protocol.campaignId });
const cache = new PersistentModelResponseCache({ filePath: path.join(state, "response-cache.json") }); const evidence = new EvidenceLedger(path.join(state, "evidence.jsonl"));
const provider = new PairedScaleOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY, pricingByModel: protocol.pricing.models, modelMap: { "candidate-architect-policy": protocol.generation.architectModel }, environment: process.env });
const gateway = new MeteredModelGateway({ provider, budget, cache, evidence, secrets: [process.env.OPENAI_API_KEY] });
const architect = new CandidateScaleModelBatchArchitect({ gateway, maxOutputTokens: protocol.generation.maxOutputTokensPerArchitectBatch, reasoningEffort: protocol.generation.architectReasoningEffort });
const generated = await generateBatchedCandidatePortfolio({
  brief: createCommercialSupportPack().roleDraft.compiled.brief,
  architect,
  targetCount: protocol.targetCandidateCount,
  batchSize: protocol.batchSize,
  executionModel: { family: protocol.generation.executionModel, tier: "paired-normalized-execution" },
  maximumWallClockMs: pairedCampaignRemainingMs(campaignClock, protocol.budget.maximumWallClockMs),
  onBatch: async (batch) => writePrivate(path.join(state, "generation-progress.json"), { planHash: plan.planHash, completedBatch: batch.batchIndex, batchHash: batch.batchHash, budget: budget.snapshot() }),
});
requireCondition(generated.receipt.returnedCount === 150, "Architect did not return all 150 packages");
requireCondition(generated.candidates.length === 150 && generated.rejected.length === 0, `Architect produced ${generated.candidates.length}/150 valid packages; preserve this negative result and do not evaluate`);
const selection = freezePairedStructuralSelection({ candidates: generated.candidates, brief: createCommercialSupportPack().roleDraft.compiled.brief, prefixCount: protocol.prefixCandidateCount, globalCount: protocol.structuralScreen.globalFinalistCount, meaningfulDistance: protocol.structuralScreen.meaningfulDistanceThreshold });
const portfolio = { schemaVersion: "das.candidate-scale-paired-generated-portfolio.v1", planHash: plan.planHash, protocolCoreHash: protocol.protocolCoreHash, roleHash: protocol.bindings.roleHash, model: protocol.generation.architectModel, candidates: generated.candidates, rejected: generated.rejected, receipt: generated.receipt, budget: budget.snapshot(), evidenceLedgerValid: evidence.verify() };
portfolio.integrityHash = digest(portfolio);
const checkpoint = { schemaVersion: "das.candidate-scale-paired-generation-checkpoint.v1", planHash: plan.planHash, protocolCoreHash: protocol.protocolCoreHash, casePackHash: plan.casePackHash, pricingHash: protocol.pricingHash, generationReceiptHash: digest(generated.receipt), portfolioIntegrityHash: portfolio.integrityHash, firstFiveCandidateIds: selection.firstFiveCandidateIds, globalFinalistIds: selection.globalFinalistIds, protectedFirstFiveFinalistIds: selection.protectedFirstFiveFinalistIds, evaluationUnionIds: selection.evaluationUnionIds, structuralSelectionFreezeHash: selection.freezeHash, generatedCount: generated.receipt.returnedCount, validCount: generated.candidates.length, rejectedCount: generated.rejected.length, exactUniqueCount: selection.exactUniqueCount, exactDuplicateCount: selection.exactDuplicates.length, budget: budget.snapshot(), evidenceLedgerValid: evidence.verify() };
checkpoint.integrityHash = digest(checkpoint);
writePrivate(path.join(state, "generated-portfolio.json"), portfolio); writePrivate(path.join(state, "structural-selection-freeze.json"), selection); writePrivate(path.join(state, "generation-checkpoint.json"), checkpoint);
process.stdout.write(`${JSON.stringify({ status: "paired-portfolio-generated-and-structurally-frozen", planHash: plan.planHash, generatedCount: checkpoint.generatedCount, validCount: checkpoint.validCount, exactUniqueCount: checkpoint.exactUniqueCount, evaluationUnionCount: selection.evaluationUnionIds.length, spendUsd: budget.spentUsd, reservedUsd: budget.reservedUsd, budgetLimitUsd: budget.hardLimitUsd, structuralSelectionFreezeHash: selection.freezeHash, checkpointHash: checkpoint.integrityHash }, null, 2)}\n`);
