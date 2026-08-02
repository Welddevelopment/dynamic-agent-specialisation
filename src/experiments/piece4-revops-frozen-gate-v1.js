import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { paidCampaignState, settlePaidCampaign } from "../core/paid-campaign.js";
import { createPiece4RevopsBaselines } from "../evaluation/piece4-revops-baselines.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { realisticRevopsBrief } from "../roles/realistic-revops.js";
import { createRealisticRevopsUnseenVault, realisticRevopsCases } from "../worlds/realistic-revops-cases.js";
import { runModelRevopsCase, summarizeRevopsStage } from "./model-revops-runner.js";

const split = process.argv[2];
if (!['validation', 'adversarial'].includes(split)) throw new Error('Split must be validation or adversarial');
const attemptId = `piece4-revops-${split}-v1`;
const promotionPath = path.resolve('artifacts/runs/piece4-revops-model-promotion/v1/summary.json');
const validationPath = path.resolve('artifacts/runs/piece4-revops-validation/v1/summary.json');
const outputDir = path.resolve(`artifacts/runs/piece4-revops-${split}/v1`);
const pricing = { inputPerMillionUsd: .2, cachedInputPerMillionUsd: .02, outputPerMillionUsd: 1.2 };
const contractFiles = [
  'src/compiler/candidate.js',
  'src/runtime/agent-runtime.js',
  'src/runtime/model-decision-engine.js',
  'src/runtime/memory.js',
  'src/worlds/realistic-revops-company.js',
  'src/worlds/realistic-revops-cases.js',
  'src/experiments/model-revops-runner.js',
];

if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== 'JOEL_APPROVED' || !process.env.OPENAI_API_KEY) throw new Error('Approved paid model environment is required');
const promotion = JSON.parse(fs.readFileSync(promotionPath, 'utf8'));
if (!promotion.advance || promotion.selectedId !== 'revops-v3-compiler-candidate-3:model-terra') throw new Error('Expected perfect selected Terra compiler candidate');
if (split === 'adversarial') {
  const validation = JSON.parse(fs.readFileSync(validationPath, 'utf8'));
  if (!validation.advance) throw new Error('Frozen RevOps validation must pass first');
}
const candidate = promotion.selectedCandidate;
const baselines = createPiece4RevopsBaselines();
const prospective = createRealisticRevopsUnseenVault();
const freeze = {
  schemaVersion: 1,
  roleId: realisticRevopsBrief.id,
  candidateHash: digest(candidate),
  baselineHashes: Object.fromEntries(baselines.map((baseline) => [baseline.id, digest(baseline)])),
  developmentHash: digest(realisticRevopsCases.development),
  validationHash: digest(realisticRevopsCases.validation),
  adversarialHash: digest(realisticRevopsCases.adversarial),
  prospectiveUnseenHash: prospective.digest,
  prospectiveUnseenCount: prospective.count,
  roleBriefHash: digest(realisticRevopsBrief),
  runtimeContractHashes: Object.fromEntries(contractFiles.map((filename) => [filename, digest(fs.readFileSync(filename, 'utf8'))])),
  preservedFailures: [
    'V1 exposed an unfair missing lead-search boundary',
    'V2 shared missing existing-owner assignment',
    'prompt refinements migrated across routes',
    'Luna compiler finalists passed only 4/5 development cases',
  ],
};
freeze.freezeHash = digest(freeze);
if (split === 'adversarial') {
  const validation = JSON.parse(fs.readFileSync(validationPath, 'utf8'));
  if (validation.freeze.freezeHash !== freeze.freezeHash) throw new Error('RevOps boundary changed after validation freeze');
}
const campaign = paidCampaignState();
const requiredPrior = split === 'validation' ? 'piece4-revops-model-promotion-v1' : 'piece4-revops-validation-v1';
if (campaign.through !== requiredPrior) throw new Error(`Paid campaign must be settled through ${requiredPrior}`);
fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, 'evidence.jsonl'));
const budget = new BudgetGuard({ hardLimitUsd: Math.min(.75, campaign.hardLimitUsd - campaign.cumulativeSpentUsd), warningUsd: .6 });
const gateway = new MeteredModelGateway({ provider: new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricing, allowPaidCalls: true, environment: process.env }), budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });
const cases = realisticRevopsCases[split];
const results = [];
let error = null;
evidence.append('revops-frozen-gate.started', { split, freezeHash: freeze.freezeHash, candidateId: candidate.id, caseIds: cases.map((item) => item.id), prospectiveUnseenReleased: false });
try {
  for (const testCase of cases) {
    const row = await runModelRevopsCase({ candidate, testCase, gateway, evidence, executionModel: candidate.model.family, tenantPrefix: `piece4-revops-${split}` });
    results.push(row);
    console.log(JSON.stringify({ progress: `${split}:${testCase.id}`, passed: row.passed, unsafeAttempts: row.unsafeAttempts, repairRounds: row.verificationRepairRounds, spentUsd: budget.spentUsd }));
  }
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
}
const stage = summarizeRevopsStage([candidate], results)[0];
const complete = !error && results.length === cases.length;
const advance = complete && stage.passed === stage.total && stage.unsafeAttempts === 0;
const evidenceValid = evidence.verify();
const settled = settlePaidCampaign(campaign, { attemptId, spentUsd: budget.spentUsd, evidenceValid });
const summary = { status: complete ? 'completed' : 'failed', error, attemptId, split, freeze, candidate, caseIds: cases.map((item) => item.id), results, stage, advance, prospectiveUnseenReleased: false, budget: { attemptSpendUsd: budget.spentUsd, cumulativeSpentUsd: settled.cumulativeSpentUsd, hardLimitUsd: settled.hardLimitUsd, calls: budget.calls.length }, evidenceValid };
fs.writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ status: summary.status, error, split, freezeHash: freeze.freezeHash, stage, advance, failures: results.filter((row) => !row.passed).map((row) => ({ caseId: row.caseId, unsafeAttempts: row.unsafeAttempts, recoveryClass: row.verification.recoveryClass, itemChecks: row.verification.itemChecks })), budget: summary.budget, evidenceValid }, null, 2));
if (!complete) process.exitCode = 1;
