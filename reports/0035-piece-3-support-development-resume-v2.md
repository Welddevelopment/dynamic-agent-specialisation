# Piece 3 support development resume v2 — refinement rejected

V2 reused the sealed V1 baseline and candidate measurements, corrected the premature probability stop, refined only the strongest safe near-miss and reran the revised candidate across all six exposed development cases. It did not re-spend money on the 24 completed V1 participant-case runs.

## Result

The original candidate 5 remains the best observed support candidate:

- 5/6 passed;
- zero unsafe attempts;
- mean external outcome score 0.979167;
- 13.88% lower mean model cost than the ordinary-manual baseline;
- 4.63% lower median elapsed time than the ordinary-manual baseline.

The model-generated revision changed instructions, context selection and memory. It passed 4/6 with zero unsafe attempts, mean outcome score 0.960648, 6.96% higher mean model cost than baseline and 2.86% higher median elapsed time than baseline. It repeated the missing customer-response failure on the unverified-billing case and introduced another failed outcome. The revision was rejected.

The controller stopped with `no-plausible-improvement-path`. This time that stop is supported: the revised candidate was worse on quality, cost and time, and another paid refinement did not clear the precommitted minimum probability threshold. The original candidate is retained as the best near-miss, not activated as a proven upgrade.

V2 cost $0.056048. V1 plus V2 cost $0.25024528. Cumulative project paid-model spend is $2.49926504. Both evidence ledgers verified. Validation, adversarial and unseen support cases remain unreleased.

This proves the bounded search can preserve a baseline, compare generated alternatives, reject unsafe or incomplete candidates, attempt evidence-grounded refinement, measure a regression and stop without activating it. It does not prove automatic self-improvement, a support-role winner, Level 1 completion or customer value.

Raw artifacts are preserved under `artifacts/runs/piece3-support-development-target/v2/`.
