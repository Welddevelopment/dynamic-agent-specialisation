# First paid smoke: truncated candidate JSON

Date: 2026-08-02

## Result

The first live Piece 2 smoke stopped after its candidate-generation call. No runtime-decision call was made.

- Model: `gpt-5.6-luna`
- Actual cost: `$0.004876`
- Input tokens: 380
- Output tokens: 4,000
- Reasoning tokens inside output usage: 729
- Evidence chain: valid
- Failure: JSON ended mid-object at the configured output ceiling

## Diagnosis

The model attempted to return at least four complete candidate packages. The response reached the old 4,000-token maximum and was truncated, so parsing correctly failed closed. This is an experiment-contract failure, not candidate-quality evidence.

## Correction before retry

- Smoke gate requests exactly two concise candidates rather than four or more.
- Candidate strings and arrays are instructed to remain minimal.
- Candidate-generation allowance is raised to 8,000 output tokens while remaining far below the `$2` smoke ceiling.
- The separate runtime-decision call is capped at 500 output tokens.

The failed result and its exact cost remain preserved. It is not counted as a successful model-backed candidate result.
