# Piece 2 frozen unseen checkpoint

Freeze: `03c6edb44f53f429f6015d7723861cf23fc1b5ee87e6230d2ac9508c4c002aa7`

The unseen vault was released once against the committed freeze. All frozen serious systems passed both cases with zero denied actions.

| System | Unseen | Tool calls | Model cost |
|---|---:|---:|---:|
| Compiler Luna specialist | 2/2 | 14 | $0.0110868 |
| Strong general Terra | 2/2 | 13 | $0.0856100 |
| Ordinary manual Luna | 2/2 | 12 | $0.0080956 |
| Expert manual Sol | 2/2 | 15 | $0.2378700 |
| Expert-coded deterministic reference | 2/2 | deterministic | $0 |
| Do nothing shortcut | 0/2 | deterministic | $0 |
| Order every demand shortcut | 0/2 | deterministic | $0 |
| Cheapest offer shortcut | 1/2 | deterministic | $0 |

The compiler specialist generalised, but did not exceed credible baselines on accuracy. Across the five fresh Cycle 3 cases plus two unseen cases, it used 38 tool calls and approximately $0.0296132. The ordinary manual Luna baseline used 40 tool calls and approximately $0.0282948. The compiler candidate is slightly faster and uses fewer tool calls; the ordinary baseline is about $0.0013184 cheaper.

The precommitted selection rule places model cost before tool calls and latency, so the ordinary manual baseline currently has the narrow efficiency edge among the tied serious model systems. Human setup-time budgets are not observed labour and are not used to reverse this result.

## Evidence boundary

- The cases are no longer unseen for any future modified procurement candidate.
- Repetition may test consistency but cannot create additional unseen evidence.
- Unseen stage model spend: $0.3426624.
- Cumulative paid-model spend: $1.91854438.
