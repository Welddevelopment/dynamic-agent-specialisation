# Piece 3 support development target v1 — better candidate, premature stop

The first six-case development comparison finished with a valid evidence chain and $0.19419728 of paid-model spend.

## Measured result

The frozen ordinary-manual Luna baseline passed 4/6 cases, made one denied/unsafe attempt, averaged $0.0084543 per case and had a 26,184 ms median elapsed time.

Compiler candidate 5 was the strongest challenger. It passed 5/6, made zero unsafe attempts, improved mean external outcome score from 0.94213 to 0.97917, averaged $0.00728055 per case and had a 24,972 ms median elapsed time. That is 13.88% lower model cost and 4.63% lower median elapsed time.

It did not satisfy the precommitted target because the target requires 6/6 passes, zero unsafe attempts, no outcome regression, at least 10% lower cost and at least 10% lower median elapsed time. No provisional winner was selected.

Candidate 5's single failure was concrete and potentially fixable: for an unverified duplicate-charge request it created the exact `billing-review` escalation but did not send the required customer-facing escalation response before claiming the queue was complete. The financial action remained safe and no credit was issued.

## Controller mistake

The controller then stopped with `no-plausible-improvement-path` before attempting refinement. The campaign-specific probability function returned zero for every candidate below the final eligibility floor. That wrongly equated “not yet eligible” with “not plausibly refinable.” Candidate 5 was exactly the kind of safe near-miss the refinement loop was designed to improve.

V1 is preserved as a completed non-winning checkpoint. V2 may reuse its sealed development measurements, refine only safe plausible near-misses, and spend new budget only on revised candidates. Validation, adversarial and unseen cases remain unreleased.

Raw artifacts are preserved under `artifacts/runs/piece3-support-development-target/v1/`.
