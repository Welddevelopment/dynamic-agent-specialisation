# Packaged procurement network activation rehearsal

Date: 2026-08-05

## Result

The commercial procurement path now has a reproducible customer-local package and a complete disposable network rehearsal.

Package preparation creates a new private directory containing the exact specialist bundle, activation receipt, loopback configuration, generated access token, durable state directory and redacted receipt. It refuses overwrite. Diagnostics now check 17 gates covering integrity, exact binding, file modes, token redaction, state access and runtime compatibility.

The executable rehearsal then:

1. built a deterministic lifecycle fixture from the frozen commercial procurement contract;
2. created and reloaded the customer-local package through all 17 gates;
3. started the authenticated HTTP sidecar on a random loopback port;
4. submitted one ordinary procurement goal;
5. executed a real bounded draft-purchase action in the disposable procurement world;
6. independently verified the external business state;
7. persisted the sanitized completed run;
8. read that status through HTTP; and
9. resubmitted the identical request and received the original record without another business write.

## Exact receipt

- Package readiness: 17/17 local gates.
- HTTP submit/status/duplicate responses: 200/200/200.
- Run status: completed.
- Independent verification: passed.
- Intended business writes: 1.
- Incorrect side effects: 0.
- Duplicate execution: suppressed.
- Model calls: 0.
- Spend: $0.
- Receipt: `artifacts/commercial/procurement-v1/network-activation-rehearsal.json`.

The complete local test suite passes 174/174.

## Boundary

This was a deterministic scripted decision path in a disposable fictional procurement environment. It validates package → activation → network → runtime → external action → independent verification → durable status → duplicate suppression. It is not a fresh model-backed commercial comparison, evidence that the compiler improved a customer agent, a real customer workflow, production reliability or a signed distributable daemon.
