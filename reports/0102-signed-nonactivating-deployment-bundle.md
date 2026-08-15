# Checkpoint 0102 — signed nonactivating deployment bundle

Date: 2026-08-14  
Work item: DAS-020 / zero-spend productization lane  
Result: passed inside the frozen private deterministic fictional boundary

## Plain-English result

DAS could already prepare a role, a provisional or selected specialist, generated plugin-project identities, separate implementation identities and local conformance receipts. Those pieces still lived as separate records. A later operator could omit a blocker, pair evidence from another specialist, treat fictional conformance as customer proof, lose the rollback position after restart or hand over an unsigned collection of files.

DAS-020 packages those exact pieces into one customer-local release while keeping it deliberately inactive.

The package is not merely labelled inactive. It contains no activation transition. Its signed readiness record says that customer execution, comparison completion, customer-environment conformance, mandatory acceptance and activation are all false. Missing proof and engineering work are generated into a mandatory blocker ledger rather than accepted as caller-authored notes.

## Exact sealed result

The fresh rehearsal used one clearly labelled synthetic/provisional invoice-dispute specialist bound to the valid DAS-025 v2 OpenAPI fixture evidence.

| Measurement | Result |
|---|---:|
| Immutable package records | 11 |
| Immutable records covered by signed manifest | 11/11 |
| Signature | Ed25519, externally pinned public key required |
| Generated unresolved blockers preserved | 11 |
| Fresh-process reload | passed |
| Durable state revisions | 3 |
| Preview state | `preview-loaded-nonactivating` |
| Final state | `rolled-back-nonactivating` |
| Package integrity after rollback | passed |
| Ready for handoff after rollback | false, by design |
| Adversarial attacks rejected | 15/15 |
| Executable customer operations | 0 |
| Customer execution authority | false |
| Activation authority | false |
| Model calls / spend | 0 / $0 |

Final result hash:

`5a7f6b6db194bba89716045af16b742347bdf12601d55e4317136fe47cb61a4a`

Final `result.json` raw SHA-256:

`32c556f2230dda524f125a2d651788d604e7d6b97ff1670da8d26e983dee6f6f`

The sealed run recorded 30.927459 ms of active machine time. This is not human setup time.

## What the bundle contains

The signed immutable records bind:

1. exact tenant, role, role revision and source identity;
2. the synthetic/provisional specialist and its fingerprint;
3. the exact DAS-025 action/observer project identities;
4. separate action and observer implementation-intent/content identities;
5. the exact fictional local conformance receipt and freshness window;
6. separate action and independently authenticated read-only observer declarations;
7. the upstream readiness input and a stricter generated deployment-readiness receipt;
8. all unresolved owner, administrator, credential, transport, proof, comparison and activation blockers;
9. a safe rollback plan whose fallback leaves the current specialist unchanged; and
10. a signed restart-safe runtime-state genesis.

Every immutable file is owner-only and covered by a raw-byte SHA-256 in the release manifest. The manifest is signed with Ed25519 and inspection requires a separately pinned public key. A package cannot become trusted merely by replacing both its files and its self-supplied key.

The signing private key was ephemeral and was not written into the artifact. A static scan of the sealed directory found no private key, bearer token or API-key-shaped value.

## Mandatory blocker preservation

Even when the caller supplies no blocker list, the provisional path creates and preserves:

- selected specialist not proved;
- customer credentials not resolved;
- customer action transport not bound;
- customer observer transport not bound;
- customer-environment conformance not run;
- mandatory customer acceptance not run;
- comparison readiness unproved;
- customer execution not authorized; and
- activation not authorized.

The sealed fixture also preserved two exact contextual blockers: no customer role-owner review and no assigned workspace administrator.

Changing or omitting a blocker changes the blocker receipt, readiness receipt, bundle identity and signed file manifest. More importantly, the inspector independently requires the mandatory set instead of trusting the caller's list.

## Restart and rollback behavior

Runtime state is mutable, so it is not incorrectly treated as an immutable release file. Instead:

- the immutable signed release binds the exact genesis event;
- every later event carries the previous event hash and exact bundle/tenant/role/revision/specialist/blocker/rollback identities;
- every event is separately signed by the pinned release authority;
- the state file is owner-only and integrity checked;
- stale revisions and cross-bundle rollback requests fail closed; and
- no active or executable status exists in the state machine.

The rehearsal loaded the preview, constructed a new state-store instance, recovered the exact signed revision and then rolled back. Another fresh instance recovered the rolled-back state. Package integrity remained valid, while handoff readiness became false because a rolled-back package must not silently re-enter use.

A safety repair was made before sealing: expired conformance blocks preview and handoff, but never blocks rollback. The rollback store can verify stale evidence as historical integrity-bound evidence without treating it as current proof.

## Adversarial coverage

The sealed campaign rejected 15/15 precommitted attacks:

- cross-specialist evidence;
- changed role revision;
- changed source revision;
- stale conformance evidence;
- collapsed action/observer authentication;
- readiness widening;
- secret leakage;
- missing release signature;
- a valid signature under the wrong externally pinned key;
- post-signature file mutation;
- an unexpected package file;
- active-state substitution inside durable runtime state;
- cross-bundle rollback;
- stale state revision; and
- caller omission of mandatory blockers.

The focused DAS-020 suite passed 9/9. The complete deterministic repository suite then passed 484 tests, failed zero and skipped the one known localhost-permission case.

## What remains unproved

The bundle is more complete operational packaging, not a customer deployment.

The specialist is synthetic/provisional. DAS has not proved that this specialist should replace any customer's existing agent. The action and observer project shells remain non-executable. Their separately supplied implementation identities and conformance receipt come from a fictional disposable local world. No customer credential, customer authority, live transport, customer-environment observation, mandatory acceptance, comparison result or activation exists.

Therefore this checkpoint does not establish:

- an eligible selected customer specialist;
- a working customer action or observer plugin;
- customer comparison readiness;
- customer acceptance or deployment;
- human setup-time reduction;
- customer value or willingness to pay; or
- production reliability.

## Artifacts

- Preregistration: `reports/0102-das020-nonactivating-deployment-bundle-preregistration.md`
- Final report: `reports/0102-signed-nonactivating-deployment-bundle.md`
- Final result: `artifacts/onboarding/das020-nonactivating-deployment-bundle-v1/result.json`
- Signed package: `artifacts/onboarding/das020-nonactivating-deployment-bundle-v1/bundle/`
- Externally pinned public key for this rehearsal: `artifacts/onboarding/das020-nonactivating-deployment-bundle-v1/release-public-key.pem`

## Next measured gates

A6 remains the correct human evidence gate and cannot be simulated: a fresh person must attempt the journey while actual time, confusion, decisions, edits and engineer intervention are measured.

Until that person is available, productization work should be driven by the exact remaining customer-local action/observer implementation blockers rather than another packaging layer. The core technical frontier remains B2: a separately frozen, paid, prospective comparison against the strong adaptive-engineer baseline. DAS-020 did not call a model or authorize that campaign.

