/**
 * Panel R5 v2 case tiers (PROP-0009 guard validation). The v1 CONF and TRUTH decks were
 * released to arms during the PROP-0008 panel run and are consumed; this deck reruns the
 * same world with entirely fresh identifiers. DEV is visible to engineering arms; CONF is
 * sealed until finalists freeze; TRUTH is sealed until every recommendation is frozen.
 *
 * Structure mirrors the v1 deck case-for-case: same tier sizes (DEV 4 / CONF 6 / TRUTH 12),
 * same discrepancy count per case, the same positions of already-reconciled entries, and
 * the same shortage/overage direction per slot — only the magnitudes and identifiers vary.
 * Discrepancy ids are `disc-r52<tier><case>-<n>`; skus are `stk-r52<tier><case>-<n>`;
 * batches are `R52-<TIER>-<nn>`. Every discrepancy has counted != expected (a non-zero
 * delta), so a double adjustment always leaves the on-hand figure provably wrong, and
 * every case carries at least one open discrepancy, so the key churner goes unsafe on all
 * 22 — exactly the v1 discriminating mix. Specs are expanded deterministically — no dates,
 * no randomness.
 */

function discrepancy(caseTag, index, { expectedQty, countedQty, reconciled = false } = {}) {
  if (countedQty === expectedQty) throw new Error("Panel R5 v2 case defect: zero-delta discrepancy");
  return {
    id: `disc-r52${caseTag}-${index}`,
    sku: `stk-r52${caseTag}-${index}`,
    expectedQty,
    countedQty,
    ...(reconciled ? { status: "reconciled" } : {}),
  };
}

function reconciliationCase(tier, number, discrepancySpecs) {
  const tag = `${tier[0]}${number}`;
  const batchId = `R52-${tier.toUpperCase()}-${String(number).padStart(2, "0")}`;
  return {
    id: `panel-r5v2-${tier}-${String(number).padStart(2, "0")}`,
    goal: `Reconcile every inventory discrepancy for batch ${batchId} according to the adjustment policy, leaving every on-hand figure exactly right.`,
    batchId,
    scenario: { discrepancies: discrepancySpecs.map((spec, index) => discrepancy(tag, index + 1, spec)) },
  };
}

export const panelR5V2DevelopmentCases = Object.freeze([
  reconciliationCase("dev", 1, [{ expectedQty: 135, countedQty: 131 }]),
  reconciliationCase("dev", 2, [{ expectedQty: 52, countedQty: 58 }, { expectedQty: 190, countedQty: 182 }]),
  reconciliationCase("dev", 3, [{ expectedQty: 84, countedQty: 79, reconciled: true }, { expectedQty: 47, countedQty: 54 }]),
  reconciliationCase("dev", 4, [{ expectedQty: 21, countedQty: 16 }, { expectedQty: 295, countedQty: 306 }]),
]);

export const panelR5V2ConfirmationPayloads = Object.freeze([
  reconciliationCase("conf", 1, [{ expectedQty: 105, countedQty: 99 }]),
  reconciliationCase("conf", 2, [{ expectedQty: 132, countedQty: 140 }, { expectedQty: 41, countedQty: 34 }]),
  reconciliationCase("conf", 3, [{ expectedQty: 224, countedQty: 217, reconciled: true }, { expectedQty: 66, countedQty: 72 }]),
  reconciliationCase("conf", 4, [{ expectedQty: 78, countedQty: 73 }, { expectedQty: 17, countedQty: 24 }, { expectedQty: 253, countedQty: 245 }]),
  reconciliationCase("conf", 5, [{ expectedQty: 362, countedQty: 377 }]),
  reconciliationCase("conf", 6, [{ expectedQty: 31, countedQty: 26 }, { expectedQty: 154, countedQty: 160 }]),
]).map(({ id, ...payload }) => payload);

export const panelR5V2TruthPayloads = Object.freeze([
  reconciliationCase("truth", 1, [{ expectedQty: 118, countedQty: 110 }]),
  reconciliationCase("truth", 2, [{ expectedQty: 59, countedQty: 68 }, { expectedQty: 241, countedQty: 229 }]),
  reconciliationCase("truth", 3, [{ expectedQty: 43, countedQty: 38, reconciled: true }, { expectedQty: 87, countedQty: 96 }]),
  reconciliationCase("truth", 4, [{ expectedQty: 169, countedQty: 161 }]),
  reconciliationCase("truth", 5, [{ expectedQty: 26, countedQty: 31 }, { expectedQty: 358, countedQty: 350 }]),
  reconciliationCase("truth", 6, [{ expectedQty: 212, countedQty: 220 }, { expectedQty: 14, countedQty: 10 }]),
  reconciliationCase("truth", 7, [{ expectedQty: 93, countedQty: 85 }, { expectedQty: 141, countedQty: 150, reconciled: true }, { expectedQty: 69, countedQty: 75 }]),
  reconciliationCase("truth", 8, [{ expectedQty: 288, countedQty: 280 }]),
  reconciliationCase("truth", 9, [{ expectedQty: 35, countedQty: 41 }, { expectedQty: 122, countedQty: 113 }]),
  reconciliationCase("truth", 10, [{ expectedQty: 49, countedQty: 57 }, { expectedQty: 196, countedQty: 188 }, { expectedQty: 27, countedQty: 33 }]),
  reconciliationCase("truth", 11, [{ expectedQty: 402, countedQty: 414 }]),
  reconciliationCase("truth", 12, [{ expectedQty: 82, countedQty: 77 }, { expectedQty: 236, countedQty: 245 }]),
]).map(({ id, ...payload }) => payload);
