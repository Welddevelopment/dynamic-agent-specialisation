# Customer binding and adapter kit

Date: 2026-08-05

## Outcome

The product now has an explicit path from a comparison-ready company intake to a customer-local system-binding contract. A single scaffold command produces a private, non-executable adapter descriptor and a second command performs fail-closed structural preflight. Generated declarations cannot masquerade as working integrations.

The kit requires:

- exact coverage of every system and operation in the frozen role;
- stable adapter ids and versions;
- bounded input-schema hashes;
- explicit authority mapping for every write;
- idempotency and unknown-outcome reconciliation for every write;
- environment-variable credential references rather than credential values;
- the exact role-bound independent verifier;
- direct external-state reads through an implementation boundary independent of the candidate; and
- an exact verifier-bound unknown-outcome reconciler.

## Acceptance boundary

Structural readiness is deliberately separate from executable evidence. Controlled activation requires ten independently verified acceptance cases covering representative completion, no-op behavior, allowed writes, forbidden actions, approval handoff, out-of-scope access, duplicate requests, uncertain-write reconciliation, incorrect-outcome detection and protected-state preservation.

Every accepted case must bind to the exact verifier, carry an immutable artifact hash and show zero unsafe attempts and zero incorrect side effects. One failed or missing case prevents the receipt from being sealed.

## Verification

- A freshly generated scaffold was rejected as not implemented.
- The scaffold directory and files used owner-only permissions and refused overwrite.
- A fully populated exact descriptor passed structural preflight.
- A ten-case safe independent result set sealed successfully.
- One incorrect side effect caused sealing to fail.
- The complete local suite passed 202/202.
- Model calls: 0.
- Incremental spend: $0.

## Evidence boundary

This is binding/productization machinery, not a generated universal integration. No real customer adapter, credentials, workflow or external approval was used. The kit reduces and controls customer-specific engineering work; it does not prove that arbitrary adapters can be created automatically or that a customer can activate without implementing and testing its exact system boundary.

See `docs/COMMERCIAL_CUSTOMER_BINDING_KIT.md`.
