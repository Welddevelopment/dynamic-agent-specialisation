# First paid-model gate

No step in this protocol is authorized until Joel separately approves paid calls.

## Objective

Test whether the compiler can create, diagnose, refine, and select a genuinely model-backed procurement specialist—not merely whether a model can complete one procurement task.

## Environment gate

Before the first paid call:

- disposable procurement system resets exactly;
- independent verifier passes known-good state and rejects known-bad states;
- lost-response reconciliation avoids duplicates;
- candidate and baseline schemas are frozen;
- development/validation cases are separated from the unseen vault;
- metered gateway refuses projected overspend;
- cache and evidence chain pass;
- human-effort recording is ready.

## Spend ladder

1. **Architecture smoke — cumulative target <= $2.** One candidate-generation call and one very small execution case. Stop if schemas or tool bindings fail.
2. **Candidate viability — cumulative target <= $8.** Test safe plausible candidates on the cheapest representative subset. Eliminate dominated candidates.
3. **Development tournament — cumulative target <= $15.** Controlled refinements and validation cases. Reserve stronger models for finalists.
4. **Frozen comparison — hard cumulative ceiling $25.** Finalists plus frozen general, ordinary-manual, and expert-manual baselines on unseen cases and controlled repeats.

The gateway must reserve a conservative projected cost before every call. Cache hits are free and recorded. Crossing the ceiling is a software error, not a discretionary choice.

## Stop conditions

Stop before $25 if:

- candidates differ only in wording;
- the verifier cannot grade external outcomes reliably;
- the compiler requires hidden manual repair;
- model variability makes the test contract invalid;
- safety failures survive candidate filtering;
- no candidate has a realistic path to challenge the ordinary manual baseline.

## Advance conditions

Proceed toward the multi-role finish line only if the one-role gate demonstrates all of:

- several complete, materially different candidate specialists;
- autonomous diagnosis and controlled refinement;
- zero surviving authority violations or incorrect side effects;
- frozen unseen evaluation with no leakage;
- a credible quality or human-effort advantage over the ordinary manual workflow;
- exact cost and failure preservation.

