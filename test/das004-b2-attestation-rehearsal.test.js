import test from "node:test";
import assert from "node:assert/strict";
import { WRONG_DECLARATIONS, runAttestationRehearsal } from "../src/experiments/das004-b2/attestation-rehearsal.js";
import { DAS004_B2_ARM_ENTRY_POINTS, armEntryPointsAreDistinct, createDas004B2Preregistration } from "../src/experiments/das004-b2/protocol.js";

test("PROP-0002 done-when: an honest declaration produces a quotable rehearsal result at zero spend", async () => {
  const result = await runAttestationRehearsal();
  assert.equal(result.quotable, true);
  assert.equal(result.spendUsd, 0);
  assert.equal(result.modelCallsMade, 0);
  assert.equal(result.executionAttestation.declarationsVerified, true);
  assert.equal(result.executionAttestation.resolutionState, "resolved");
  for (const arm of result.executionAttestation.arms) assert.ok(arm.invocations > 0, `${arm.armId} never ran`);
  assert.match(result.rehearsalHash, /^[a-f0-9]{64}$/);
});

test("PROP-0002 done-when: a declaration naming a module that does not exist dies before a result", async () => {
  await assert.rejects(
    () => runAttestationRehearsal({ entryPoints: WRONG_DECLARATIONS.moduleDoesNotExist() }),
    /Declared entry point for das does not load/,
  );
});

test("PROP-0002 done-when: declaring the compiler while running the designer dies before a result", async () => {
  await assert.rejects(
    () => runAttestationRehearsal({ entryPoints: WRONG_DECLARATIONS.claimsCompilerButRunsDesigner() }),
    /das declares no methodName|is not the declared compileSpecialist/,
  );
});

test("PROP-0002 done-when: declaring a method the campaign never calls dies before a result", async () => {
  await assert.rejects(
    () => runAttestationRehearsal({ entryPoints: WRONG_DECLARATIONS.wrongMethodOnRightClass() }),
    /Declared entry points never executed: das/,
  );
});

test("PROP-0002 done-when: an arm that is declared but never invoked dies before a result", async () => {
  await assert.rejects(
    () => runAttestationRehearsal({ skipArm: "das" }),
    /Declared entry points never executed: das/,
  );
  await assert.rejects(
    () => runAttestationRehearsal({ skipArm: "adaptive-engineer" }),
    /Declared entry points never executed: adaptive-engineer/,
  );
});

test("the B2 preregistration seals its per-arm entry points and admits the arms are the same code", () => {
  const plan = createDas004B2Preregistration();
  assert.equal(plan.armEntryPoints.entryPointsHash, DAS004_B2_ARM_ENTRY_POINTS.entryPointsHash);
  assert.equal(plan.armEntryPoints.arms.length, 2);
  // Erratum 0111a, stated as a machine-checked fact rather than prose.
  assert.equal(plan.distinctArmEntryPoints, false);
  assert.equal(armEntryPointsAreDistinct(), false);
  const das = plan.armEntryPoints.arms.find((row) => row.armId === "das");
  const adaptive = plan.armEntryPoints.arms.find((row) => row.armId === "adaptive-engineer");
  assert.equal(das.exportName, "ModelAdaptiveDesigner");
  assert.equal(das.methodName, "propose");
  assert.deepEqual({ m: das.module, e: das.exportName, n: das.methodName }, { m: adaptive.module, e: adaptive.exportName, n: adaptive.methodName });
});

test("a preregistration with no entry-point declaration is rejected for a new run", async () => {
  const { assertDas004B2Preregistration } = await import("../src/experiments/das004-b2/protocol.js");
  const plan = structuredClone(createDas004B2Preregistration());
  delete plan.armEntryPoints;
  assert.throws(() => assertDas004B2Preregistration(plan), /integrity mismatch|predates execution attestation/);
});
