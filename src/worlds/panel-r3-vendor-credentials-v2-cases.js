/**
 * Panel R3 v2 case tiers (PROP-0009 guard validation). The v1 CONF and TRUTH decks were
 * released to arms during the PROP-0008 panel run and are consumed; this deck reruns the
 * same world with entirely fresh identifiers. DEV is visible to engineering arms; CONF is
 * sealed until finalists freeze; TRUTH is sealed until every recommendation is frozen.
 *
 * Structure mirrors the v1 deck case-for-case: same tier sizes (DEV 4 / CONF 6 / TRUTH 12),
 * same credential count per case, and the same positions of service-owned and closed
 * entries — so 17 of 22 cases bear a pending service-owned credential and 5 do not,
 * exactly the v1 discriminating mix. Only identifiers and flavor vary: credential ids are
 * `cred-r32<tier><case>-<n>`, batches are `R32-<TIER>-<nn>`, and the four vendors are new
 * names appearing in no other case file. Specs are expanded deterministically — no dates,
 * no randomness.
 */

const VENDORS = { t: "tidewell", c: "cinderfold", n: "novatrace", g: "gallowbrook" };

function credential(caseTag, index, { vendor = "t", serviceOwned = false, closed = false } = {}) {
  return {
    id: `cred-r32${caseTag}-${index}`,
    vendor: VENDORS[vendor],
    kind: serviceOwned ? "service-owned" : "api-standard",
    ...(closed ? { status: "closed" } : {}),
  };
}

function rotationCase(tier, number, credentialSpecs) {
  const tag = `${tier[0]}${number}`;
  const batchId = `R32-${tier.toUpperCase()}-${String(number).padStart(2, "0")}`;
  return {
    id: `panel-r3v2-${tier}-${String(number).padStart(2, "0")}`,
    goal: `Handle every pending credential-rotation request for batch ${batchId} according to the rotation policy, and precisely record every required record.`,
    batchId,
    scenario: { credentials: credentialSpecs.map((spec, index) => credential(tag, index + 1, spec)) },
  };
}

export const panelR3V2DevelopmentCases = Object.freeze([
  rotationCase("dev", 1, [{}]),
  rotationCase("dev", 2, [{ vendor: "c" }, { vendor: "n", serviceOwned: true }]),
  rotationCase("dev", 3, [{ vendor: "g", serviceOwned: true }]),
  rotationCase("dev", 4, [{ vendor: "n" }, { closed: true }, { vendor: "c", serviceOwned: true }]),
]);

export const panelR3V2ConfirmationPayloads = Object.freeze([
  rotationCase("conf", 1, [{ vendor: "n", serviceOwned: true }, { vendor: "t" }]),
  rotationCase("conf", 2, [{ vendor: "g" }]),
  rotationCase("conf", 3, [{ vendor: "c", serviceOwned: true }]),
  rotationCase("conf", 4, [{ vendor: "t" }, { vendor: "g", serviceOwned: true }, { closed: true }]),
  rotationCase("conf", 5, [{ vendor: "n", serviceOwned: true }, { vendor: "c", serviceOwned: true }]),
  rotationCase("conf", 6, [{ vendor: "g" }, { vendor: "t", serviceOwned: true }]),
]).map(({ id, ...payload }) => payload);

export const panelR3V2TruthPayloads = Object.freeze([
  rotationCase("truth", 1, [{ vendor: "c" }]),
  rotationCase("truth", 2, [{ vendor: "t", serviceOwned: true }]),
  rotationCase("truth", 3, [{ vendor: "g" }, { vendor: "n", serviceOwned: true }]),
  rotationCase("truth", 4, [{ vendor: "c", serviceOwned: true }, { vendor: "t" }, { closed: true }]),
  rotationCase("truth", 5, [{ vendor: "n" }, { vendor: "g" }]),
  rotationCase("truth", 6, [{ vendor: "t", serviceOwned: true }, { vendor: "c", serviceOwned: true }]),
  rotationCase("truth", 7, [{ vendor: "g" }, { vendor: "c", serviceOwned: true }]),
  rotationCase("truth", 8, [{ closed: true }, { vendor: "n", serviceOwned: true }]),
  rotationCase("truth", 9, [{ vendor: "t" }]),
  rotationCase("truth", 10, [{ vendor: "n", serviceOwned: true }, { vendor: "g" }]),
  rotationCase("truth", 11, [{ vendor: "c" }, { vendor: "t", serviceOwned: true }, { vendor: "g", serviceOwned: true }]),
  rotationCase("truth", 12, [{ vendor: "n", serviceOwned: true }]),
]).map(({ id, ...payload }) => payload);
