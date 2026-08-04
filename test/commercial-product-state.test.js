import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildCommercialProductState,
  loadCommercialProductState,
} from "../src/console/commercial-product-state.js";

const contract = {
  freezeHash: "freeze-1",
  templateId: "procurement-coverage-v1",
  driver: { id: "procurement-sandbox:v1" },
  cases: {
    development: ["d1", "d2"],
    validation: ["v1"],
    adversarial: ["a1"],
    unseen: { count: 2 },
  },
  thresholds: { minimumCostReduction: 0.1, minimumSpeedReduction: 0.1 },
  budget: { maximumModelSpendUsd: 5 },
  evidenceBoundary: "local only",
};

const manifest = [{
  id: "candidate-a",
  type: "compiler-candidate",
  label: "Candidate A",
  version: "1",
  configurationHash: "candidate-hash",
  candidate: { model: { family: "test-model" } },
}];

test("commercial product state keeps zero-cost preflight distinct from a model result", () => {
  const state = buildCommercialProductState({ receipt: { deterministicReference: { passed: 12, total: 12 } }, contract, manifest });
  assert.equal(state.status, "preflight-ready");
  assert.equal(state.modelCampaignAuthorized, false);
  assert.equal(state.contract.cases.development, 2);
  assert.equal(state.participants[0].model.family, "test-model");
  assert.equal(state.result, null);
  assert.match(state.boundary, /model-backed commercial result has not run/i);
});

test("commercial product lifecycle statuses advance only when their receipts exist", () => {
  const compared = buildCommercialProductState({ receipt: {}, contract, manifest, result: { decision: "retain-current" } });
  const recommended = buildCommercialProductState({ receipt: {}, contract, manifest, result: {}, bundle: { bundleHash: "bundle", status: "prepared", selected: { participantId: "candidate-a", type: "compiler-candidate", label: "Candidate A" }, role: {}, evidence: {} } });
  const active = buildCommercialProductState({ receipt: {}, contract, manifest, result: {}, bundle: recommended.bundle, activation: { status: "active" } });
  assert.equal(compared.status, "comparison-complete");
  assert.equal(recommended.status, "recommended");
  assert.equal(active.status, "controlled-active");
});

test("commercial product artifacts load from a separately supplied root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "das-commercial-console-"));
  const directory = path.join(root, "artifacts");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "receipt.json"), JSON.stringify({ deterministicReference: { passed: 1, total: 1 } }));
  fs.writeFileSync(path.join(directory, "contract.json"), JSON.stringify(contract));
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest));
  const state = loadCommercialProductState({ root, artifacts: { receipt: "artifacts/receipt.json", contract: "artifacts/contract.json", manifest: "artifacts/manifest.json" } });
  assert.equal(state.status, "preflight-ready");
  assert.equal(state.contract.freezeHash, "freeze-1");
  assert.equal(state.participants.length, 1);
});
