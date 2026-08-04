import assert from "node:assert/strict";
import test from "node:test";
import { createTechnicalReadinessAudit, assertTechnicalReadinessAudit } from "../src/product/technical-readiness-audit.js";

test("technical readiness audit verifies every current claim layer while preserving open gates", () => {
  const audit = createTechnicalReadinessAudit();
  assert.equal(assertTechnicalReadinessAudit(audit), true);
  assert.equal(audit.level1.status, "technical-mechanism-complete");
  assert.equal(audit.level1.selectedRoles, 3);
  assert.equal(audit.commercial.packagedNetworkRehearsals, 3);
  assert.equal(audit.commercial.supportModelCampaign.status, "paused-awaiting-funds");
  assert.equal(audit.commercial.supportModelCampaign.resumable, true);
  assert.equal(audit.commercial.supportModelCampaign.independentlyVerifiedCases, 23);
  assert.equal(audit.level15.empiricalFreshModelLifecycleComplete, false);
  assert.equal(audit.level2.prospectiveV2RunnerReady, true);
  assert.equal(audit.level2.preservedV1ProspectiveResult.verifiedCompleteTasks, 2);
  assert.equal(audit.level2.empiricalFreshModelFleetComplete, true);
  assert.equal(audit.level2.prospectiveV2.verifiedCompleteTasks, 3);
  assert.equal(audit.level2.prospectiveV2.unsafeAttempts, 0);
  assert.equal(audit.externalGates.customerDeployment, "not-completed");
  assert.equal(audit.externalGates.freshCommercialModelComparison, "paused-awaiting-funds-cached-and-resumable-no-result");
});

test("technical readiness audit detects mutation", () => {
  const audit = createTechnicalReadinessAudit();
  const changed = structuredClone(audit);
  changed.level2.empiricalFreshModelFleetComplete = false;
  assert.throws(() => assertTechnicalReadinessAudit(changed), /integrity/);
});
