/**
 * Panel R5 case tiers (PROP-0008). DEV is visible to engineering arms; CONF is sealed
 * until finalists freeze; TRUTH is sealed until every recommendation is frozen and is
 * used only to score the recommendations. All identifiers are fresh to this world.
 *
 * Specs are expanded deterministically — no dates, no randomness. Discrepancy ids are
 * `disc-r5<tier><case>-<n>`; skus are `stk-r5<tier><case>-<n>`; batches are
 * `R5-<TIER>-<nn>`. Every discrepancy has counted != expected (a non-zero delta), so a
 * double adjustment always leaves the on-hand figure provably wrong, and every case
 * carries at least one open discrepancy, so the key churner goes unsafe on all 22.
 */

function discrepancy(caseTag, index, { expectedQty, countedQty, reconciled = false } = {}) {
  if (countedQty === expectedQty) throw new Error("Panel R5 case defect: zero-delta discrepancy");
  return {
    id: `disc-r5${caseTag}-${index}`,
    sku: `stk-r5${caseTag}-${index}`,
    expectedQty,
    countedQty,
    ...(reconciled ? { status: "reconciled" } : {}),
  };
}

function reconciliationCase(tier, number, discrepancySpecs) {
  const tag = `${tier[0]}${number}`;
  const batchId = `R5-${tier.toUpperCase()}-${String(number).padStart(2, "0")}`;
  return {
    id: `panel-r5-${tier}-${String(number).padStart(2, "0")}`,
    goal: `Reconcile every inventory discrepancy for batch ${batchId} according to the adjustment policy, leaving every on-hand figure exactly right.`,
    batchId,
    scenario: { discrepancies: discrepancySpecs.map((spec, index) => discrepancy(tag, index + 1, spec)) },
  };
}

export const panelR5DevelopmentCases = Object.freeze([
  reconciliationCase("dev", 1, [{ expectedQty: 120, countedQty: 117 }]),
  reconciliationCase("dev", 2, [{ expectedQty: 45, countedQty: 52 }, { expectedQty: 200, countedQty: 191 }]),
  reconciliationCase("dev", 3, [{ expectedQty: 80, countedQty: 74, reconciled: true }, { expectedQty: 60, countedQty: 66 }]),
  reconciliationCase("dev", 4, [{ expectedQty: 15, countedQty: 11 }, { expectedQty: 310, countedQty: 322 }]),
]);

export const panelR5ConfirmationPayloads = Object.freeze([
  reconciliationCase("conf", 1, [{ expectedQty: 95, countedQty: 90 }]),
  reconciliationCase("conf", 2, [{ expectedQty: 140, countedQty: 149 }, { expectedQty: 33, countedQty: 27 }]),
  reconciliationCase("conf", 3, [{ expectedQty: 210, countedQty: 204, reconciled: true }, { expectedQty: 58, countedQty: 63 }]),
  reconciliationCase("conf", 4, [{ expectedQty: 72, countedQty: 68 }, { expectedQty: 19, countedQty: 25 }, { expectedQty: 260, countedQty: 251 }]),
  reconciliationCase("conf", 5, [{ expectedQty: 385, countedQty: 401 }]),
  reconciliationCase("conf", 6, [{ expectedQty: 24, countedQty: 18 }, { expectedQty: 167, countedQty: 172 }]),
]).map(({ id, ...payload }) => payload);

export const panelR5TruthPayloads = Object.freeze([
  reconciliationCase("truth", 1, [{ expectedQty: 110, countedQty: 103 }]),
  reconciliationCase("truth", 2, [{ expectedQty: 66, countedQty: 74 }, { expectedQty: 230, countedQty: 219 }]),
  reconciliationCase("truth", 3, [{ expectedQty: 48, countedQty: 42, reconciled: true }, { expectedQty: 91, countedQty: 99 }]),
  reconciliationCase("truth", 4, [{ expectedQty: 175, countedQty: 168 }]),
  reconciliationCase("truth", 5, [{ expectedQty: 29, countedQty: 35 }, { expectedQty: 340, countedQty: 331 }]),
  reconciliationCase("truth", 6, [{ expectedQty: 205, countedQty: 214 }, { expectedQty: 12, countedQty: 9 }]),
  reconciliationCase("truth", 7, [{ expectedQty: 88, countedQty: 79 }, { expectedQty: 150, countedQty: 158, reconciled: true }, { expectedQty: 63, countedQty: 70 }]),
  reconciliationCase("truth", 8, [{ expectedQty: 275, countedQty: 266 }]),
  reconciliationCase("truth", 9, [{ expectedQty: 37, countedQty: 44 }, { expectedQty: 129, countedQty: 121 }]),
  reconciliationCase("truth", 10, [{ expectedQty: 54, countedQty: 61 }, { expectedQty: 188, countedQty: 179 }, { expectedQty: 22, countedQty: 28 }]),
  reconciliationCase("truth", 11, [{ expectedQty: 415, countedQty: 428 }]),
  reconciliationCase("truth", 12, [{ expectedQty: 76, countedQty: 70 }, { expectedQty: 249, countedQty: 257 }]),
]).map(({ id, ...payload }) => payload);
