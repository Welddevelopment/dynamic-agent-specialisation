# Assisted commercial onboarding state machine

## Purpose

`src/product/assisted-onboarding-journey.js` joins the existing commercial intake, system-import proposal, customer-binding, comparison-freeze, paid-call approval, result, bundle and activation components into one private customer-local journey.

It is an **assisted pilot path**, not self-serve activation. The customer supplies business truth and bounded local test material. DAS produces the normalized role contract, proposed setup work, binding scaffold, authoritative checklist and zero-cost comparison plan. An engineer must still implement and verify customer-specific adapters and the independent external-state checker.

Nothing in this state machine makes a network request or a model call. `attemptPaidExecution()` always fails closed. The existing role-specific campaign runner remains the only paid execution path, and it still requires separate global approval, campaign approval, the exact plan hash, an explicit spend limit, same-day pricing confirmation and an API key.

## Authoritative stages

The projection returned by `latest(sessionId)` keeps these gates separate:

1. `businessRoleDraftComplete` — the supported role, owned result, company and escalation owner are stated.
2. `comparisonDesignContractComplete` — systems, consequential rules, authority, representative cases, success measures, current-agent status and redaction are sufficient to design a fair comparison.
3. `customerBindingScaffoldGenerated` — DAS generated a private scaffold from the exact saved intake. Every adapter and verifier still begins `not-implemented`.
4. `structuralBindingReady` — an engineer-provided descriptor passed exact operation, authority, credential-reference, adapter, verifier and reconciliation diagnostics.
5. `mandatoryAcceptanceComplete` — all ten binding cases passed through the exact independent verifier with zero unsafe attempts and zero incorrect side effects.
6. `executableComparisonEnvironmentReady` — accepted bindings are attached to an integrity-checked comparison contract with exact stage cases, participants, limits and verifier.
7. `awaitingExplicitModelSpendApproval` — a zero-cost model plan is frozen. No spend or calls are authorized.
8. `comparisonCompleteRecommendationReady` — an integrity-checked result with at least three safe perfect repeats exists.
9. `controlledActivationReady` — the exact proved bundle has an integrity-checked controlled activation receipt for the frozen environment.

A form can be complete at stage 2 while stage 6 remains false. A named system with no executable adapter, no accepted verifier and no test evidence never appears executable.

## Customer, DAS, engineer and verifier responsibilities

The customer must confirm:

- the business outcome and completion rule;
- systems and data boundaries;
- consequential policies, permitted actions, approval-only actions and forbidden actions;
- representative redacted cases;
- independent success measures and the escalation owner;
- any schema-import operation classification or assumption before it is implemented; and
- the exact later model-spend plan, if they want the comparison to run.

DAS generates:

- a normalized role contract from the exact saved intake;
- a zero-cost setup plan;
- a fail-closed customer-binding scaffold;
- pinned OpenAPI or MCP operation/context proposals when supplied through the import module;
- a single authoritative setup projection with questions, responsibilities, evidence and blockers; and
- the frozen zero-cost campaign plan after every executable-environment gate passes.

An engineer must:

- implement the proposed operations rather than treating their names as executable tools;
- bind each consequential operation to explicit authority;
- keep credentials customer-local and store only environment-variable references;
- implement idempotency and unknown-outcome reconciliation for writes;
- implement the independent verifier against external state; and
- run and preserve all mandatory binding acceptance evidence.

The independent verifier, not the candidate, determines binding acceptance, comparison outcomes and repeatability.

## Interface contract

```js
const journey = new AssistedCommercialOnboardingJourney({ stateDirectory });

journey.saveBusinessIntake(input);
journey.recordSystemImportProposal({ sessionId, proposal, source });
journey.recordSystemImportConfirmation({
  sessionId,
  proposalHash: proposal.proposalHash,
  source,
  confirmedBy: "Accountable role owner",
  decisions,
});
journey.recordBindingDescriptor({ sessionId, descriptor });
journey.recordBindingAcceptance({ sessionId, results });
journey.freezeZeroCostComparisonPlan({
  sessionId,
  contract,
  participants,
  maxTurns,
  campaignId,
  campaignApproval,
});

const projection = journey.latest(sessionId);
```

Every mutating method returns `das.assisted-onboarding-projection.v1` with:

- `status` — the highest honest stage;
- `stages` — every gate as an independent boolean;
- `questions` — precise missing intake answers;
- `checklist` — items labelled `customer`, `das`, `engineer` or `independent-verifier`;
- `generated` — which artifacts exist; and
- `spend` — zero calls/authorization plus exact ceilings only after the plan is frozen.

`readinessReceipt(sessionId, revision)` returns an additional `das.assisted-onboarding-readiness-receipt.v1`. It binds the exact session revision and separates customer declarations, DAS-generated proposals, engineer-owned bindings, independent proof, comparison-design completeness, execution readiness, activation readiness and exact blockers. A customer-declared adapter/verifier status is never accepted as engineer or independent evidence. The receipt is rebuilt against the source revision during validation, so mutation or cross-revision reuse fails closed.

The console should render this projection as the authority. It must not infer readiness from form completion, system names or schema-import proposals.

## Persistence and mutation behavior

Each saved intake revision receives a separate artifact directory and immutable joined record. Saving a changed intake creates a new revision rather than silently carrying old binding or comparison evidence forward. The complete journey state and each record are hash checked on load. Direct mutation fails closed.

System-import proposals bind the exact normalized intake, system snapshot and local source hash. They remain review proposals: they cannot grant authority, collect credentials, mark an adapter executable, invent success criteria, authorize spend or widen activation readiness.

`recordSystemImportConfirmation(...)` now converts one exact reviewed OpenAPI or MCP proposal into a private, integrity-bound **non-executable binding work plan**. The reviewer must decide every proposed operation, map each approved operation one-to-one onto an operation already declared in the saved intake, explicitly classify ambiguous MCP tools as read or write, approve the context inventory, and map writes only to authority already declared in the saved role. The confirmation does not grant that authority at runtime.

The generated work-plan directory contains:

- the exact review confirmation;
- a prefilled adapter configuration draft;
- an independent-verifier assertion scaffold;
- a machine-readable inventory of generated, customer-confirmed and still-unimplemented fields; and
- the exact remaining engineering and independent-proof work.

The work plan deliberately does not contain credential values or the raw imported source. The exact source must be supplied again and match its pinned digest when the existing bounded OpenAPI or MCP compiler is later invoked. Write idempotency and reconciliation mappings remain blank until an engineer supplies and tests them. The source-operation schema hash and later runtime-contract schema hash remain separate because the runtime may add explicit idempotency inputs.

The customer-local console exposes this same flow: local import → consequential review → measured work plan. It displays zero executable operations after review and continues to derive execution readiness only from reviewed bindings plus independent acceptance evidence.

Before the consequential review, a deterministic review assistant may now propose one-to-one mappings from imported operations to the exact operations already declared in the saved role contract. It can also propose read/write classification, matching saved authority boundaries and relevant approved context. These are source-grounded suggestions, not decisions: the role owner still confirms every mapping and consequential mode, an authority suggestion can only point at an already-declared boundary, and no suggestion grants runtime permission. Idempotency and readback hints identify candidate source fields for engineering review but never claim the behavior is implemented.

Each fresh-start teardown also emits an integrity-bound fact ledger. It distinguishes role-owner facts and confirmations, DAS defaults and proposals, engineer implementation, independent proof and precise unknowns. Only traceable facts may advance the state machine. Template defaults are labelled as DAS/template inputs rather than customer-supplied facts, while customer declarations such as “verified” remain declarations rather than executable proof. Active machine time is recorded separately and must never be described as human setup time.

A confirmed work plan can now enter structural compilation through the existing bounded OpenAPI or MCP compiler. The compiler derives operation identity, exposed name, mode, context and authority only from the exact confirmation; customer-local engineering may separately supply environment-reference names and write idempotency/readback configuration. The resulting receipt is labelled `structurally-compiled-runtime-unprobed`. It records source/runtime schema transitions and conservative descriptor diagnostics, but contains no executable plan, credential value or runtime grant. It does not advance the binding, execution or activation stages. Only customer-local wiring, qualified independent observation and mandatory acceptance may do that later.

## Role-specific lifecycle availability

The full assisted lifecycle is currently registered for:

- customer support operations;
- procurement coverage; and
- CRM / revenue operations.

Frontend implementation is supported only for discovery, structured business intake, a private exact binding scaffold and review-only system-operation proposals. The saved revision freezes this narrower lifecycle profile. It cannot accept a binding descriptor, record binding acceptance, freeze a comparison, record a result or reach controlled activation until separate customer-local design-source, repository/PR and independent repository-result bindings are implemented and accepted. The local fictional frontend role pack is reference evidence, not customer-binding evidence.

Any other unsupported role can be saved as a labelled preview only. It cannot generate a binding scaffold or advance into comparison/activation readiness until a real role adapter, cases, baselines and independent verifier exist.

## Current claim boundary

This implementation demonstrates a zero-cost, persistent, fail-closed assisted onboarding control path. A deterministic local rehearsal can reach `awaiting-explicit-model-spend-approval` without calling a model.

For approved OpenAPI and MCP material, it also demonstrates deterministic generation of reviewed adapter and independent-verifier scaffolds with exact omissions and integrity-bound persistence. It does not demonstrate that those scaffolds compile against an unknown customer system or that the verifier has been implemented.

It does **not** prove:

- self-serve customer activation;
- arbitrary schema-to-working-integration generation;
- a completed or improved customer specialist;
- customer compatibility, value or demand;
- production reliability or security certification; or
- authority to spend, deploy, activate, contact a customer or make public claims.
