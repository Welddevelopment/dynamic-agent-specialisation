# DAS-027 bounded declarative runtime compiler checkpoint

Date: 2026-08-14  
Scope: private fictional deterministic local development  
Calls/spend: 0 / $0  
Preregistration: `reports/0105-das027-declarative-runtime-compiler-preregistration.md`

## Verdict

Passed the preregistered bounded disposable-runtime gate.

For one fresh fictional OpenAPI package and one fresh fictional pinned-MCP
package, DAS took the exact reviewed DAS-024 → DAS-023 → DAS-025 → DAS-026
chain and generated actual, separate runnable action-plane and read-only
observer-plane implementation bytes. The generated candidates executed only in
disposable local transports with test-only customer-local credential resolvers.
Both then passed the unchanged DAS-023 ten-control qualification and entered
separately signed DAS-020 nonactivating bundles.

This crosses the previous **zero generated executable files/lines** boundary
for the frozen declarative subset. It does not cross the customer execution or
activation boundary.

## Frozen supported subset actually exercised

- one exact confirmed write per package;
- one exact reconciliation read before any possible retry;
- a separate independently authenticated read-only observer plane;
- flat object inputs containing only bounded primitive strings, integers,
  numbers and booleans;
- exact pinned OpenAPI 3.x method/route/parameter/body serialization or exact
  pinned MCP server/version/tool/input-schema serialization;
- one distinct alias-only credential lease per plane;
- an immediate exact authority check before action transport;
- zero automatic retries;
- fixed time and request ceilings;
- action responses explicitly unable to prove business outcomes.

Nested object input was tested as an unsupported control for each source family
and stopped with the exact schema location rather than being approximated:

- `Action source.createDraftSupplierQualityHold.body.unsupportedNested uses unsupported type object`
- `Action source.draftWarrantyClaimResponse.input.unsupportedNested uses unsupported type object`

Custom authentication, streaming, callbacks, arbitrary transforms/code,
ambiguous or referenced schemas, dynamic endpoints/tools, missing independent
observers and unconfirmed safety/proof semantics remain outside this compiler
subset and must stop before disposable execution.

## Exact sealed result

Artifact root:
`artifacts/onboarding/das027-declarative-runtime-v1`

Result hash:
`c7cef310ee620b812d6bc95f464d2bc1d53e6bd3ae6a27ca87150a6686c3c453`

| Measure | Result |
|---|---:|
| Fresh packages | 2 |
| Source families | OpenAPI + pinned MCP |
| Generated executable files | 4 |
| Generated nonblank executable lines | 322 |
| Generated executable operation surfaces | 10 |
| Package-specific handwritten executable files | 0 |
| Package-specific handwritten executable lines | 0 |
| Unchanged qualification controls | 20/20 |
| Fresh-process lost-response recoveries | 2 |
| Lost-response replayed writes | 0 |
| Observer writes | 0 |
| Surviving unexpected incorrect effects | 0 |
| Direct preregistered attacks | 16/16 rejected |
| Signed nonactivating bundles | 2/2 |
| Customer-executable operations | 0 |
| Model calls / spend | 0 / $0 |

The direct attacks covered exact authority denial before transport, observer
write surfaces, post-seal implementation mutation, endpoint/tool/schema source
widening, cross-package implementation evidence, action-response-as-proof,
credential-value leakage and lost-response replay. Exact request/rate/timeout
values are embedded in content-addressed generated contracts; changing those
bytes invalidates the implementation receipt.

Repository verification after sealing: **488 tests passed, 0 failed, 0 skipped**
under the permissioned full-suite run.

## Failures preserved before the seal

The first end-to-end rehearsals exposed four integration defects. None was
hidden or counted as a passing run:

1. the existing synthetic OpenAPI structural helper supplied no environment
   reference for a declared security scheme;
2. its verifier mapping assumed all readback identities were query/body fields
   rather than deriving path/query/header/body locations from the source;
3. the disposable qualification driver initially challenged credential leases
   against a newly invented composite identity rather than the exact compiled
   work-pack package identity;
4. the observer's internal lease-audit event was initially exposed inside the
   business-state snapshot, correctly triggering the unchanged no-observer-
   mutation check.

The helper now accepts alias-only credential references, derives OpenAPI input
locations from the exact operations, the driver preserves the compiled package
identity, and access-audit state remains separate from externally observed
business state. The final fresh sealed run followed those repairs.

## Remaining customer-specific work

The generator still does not supply a real provider client, a real customer
credential resolver, or a real customer authority source. It has not run in a
customer environment, passed customer acceptance, completed a specialist
comparison, or activated anything. Every signed bundle therefore preserves
these blockers, including separate action and observer transport binding,
credentials, customer conformance, mandatory acceptance, specialist proof,
execution authorization and activation authorization.

A6 remains an external human evidence gate: this checkpoint says nothing about
fresh-user setup time or self-serve usability. B2 remains a separate paid
specialist-quality experiment and was not touched.

## Strongest accurate finding

Within one strict flat-schema declarative subset, DAS can now turn exact
reviewed OpenAPI or pinned-MCP work packs into separate runnable action and
observer implementations, qualify them against the unchanged local safety and
outcome controls, and package them without silently granting customer execution
or activation.

This is private fictional local evidence. It is not arbitrary API/MCP support,
customer deployment, production reliability, demand, or universal autonomous
agent construction.
