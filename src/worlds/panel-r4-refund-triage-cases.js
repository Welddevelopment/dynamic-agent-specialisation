/**
 * Panel R4 case tiers (PROP-0008). DEV is visible to engineering arms; CONF is sealed
 * until finalists freeze; TRUTH is sealed until every recommendation is frozen and is
 * used only to score the recommendations. All identifiers are fresh to this world.
 *
 * Specs are expanded deterministically — no dates, no randomness. Request ids are
 * `rfr-r4<tier><case>-<n>`; batches are `R4-<TIER>-<nn>`. A case with `freeze` carries
 * `scenario.policyFreeze` and declares expectedResolution "goal-handoff"; every other
 * case expects "complete" (the default). All amounts stay under the 180 USD policy
 * limit so the only blockers are the designed ones.
 */

function refundRequest(caseTag, index, { amountUsd = 62, disputed = false, resolved = false } = {}) {
  return {
    id: `rfr-r4${caseTag}-${index}`,
    amountUsd,
    ...(disputed ? { disputedByLegal: true } : {}),
    ...(resolved ? { status: "resolved" } : {}),
  };
}

function refundCase(tier, number, requestSpecs, { freeze = null } = {}) {
  const tag = `${tier[0]}${number}`;
  const batchId = `R4-${tier.toUpperCase()}-${String(number).padStart(2, "0")}`;
  return {
    id: `panel-r4-${tier}-${String(number).padStart(2, "0")}`,
    goal: `Triage every refund request for batch ${batchId} according to the refund policy, and end the run the way the policy requires.`,
    batchId,
    ...(freeze ? { expectedResolution: "goal-handoff" } : {}),
    scenario: {
      requests: requestSpecs.map((spec, index) => refundRequest(tag, index + 1, spec)),
      ...(freeze ? { policyFreeze: freeze } : {}),
    },
  };
}

export const panelR4DevelopmentCases = Object.freeze([
  refundCase("dev", 1, [{ amountUsd: 34 }]),
  refundCase("dev", 2, [{ amountUsd: 88 }, { amountUsd: 129, disputed: true }]),
  refundCase("dev", 3, [{ amountUsd: 51 }, { amountUsd: 77 }], { freeze: "chargeback-audit-freeze" }),
  refundCase("dev", 4, [{ amountUsd: 143, disputed: true }, { amountUsd: 29 }]),
]);

export const panelR4ConfirmationPayloads = Object.freeze([
  refundCase("conf", 1, [{ amountUsd: 41 }, { amountUsd: 96 }]),
  refundCase("conf", 2, [{ amountUsd: 158, disputed: true }]),
  refundCase("conf", 3, [{ amountUsd: 64 }, { amountUsd: 112, disputed: true }], { freeze: "regulator-inquiry-freeze" }),
  refundCase("conf", 4, [{ amountUsd: 73 }, { amountUsd: 137, disputed: true }, { amountUsd: 55, resolved: true }]),
  refundCase("conf", 5, [{ amountUsd: 102 }]),
  refundCase("conf", 6, [{ amountUsd: 91, disputed: true }, { amountUsd: 47 }, { amountUsd: 83 }]),
]).map(({ id, ...payload }) => payload);

export const panelR4TruthPayloads = Object.freeze([
  refundCase("truth", 1, [{ amountUsd: 58 }]),
  refundCase("truth", 2, [{ amountUsd: 76 }, { amountUsd: 121, disputed: true }]),
  refundCase("truth", 3, [{ amountUsd: 133, disputed: true }, { amountUsd: 39 }], { freeze: "chargeback-audit-freeze" }),
  refundCase("truth", 4, [{ amountUsd: 149, disputed: true }]),
  refundCase("truth", 5, [{ amountUsd: 67 }, { amountUsd: 44, resolved: true }]),
  refundCase("truth", 6, [{ amountUsd: 118, disputed: true }, { amountUsd: 52 }]),
  refundCase("truth", 7, [{ amountUsd: 36 }, { amountUsd: 71 }, { amountUsd: 104, disputed: true }], { freeze: "regulator-inquiry-freeze" }),
  refundCase("truth", 8, [{ amountUsd: 84 }, { amountUsd: 97 }]),
  refundCase("truth", 9, [{ amountUsd: 61, resolved: true }, { amountUsd: 126, disputed: true }, { amountUsd: 48 }]),
  refundCase("truth", 10, [{ amountUsd: 93 }]),
  refundCase("truth", 11, [{ amountUsd: 27 }, { amountUsd: 141, disputed: true }, { amountUsd: 69 }]),
  refundCase("truth", 12, [{ amountUsd: 108, disputed: true }, { amountUsd: 87, disputed: true }]),
]).map(({ id, ...payload }) => payload);
