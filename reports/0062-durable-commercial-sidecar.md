# Durable customer-local commercial sidecar

Date: 2026-08-05

## Result

The activated specialist now has a customer-local durable execution boundary rather than only in-process framework adapters.

The new run ledger:

- binds every record to one exact role, specialist bundle and activation receipt;
- persists with owner-only file permissions and an integrity hash;
- reserves a request before runtime execution;
- returns the original completed receipt for an identical duplicate;
- rejects request-id reuse for a different goal;
- turns interrupted pending work into `outcome-unknown` after restart;
- blocks blind retry until the activated independent verifier reconciles external state; and
- allows an exact retry only after a verified `not-started` result.

The local sidecar:

- binds only to loopback;
- requires a minimum-32-byte bearer token held in memory;
- caps JSON input at 32 KiB;
- exposes the active specialist, goal submission, durable run status and customer-local reconciliation endpoints; and
- returns sanitized receipts rather than raw tool observations or customer records.

Direct invocation also now preserves a failed request rather than silently deleting it. Reuse remains blocked until the activated verifier proves the action never started.

## Validation

- Six focused durable-host/sidecar and direct-retry tests pass.
- Full local suite passes 172/172.
- Tests cover durable completion, duplicate suppression, conflicting request ids, restart unknown-state handling, verified retry authorization, bearer authentication, credential non-disclosure, ledger tamper detection and forged completion rejection.
- A real loopback network smoke test started the Node HTTP server on a random `127.0.0.1` port, made an authenticated request, received HTTP 200 and shut the server down cleanly.
- No model calls or new paid spend occurred.

## Boundary

This is a tested local library and HTTP transport, not yet a packaged background daemon, signed installer, production service, customer deployment or external security assessment. The unknown-outcome callback still requires a customer-specific independent verifier. The next commercial hardening step is packaging and readiness diagnostics around this sidecar, followed by a complete disposable procurement activation rehearsal through the real network boundary.
