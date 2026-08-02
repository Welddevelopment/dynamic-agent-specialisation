# Piece 2 Cycle 3 multi-model selection checkpoint

## Result

The compiler refined the no-eligible-work behaviour, then created two otherwise equivalent execution variants. Both faced the same ten exposed regression cases.

| Variant | Result | Denied actions | Correct handoffs | Tool calls | Runtime cost | Elapsed |
|---|---:|---:|---:|---:|---:|---:|
| Luna | 10/10 | 0 | 2/2 | 52 | $0.0447908 | 144.7s |
| Terra | 10/10 | 0 | 2/2 | 63 | $0.4525460 | 131.4s |

Terra was roughly 9% faster, but cost about ten times more and did not improve correctness. Under the brief's quality-first but cost-aware priorities, Luna is selected automatically.

Selected candidate: `rps-scope-noop:cycle3:luna`

Fingerprint: `471fbdb4b9292af830b145df6a7a79ac98d67f6e7f12f8f1480aa9c6badb58e1`

Unlike Cycle 2, the candidate was fully labelled and model-bound before validation generated this fingerprint.

## Spend and boundary

- Refinement plus 20 candidate/case regressions: $0.4983806.
- Cumulative paid-model spend: $0.77910838.
- Fresh Cycle 3 validation, adversarial and original unseen cases remain unavailable to the selected candidate.
