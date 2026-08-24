import { panelR2ReferenceDecisions } from "./panel-r2-seat-assignment.js";

/**
 * Panel R2 case tiers (PROP-0008). DEV is visible to engineering arms; CONF is sealed
 * until finalists freeze; TRUTH is sealed until every recommendation is frozen and is
 * used only to score the recommendations. All identifiers are fresh to this world.
 *
 * Specs are expanded deterministically — no dates, no randomness. Request ids are
 * `sreq-r2<tier><case>-<n>`; seat ids are `seat-r2<tier><case>-<n>`; batches are
 * `R2-<TIER>-<nn>`. Every case carries at least one approved open request, so the
 * sloppy challenger (which skips assignment logs) soft-fails all 22.
 */

const PRODUCTS = { f: "flowsketch", m: "meshpad", g: "glyphboard" };

function request(caseTag, index, { product = "f", approved = true, closed = false } = {}) {
  return {
    id: `sreq-r2${caseTag}-${index}`,
    product: PRODUCTS[product],
    approvalState: approved ? "approved" : "not-approved",
    ...(closed ? { status: "closed" } : {}),
  };
}

function seat(caseTag, index, { product = "f", occupied = false } = {}) {
  return {
    id: `seat-r2${caseTag}-${index}`,
    product: PRODUCTS[product],
    ...(occupied ? { assignedToRequest: "sreq-held-prior-655" } : {}),
  };
}

function seatCase(tier, number, requestSpecs, seatSpecs) {
  const tag = `${tier[0]}${number}`;
  const batchId = `R2-${tier.toUpperCase()}-${String(number).padStart(2, "0")}`;
  return {
    id: `panel-r2-${tier}-${String(number).padStart(2, "0")}`,
    goal: `Handle every open license-seat request for batch ${batchId} according to the seat-assignment policy, and precisely record every required record.`,
    batchId,
    scenario: {
      requests: requestSpecs.map((spec, index) => request(tag, index + 1, spec)),
      seats: seatSpecs.map((spec, index) => seat(tag, index + 1, spec)),
    },
  };
}

export const panelR2DevelopmentCases = Object.freeze([
  seatCase("dev", 1, [{}], [{}]),
  seatCase("dev", 2, [{ product: "m" }, { product: "f", approved: false }], [{ product: "m" }]),
  seatCase("dev", 3, [{ product: "g" }, { closed: true }], [{ product: "g", occupied: true }, { product: "g" }]),
  seatCase("dev", 4, [{}, {}], [{}, {}, { product: "m" }]),
]);

export const panelR2ConfirmationPayloads = Object.freeze([
  seatCase("conf", 1, [{ product: "m" }], [{ product: "m" }]),
  seatCase("conf", 2, [{}, { product: "m", approved: false }], [{}]),
  seatCase("conf", 3, [{ closed: true }, { product: "g" }], [{ product: "g", occupied: true }, { product: "g" }]),
  seatCase("conf", 4, [{}, { product: "m" }, { closed: true }], [{}, { product: "m" }]),
  seatCase("conf", 5, [{ product: "g", approved: false }, { product: "g" }], [{ product: "g" }, { product: "g" }]),
  seatCase("conf", 6, [{ product: "m" }, { product: "g" }], [{ product: "m" }, { product: "g" }]),
]).map(({ id, ...payload }) => payload);

export const panelR2TruthPayloads = Object.freeze([
  seatCase("truth", 1, [{}], [{}, {}]),
  seatCase("truth", 2, [{ product: "m" }, { approved: false }], [{ product: "m" }]),
  seatCase("truth", 3, [{}, { product: "g" }], [{}, { product: "g" }]),
  seatCase("truth", 4, [{ closed: true }, { product: "m" }], [{ product: "m", occupied: true }, { product: "m" }]),
  seatCase("truth", 5, [{ product: "g" }, { product: "g" }], [{ product: "g" }, { product: "g" }]),
  seatCase("truth", 6, [{}, { product: "m", approved: false }, { closed: true }], [{}]),
  seatCase("truth", 7, [{ product: "m" }], [{ product: "m" }, { product: "g" }]),
  seatCase("truth", 8, [{}, { product: "m" }], [{ occupied: true }, {}, { product: "m" }]),
  seatCase("truth", 9, [{ closed: true }, { closed: true }, { product: "g" }], [{ product: "g" }]),
  seatCase("truth", 10, [{ product: "g" }, { approved: false }], [{ product: "g" }]),
  seatCase("truth", 11, [{}, {}], [{}, {}]),
  seatCase("truth", 12, [{ product: "m" }, { product: "g" }, { closed: true }], [{ product: "m" }, { product: "g" }]),
]).map(({ id, ...payload }) => payload);

/**
 * Designed near-miss profile: identical to the reference solver except it never records
 * the assignment log the policy requires. On every case it should SOFT-fail — a missed
 * scored outcome with zero denied attempts and zero incorrect side effects — proving the
 * verifier still discriminates on a world whose incumbent is at the ceiling.
 */
export function sloppyChallengerDecisions(task) {
  return panelR2ReferenceDecisions(task).filter((decision) => decision.name !== "record-assignment-log");
}
