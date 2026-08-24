/**
 * Panel R1 case tiers (PROP-0008). DEV is visible to engineering arms; CONF is sealed
 * until finalists freeze; TRUTH is sealed until every recommendation is frozen and is
 * used only to score the recommendations. All identifiers are fresh to this world.
 *
 * Specs are expanded deterministically — no dates, no randomness. Account ids are
 * `acct-r1<tier><case>-<n>`; batches are `R1-<TIER>-<nn>`.
 */

const CYCLE = "2026-C9";

function account(caseTag, index, { verified = false, closed = false, term = "annual", amountUsd = 240 } = {}) {
  return {
    id: `acct-r1${caseTag}-${index}`,
    term,
    amountUsd,
    ...(verified ? { paymentVerifiedCycle: CYCLE } : {}),
    ...(closed ? { requestStatus: "closed", renewalApplied: true } : {}),
  };
}

function renewalCase(tier, number, accounts, { existing } = {}) {
  const tag = `${tier[0]}${number}`;
  const batchId = `R1-${tier.toUpperCase()}-${String(number).padStart(2, "0")}`;
  return {
    id: `panel-r1-${tier}-${String(number).padStart(2, "0")}`,
    goal: `Process every pending renewal for batch ${batchId} according to the renewal policy, and precisely record every required record.`,
    batchId,
    cycle: CYCLE,
    scenario: { accounts: accounts.map((spec, index) => account(tag, index + 1, spec)), ...(existing ? { existing } : {}) },
  };
}

export const panelR1DevelopmentCases = Object.freeze([
  renewalCase("dev", 1, [{}]),
  renewalCase("dev", 2, [{ verified: true, term: "monthly", amountUsd: 25 }]),
  renewalCase("dev", 3, [{}, { closed: true }]),
  renewalCase("dev", 4, [{ term: "quarterly", amountUsd: 72 }, { verified: true }]),
]);

export const panelR1ConfirmationPayloads = Object.freeze([
  renewalCase("conf", 1, [{}, {}]),
  renewalCase("conf", 2, [{ verified: true, term: "biennial", amountUsd: 430 }]),
  renewalCase("conf", 3, [{ closed: true }, { term: "monthly", amountUsd: 19 }]),
  renewalCase("conf", 4, [{}, { verified: true, term: "quarterly", amountUsd: 66 }, { closed: true }]),
  renewalCase("conf", 5, [{ term: "monthly", amountUsd: 31 }]),
  renewalCase("conf", 6, [{ verified: true }, {}]),
]).map(({ id, ...payload }) => payload);

export const panelR1TruthPayloads = Object.freeze([
  renewalCase("truth", 1, [{}]),
  renewalCase("truth", 2, [{ verified: true, term: "monthly", amountUsd: 22 }]),
  renewalCase("truth", 3, [{}, {}]),
  renewalCase("truth", 4, [{ closed: true }, {}]),
  renewalCase("truth", 5, [{ term: "quarterly", amountUsd: 81 }, { verified: true, term: "annual", amountUsd: 210 }]),
  renewalCase("truth", 6, [{ verified: true }, { closed: true }, {}]),
  renewalCase("truth", 7, [{ term: "biennial", amountUsd: 399 }]),
  renewalCase("truth", 8, [{}, { verified: true, term: "monthly", amountUsd: 27 }]),
  renewalCase("truth", 9, [{ closed: true }, { closed: true }, {}]),
  renewalCase("truth", 10, [{ verified: true, term: "quarterly", amountUsd: 75 }, {}]),
  renewalCase("truth", 11, [{ term: "monthly", amountUsd: 18 }, { term: "monthly", amountUsd: 18 }]),
  renewalCase("truth", 12, [{}, { verified: true }, { closed: true }]),
]).map(({ id, ...payload }) => payload);
