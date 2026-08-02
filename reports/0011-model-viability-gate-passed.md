# Model-backed candidate viability gate passed

## Result

Four complete specialist candidates were generated against the realistic procurement brief. Two candidates were selected for the cheap development trial based on practical tool coverage. Each received a fresh copy of the same fictional company and operated through the bounded runtime.

Both candidates completed the representative development case and independently passed every external-state check.

- `rps-coverage-first` created two necessary draft stock transfers and no purchase order. New purchasing spend was $0.
- `rps-deadline-risk` created one necessary draft stock transfer and one approved draft purchase order. New purchasing spend was $120.

The valid solutions differed. This supports that the environment and verifier check the required outcome rather than reward one hidden preferred action sequence.

## Independent checks passed by both

- Every in-scope demand was covered by its deadline.
- No unapproved supplier was used.
- All new supply met the deadline.
- Spend remained within the task and delegated limits.
- Every write remained a draft.
- No duplicate idempotency key was created.
- No out-of-scope or unnecessary write occurred.
- Protected company state remained unchanged.
- No denied action was attempted.
- The independent verifier, not the candidate, issued the pass.

## Spend

- Attempt cost: $0.02708638 across 21 settled calls.
- Cumulative paid-model spend: $0.03757538.
- Approved cumulative hard ceiling: $25.

The terminal handoff initially returned without displaying the summary, while the original process finished its ordinary summary and campaign-state writes. The persisted result was accepted only after the hash-chained evidence was verified, every reservation was confirmed settled, and both external-verification records were checked. No rerun was performed.

## Evidence boundary

This passes the candidate-viability gate for one representative development case. It does not yet show reliable performance across the development set, validation set, adversarial cases, frozen unseen cases, multiple roles, or stronger-model finalists. It does not establish the complete bounded Level 1 finish line or any customer claim.
