# 0114 — DAS-004/B3: the real compiler arm, preregistration

**Date:** 2026-08-22. **Hub proposal:** PROP-0004 (APR-0003, paid).
**Campaign:** `das004-b3-access-offboarding-real-compiler-v1`.
**Status: sealed before paid execution. Paid calls so far: 0. Spend so far: $0.**
Plan sealed at `artifacts/adaptive-baseline/das004-b3-access-offboarding-real-compiler-v1/plan.json`,
planHash `259f783f0de1222852f39eeae16b78793ae37c0959e2d37b1290fe1ffb13fdd7`.
Preflight clean, hash `add46de7c6b715bb0af45c8610b8d03d0eb973ceff5b6152878e253e7499a3e5`.

## Expectation, stated before the run

**A coin flip is the honest prior.** This is the first *valid* run of the decisive
comparison, not a rerun of a passing test. B2 cannot tell us what to expect, because B2
compared two personas over one class (erratum `0111a`). A tie or a loss here is a real
result, will be preserved unchanged, and is worth more than an untested claim. If neither
arm's winner beats the imported agent, **retain-existing is the correct outcome** and will
be reported as such.

## What is different from B2 — the entire point

| | B2 | B3 |
|---|---|---|
| das arm | `ModelAdaptiveDesigner` + 3-sentence persona | **`ModelCandidateArchitect.propose`** — the real model-backed compiler, the same path the paid Level 1 campaign ran |
| adaptive arm | `ModelAdaptiveDesigner` + persona | `ModelAdaptiveDesigner` (unchanged) |
| `distinctArmEntryPoints` | `false` | **`true`, machine-enforced** — the preregistration is rejected outright if the arms are the same code |
| Attestation | none | both arms resolved against their real modules; `assertAllReached()` gates any quotable result |
| Cases | consumed | fresh — zero identifier overlap with B2, checked mechanically in preflight |
| Verifier | old hash `b40976dc9318…` | post-PROP-0003 hash `6a9f79b630c5…` |

**Why not `compileSpecialist()`.** PROP-0004's text says the arm should run the compiler's
real path. The literal `compileSpecialist()` pipeline is **deterministic** — hard-coded
variants, `model.family: "model-policy"`, `planWorkItem`, zero model calls — and requires a
role interface (`createWorld`/`verify`/`unseen.release`/registry) this campaign's brief does
not have. Using it would put a $0 arm against a paid arm and break equal resources. The
model-backed compiler DAS actually shipped and paid for in Level 1 is
`ModelCandidateArchitect` (portfolio generation) + `ModelCandidateRefiner`
(verifier-grounded repair), and that is what the das arm runs. Joel approved this reading
in session on 2026-08-22.

## Declared harness steps (bookkeeping, not design)

1. **Model normalization** — the architect's schema leaves `model.family` free; generated
   candidates are normalized onto the frozen execution family `gpt-5.6-luna`, exactly as the
   Level 1 campaign did. Both arms execute on the same family.
2. **Lineage stamping** — the architect returns a portfolio, not parent-linked actions, so
   the adapter stamps `provenance.parents` with the frozen parent fingerprint. No scored
   design dimension is ever edited.
3. Campaign-level **retain-existing is a ranking outcome**: the incumbent competes in the
   beam and wins if nothing beats it. The designer's own `retain` branch covers only the
   narrower no-valid-candidate case.

## Resources and money

- Both arms engineer on `gpt-5.6-terra`, execute on `gpt-5.6-luna`, same per-arm limits,
  isolated caches, no cross-arm feedback.
- **Ceiling $3 (hard), planned maximum $1.6.** APR-0003 said $1; Joel was shown the
  contradiction with the frozen-$3 gate design and chose $3 in session on 2026-08-22. The
  override is recorded in the plan itself (`resources.ceilingNote`).
- **Pricing honesty:** the table is B2's, carried forward unchanged. It has **not** been
  independently re-verified today, and the plan says so
  (`pricing.independentlyReverifiedOnThisDate: false`). The authorization gate still pins
  the run to 2026-08-22 UTC; if the run slips, the table must actually be re-checked and
  the date constant bumped.
- One paid campaign at a time. Stop conditions include an unresolved attestation.

## Preflight (zero spend, all green)

Reference solver passes all 5 cases at score 1; a do-nothing control fails all 5
(`missing-outcome`); no consumed-case reuse; confirmation vault sealed, unreleased, and its
payloads appear nowhere in the sealed plan; both entry points resolve; arms are distinct
code; no authority granted. 13 new tests; full suite **541/541**.

## What a result will and will not mean

It speaks only to this exact frozen role, cases, resources and verifier. It says nothing
about recurring value, customer willingness to pay, setup time (never measured), or
generality across roles — that is DAS-013, which remains open regardless of this outcome.
The result must never be pooled with B2's numbers (different verifier hash, different
arms) or with the deterministic 115/115 fleet result.

Result report: `0115`, after the run.
