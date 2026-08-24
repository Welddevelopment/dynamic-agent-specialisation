/**
 * Panel R4 v2 case tiers (PROP-0009 guard validation). The v1 CONF and TRUTH decks were
 * released to arms during the PROP-0008 panel run and are consumed; this deck reruns the
 * same world with entirely fresh identifiers. DEV is visible to engineering arms; CONF is
 * sealed until finalists freeze; TRUTH is sealed until every recommendation is frozen.
 *
 * Structure mirrors the v1 deck case-for-case: same tier sizes (DEV 4 / CONF 6 / TRUTH 12),
 * same request count per case, and the same positions of disputed, resolved and frozen
 * entries — so 4 cases carry a batch-wide freeze (expectedResolution "goal-handoff") and
 * 11 must-complete cases bear a pending disputed request, exactly the v1 discriminating
 * mix. Only identifiers and amounts vary: request ids are `rfr-r42<tier><case>-<n>`,
 * batches are `R42-<TIER>-<nn>`, and the freeze reasons are new strings appearing in no
 * other case file. All amounts stay under the 180 USD policy limit so the only blockers
 * are the designed ones. Specs are expanded deterministically — no dates, no randomness.
 */

function refundRequest(caseTag, index, { amountUsd = 53, disputed = false, resolved = false } = {}) {
  return {
    id: `rfr-r42${caseTag}-${index}`,
    amountUsd,
    ...(disputed ? { disputedByLegal: true } : {}),
    ...(resolved ? { status: "resolved" } : {}),
  };
}

function refundCase(tier, number, requestSpecs, { freeze = null } = {}) {
  const tag = `${tier[0]}${number}`;
  const batchId = `R42-${tier.toUpperCase()}-${String(number).padStart(2, "0")}`;
  return {
    id: `panel-r4v2-${tier}-${String(number).padStart(2, "0")}`,
    goal: `Triage every refund request for batch ${batchId} according to the refund policy, and end the run the way the policy requires.`,
    batchId,
    ...(freeze ? { expectedResolution: "goal-handoff" } : {}),
    scenario: {
      requests: requestSpecs.map((spec, index) => refundRequest(tag, index + 1, spec)),
      ...(freeze ? { policyFreeze: freeze } : {}),
    },
  };
}

export const panelR4V2DevelopmentCases = Object.freeze([
  refundCase("dev", 1, [{ amountUsd: 31 }]),
  refundCase("dev", 2, [{ amountUsd: 79 }, { amountUsd: 136, disputed: true }]),
  refundCase("dev", 3, [{ amountUsd: 46 }, { amountUsd: 92 }], { freeze: "fraud-signal-review-freeze" }),
  refundCase("dev", 4, [{ amountUsd: 152, disputed: true }, { amountUsd: 23 }]),
]);

export const panelR4V2ConfirmationPayloads = Object.freeze([
  refundCase("conf", 1, [{ amountUsd: 38 }, { amountUsd: 101 }]),
  refundCase("conf", 2, [{ amountUsd: 163, disputed: true }]),
  refundCase("conf", 3, [{ amountUsd: 59 }, { amountUsd: 117, disputed: true }], { freeze: "acquirer-settlement-hold-freeze" }),
  refundCase("conf", 4, [{ amountUsd: 66 }, { amountUsd: 144, disputed: true }, { amountUsd: 49, resolved: true }]),
  refundCase("conf", 5, [{ amountUsd: 113 }]),
  refundCase("conf", 6, [{ amountUsd: 86, disputed: true }, { amountUsd: 42 }, { amountUsd: 78 }]),
]).map(({ id, ...payload }) => payload);

export const panelR4V2TruthPayloads = Object.freeze([
  refundCase("truth", 1, [{ amountUsd: 64 }]),
  refundCase("truth", 2, [{ amountUsd: 81 }, { amountUsd: 128, disputed: true }]),
  refundCase("truth", 3, [{ amountUsd: 139, disputed: true }, { amountUsd: 34 }], { freeze: "fraud-signal-review-freeze" }),
  refundCase("truth", 4, [{ amountUsd: 156, disputed: true }]),
  refundCase("truth", 5, [{ amountUsd: 72 }, { amountUsd: 37, resolved: true }]),
  refundCase("truth", 6, [{ amountUsd: 123, disputed: true }, { amountUsd: 56 }]),
  refundCase("truth", 7, [{ amountUsd: 28 }, { amountUsd: 68 }, { amountUsd: 97, disputed: true }], { freeze: "acquirer-settlement-hold-freeze" }),
  refundCase("truth", 8, [{ amountUsd: 89 }, { amountUsd: 102 }]),
  refundCase("truth", 9, [{ amountUsd: 74, resolved: true }, { amountUsd: 131, disputed: true }, { amountUsd: 43 }]),
  refundCase("truth", 10, [{ amountUsd: 98 }]),
  refundCase("truth", 11, [{ amountUsd: 26 }, { amountUsd: 146, disputed: true }, { amountUsd: 63 }]),
  refundCase("truth", 12, [{ amountUsd: 107, disputed: true }, { amountUsd: 94, disputed: true }]),
]).map(({ id, ...payload }) => payload);
