import assert from "node:assert/strict";
import test from "node:test";
import { doNothingStrategy, referenceProcurementStrategy } from "../src/evaluation/realistic-procurement-strategies.js";
import { doNothingSupportStrategy, evaluateSupportStrategy, referenceSupportStrategy } from "../src/evaluation/realistic-support-strategies.js";
import { doNothingRevopsStrategy, evaluateRevopsStrategy, referenceRevopsStrategy } from "../src/evaluation/realistic-revops-strategies.js";
import { assertVerifiedObservation } from "../src/lifecycle/verified-monitor.js";
import { createCommercialLifecycleRunner } from "../src/product/commercial-lifecycle-runner.js";
import { createCommercialProcurementPack } from "../src/product/commercial-procurement-pack.js";
import { createCommercialSupportPack } from "../src/product/commercial-support-pack.js";
import { createCommercialRevopsPack } from "../src/product/commercial-revops-pack.js";
import { RealisticProcurementCompany, RealisticProcurementVerifier } from "../src/worlds/realistic-procurement-company.js";
import { commercialProcurementCases } from "../src/product/commercial-procurement-cases.js";
import { commercialSupportCases } from "../src/worlds/realistic-support-cases.js";
import { commercialRevopsCases } from "../src/worlds/realistic-revops-cases.js";

async function evaluateProcurement(strategy, task) {
  const world = new RealisticProcurementCompany({ task, loseWriteResponseFor: task.executionFault });
  const verifier = new RealisticProcurementVerifier({ task, initialState: world.initial });
  let resolution;
  try { resolution = await strategy.run(world, task); }
  catch (error) { resolution = { kind: "error", blocker: error.message, reconciled: false }; }
  const verification = await verifier.verify({ externalState: world.externalState(), resolution });
  return { caseId: task.id, resolution, verification, externalState: world.externalState() };
}

const configurations = [
  {
    name: "procurement",
    pack: createCommercialProcurementPack,
    cases: commercialProcurementCases,
    evaluate: evaluateProcurement,
    reference: referenceProcurementStrategy,
    weak: doNothingStrategy,
    actions: ["purchaseOrders", "stockTransfers"],
    countSandboxWrites: ({ state }) => state.purchaseOrders.filter((item) => item.status === "draft").length + state.stockTransfers.filter((item) => item.status === "draft").length,
    unsafeChecks: ["noUnauthorizedSupplier", "withinTaskSpend", "draftOnly", "noDuplicateKeys", "noOutOfScopeWrites", "noUnnecessaryActions", "protectedUnchanged", "noDeniedAttempts"],
  },
  {
    name: "support",
    pack: createCommercialSupportPack,
    cases: commercialSupportCases,
    evaluate: evaluateSupportStrategy,
    reference: referenceSupportStrategy,
    weak: doNothingSupportStrategy,
    actions: ["responses", "credits", "escalations", "incidentLinks", "merges", "closures"],
    unsafeChecks: ["noDeniedAttempts", "noOutOfScopeWrites", "noDuplicateKeys", "protectedStateUnchanged"],
  },
  {
    name: "revops",
    pack: createCommercialRevopsPack,
    cases: commercialRevopsCases,
    evaluate: evaluateRevopsStrategy,
    reference: referenceRevopsStrategy,
    weak: doNothingRevopsStrategy,
    actions: ["ownerAssignments", "followUpTasks", "dispositions", "accountLinks", "leadMerges", "escalations"],
    unsafeChecks: ["noDeniedAttempts", "noOutOfScopeWrites", "noDuplicateKeys", "protectedStateUnchanged"],
  },
];

for (const config of configurations) test(`${config.name} lifecycle runner uses the real disposable verifier and gives shadow no customer-write authority`, async () => {
  const pack = config.pack();
  const candidate = pack.participants.find((item) => item.type === "compiler-candidate").candidate;
  const strategyByCandidate = new Map([[candidate.id, config.reference]]);
  const runner = createCommercialLifecycleRunner({
    roleId: pack.roleDraft.compiled.brief.id,
    verifierId: pack.driver.verifier.id,
    evaluate: config.evaluate,
    strategyFor: (supplied) => strategyByCandidate.get(supplied.id),
    actionCollections: config.actions,
    countSandboxWrites: config.countSandboxWrites,
    unsafeCheckNames: config.unsafeChecks,
  });
  const task = config.cases.development.find((item) => !item.executionFault) ?? config.cases.development[0];
  const shadow = await runner({ candidate, taskId: task.id, task, executionMode: "shadow-no-authority" });
  assertVerifiedObservation(shadow);
  assert.equal(shadow.verificationPassed, true);
  assert.equal(shadow.unsafeAttempts, 0);
  assert.equal(shadow.businessWritesCommitted, 0);
  assert.ok(shadow.sandboxWritesExecuted >= 0);
  assert.equal(shadow.verifierBinding, pack.driver.verifier.id);

  const live = await runner({ candidate, taskId: task.id, task, executionMode: "live" });
  assertVerifiedObservation(live);
  assert.equal(live.verificationPassed, true);
  assert.equal(live.businessWritesCommitted, live.sandboxWritesExecuted);
});

test("commercial lifecycle runner preserves an independently observed weak outcome instead of treating execution as success", async () => {
  const pack = createCommercialSupportPack();
  const candidate = pack.participants.find((item) => item.type === "current-agent").candidate;
  const runner = createCommercialLifecycleRunner({
    roleId: pack.roleDraft.compiled.brief.id,
    verifierId: pack.driver.verifier.id,
    evaluate: evaluateSupportStrategy,
    strategyFor: () => doNothingSupportStrategy,
    actionCollections: ["responses", "credits", "escalations", "incidentLinks", "merges", "closures"],
    unsafeCheckNames: ["noDeniedAttempts", "noOutOfScopeWrites", "noDuplicateKeys", "protectedStateUnchanged"],
  });
  const task = commercialSupportCases.development[0];
  const observation = await runner({ candidate, taskId: task.id, task, executionMode: "live" });
  assert.equal(observation.verificationPassed, false);
  assert.equal(observation.unsafeAttempts, 0);
  assert.ok(observation.outcomeScore < 1);
});
