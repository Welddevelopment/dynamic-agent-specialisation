import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DurableSpecialistRegistry } from "../src/compiler/durable-registry.js";
import { SpecialistControlPlane } from "../src/compiler/control-plane.js";
import { digest } from "../src/core/canonical.js";
import { realisticProcurementBrief } from "../src/roles/realistic-procurement.js";
import { createPiece2ModelBaselines } from "../src/evaluation/piece2-baselines.js";

function fixture() {
  const role = { id: realisticProcurementBrief.id, brief: realisticProcurementBrief };
  const candidates = createPiece2ModelBaselines();
  const selected = candidates.find((candidate) => candidate.id === "baseline-ordinary-manual-luna");
  const alternative = candidates.find((candidate) => candidate.id === "baseline-strong-general-terra");
  const compatibility = {
    roleTags: realisticProcurementBrief.environment.tags,
    environmentTags: realisticProcurementBrief.environment.tags,
    policyHash: digest(realisticProcurementBrief.policies),
    authorityHash: digest(realisticProcurementBrief.authority),
    toolsHash: digest(realisticProcurementBrief.environment.tools),
  };
  return { role, selected, alternative, compatibility };
}

test("selected specialist and alternatives survive a durable verified reload", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "das-registry-"));
  const file = path.join(directory, "registry.json");
  const now = () => "2026-08-02T00:00:00.000Z";
  const { role, selected, alternative, compatibility } = fixture();
  const registry = new DurableSpecialistRegistry({ clock: now });
  registry.registerSelection({
    role,
    selectedCandidate: selected,
    alternatives: [{ candidate: alternative, evidence: { candidateId: alternative.id, successRate: 1, unsafeAttempts: 0 } }],
    decision: "retain-existing-specialist",
    evidence: { candidateId: selected.id, successRate: 1, unsafeAttempts: 0 },
    compatibility,
    evidenceReferences: [{ path: "frozen.json", sha256: "abc" }],
  });
  registry.save(file);
  const restored = DurableSpecialistRegistry.load(file, { clock: now });
  assert.equal(restored.latest(role.id).selected.candidate.id, selected.id);
  assert.equal(restored.latest(role.id).alternatives[0].candidate.id, alternative.id);
  assert.equal(restored.snapshot().integrityHash, registry.snapshot().integrityHash);
});

test("tampering with a saved specialist is detected before reuse", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "das-registry-"));
  const file = path.join(directory, "registry.json");
  const { role, selected, compatibility } = fixture();
  const registry = new DurableSpecialistRegistry();
  registry.registerSelection({ role, selectedCandidate: selected, decision: "retain-existing-specialist", evidence: { candidateId: selected.id, successRate: 1, unsafeAttempts: 0 }, compatibility });
  registry.save(file);
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  state.selections[0].selected.candidate.authority.allowedActions.push("approve-spend");
  fs.writeFileSync(file, JSON.stringify(state));
  assert.throws(() => DurableSpecialistRegistry.load(file), /integrity mismatch/);
});

test("durable selected specialist still passes fail-closed activation checks", () => {
  const { role, selected, compatibility } = fixture();
  const registry = new DurableSpecialistRegistry();
  registry.registerSelection({ role, selectedCandidate: selected, decision: "retain-existing-specialist", evidence: { candidateId: selected.id, successRate: 1, unsafeAttempts: 0 }, compatibility });
  const control = new SpecialistControlPlane();
  const environment = { policyHash: compatibility.policyHash, authorityHash: compatibility.authorityHash, availableTools: realisticProcurementBrief.environment.tools };
  const activation = control.activateRecommended({ compiled: { retained: registry.activationRecord(role.id) }, role, environment });
  assert.equal(activation.activated, true);
  const blocked = control.requestSwitch({ specialist: registry.activationRecord(role.id), role, environment: { ...environment, availableTools: [] }, requestedBy: "engineer" });
  assert.equal(blocked.activated, false);
});
