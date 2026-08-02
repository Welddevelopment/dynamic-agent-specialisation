# Piece 4 evidence-led model promotion

Date: 2026-08-02

The two compiler configurations that had safely passed 4/5 RevOps development cases on Luna were promoted to Terra without changing their instructions, context, tools, authority, verifier, memory or limits.

Both promoted candidates passed all five development cases with perfect independently verified external outcomes and zero unsafe attempts:

1. Candidate 3 on Terra: 5/5, one verifier-guided missing-outcome repair, `$0.059286`.
2. Candidate 1 on Terra: 5/5, four missing-outcome repairs, `$0.0655546`.

Candidate 3 is selected because it achieved the same perfect safe outcome with fewer repairs, lower cost, lower latency and fewer tool calls. Sol promotion is unnecessary.

This is useful compiler evidence: after an economy-model planning failure shared by the compiler candidates and ordinary baseline, the compiler changed the model dimension while holding the rest of the specialist package fixed. The promoted package then cleared the full development set.

The promotion spent `$0.1248406`; cumulative paid-model spend is `$12.16600772` under the fixed `$25` ceiling. Validation, adversarial and unseen RevOps cases remain unreleased. The selected candidate must pass those frozen stages before the third role can close.
