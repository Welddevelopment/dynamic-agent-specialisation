import assert from "node:assert/strict";
import test from "node:test";
import { createTechnicalReadinessAudit, assertTechnicalReadinessAudit } from "../src/product/technical-readiness-audit.js";

test("technical readiness audit verifies every current claim layer while preserving open gates", () => {
  const audit = createTechnicalReadinessAudit();
  assert.equal(assertTechnicalReadinessAudit(audit), true);
  assert.equal(audit.level1.status, "technical-mechanism-complete");
  assert.equal(audit.level1.selectedRoles, 3);
  assert.equal(audit.commercial.packagedNetworkRehearsals, 3);
  assert.equal(audit.level15.empiricalFreshModelLifecycleComplete, false);
  assert.equal(audit.level2.prospectiveRunnerReady, true);
  assert.equal(audit.level2.empiricalFreshModelFleetComplete, false);
  assert.equal(audit.externalGates.customerDeployment, "not-completed");
});

test("technical readiness audit detects mutation", () => {
  const audit = createTechnicalReadinessAudit();
  const changed = structuredClone(audit);
  changed.level2.empiricalFreshModelFleetComplete = true;
  assert.throws(() => assertTechnicalReadinessAudit(changed), /integrity/);
});
