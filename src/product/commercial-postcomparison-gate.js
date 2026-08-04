import { digest } from "../core/canonical.js";
import { assertCommercialComparisonFreeze } from "./commercial-comparison.js";
import { assertCommercialComparisonResult, assertCommercialSpecialistBundle } from "./commercial-specialist-lifecycle.js";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function withoutHash(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

export function createCommercialPostcomparisonGate({ contract, roleId, cases }) {
  assertCommercialComparisonFreeze(contract);
  requireCondition(roleId && Array.isArray(cases) && cases.length >= 2, "Post-comparison gate requires a role and at least two fresh cases");
  requireCondition(new Set(cases.map((item) => item?.id)).size === cases.length && cases.every((item) => item?.id && item?.payload?.id === item.id), "Post-comparison cases need unique matching ids");
  const sealedCases = structuredClone(cases);
  const record = {
    schemaVersion: "das.commercial-postcomparison-gate.v1",
    roleId,
    comparisonContractFreezeHash: contract.freezeHash,
    driver: {
      id: contract.driver.id,
      version: contract.driver.version,
      verifierId: contract.driver.verifier.id,
    },
    cases: {
      count: sealedCases.length,
      digest: digest(sealedCases),
      caseHashes: sealedCases.map((item) => ({ id: item.id, caseHash: digest(item.payload) })),
    },
    releasePolicy: {
      exactCampaignResultRequired: true,
      exactSelectedCandidateRequired: true,
      provedUpgradeRequired: true,
      modelCampaignCompletionRequired: true,
      releaseAfterComparisonOnly: true,
    },
    evidenceBoundary: "Sealed post-comparison lifecycle gate contract. Payloads are withheld from candidate construction and comparison; no candidate has run these cases.",
  };
  record.gateHash = digest(record);
  let releaseCount = 0;
  return Object.freeze({
    contract: Object.freeze(record),
    release({ handoff, plan, result, bundle }) {
      assertCommercialPostcomparisonGate(record);
      requireCondition(plan?.schemaVersion === "das.commercial-lifecycle-handoff-plan.v1" && plan.planHash && digest(withoutHash(plan, "planHash")) === plan.planHash, "Post-comparison release requires the exact integrity-checked lifecycle plan");
      assertCommercialComparisonResult(result);
      assertCommercialSpecialistBundle(bundle);
      requireCondition(handoff?.schemaVersion === "das.commercial-lifecycle-challenger-handoff.v1", "Post-comparison release requires a completed challenger handoff");
      requireCondition(handoff.handoffHash && digest(withoutHash(handoff, "handoffHash")) === handoff.handoffHash, "Challenger handoff integrity mismatch");
      requireCondition(handoff.status === "awaiting-postcomparison-offline-gates", "Only a proved challenger may enter post-comparison gates");
      requireCondition(handoff.lifecyclePlanHash === plan.planHash && handoff.comparisonResultHash === result.resultHash && handoff.bundleHash === bundle.bundleHash, "Post-comparison release evidence chain is incomplete");
      requireCondition(result.decision === "activate-compiler" && result.improvementAssessment?.proved === true, "Post-comparison release requires a proved compiler upgrade");
      requireCondition(bundle.selected.type === "compiler-candidate" && bundle.selected.candidate.fingerprint === handoff.candidate.fingerprint, "Post-comparison release candidate does not match the proved bundle");
      requireCondition(handoff.roleId === roleId && handoff.postcomparisonGateHash === record.gateHash, "Challenger handoff belongs to another post-comparison gate");
      requireCondition(handoff.comparisonContractFreezeHash === contract.freezeHash, "Challenger handoff belongs to another comparison freeze");
      requireCondition(handoff.candidate?.fingerprint && handoff.candidate.fingerprint !== handoff.activeCandidateFingerprint, "Current specialist cannot be released as its own challenger");
      releaseCount += 1;
      return structuredClone(sealedCases);
    },
    releaseCount() { return releaseCount; },
  });
}

export function assertCommercialPostcomparisonGate(contract) {
  requireCondition(contract?.schemaVersion === "das.commercial-postcomparison-gate.v1", "Unsupported post-comparison gate contract");
  requireCondition(contract.gateHash && digest(withoutHash(contract, "gateHash")) === contract.gateHash, "Post-comparison gate integrity mismatch");
  requireCondition(contract.cases?.count >= 2 && contract.cases.caseHashes?.length === contract.cases.count, "Post-comparison gate case commitment is incomplete");
  return true;
}
