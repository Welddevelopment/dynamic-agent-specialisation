# Piece 4 RevOps viability v1 — environment discovery

Date: 2026-08-02

The first paid RevOps viability gate is preserved but cannot be used as a fair candidate-quality verdict.

Observed result:

- Candidate 5 passed one of two cases safely and reached a mean external-outcome score of 0.9375.
- Candidates 1 and 3 were safe near-misses at 0.875.
- Candidates 2 and 4 were correctly blocked by runtime before acting because they claimed complete context but omitted sources required by selected tools.
- Total spend was `$0.0626038`; cumulative spend became `$11.36144006`.

The failed duplicate case revealed that the deterministic reference could inspect the full synthetic state directly, while the model had no bounded tool for searching existing lead records. It therefore could not discover the canonical lead needed for an exact merge. This was an unfair environment omission.

The repair is general rather than score-seeking:

1. Add a bounded `search-leads` read tool backed by a redacted lead index.
2. Add the corresponding `lead-index` context source to the role contract.
3. Reject any candidate that sets `requireCompleteContext: true` while omitting any context source declared by the role.
4. Tell the model architect the same invariant before it proposes candidates.

The full suite passes 97/97 after repair. The four prospective unseen RevOps cases remain sealed. V1 candidates are not carried forward because the role and validation contract changed; a new committed v2 protocol must generate a fresh portfolio.
