# Checkpoint 0100 — source-grounded package-draft authoring

Date: 2026-08-14  
Work item: DAS-024 / zero-spend productization lane  
Result: passed inside the frozen private deterministic local boundary

## Plain-English result

DAS-023 could safely validate a complete action/observer package, but a knowledgeable author still had to write most of that package data directly. DAS-024 replaces that author-only translation step with an integrity-bound authoring process.

The process now starts from only:

- a bounded ordinary-language description of the role, intended mutation, observable outcome, known identity, limits and escalation owner;
- one exact pinned action source;
- one exact pinned observer source; and
- customer-local credential aliases, never credential values.

It extracts the source operation, parameter, schema, response/error and transport inventory; records five explicitly provisional source-grounded suggestions; and creates a dependency-ordered graph of 43 precise owner/engineer questions. It cannot silently turn those suggestions into authority, write safety, observer independence or proof. Only explicit answers can complete the package-input draft.

Two fresh fictional packages completed that path:

- **Northstar invoice-dispute drafting:** OpenAPI action source plus a separate paginated read-only AP-audit source;
- **Fieldhaven equipment-damage review drafting:** pinned MCP action server plus a separate pinned read-only audit MCP server.

A third malicious OpenAPI input tried to grant itself authority, call its own response proof, reuse the action source as observer and reuse the same credential alias. Its text remained inert, three hard trust-plane blockers remained visible, no package was generated and it never entered qualification.

## Exact sealed v2 result

| Measurement | OpenAPI | MCP | Aggregate |
|---|---:|---:|---:|
| Source operations extracted | 6 | 7 | 17 including malicious control |
| Atomic questions generated | 43 | 43 | 129 including malicious control |
| Explicit answers | 43 | 43 | 86 |
| Observed facts | 9 | 9 | 18 |
| Extracted facts | 4 | 4 | 8 |
| Provisional source-grounded facts | 5 | 5 | 10 |
| Owner-confirmed facts | 19 | 19 | 38 |
| Engineer-confirmed, still unproved facts | 24 | 24 | 48 |
| Independently verified facts during authoring | 0 | 0 | 0 |
| Unknown facts after complete answer packet | 0 | 0 | 0 |
| Fresh-process receipt equality | passed | passed | 2/2 |
| Separate DAS-023 qualification | 10/10 | 10/10 | 20/20 |
| Observer writes | 0 | 0 | 0 |
| Lost-response writes / replays | 1 / 0 | 1 / 0 | 2 / 0 |
| Unsafe or ambiguous outcomes accepted | 0 | 0 | 0 |
| Executable operations | 0 | 0 | 0 |
| Model calls / spend | 0 / $0 | 0 / $0 | 0 / $0 |

Sealed v2 result hash:

`37eb08b9bc6bf4cefc18697c442bc30b9bf07a2bd584d484ebeb431e18024e8b`

The sealed campaign recorded 87.089 ms of active machine time. This is deliberately not described as human setup time.

## What the authoring engine now does

The new provider-neutral engine:

1. bounds and hashes the ordinary-language intake, source material and alias-only credential references;
2. rejects credential values, external references, unsafe object keys, duplicate operations and oversized structures;
3. records source descriptions and MCP annotations as untrusted evidence, never instructions;
4. extracts exact OpenAPI or MCP operation inventories and source hashes;
5. proposes write, read, observer, stable-identity and idempotency candidates while labelling them `inferred-proposal`;
6. asks separate owner and engineer questions for action mapping, authority, stable identity, conflict behavior, write scope, retry, reconciliation, observer identity, exact outcome, freshness, duplicates, collateral state and all ten terminal classifications;
7. binds every answer to the exact session, role/source/alias identity, question target and prior session revision;
8. makes exact replay idempotent while rejecting changed replay, stale revision submission, source substitution and cross-source materialization;
9. stores each completed revision privately with an integrity hash and verifies it after a fresh-process reload; and
10. translates only a fully answered, unblocked session into the exact input shape of the unchanged DAS-023 package factory.

The generated input remains explicitly unproved, non-executable and unactivated. The action and observer stay on distinct source, surface, transport, implementation, authentication and credential-alias identities.

## What remains explicit human truth

DAS-024 reduces hidden authoring and omission risk; it does not remove the need for legitimate business and engineering decisions.

For each valid fixture, the role owner still explicitly confirmed 19 atomic facts and the implementation engineer confirmed 24. These include the actual authority action, stable business identity, permitted mutation, idempotency/conflict behavior, reconciliation mapping, separate observer identity, exact proof fields, freshness, duplicate/collateral semantics and terminal handling.

The current 43-question graph is deliberately atomic and conservative. A future console may group it into roughly seven coherent review screens, but grouping must not erase individual confirmations or make a shorter form look more autonomous than it is.

The separate qualification wrapper also supplies five synthetic commercial-intake examples because the older DAS-012 role scaffold requires them. They are labelled qualification-harness data. They are not DAS-024 authoring facts, customer examples or evidence that ordinary intake automatically creates trustworthy test cases.

Therefore the strongest honest setup statement is:

> DAS can now turn bounded business intent and pinned OpenAPI/MCP material into provenance-rich, non-executable action/observer drafts and the exact questions needed to complete them. Consequential business, authority, write-safety and proof meaning still require explicit owner or engineer confirmation.

## Preserved failure and superseded v1

An initial v1 campaign completed before the final source-grounded proposal facts and stale-revision answer gate were added. Its artifacts remain preserved at `artifacts/onboarding/source-grounded-binding-authoring-v1/`, but it is superseded and must not be cited as the final DAS-024 result.

The final v2 campaign froze a source manifest covering the authoring engine, durable store, fixtures, preflight, qualification wrapper and runner. The manifest remained unchanged during execution and still matches the current files.

During implementation, the first revision-zero preflight also exposed that unknown answer facts were being validated as though they were confirmed. That defect was fixed before the v2 campaign and regression-tested. The OpenAPI action-plane reconciler was separately corrected to say `independentBusinessOutcomeProof: false`; action-side readback may prevent duplicate retry but cannot replace the separate business-outcome observer. DAS-023 itself had used a separate observer, so this terminology repair does not invalidate checkpoint 0099.

## Adversarial validation

Focused validation passed 44/44 across DAS-024, the DAS-023 package factory/runtime bridge, declarative world and both adapter families. It covers:

- prompt/source text attempting to grant authority, declare proof or activate;
- shared action/observer source and credential aliases;
- observer sources containing write-capable operations;
- credentials in nested source or answer material;
- unsafe object keys and unsupported source shapes;
- out-of-role/rejected action selection;
- stable identity and conflict fields absent from the selected write schema;
- blind retry, more than one write and unsafe conflict behavior;
- missing terminal classifications;
- stale revision submissions, conflicting replay and store mutation;
- cross-source structural-chain substitution;
- materialized action/observer authentication collapse; and
- post-generation readiness or activation fabrication.

The complete deterministic repository suite also passed after the final v2 run. `git diff --check` passed. Every v2 artifact is mode `0600`; the result hash and current source manifest recompute exactly.

## Protected gates

All of these remain false or zero:

- credential values accepted;
- real customer runtime connected;
- customer runtime authority granted;
- action or observer independently proved in a customer environment;
- executable operations;
- customer-environment acceptance;
- comparison readiness;
- controlled activation;
- human setup-time evidence;
- customer evidence;
- production reliability;
- model calls and spend.

## Evidence artifacts

- Preregistration: `reports/0100-das024-package-draft-authoring-preregistration.md`
- Final v2 campaign: `artifacts/onboarding/source-grounded-binding-authoring-v2/summary.json`
- OpenAPI result: `artifacts/onboarding/source-grounded-binding-authoring-v2/northstar-invoice-dispute-authoring-openapi-v1.json`
- MCP result: `artifacts/onboarding/source-grounded-binding-authoring-v2/fieldhaven-equipment-damage-authoring-mcp-v1.json`
- Malicious control: `artifacts/onboarding/source-grounded-binding-authoring-v2/malicious-ambiguous-authoring-openapi-v1.json`
- Superseded v1, preserved for audit: `artifacts/onboarding/source-grounded-binding-authoring-v1/`

## Claim boundary

DAS-024 supports one private deterministic local statement: from bounded fictional business intake and pinned OpenAPI/MCP sources, the same source-grounded engine generated provenance-rich non-executable drafts and exact question graphs; after every required fact was explicitly confirmed, both drafts entered the unchanged DAS-023 package/qualification path and passed 20/20 local controls, while a malicious collapsed-trust-plane input stopped before package generation.

It does not establish automated safe bindings, arbitrary source support, unassisted onboarding, reduced human setup time, live customer transports, real credentials, customer acceptance, production reliability, comparison readiness or activation.

## Next measured blocker

The remaining author-only work has moved from package-description translation to implementation conformance: building the real customer-local action transport and independent observer against the reviewed draft, then proving that implementation matches the exact hashes and semantics.

The next zero-spend productization slice should therefore generate strict, non-executable action/observer plugin projects from a complete DAS-024 receipt, with separate conformance tests, alias-only secret interfaces, evidence-mapper stubs and exact TODO/blocker receipts. It must not mark those skeletons executable merely because code was generated.
