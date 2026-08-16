# 0111a — Erratum: the B2 "DAS arm" did not execute the DAS compiler

**Date:** 2026-08-16. **Discovered by:** independent post-hoc source review during
the Claude Code migration. **Verified by:** direct source read, twice.
Hub record: `~/CF_DAS_FLEETBRAIN/coordination/events/EVT-0003`.

## What the sealed documents claim

`reports/0110` (preregistration): the DAS arm is the *"Actual bounded DAS adaptive
candidate controller with verifier-grounded diagnosis, complete-package generation
and diverse-beam selection."* `reports/0111` repeats "bounded candidate
compiler/controller".

## What the code shows

- Both arms are the same class: `src/experiments/das004-b2/model-adaptive-designer.js`
  -> `ModelAdaptiveDesigner`. Same model, same schema, same `sharedInstruction()`,
  same `reasoningEffort`.
- The only arm difference is `armInstruction(armId)` — a three-sentence persona —
  plus a provenance label (line ~96). The DAS persona begins *"Operate the actual
  DAS bounded candidate-search procedure."*
- `compileSpecialist()` is never invoked anywhere in `src/experiments/das004-b2/`.
  `generateCandidatePortfolio`, `runStagedTournament` and `freezeEvaluation` do not
  execute. The only compiler import in the pairing code is `validateCandidate`.

## What survives and what does not

**Survives:** every measurement. The accounting is intact (335 settled calls, one
verified-uncharged rejection, zero unresolved reservations). The result stands as
a comparison of the *DAS procedure expressed as instructions* against an
unconstrained adaptive engineer persona, on one fictional role, single paired
sample.

**Does not survive:** any citation of B2 as evidence about the DAS *architecture*
or the compiler. The compiler did not run.

## Corrective path

A rerun in which the DAS arm executes the real compiler code path, with an
execution-attestation receipt proving which entry point ran (see
`docs/EXECUTION_ATTESTATION.md`), is drafted as hub proposal PROP-0004. Paid;
requires separate approval.

This erratum is append-only. `0110` and `0111` are not edited.
