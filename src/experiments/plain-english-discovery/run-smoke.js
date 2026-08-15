import fs from "node:fs";
import path from "node:path";
import { DurableBudgetGuard, PersistentModelResponseCache } from "../../core/durable-model-campaign.js";
import { EvidenceLedger } from "../../core/evidence.js";
import { MeteredModelGateway } from "../../core/model-gateway.js";
import { assertProvisionalRoleContract, discoverRoleFromPlainEnglish } from "../../product/plain-english-role-discovery.js";
import { benchmarkCase } from "./benchmark.js";
import { createPlainEnglishDiscoverySmokePlan, assertPlainEnglishDiscoveryAuthorization, PLAIN_ENGLISH_DISCOVERY_PRICING } from "./execution-plan.js";
import { createModelBackedRoleDiscoveryProvider } from "./model-provider.js";
import { OpenAIPlainEnglishDiscoveryProvider } from "./openai-metered-provider.js";
import { scorePlainEnglishDiscoveryContract } from "./scoring.js";

function writePrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

const plan = createPlainEnglishDiscoverySmokePlan();
const authorization = assertPlainEnglishDiscoveryAuthorization({ plan, environment: process.env });
const testCase = benchmarkCase(plan.caseId);
const stateDirectory = path.resolve("artifacts/plain-english-discovery/v1/model-smoke");
fs.mkdirSync(stateDirectory, { recursive: true });
const budget = new DurableBudgetGuard({
  filePath: path.join(stateDirectory, "spend-ledger.json"),
  hardLimitUsd: authorization.hardLimitUsd,
  warningUsd: .40,
  campaignId: plan.campaignId,
});
const cache = new PersistentModelResponseCache({ filePath: path.join(stateDirectory, "response-cache.json") });
const evidence = new EvidenceLedger(path.join(stateDirectory, "evidence.jsonl"));
const lowLevelProvider = new OpenAIPlainEnglishDiscoveryProvider({
  apiKey: process.env.OPENAI_API_KEY,
  pricing: PLAIN_ENGLISH_DISCOVERY_PRICING,
  allowPaidCalls: true,
  environment: process.env,
});
const gateway = new MeteredModelGateway({ provider: lowLevelProvider, budget, cache, evidence, secrets: [process.env.OPENAI_API_KEY] });
const discoveryProvider = createModelBackedRoleDiscoveryProvider({ gateway });

const contract = await discoverRoleFromPlainEnglish({
  provider: discoveryProvider,
  usageAuthorization: authorization.discoveryUsageAuthorization,
  input: {
    requestId: `benchmark:${testCase.id}:v1`,
    description: testCase.description,
    approvedArtifacts: testCase.approvedArtifacts,
    currentAgentConfiguration: testCase.currentAgentConfiguration,
  },
});
assertProvisionalRoleContract(contract);
const score = scorePlainEnglishDiscoveryContract({ testCase, contract });
const budgetSnapshot = budget.snapshot();
const responseProcessing = {
  kind: contract.provider.usage.cached ? "persistent-cache-replay-of-paid-response" : "live-provider-response",
  newModelCalls: contract.provider.usage.modelCalls,
  newExternalRequests: contract.provider.usage.externalRequests,
  newSpendUsd: contract.provider.usage.spendUsd,
  campaignSettledCalls: budgetSnapshot.calls.filter((call) => call.status === "settled").length,
  campaignSpendUsd: budgetSnapshot.spentUsd,
  boundary: contract.provider.usage.cached
    ? "The contract and score were produced by replaying the exact persisted response from the campaign's one settled paid call. No new request or spend occurred during this processing run."
    : "The contract and score were produced directly from the campaign's settled provider response.",
};
const report = {
  schemaVersion: "das.plain-english-discovery-smoke-report.v1",
  planHash: plan.planHash,
  caseId: testCase.id,
  contract,
  score,
  spend: budgetSnapshot,
  responseProcessing,
  outcome: score.passed ? "smoke-passed-awaiting-human-review" : "smoke-failed-no-scaling",
  downstreamSpecialistCompetition: "not-run-not-authorized",
  evidenceBoundary: plan.evidenceBoundary,
};
writePrivate(path.join(stateDirectory, "report.json"), report);
console.log(JSON.stringify({
  outcome: report.outcome,
  planHash: plan.planHash,
  caseId: testCase.id,
  passed: score.passed,
  hardSafetyPassed: score.hardSafetyPassed,
  spendUsd: budgetSnapshot.spentUsd,
  newSpendUsd: responseProcessing.newSpendUsd,
  responseProcessing: responseProcessing.kind,
  reservedUsd: budgetSnapshot.reservedUsd,
  calls: budgetSnapshot.calls.length,
  scalingAuthorized: false,
}, null, 2));
