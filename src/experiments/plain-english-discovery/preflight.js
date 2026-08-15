import fs from "node:fs";
import path from "node:path";
import { PLAIN_ENGLISH_DISCOVERY_BENCHMARK, PLAIN_ENGLISH_DISCOVERY_BENCHMARK_HASH } from "./benchmark.js";
import { createPlainEnglishDiscoverySmokePlan } from "./execution-plan.js";

const outputDirectory = path.resolve("artifacts/plain-english-discovery/v1");
fs.mkdirSync(outputDirectory, { recursive: true });
const plan = createPlainEnglishDiscoverySmokePlan();
function writePrivate(name, value) {
  const target = path.join(outputDirectory, name);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
  fs.chmodSync(target, 0o600);
}
writePrivate("smoke-plan.json", plan);
writePrivate("preflight-receipt.json", {
  schemaVersion: "das.plain-english-discovery-preflight-receipt.v1",
  benchmarkId: PLAIN_ENGLISH_DISCOVERY_BENCHMARK.benchmarkId,
  benchmarkHash: PLAIN_ENGLISH_DISCOVERY_BENCHMARK_HASH,
  caseCount: PLAIN_ENGLISH_DISCOVERY_BENCHMARK.cases.length,
  smokeCaseId: plan.caseId,
  planHash: plan.planHash,
  projectedMaximumSpendUsd: plan.projectedMaximumSpendUsd,
  hardLimitUsd: plan.hardExperimentLimitUsd,
  modelCallsMade: 0,
  externalRequestsMade: 0,
  newSpendUsd: 0,
  paidExecutionStatus: "disabled-pending-safety-core-and-exact-approval",
  scaleStatus: "not-authorized-before-smoke-review",
});
console.log(JSON.stringify({
  status: "zero-cost-plan-sealed-paid-execution-disabled",
  planHash: plan.planHash,
  caseId: plan.caseId,
  maximumCalls: plan.maximumCalls,
  projectedMaximumSpendUsd: plan.projectedMaximumSpendUsd,
  hardLimitUsd: plan.hardExperimentLimitUsd,
  nextGate: "Repaired discovery safety core must pass, then exact environment approval may unlock one smoke call.",
}, null, 2));
