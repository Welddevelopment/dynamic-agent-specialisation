import assert from "node:assert/strict";
import test from "node:test";
import { CommercialComparisonRunner } from "../src/product/commercial-comparison-runner.js";
import { activatePromotedCommercialBundle, authorizeCommercialRollback, seedCommercialLifecycleRegistry } from "../src/product/commercial-lifecycle-bridge.js";
import { createCommercialSupportPack } from "../src/product/commercial-support-pack.js";
import { createCommercialActivationReceipt, createCommercialSpecialistBundle } from "../src/product/commercial-specialist-lifecycle.js";

function environment(pack) {
  return { kind: "disposable-sandbox", driverId: pack.driver.id, driverVersion: pack.driver.version, verifierId: pack.driver.verifier.id, verifierStatus: "verified", systemBindings: structuredClone(pack.driver.systemBindings) };
}

async function bundleSelecting(type) {
  const pack = createCommercialSupportPack();
  const runner = new CommercialComparisonRunner({ evaluate: async ({ participant, caseId, verifierId }) => {
    const preferred = participant.type === type;
    return { verifierId, independentlyVerified: true, passed: true, outcomeScore: 1, unsafeAttempts: 0, incorrectSideEffects: 0, modelCostUsd: preferred ? .001 : .004, elapsedMs: preferred ? 20 : 100, humanInterventions: 0, receiptHash: `${type}:${participant.id}:${caseId}` };
  } });
  const result = await runner.run({ contract: pack.contract, unseenVault: pack.unseenVault, participants: pack.participants });
  const participant = pack.participants.find((item) => item.id === result.selectedParticipantId);
  return { pack, bundle: createCommercialSpecialistBundle({ contract: pack.contract, result, participant, roleDraft: pack.roleDraft }) };
}

test("commercial bundles seed the durable replacement registry and produce linked activation and rollback receipts", async () => {
  const active = await bundleSelecting("current-agent");
  const challenger = await bundleSelecting("compiler-candidate");
  assert.equal(active.pack.contract.freezeHash, challenger.pack.contract.freezeHash);
  const seeded = seedCommercialLifecycleRegistry({ activeBundle: active.bundle, alternativeBundles: [challenger.bundle], brief: active.pack.roleDraft.compiled.brief, clock: () => "2026-08-05T00:00:00.000Z" });
  assert.equal(seeded.registry.latest(active.bundle.role.id).selected.candidate.id, active.bundle.selected.candidate.id);
  const currentActivation = createCommercialActivationReceipt({ bundle: active.bundle, contract: active.pack.contract, environment: environment(active.pack) });

  seeded.registry.registerSelection({
    role: seeded.role,
    selectedCandidate: challenger.bundle.selected.candidate,
    alternatives: [{ candidate: active.bundle.selected.candidate, evidence: { candidateId: active.bundle.selected.candidate.id, successRate: 1, unsafeAttempts: 0 } }],
    decision: "activate-compiler-specialist",
    evidence: { candidateId: challenger.bundle.selected.candidate.id, successRate: 1, unsafeAttempts: 0 },
    compatibility: seeded.compatibility,
  });
  const promoted = activatePromotedCommercialBundle({ registry: seeded.registry, bundle: challenger.bundle, contract: challenger.pack.contract, environment: environment(challenger.pack), previousActivation: currentActivation });
  assert.equal(promoted.previousActivationHash, currentActivation.activationHash);
  assert.equal(promoted.bundleHash, challenger.bundle.bundleHash);
  const rollback = authorizeCommercialRollback({ activeActivation: promoted, targetBundle: active.bundle });
  assert.equal(rollback.fromActivationHash, promoted.activationHash);
  assert.equal(rollback.toBundleHash, active.bundle.bundleHash);
});

