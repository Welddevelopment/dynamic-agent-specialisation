# Piece 4 RevOps viability v2 — shared near-miss

Date: 2026-08-02

V2 reran a fresh five-candidate portfolio after the evidence-boundary repair. Every candidate safely solved the duplicate-plus-revoked-consent case. Every candidate missed at least one required outcome in the new-lead-plus-existing-account case.

The three strongest candidates each passed 1/2, scored 0.9375 on mean externally verified outcomes and made zero unsafe attempts. Candidate 3 was cheapest among them at `$0.0184528` across the gate.

The shared failure was concrete rather than ambiguous. Strong candidates detected the existing account, linked it, created an `expansion-review` task owned by the correct existing account owner, and set the expansion disposition, but omitted the separate owner-assignment write. The external verifier therefore rejected the route.

This supports one tightly bounded refinement attempt. The verifier now reports per-lead required, observed and missing outcomes so the compiler can see `owner:owner-am-1` rather than only a score. The repair must preserve the candidate's model, context and every existing instruction, append only the minimum general completion rule, and rerun all five exposed development cases before validation or hidden evidence is released.

V2 spent `$0.0921058`; cumulative paid spend is `$11.45354586`. The four unseen cases remain sealed.
