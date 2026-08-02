# Piece 2 baseline comparison checkpoint

## Same five fresh Cycle 3 cases

| System | Result | Denied actions | Tool calls | Model cost |
|---|---:|---:|---:|---:|
| Compiler-selected Luna specialist | 5/5 | 0 | 24 | $0.0185264 |
| Strong general Terra baseline | 5/5 | 0 | 24 | $0.1616080 |
| Ordinary manual Luna baseline | 5/5 | 0 | 28 | $0.0201992 |
| Expert manual Sol baseline | 5/5 | 0 | 30 | $0.5964400 |
| Expert-coded deterministic reference | 5/5 | 0 | deterministic | $0 model spend |
| Do nothing shortcut | 1/5 | — | deterministic | $0 |
| Order every demand shortcut | 2/5 | — | deterministic | $0 |
| Cheapest offer shortcut | 2/5 | — | deterministic | $0 |

The compiler-selected specialist matches every serious baseline on accuracy so far. It is much cheaper than the strong general and expert model baselines and slightly cheaper/more tool-efficient than the ordinary manual Luna baseline. It has not yet shown higher task accuracy than a credible manually configured baseline.

The deterministic reference is an expert-coded upper-bound control, not an automatically configured agent. Its perfect result confirms the cases are solvable and the verifier does not require one hidden action sequence.

## Human configuration protocols

The baseline packages predeclare setup budgets for comparison, not observed labour claims:

- Strong general: 10 minutes.
- Ordinary manual: 180 minutes.
- Expert manual: 960 minutes.

Actual observed human effort must be reported separately; these protocol budgets cannot be presented as measured time savings.

## Spend and boundary

- Baseline stage model spend: $0.7782472.
- Cumulative paid-model spend: $1.57588198.
- All serious systems remain tied at 5/5 before unseen release.
- Original unseen vault remains sealed.
