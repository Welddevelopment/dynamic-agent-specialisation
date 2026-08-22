import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionAttestor, attestorForSealedEntryPoints, declareArmEntryPoints } from "../src/evaluation/execution-attestation.js";
import { compileSpecialist } from "../src/compiler/compiler.js";
import { AdaptiveEngineerController } from "../src/evaluation/adaptive-engineer-controller.js";
import { ModelAdaptiveDesigner } from "../src/experiments/das004-b2/model-adaptive-designer.js";

const DECLARED = [
  { armId: "das", module: "src/compiler/compiler.js", exportName: "compileSpecialist" },
  { armId: "adaptive", module: "src/evaluation/adaptive-engineer-controller.js", exportName: "AdaptiveEngineerController" },
];

const unverified = (declared = DECLARED) => new ExecutionAttestor(declared, { verifyDeclarations: false });

test("count-only attestation still works when a caller explicitly opts out of verification", () => {
  const attestor = unverified();
  attestor.wrap("das", () => 1)();
  assert.throws(() => attestor.assertAllReached(), /adaptive/);
});

test("all reached passes and the receipt records invocations", () => {
  const attestor = unverified();
  const das = attestor.wrap("das", (x) => x + 1);
  const adaptive = attestor.wrap("adaptive", () => "ok");
  assert.equal(das(1), 2);
  adaptive(); adaptive();
  attestor.assertAllReached();
  const receipt = attestor.receipt();
  assert.equal(receipt.arms.find((a) => a.armId === "das").invocations, 1);
  assert.equal(receipt.arms.find((a) => a.armId === "adaptive").invocations, 2);
  assert.match(receipt.attestationHash, /^[a-f0-9]{64}$/);
});

test("wrapping an undeclared arm throws; empty declaration throws; duplicate arms throw", () => {
  const attestor = unverified();
  assert.throws(() => attestor.wrap("mystery", () => {}), /No declared entry point/);
  assert.throws(() => new ExecutionAttestor([]), /at least one/);
  assert.throws(() => unverified([DECLARED[0], DECLARED[0]]), /Duplicate entry-point declaration/);
});

test("receipt hash is stable for identical state", () => {
  const a = unverified();
  const b = unverified();
  a.wrap("das", () => {})(); a.wrap("adaptive", () => {})();
  b.wrap("das", () => {})(); b.wrap("adaptive", () => {})();
  assert.equal(a.receipt().attestationHash, b.receipt().attestationHash);
});

test("count-only attestation is recorded as unverified in the receipt", () => {
  const attestor = unverified();
  attestor.wrap("das", () => {})(); attestor.wrap("adaptive", () => {})();
  const receipt = attestor.receipt();
  assert.equal(receipt.declarationsVerified, false);
  assert.equal(receipt.resolutionState, "not-attempted");
});

test("erratum 0111a: declaring the compiler while running something else is rejected", async () => {
  const attestor = new ExecutionAttestor(DECLARED);
  await attestor.resolve();
  assert.throws(
    () => attestor.wrap("das", async () => ({ actions: [] })),
    /is not the declared compileSpecialist .* does not match the code being run/s,
  );
});

test("resolved declarations accept the declared export and count its invocations", async () => {
  const attestor = new ExecutionAttestor(DECLARED);
  await attestor.resolve();
  const das = attestor.wrap("das", compileSpecialist);
  const adaptive = attestor.wrap("adaptive", AdaptiveEngineerController);
  assert.equal(typeof das, "function");
  assert.equal(typeof adaptive, "function");
  const receipt = attestor.receipt();
  assert.equal(receipt.declarationsVerified, true);
  assert.equal(receipt.resolutionState, "resolved");
});

test("entryPoint returns the declared function itself, so declaration and execution cannot diverge", async () => {
  const attestor = new ExecutionAttestor([DECLARED[0]]);
  await attestor.resolve();
  let inner = 0;
  const original = compileSpecialist;
  const attested = attestor.entryPoint("das");
  assert.equal(typeof attested, "function");
  assert.equal(original, compileSpecialist, "resolution must not mutate the module");
  assert.throws(() => attestor.assertAllReached(), /never executed/);
  try { attested({ role: null, registry: null, evidence: null }); } catch { inner += 1; }
  attestor.assertAllReached();
  assert.equal(attestor.receipt().arms[0].invocations, 1);
});

test("a declared method on a class export resolves and is identity-checked", async () => {
  const declared = [{ armId: "das", module: "src/experiments/das004-b2/model-adaptive-designer.js", exportName: "ModelAdaptiveDesigner", methodName: "propose" }];
  const attestor = new ExecutionAttestor(declared);
  await attestor.resolve();
  assert.doesNotThrow(() => attestor.wrap("das", ModelAdaptiveDesigner.prototype.propose));
  assert.throws(() => attestor.wrap("das", ModelAdaptiveDesigner.prototype.estimate), /is not the declared ModelAdaptiveDesigner\.propose/);
});

test("declarations that do not point at real code fail to resolve", async () => {
  await assert.rejects(
    () => new ExecutionAttestor([{ armId: "das", module: "src/compiler/does-not-exist.js", exportName: "compileSpecialist" }]).resolve(),
    /does not load/,
  );
  await assert.rejects(
    () => new ExecutionAttestor([{ armId: "das", module: "src/compiler/compiler.js", exportName: "noSuchExport" }]).resolve(),
    /missing export noSuchExport/,
  );
  await assert.rejects(
    () => new ExecutionAttestor([{ armId: "das", module: "src/compiler/compiler.js", exportName: "compileSpecialist", methodName: "nope" }]).resolve(),
    /missing method compileSpecialist\.nope/,
  );
});

test("verified attestation cannot be asserted or wrapped before resolution", async () => {
  const attestor = new ExecutionAttestor(DECLARED);
  assert.throws(() => attestor.wrap("das", compileSpecialist), /before declarations were resolved/);
  assert.throws(() => attestor.assertAllReached(), /before declarations are resolved/);
  assert.throws(() => attestor.entryPoint("das"), /before declarations were resolved/);
});

test("sealed entry-point declarations round-trip and detect tampering", async () => {
  const sealed = declareArmEntryPoints(DECLARED);
  assert.match(sealed.entryPointsHash, /^[a-f0-9]{64}$/);
  assert.equal(sealed.arms.length, 2);
  assert.equal(sealed.arms[0].methodName, null);

  const attestor = await attestorForSealedEntryPoints(sealed);
  assert.equal(attestor.resolutionState, "resolved");

  const tampered = structuredClone(sealed);
  tampered.arms[0].exportName = "somethingElse";
  await assert.rejects(() => attestorForSealedEntryPoints(tampered), /integrity mismatch/);

  assert.throws(() => declareArmEntryPoints([]), /at least one arm entry point/);
  assert.throws(() => declareArmEntryPoints([{ armId: "das", module: "m.js" }]), /missing exportName/);
});
