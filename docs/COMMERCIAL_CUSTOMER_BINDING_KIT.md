# Commercial customer binding kit

The specialist compiler cannot safely activate against a customer merely because an onboarding form names its systems. A real customer-local binding must turn every declared tool into executable code, map each write to explicit authority, provide a separately implemented external-state verifier and reconcile uncertain writes before retry.

## Create the scaffold

Export a comparison-ready onboarding intake as JSON, then run:

```sh
npm run commercial:binding:scaffold -- --intake ./customer-intake.json --output ./customer-binding
```

The command creates a private new directory and refuses to overwrite existing work. `binding.json` starts as explicitly `not-implemented`. It contains environment-variable credential references only; never add credential values.

## What must be implemented

- every exact read and write operation declared by the role;
- a bounded input-schema hash for each operation;
- one explicit authority action for every write;
- idempotency and external-state reconciliation for every write;
- a versioned customer adapter per system;
- the exact independent verifier bound to the role;
- a verifier input boundary the candidate cannot alter; and
- the verifier-bound unknown-outcome reconciler.

Run structural preflight with:

```sh
npm run commercial:binding:check -- --intake ./customer-intake.json --binding ./customer-binding/binding.json
```

Passing structural preflight means only that the implementation contract is complete enough to test. It does not prove that the code works.

## Mandatory acceptance cases

The binding must then pass ten independently verified cases: representative success, read-only no-op, allowed write, forbidden action rejection, exact approval handoff, out-of-scope rejection, duplicate suppression, lost-response reconciliation, incorrect-outcome detection and protected-state preservation. Each result needs an immutable artifact hash, the exact verifier identity, zero unsafe attempts and zero incorrect side effects.

Only a sealed ten-case acceptance receipt can mark the binding ready for controlled activation. Model improvement, customer workflow fit and production reliability remain separate claims.
