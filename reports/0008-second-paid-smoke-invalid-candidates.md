# Second paid smoke: structurally invalid candidates

Date: 2026-08-02

## Result

The second live Piece 2 smoke stopped after candidate generation. It made no runtime-decision call.

- Model: `gpt-5.6-luna`
- Attempt cost: `$0.001542`
- Cumulative paid cost: `$0.006418`
- Input tokens: 402
- Output tokens: 1,218
- Reasoning tokens inside output usage: 375
- Evidence chain: valid
- Failure: neither returned candidate passed the internal candidate validator

## Diagnosis

The prior truncation was fixed: the model returned valid JSON and stayed well below the enlarged output ceiling. However, the prompt described required fields without machine-enforcing their nested shapes and bounded values. Both candidates were therefore rejected before execution.

The attempt runner preserved the aggregate rejection but did not preserve the individual rejection reasons before throwing. That is itself an evidence defect and means this attempt cannot support a more specific diagnosis.

## Correction before another call

Candidate generation now uses strict Structured Outputs with a complete JSON Schema. The schema fixes the role identifier, allowed tools and actions, independent verifier binding, required nested fields, cost/latency ceilings, escalation requirement, array sizes, and exactly two smoke candidates. A malformed package should now be prevented by the API contract rather than repaired manually afterward.

This failed attempt is not counted as candidate-quality evidence.
