# Checkpoint 0099 preregistration — provider-neutral customer-local qualification transfer

Date frozen: 2026-08-14  
Work item: DAS-023 / zero-spend productization lane  
State: protocol frozen before the executed transfer rehearsal

Pre-evidence failure preserved: the first Package A preflight stopped before candidate generation or artifact writing because the new generic factory expected the template role id and session-qualified binding role id to be literally identical. The existing onboarding contract intentionally represents these as `role-template` and `session-id:role-template`. The factory was repaired to accept only those two exact linked forms, a regression test was added, and the core must be refrozen after Package A before Package B is opened. Package B had not been opened when this repair occurred.

A second Package A preflight then stopped before candidate generation or artifact writing because the reviewed onboarding work plan deliberately pins the credential-free server origin while the structural compiler pins the exact base URL including `/v1`. The new factory had incorrectly assumed these were literally one value. The generic factory was repaired to require both identities: the reviewed origin must equal the full URL's origin, and the compiled transport hash must bind the full base URL. A path-prefix regression test was added. Package B was still unopened.

## Primary question

Can one integrity-bound, provider-neutral package factory and one shared qualification-runtime bridge translate two materially different fresh reviewed packages into separate action and observer candidates, then run the unchanged ten-control DAS-022 protocol without package-specific branches or a core repair after the second package is opened?

This is a transfer and setup-reduction test. It is not another test of whether the existing ten classifications work in one renamed world.

## Frozen packages

### A — Alderbridge supplier-compliance review (OpenAPI)

- Source: one pinned OpenAPI 3.1 action document and a separately pinned read-only audit source.
- Ordinary outcome: create exactly one draft supplier-compliance review for one approved application.
- Forbidden outcomes: activating a supplier, approving payment, changing bank details, or changing unrelated applications.
- Stable identity: `applicationId + idempotencyKey`.
- Exact outcome fields: `applicationId`, `idempotencyKey`, `supplierId`, `applicationDigest`, `jurisdiction`, and `riskTier`.
- Completion: one result with status `pending-review`.
- Allowed changed entity: `draft-compliance-review` only.
- Idempotency shape: reviewed HTTP header plus stable body key.

### B — ParcelDock return authorization (pinned MCP)

- Action source: one pinned MCP server/tools-list with an approved read, one draft write, and action-plane readback. Refund, shipping-label and inventory-receipt tools are deliberately outside the selected subset.
- Observer source: a separately pinned read-only MCP audit server/tools-list, transport, credential alias and implementation.
- Ordinary outcome: create exactly one draft return authorization for one approved return request.
- Forbidden outcomes: issuing a refund, generating a shipping label, receiving inventory, or final authorization.
- Stable identity: `sourceReturnId + idempotencyKey`.
- Exact outcome fields: `sourceReturnId`, `idempotencyKey`, `orderId`, `reasonCode`, and `approvedItemsDigest`.
- Completion: one result with status `draft`.
- Allowed changed entity: `draft-rma` only.
- Idempotency shape: one required MCP write input field.

The two packages differ in source family, role, operation names, schema shape, idempotency location, transport identity, observed result layout, authority action and protected state.

## Frozen protocol

1. Each package must enter through an integrity-valid DAS-012 structural receipt and exact reviewed work plan.
2. The factory receives explicit role-owner and engineer declarations. It may normalize, validate, hash and generate scaffolds; it must not infer authority, stable identity, idempotency meaning, retry policy, business completion, freshness, duplicate/collateral semantics, credentials or proof independence.
3. It emits separate action and observer declarations, a non-executable binding candidate, a non-executable runtime work pack, exact blockers and a generation receipt.
4. One shared runtime bridge—not package-specific action/observer factories—must bind a disposable world driver to the existing DAS-022 qualification runner.
5. Both packages run exactly these controls with existing canonical classifications and write limits: completed, not-started, partial, incorrect, duplicate, stale, collateral, unknown, unavailable and lost-response.
6. The lost-response control must commit once, lose the action response, attach a fresh observer process to the same durable store, observe the completed external state and perform no replay.
7. Action responses are never accepted as business-outcome evidence.
8. MCP action-plane readback may prevent a blind retry but may not count as independent business-outcome proof.
9. Package A may expose generic factory defects during preflight. After the core manifest is sealed, Package B must pass without a core-file change. If Package B requires a core change, preserve that result as invalid transfer evidence and use a new unopened package for a later version.

## Primary metric

Whether Package B reaches 10/10 canonical controls with zero core-file changes after the core manifest is frozen.

## Secondary metrics

- package A and B control counts and classifications;
- business writes, observer writes, blind retries and lost-response replays;
- generated, customer-confirmed, engineer-supplied and independently proved fields;
- generated artifact lines and package-specific handwritten executable lines;
- package-specific branches in the generic factory/bridge;
- exact core source-file digests before and after B;
- exact package driver/config digests;
- active machine time, explicitly not human setup time;
- executable operations, credentials, authority, commercial acceptance, comparison readiness and activation status;
- model calls and spend.

## Frozen attacks

- cross-package role/session/work-plan/confirmation substitution;
- action or observer source/schema/transport/implementation/credential substitution;
- MCP tools-list, server-version, annotation or required-idempotency-field drift;
- authority widening and selected-subset widening;
- shared action/observer identity, alias, transport, implementation or proof source;
- nested action-response material presented as observer evidence;
- future, stale or pre-existing evidence;
- observer write or state mutation;
- caller-weakened control classification or write bound;
- unsafe retry without a fresh independently observed not-started state and explicit gate;
- same-process lost-response recovery or changed durable-store identity;
- qualification/acceptance reuse after any upstream mutation.

## Success criteria

- two fresh materially different packages generate separate non-executable candidates and work packs;
- 10/10 unchanged canonical controls pass for each;
- zero observer writes, zero blind retries and zero accepted unsafe or ambiguous outcome;
- lost response produces exactly one business write, no replay, a different process identity and the same durable-store identity;
- every frozen substitution/drift/mutation attack fails closed;
- no generic core digest changes after Package B is opened;
- Package B needs no copied authentication, runtime-factory, canonical-case or measurement choreography;
- all protected product gates remain false/zero;
- zero model calls and zero spend.

## Kill and no-claim rules

No transfer or falling-marginal-effort result is allowed if Package B causes a core repair, the generic core contains a package-specific branch, action and observer share a trust plane, any consequential rule is inferred, MCP annotations grant authority, the action readback is called independent business proof, a canonical control fails, an attack survives, or any artifact becomes executable/active.

If the runtime world/proof implementation remains essentially as bespoke as DAS-022, a clean run may support source-family parity only—not setup reduction or factory economics.

Even a full pass is private deterministic local evidence across two fictional packages. It does not establish arbitrary OpenAPI/MCP support, customer credentials, customer acceptance, human setup time, production reliability, demand, comparison readiness or activation.
