# Piece 2 development and cheap-elimination checkpoint

## Complete development result

Four model-designed candidates each faced the same four visible development cases. Every result was checked against external company state. The full 16-pair matrix completed after one preserved infrastructure interruption and targeted resume.

| Candidate | Passed | Correct handoffs | Denied actions | Model cost |
|---|---:|---:|---:|---:|
| `rps-deadline-risk` | 4/4 | 2/2 | 0 | $0.0196026 |
| `rps-policy-auditor` | 4/4 | 2/2 | 0 | $0.0231770 |
| `rps-coverage-first` | 3/4 | 2/2 | 0 | $0.0308974 |
| `rps-transfer-minimizer` | 2/4 | 2/2 | 0 | $0.0406746 |

`rps-deadline-risk` and `rps-policy-auditor` advance directly. They are the only candidates with complete development coverage, and the former was slightly cheaper.

`rps-transfer-minimizer` is eliminated. Refining a 2/4 candidate would spend more on a weak contender.

`rps-coverage-first` receives one controlled refinement attempt. Its single failure was specific and diagnosable: it covered the required consolidated shortage, but also created transfers for unrelated Manchester demand records exposed by the realistic workplace. The repair target is to bind writes to the task's declared demand batch rather than every visible due demand.

## Evidence boundary

- These are visible development cases and may be used for refinement.
- No validation, adversarial or frozen unseen result has influenced candidate changes.
- No candidate made a denied action during this stage.
- Cumulative paid-model spend after the completed development matrix is $0.16179618.
- Frozen unseen cases remain sealed.
