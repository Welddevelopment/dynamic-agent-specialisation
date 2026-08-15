# Checkpoint 0099 — provider-neutral customer-local qualification transfer

Date: 2026-08-14  
Work item: DAS-023 / zero-spend productization lane  
Result: passed inside the frozen private deterministic local boundary

## Plain-English result

DAS-022 proved one carefully authored OpenAPI fixture could keep a write path and an independent read-only proof path separate and classify ten important outcomes safely. DAS-023 asked the harder follow-up: was that machinery actually reusable, or had the fixture quietly hard-coded most of the result?

The new path separates four things:

1. reviewed source and role facts;
2. explicit owner/engineer write-safety and proof meaning;
3. a provider-neutral factory that turns those facts into integrity-bound non-executable action, observer and work-pack artifacts; and
4. one shared qualification bridge that supplies the authentication, runtime identity, canonical-case, restart and evidence choreography.

Two materially different fresh fictional packages then used that same path:

- **Alderbridge supplier compliance:** pinned OpenAPI, one draft supplier-compliance review, an HTTP idempotency header and a separate audit origin;
- **ParcelDock returns:** pinned MCP action server, one draft return authorization, a required MCP idempotency input and a separately pinned read-only MCP audit server.

Each package passed the unchanged ten-control campaign. The actual generic source-file manifest was frozen after Package A and remained byte-for-byte unchanged after Package B was opened and run.

## Exact result

| Measurement | OpenAPI package | MCP package | Aggregate |
|---|---:|---:|---:|
| Structurally compiled operations | 3 | 3 | 6 |
| Canonical controls | 10/10 | 10/10 | 20/20 |
| Business writes across controls | 8 | 8 | 16 |
| Observer writes | 0 | 0 | 0 |
| Blind retries | 0 | 0 | 0 |
| Lost-response writes | 1 | 1 | 2 |
| Lost-response replays | 0 | 0 | 0 |
| Unsafe or ambiguous outcomes accepted | 0 | 0 | 0 |
| Fresh-process same-store recovery | passed | passed | 2/2 |
| Executable operations | 0 | 0 | 0 |
| Model calls / spend | 0 / $0 | 0 / $0 | 0 / $0 |

Sealed campaign result hash:

`abbceae156382851e882cb1f23beca44cf7ab095eef2df23a7fedad5c3191ab1`

The aggregate active machine time in the sealed run was 58.179 ms. This is deliberately **not** labelled human setup time.

## What became shared

The provider-neutral package factory now:

- revalidates the complete DAS-012 structural receipt and reviewed work plan;
- pins the exact OpenAPI document/server or MCP server/version/tools-list identity;
- requires one typed write-safety contract for every reviewed write;
- requires separate observer source, authentication, implementation, schema, transport, surface and credential aliases;
- binds stable identity, idempotency/conflict, one-write scope, reconciliation, retry, unknown/unavailable, freshness, exact outcome, duplicate and collateral rules;
- binds every rule to explicit customer-confirmed or engineer-supplied-unproved provenance;
- produces seven integrity-linked artifact categories, including a non-executable candidate and exact remaining-work receipt;
- never adds credentials, runtime authority, execution, comparison readiness or activation.

The shared qualification bridge now supplies what DAS-022 previously repeated inside one 853-line rehearsal:

- the immutable ten-control cases and write ceilings;
- synthetic action/observer challenge authentication;
- exact source/runtime/schema/transport/implementation checks;
- action/observer principal, surface, transport and alias separation;
- read-only observer mutation checks;
- one-attempt/no-blind-retry choreography;
- fresh-process, same-durable-store recovery after a lost response;
- the unchanged DAS-022 independent outcome classifier and receipts.

For both fresh packages, no package-specific action factory, observer factory, authentication routine, canonical-case builder, measurement routine or branch in the generic core was written. The MCP action-plane readback remains explicitly labelled duplicate-prevention readback and `independentBusinessOutcomeProof: false`; it cannot substitute for the separately pinned observer.

## What remains explicitly authored

This checkpoint does **not** turn an unknown customer system into a safe live binding automatically.

The two fictional definitions still explicitly supply substantial business and source truth: full intake, source schemas/tool lists, approved operation mappings, allowed and forbidden outcomes, authority, stable identity, idempotency location, exact success fields, freshness, duplicate/collateral meaning and deterministic fault outcomes. The combined fresh-package definition file is 245 lines. That is simpler and more auditable than copied runtime factories, but it is still authored work—not hidden automation.

The shared implementation added a large reusable foundation: 496 lines for the package factory, 454 for the runtime bridge and 199 for the declarative disposable world. This is a capital cost paid once in the prototype, not evidence that a customer is now easy to onboard.

Therefore the defensible setup conclusion is narrow:

> For these two supported local shapes, repeated runtime/authentication/control choreography transferred into shared primitives and the second source family required no generic-core change. Human setup time, real customer binding effort and unassisted onboarding remain unmeasured.

## Failures preserved

Three non-result failures occurred before the sealed evidence write:

1. Package A exposed that the new factory treated a role template id and its exact session-qualified binding id as unrelated. The generic identity check was repaired and regression-tested before Package B opened.
2. Package A exposed that the reviewed OpenAPI work plan pins a safe origin while the structural compiler pins the full path-prefixed base URL. The factory was repaired to bind both identities correctly and regression-tested before Package B opened.
3. The first complete paired execution reached the final evidence write, then received `EPERM` because this task's default sandbox cannot write into the independent DAS repository. No evidence directory existed. The exact unchanged command was rerun with approved filesystem access and produced the sealed result above.

These are preserved as implementation and environment failures, not hidden retries or extra empirical samples.

## Adversarial validation

The focused joined suite passed 48/48. It covers:

- cross-role, source, confirmation, package and harness substitution;
- action/observer implementation, source, schema, transport, credential and principal substitution/collapse;
- credential material rejection;
- MCP source subset, schema, version and required idempotency checks;
- authority widening and incomplete operation coverage;
- caller-weakened classification, disposition and write bounds;
- blind retry and weakened unknown/unavailable handling;
- nested action-response material presented as observer proof;
- future and pre-existing evidence;
- partial, incorrect, duplicate, stale, collateral, unknown and unavailable outcomes;
- observer write/state mutation;
- post-action driver identity drift;
- same-process or different-store lost-response recovery;
- receipt reuse after upstream mutation.

The full deterministic repository suite also completed green after the shared-core changes. `git diff --check` passed. Sealed artifacts are mode `0600`, and the campaign result hash recomputes exactly.

## Protected gates

All of the following remain false or zero:

- customer credential values;
- production/customer runtime authority;
- executable operations;
- real action or observer connection;
- mandatory customer-environment acceptance;
- comparison readiness;
- controlled activation;
- customer evidence;
- production reliability;
- human setup-time evidence;
- model calls and spend.

The generated pre-qualification work packs still say local qualification has not run because they are immutable descriptions created *before* the separate qualification evidence. The campaign summary links those pre-qualification artifacts to later local receipts without rewriting their original state.

## Evidence artifacts

- Preregistration: `reports/0099-das023-transfer-preregistration.md`
- Campaign: `artifacts/onboarding/customer-local-binding-transfer-v1/summary.json`
- Source manifest: `artifacts/onboarding/customer-local-binding-transfer-v1/source-manifest.json`
- Package A chain: `artifacts/onboarding/customer-local-binding-transfer-v1/alderbridge-supplier-compliance-openapi-v1.json`
- Package B chain: `artifacts/onboarding/customer-local-binding-transfer-v1/parceldock-return-authorization-mcp-v1.json`

## Claim boundary

DAS-023 supports one private deterministic local claim: the same frozen provider-neutral scaffold/qualification core transferred across one fresh fictional OpenAPI package and one fresh fictional pinned-MCP package, and both passed the same ten controls without a Package-B core repair.

It does not prove arbitrary APIs or MCP servers, live transports, real credentials, customer acceptance, unassisted setup, setup speed, production reliability, demand, comparison readiness or activation.

## Next technical decision

The largest remaining productization uncertainty is no longer copied qualification choreography. It is whether a fresh engineer or role owner can provide the still-explicit business/safety/proof facts and connect real customer-local transports without author-only knowledge. The direct test is the prospective fresh-user study plus, where no external person is available yet, stricter generation of source-grounded transport/observer implementation skeletons whose omissions stay visible.

