import assert from "node:assert/strict";
import test from "node:test";

import { digest } from "../src/core/canonical.js";
import {
  assertOnboardingTeardownLedger,
  createOnboardingTeardownLedger,
} from "../src/product/onboarding-teardown-ledger.js";

function fixture() {
  const record = {
    schemaVersion: "das.assisted-onboarding-record.v1",
    sessionId: "teardown-ledger-test",
    revision: 1,
    intakeProvenance: {
      facts: [
        { path: "role.title", status: "customer-supplied", valuePresent: true },
        { path: "role.maxParallel", status: "das-safe-default", valuePresent: true },
        { path: "role.unknownLimit", status: "unknown", valuePresent: false },
      ],
      provenanceHash: "provenance-test-hash",
    },
    systemImports: [],
  };
  record.recordHash = digest(record);
  return {
    record,
    projection: { sessionId: record.sessionId },
    readinessReceipt: {
      receiptHash: "receipt-test-hash",
      session: { recordHash: record.recordHash },
    },
  };
}

test("teardown ledger separates traceable used facts from precise unknowns", () => {
  const ledger = createOnboardingTeardownLedger(fixture());

  assert.equal(assertOnboardingTeardownLedger(ledger), true);
  assert.equal(ledger.measurements.meaningfulSetupUnits, 3);
  assert.equal(ledger.measurements.usedToAdvanceUnits, 2);
  assert.equal(ledger.measurements.traceableUsedToAdvanceUnits, 2);
  assert.equal(ledger.measurements.provenanceCoverage, 1);
  assert.equal(ledger.measurements.preciseUnknownOrBlockedUnits, 1);
  assert.equal(ledger.measurements.silentAuthorOnlyInjections, 0);
  assert.equal(ledger.measurements.authorityGrantedRows, 0);
  assert.equal(ledger.measurements.credentialValueRows, 0);
});

test("teardown ledger integrity detects mutation", () => {
  const ledger = structuredClone(createOnboardingTeardownLedger(fixture()));
  ledger.measurements.provenanceCoverage = 0;

  assert.throws(
    () => assertOnboardingTeardownLedger(ledger),
    /integrity mismatch/,
  );
});
