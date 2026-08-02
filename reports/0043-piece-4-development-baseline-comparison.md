# Piece 4 RevOps development baseline comparison

Date: 2026-08-02

Two fresh compiler-generated Luna finalists and three frozen baselines ran across all five exposed development cases.

Ranking:

1. Strong-general Terra: 5/5, zero unsafe attempts, one verifier-guided repair, `$0.035101`.
2. Expert-manual Sol: 5/5, zero unsafe attempts, one repair, `$0.0428916`.
3. Compiler candidate 3 on Luna: 4/5, zero unsafe attempts, one repair, `$0.05984554`.
4. Ordinary-manual Luna: 4/5, zero unsafe attempts, two repairs, `$0.0415358`.
5. Compiler candidate 1 on Luna: 4/5, zero unsafe attempts, three repairs, `$0.06919524`.

Every Luna participant made the same incorrect partner-route action: it created a `first-touch` task for the correct partner owner rather than the required `partner-follow-up`. Because that is an incorrect external side effect, the verifier correctly refused recovery. Terra and Sol completed the same route, each with one missing-only repair.

No compiler finalist advances. The next rational compiler search dimension is model selection: keep the two compiler configurations unchanged, promote them to Terra, and rerun all five exposed cases. Do not add more route-specific prompt lines. Reserve Sol promotion only if Terra fails.

This comparison spent `$0.24856918`; cumulative paid spend is `$12.04116712`. Validation, adversarial and unseen RevOps cases remain unreleased.
