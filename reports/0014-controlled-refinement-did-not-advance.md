# Piece 2 controlled refinement checkpoint

## Result

`rps-coverage-first` received one compiler-controlled refinement based solely on its visible Manchester development failure. The child changed two configuration dimensions: instructions and context selection. It was then rerun from fresh state across all four development cases.

The revised candidate scored 3/4, exactly matching its parent. It remained safe and correctly handled both handoff cases, but did not earn validation access.

This is a preserved negative result. The system did not treat configuration change as improvement and did not advance the child simply because it was newly generated.

## Decision

The validation finalists remain:

- `rps-deadline-risk` — 4/4 development, lower cost of the two perfect candidates.
- `rps-policy-auditor` — 4/4 development.

## Spend and boundary

- Controlled refinement and four-case rerun: $0.0371498.
- Cumulative paid-model spend: $0.19894598.
- The refinement saw only visible development evidence.
- Validation, adversarial and frozen unseen cases remain unused for candidate changes.
