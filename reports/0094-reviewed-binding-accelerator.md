# 0094 — Reviewed OpenAPI/MCP binding accelerator

## Verdict

DAS now joins approved local OpenAPI and pinned MCP material to one exact saved onboarding revision, requires a consequential customer review, and emits separate tamper-evident adapter and independent-verifier work packs.

The result is deliberately non-executable. It does not grant authority, store credentials, claim that a customer-local adapter works, treat a transport read-back as business-outcome proof, or advance comparison and activation readiness.

No paid model calls, external services, customer data or deployment were used.

## What the joined path does

For both supported import shapes, DAS now:

1. normalizes the approved source material and binds its identity;
2. presents every proposed operation for explicit review;
3. maps each approved source operation one-to-one onto an operation already present in the saved role contract;
4. requires an explicit read/write decision when source metadata is ambiguous;
5. restricts write mappings to authority actions already declared by the customer;
6. records approved context sources without treating imported content as instructions;
7. keeps source-schema identity separate from the later compiled runtime schema;
8. creates a private adapter-configuration draft;
9. creates a separate independent business-outcome-verifier scaffold;
10. lists every remaining engineering and proof obligation; and
11. persists the confirmation and work-plan hashes in the assisted-onboarding record and readiness receipt.

The customer-local console exposes the same import -> review -> work-plan path. Its final view explicitly reports zero executable operations and shows the remaining work instead of calling the system comparison-ready.

## Deterministic rehearsal

One fresh fictional support intake was exercised through two distinct import modes:

| Import mode | Approved operations | Explicit fields | Generated or customer-confirmed | Engineer or independent-proof fields remaining | Completion ratio | Executable operations |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| OpenAPI | 2 | 36 | 12 | 24 | 33.33% | 0 |
| MCP | 2 | 36 | 12 | 24 | 33.33% | 0 |

These are field-level setup-coverage measurements, not estimates of engineering time or lines of code. Both paths report that the existing generic transport compiler is intended to avoid custom transport source files for the supported bounded shapes, but neither rehearsal proves compilation against an unfamiliar customer system.

Private evidence:

- `artifacts/onboarding/binding-accelerator-v1/summary.json`
- OpenAPI work-plan hash: `e41e4c159089aa8d4ed36f2ef527dce7f5c02eaea67deb2ee90c142fe9134088`
- MCP work-plan hash: `b380cb74a0241f01e5db5ed8ff2322309349c33c3600b566ee22c1a5962c1641`

## Fail-closed boundaries tested

The implementation rejects or preserves as blocked:

- unknown or newly invented authority;
- duplicate source-to-role operation mappings;
- ambiguous MCP read/write classification without confirmation;
- proposal, source, server, intake or persisted-artifact mutation;
- credentials and raw source material in generated work packs;
- unsupported role operations that have no reviewed source mapping;
- unbound idempotency and lost-response reconciliation for writes;
- missing customer-local runtime wiring;
- missing direct external-state verifier implementation;
- unrun mandatory binding acceptance; and
- any attempt to treat a complete-looking draft as execution, comparison or activation evidence.

MCP now has parity with the existing OpenAPI commercial-descriptor binder while preserving a distinct semantic adapter version. The binder still leaves verifier implementation and acceptance evidence explicitly unproved.

## Verification

The complete local test suite passed **412/412** with zero failures after the shared-core changes. The localhost console endpoint was also run separately with local-bind permission and passed **1/1**.

The private technical-readiness audit was refreshed successfully:

- audit hash: `f5eca58d088a3f989c2bdb98bf67eb3083f842bcd6422b1d93555dbaae0e09ee`;
- customer deployment: not completed;
- production reliability: not established; and
- market demand: not established.

The test count is repository regression coverage, not a customer-reliability or production-safety percentage.

## Remaining setup work

The rehearsal makes the residual work precise. The largest remaining classes are:

1. mappings for required role operations absent from the supplied schema;
2. compiled runtime-schema and transport checks;
3. write idempotency and unknown-outcome reconciliation;
4. customer-local credential references and runtime wiring;
5. direct external-state readers and business assertions; and
6. mandatory binding acceptance evidence.

Frontend implementation remains frozen at design-and-scaffold-only. Its customer-local design-source binding, repository/draft-PR binding and independent repository/build/responsive-result verifier remain missing.

## Next queue decision

Proceed to **DAS-010: repeated fresh-start onboarding teardowns**. The next checkpoint must measure exactly where an independent setup still depends on author-only knowledge across discovery, source-to-role mapping, write reconciliation, verifier definition and activation readiness, then remove the largest repeatable software omission rather than merely documenting it.

## Claim boundary

Strongest accurate wording:

> DAS can turn approved OpenAPI or MCP material into a reviewed, provenance-bound binding and verifier work plan for an exact saved role, while refusing to mistake generated scaffolding for an executable or verified customer integration.

This does not establish self-serve onboarding, arbitrary protocol support, executable unfamiliar-system adapters, customer setup-time savings, independent verifier correctness, comparison success, activation readiness, customer value or production reliability.
