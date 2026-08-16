import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionAttestor } from "../src/evaluation/execution-attestation.js";

const DECLARED = [
  { armId: "das", module: "src/compiler/compiler.js", exportName: "compileSpecialist" },
  { armId: "adaptive", module: "src/evaluation/adaptive-engineer-controller.js", exportName: "AdaptiveEngineerController" },
];

test("unreached declared entry point fails the campaign", () => {
  const attestor = new ExecutionAttestor(DECLARED);
  attestor.wrap("das", () => 1)();
  assert.throws(() => attestor.assertAllReached(), /adaptive/);
});

test("all reached passes and the receipt records invocations", () => {
  const attestor = new ExecutionAttestor(DECLARED);
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

test("wrapping an undeclared arm throws; empty declaration throws", () => {
  const attestor = new ExecutionAttestor(DECLARED);
  assert.throws(() => attestor.wrap("mystery", () => {}), /No declared entry point/);
  assert.throws(() => new ExecutionAttestor([]), /at least one/);
});

test("receipt hash is stable for identical state", () => {
  const a = new ExecutionAttestor(DECLARED);
  const b = new ExecutionAttestor(DECLARED);
  a.wrap("das", () => {})(); a.wrap("adaptive", () => {})();
  b.wrap("das", () => {})(); b.wrap("adaptive", () => {})();
  assert.equal(a.receipt().attestationHash, b.receipt().attestationHash);
});
