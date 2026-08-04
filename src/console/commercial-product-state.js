import fs from "node:fs";
import path from "node:path";

export const COMMERCIAL_PROCUREMENT_ARTIFACTS = Object.freeze({
  receipt: "artifacts/commercial/procurement-v1/preflight-receipt.json",
  contract: "artifacts/commercial/procurement-v1/comparison-contract.json",
  manifest: "artifacts/commercial/procurement-v1/participant-manifest.json",
  result: "artifacts/commercial/procurement-v1/model-result.json",
  bundle: "artifacts/commercial/procurement-v1/specialist-bundle.json",
  evidenceViews: "artifacts/commercial/procurement-v1/evidence-views.json",
  activation: "artifacts/commercial/procurement-v1/activation-receipt.json",
});

export function readOptionalJson(file, { root = process.cwd() } = {}) {
  const resolved = path.resolve(root, file);
  return fs.existsSync(resolved) ? JSON.parse(fs.readFileSync(resolved, "utf8")) : null;
}

export function buildCommercialProductState({
  receipt = null,
  contract = null,
  manifest = null,
  result = null,
  bundle = null,
  evidenceViews = null,
  activation = null,
} = {}) {
  const status = activation
    ? "controlled-active"
    : bundle
      ? "recommended"
      : result
        ? "comparison-complete"
        : receipt
          ? "preflight-ready"
          : "not-prepared";

  return {
    status,
    receipt,
    contract: contract ? {
      freezeHash: contract.freezeHash,
      templateId: contract.templateId,
      driver: contract.driver,
      cases: {
        development: contract.cases.development.length,
        validation: contract.cases.validation.length,
        adversarial: contract.cases.adversarial.length,
        unseen: contract.cases.unseen.count,
      },
      thresholds: contract.thresholds,
      budget: contract.budget,
      evidenceBoundary: contract.evidenceBoundary,
    } : null,
    participants: (manifest ?? []).map((item) => ({
      id: item.id,
      type: item.type,
      label: item.label,
      version: item.version,
      configurationHash: item.configurationHash,
      model: item.candidate?.model ?? null,
    })),
    result,
    bundle: bundle ? {
      bundleHash: bundle.bundleHash,
      status: bundle.status,
      selected: {
        participantId: bundle.selected.participantId,
        type: bundle.selected.type,
        label: bundle.selected.label,
      },
      role: bundle.role,
      evidence: bundle.evidence,
    } : null,
    evidenceViews,
    activation,
    modelCampaignAuthorized: false,
    boundary: "Preflight is zero-cost local evidence. A model-backed commercial result has not run unless a verified result receipt appears here.",
  };
}

export function loadCommercialProductState({ root = process.cwd(), artifacts = COMMERCIAL_PROCUREMENT_ARTIFACTS } = {}) {
  return buildCommercialProductState(Object.fromEntries(
    Object.entries(artifacts).map(([key, file]) => [key, readOptionalJson(file, { root })]),
  ));
}
