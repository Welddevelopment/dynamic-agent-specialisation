# Customer-local commercial specialist sidecar

## Purpose

The sidecar lets an existing agent host submit an ordinary goal to one controlled-active DAS specialist without importing that host into the DAS runtime or exporting customer credentials.

It binds only to `127.0.0.1` or `::1`, requires a bearer token of at least 32 bytes, caps JSON request bodies at 32 KiB and keeps credentials out of its persisted run ledger.

## Required customer-local bindings

Before startup, the embedding application must supply:

1. an integrity-checked `das.commercial-specialist-bundle.v1`;
2. its matching `das.commercial-activation-receipt.v1`;
3. the DAS specialist runtime;
4. a factory that creates the exact customer-local tool host and activated independent verifier for each run;
5. a fixed tenant id;
6. a private ledger path;
7. an independent unknown-outcome reconciliation callback; and
8. optionally, the bound customer-local lifecycle monitor used to halt unsafe work and request a new comparison after measured drift.

These are code-level activation requirements. A role description or saved onboarding session is not sufficient.

## Package preparation and diagnostics

`prepareCommercialLocalPackage` creates a new owner-only directory and refuses to overwrite an existing one. It writes the exact specialist bundle, activation receipt, local configuration, generated access token, state directory and redacted package receipt.

`diagnoseCommercialLocalPackage` checks 17 local gates, including:

- bundle, activation, configuration and package-receipt integrity;
- exact role/bundle/activation binding;
- loopback-only configuration;
- owner-only directory, token and specialist file permissions;
- receipt-to-file hashes;
- token length and redaction from JSON package records;
- readable/writable state; and
- the supported Node runtime.

`loadCommercialLocalPackage` refuses to return the token or runtime paths unless every gate passes.

## HTTP contract

Every endpoint requires `Authorization: Bearer <customer-local-token>`.

### Inspect the active specialist

`GET /v1/specialist`

Returns role, bundle and activation identifiers. It does not return candidate prompts, credentials or customer data.

### Inspect operations

`GET /v1/operations`

Returns the active specialist's customer-local monitoring state, observation count, latest independent assessment, any halt, and any bounded re-comparison request. It does not start a comparison, authorize model spend or promote a replacement.

### Submit a goal

`POST /v1/runs`

```json
{
  "requestId": "stable-host-generated-id",
  "goal": "Cover every approved demand due today."
}
```

The request id is an idempotency key. Repeating the same request within one process or after a completed durable record returns the original result. Reusing it for another goal is rejected.

### Inspect a run

`GET /v1/runs/<requestId>`

Returns the integrity-checked durable record and sanitized result.

### Reconcile an unknown outcome

`POST /v1/runs/<requestId>/reconcile`

This does not accept a caller-authored verdict. It invokes the customer-local reconciliation callback already bound at startup. Only an exact independent result from the activated verifier can classify the run as completed, not started, incorrect or still unknown.

## Restart rule

A process crash may occur after an external write but before the result reaches the sidecar. Any persisted `pending` request owned by the previous process becomes `outcome-unknown` at restart. The sidecar refuses to retry it.

- `completed`: return the verified result;
- `not-started`: authorize one exact retry;
- `incorrect`: keep the run blocked and expose the incident;
- `unknown`: remain blocked.

This is intentionally conservative. A missed action is recoverable; an accidental duplicate or compounding write may not be.

## Runtime monitoring rule

When lifecycle monitoring is attached, each completed run receipt preserves only aggregate outcome, safety, write-count, cost and model-latency measurements bound to the activated independent verifier. Duplicate receipts do not count twice.

- A verified unsafe attempt or incorrect side effect halts new work immediately.
- Ordinary quality, cost or latency drift is assessed only after the configured evidence minimum.
- Measured drift may create one integrity-bound re-comparison request, but the request is `awaiting-explicit-approval`, carries no spend authorization and cannot promote anything.
- The run ledger remains authoritative if monitoring persistence fails after execution. On restart, `reconcileLedger` can backfill any completed receipt missing from monitoring without re-running the business action.

## Evidence boundary

The loopback transport, authentication dispatcher, integrity-checked ledger, duplicate suppression, restart rule, persistent independent-outcome monitoring, immediate safety halt, no-spend drift request, private package assembly and readiness diagnostics are locally implemented and tested. This is not a signed installer, managed daemon, production deployment, remote service, external security review, proof against process-kill timing on a customer system, or a complete model-backed Level 1.5 replacement cycle.
