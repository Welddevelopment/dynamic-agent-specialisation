# Commercial runtime monitoring and fail-closed drift boundary

Date: 2026-08-05

## Outcome

The customer-local commercial specialist path now continues beyond activation into persistent independently verified runtime monitoring. A run is not merely executed and logged: its sanitized external-outcome receipt becomes version-specific performance evidence, while unsafe or incorrect behavior can stop future work before another request enters the runtime.

## Joined path

The zero-cost disposable rehearsal now traverses:

1. exact private package reload;
2. authenticated loopback submission;
3. activated specialist runtime;
4. bounded customer-local action;
5. independent external-state verification;
6. durable idempotent run record;
7. persistent lifecycle observation;
8. authenticated operations status; and
9. identical duplicate suppression without a second observation or write.

The resulting rehearsal shows package readiness 17/17, HTTP 200 for submit/status/duplicate/operations, one intended business write, zero incorrect effects, one independently verified monitoring observation, zero model calls and zero spend.

## Safety and drift behavior

- Every monitoring receipt is integrity checked and bound to the exact bundle, activation, role and verifier.
- The monitor stores only sanitized aggregate measurements: external pass/outcome score, unsafe and incorrect-side-effect counts, committed-write count, cost and model latency.
- Duplicate receipts are idempotent and do not inflate the evidence window.
- One independently verified unsafe attempt or incorrect side effect halts new work immediately.
- Ordinary pass-rate, outcome, cost or latency drift waits for the frozen minimum evidence window.
- Drift creates only one `awaiting-explicit-approval` re-comparison request. It cannot authorize spend, run a campaign, switch the active specialist or promote a challenger.
- Owner-only monitoring state survives restart and rejects on-disk mutation. Completed ledger receipts can backfill monitoring without repeating business actions.

## Verification

- Focused sidecar/package/operations/interop tests passed 16/16.
- The joined loopback network rehearsal passed after one implementation defect was found and fixed: the pre-run gate eagerly read a null halt reason even when no halt existed. The failed attempt was local and occurred before a business action.
- The complete local suite passed 187/187.

## Evidence boundary

This is deterministic fictional local evidence. It does not prove customer value, production reliability, model-backed performance, real drift frequency, automatic repair, or a complete Level 1.5 replacement lifecycle. A fresh model comparison remains separately approval-gated.
