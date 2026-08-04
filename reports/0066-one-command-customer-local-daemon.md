# One-command customer-local daemon assembly

Date: 2026-08-05

## Outcome

The commercial specialist package can now be assembled into the full customer-local sidecar through one reusable launcher instead of custom wiring scattered through a demonstration script.

After a specialist package and customer-owned bindings module exist, the supported command is:

```bash
npm run commercial:sidecar -- --package /absolute/package/path --bindings /absolute/customer-bindings.mjs
```

## What the launcher joins

- exact private package validation;
- customer runtime, fixed tenant and per-run tool/verifier bindings;
- durable request ledger and restart reconciliation state;
- persistent independent-outcome monitoring;
- completed-ledger monitoring backfill;
- fail-closed operational halt;
- authenticated loopback dispatcher; and
- sanitized startup status without printing the token.

The customer module must export one explicit factory. Missing runtime, tenant, per-run bindings, unknown-outcome reconciliation or the exact verifier binding stops startup before listening.

## Verification

- Assembly tests validate fail-closed customer bindings and exercise package → host → one run → durable ledger → operations without opening a port.
- The actual disposable procurement network rehearsal was refactored to use the same daemon assembly and passed over a real loopback socket: 200 submit/status/duplicate/operations, one intended write, zero incorrect effects, one monitoring observation, zero model calls and zero spend.
- Focused daemon tests passed 13/13 before the network rerun.

## Boundary

This removes bespoke startup wiring, not the need for a customer-specific executable adapter and independent verifier. It is a local Node launcher, not an installer, signed binary, operating-system service, hosted control plane, customer deployment or production reliability proof.
