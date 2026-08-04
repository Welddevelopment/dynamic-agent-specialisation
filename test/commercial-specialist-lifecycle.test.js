import test from "node:test";
import assert from "node:assert/strict";
import { CommercialComparisonRunner } from "../src/product/commercial-comparison-runner.js";
import { buildCommercialEvidenceViews } from "../src/product/commercial-evidence-view.js";
import { createCommercialProcurementPack } from "../src/product/commercial-procurement-pack.js";
import { assertCommercialComparisonResult, assertCommercialSpecialistBundle, createCommercialActivationReceipt, createCommercialSpecialistBundle, exportCommercialSpecialistBundle, importCommercialCurrentAgent } from "../src/product/commercial-specialist-lifecycle.js";

async function completedFixture() {
  const pack = createCommercialProcurementPack();
  const runner = new CommercialComparisonRunner({ evaluate: async ({ participant, caseId, verifierId }) => {
    const compilerWinner = participant.id === "commercial-procurement-candidate-1";
    return {
      verifierId, independentlyVerified: true, passed: true, outcomeScore: 1,
      unsafeAttempts: 0, incorrectSideEffects: 0,
      modelCostUsd: compilerWinner ? .001 : participant.type === "compiler-candidate" ? .002 : .004,
      elapsedMs: compilerWinner ? 40 : participant.type === "compiler-candidate" ? 70 : 100,
      humanInterventions: 0, receiptHash: `external-${participant.id}-${caseId}`,
    };
  } });
  const result = await runner.run({ contract: pack.contract, unseenVault: pack.unseenVault, participants: pack.participants });
  const selected = pack.participants.find((item) => item.id === result.selectedParticipantId);
  return { pack, result, selected };
}

test("current-agent import rejects credentials and binds a candidate to the commercial role", () => {
  const pack = createCommercialProcurementPack();
  const candidate = pack.participants.find((item) => item.type === "ordinary-manual").candidate;
  const imported = importCommercialCurrentAgent({ candidate, brief: pack.roleDraft.compiled.brief, source: { system: "fictional-existing-agent", version: "1" } });
  assert.equal(imported.credentialsIncluded, false);
  assert.equal(imported.candidate.roleId, pack.roleDraft.compiled.brief.id);
  assert.match(imported.importHash, /^[a-f0-9]{64}$/);
  assert.throws(() => importCommercialCurrentAgent({ candidate: { ...candidate, apiKey: "do-not-store" }, brief: pack.roleDraft.compiled.brief }), /Credentials cannot be stored/);
});

test("comparison result becomes an integrity-checked specialist bundle and controlled activation", async () => {
  const { pack, result, selected } = await completedFixture();
  assert.equal(result.decision, "activate-compiler");
  assert.equal(assertCommercialComparisonResult(result), true);
  const bundle = createCommercialSpecialistBundle({ contract: pack.contract, result, participant: selected, roleDraft: pack.roleDraft });
  assert.equal(assertCommercialSpecialistBundle(bundle), true);
  assert.equal(bundle.status, "recommended-not-active");
  const environment = {
    kind: "disposable-sandbox",
    driverId: pack.contract.driver.id,
    driverVersion: pack.contract.driver.version,
    verifierId: pack.contract.driver.verifier.id,
    verifierStatus: "verified",
    systemBindings: structuredClone(pack.contract.driver.systemBindings),
  };
  const activation = createCommercialActivationReceipt({ bundle, contract: pack.contract, environment });
  assert.equal(activation.status, "controlled-active");
  assert.equal(activation.bundleHash, bundle.bundleHash);
  assert.match(activation.activationHash, /^[a-f0-9]{64}$/);
  assert.equal(exportCommercialSpecialistBundle(bundle).includes("apiKey"), false);
});

test("executive, technical and forensic evidence views explain the recommendation without weakening autonomy", async () => {
  const { pack, result, selected } = await completedFixture();
  const bundle = createCommercialSpecialistBundle({ contract: pack.contract, result, participant: selected, roleDraft: pack.roleDraft });
  const views = buildCommercialEvidenceViews({ contract: pack.contract, result, bundle });
  assert.equal(views.executive.recommendation, "activate-compiler");
  assert.equal(views.executive.improvementProved, true);
  assert.ok(views.technical.alternatives.every((item) => item.whyNotSelected));
  assert.equal(views.forensic.integrity.bundleHash, bundle.bundleHash);
  assert.match(views.evidenceViewHash, /^[a-f0-9]{64}$/);
});

test("tampering with a selected bundle blocks activation and export", async () => {
  const { pack, result, selected } = await completedFixture();
  const bundle = createCommercialSpecialistBundle({ contract: pack.contract, result, participant: selected, roleDraft: pack.roleDraft });
  const changed = structuredClone(bundle);
  changed.selected.candidate.authority.allowedActions.push("submit-order");
  assert.throws(() => assertCommercialSpecialistBundle(changed), /integrity mismatch/);
  assert.throws(() => exportCommercialSpecialistBundle(changed), /integrity mismatch/);
});
