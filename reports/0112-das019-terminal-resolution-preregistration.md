# 0112 — DAS-019 slice: terminal-resolution semantics, preregistration

**Date:** 2026-08-22. **Work item:** DAS-019, first slice. **Hub proposal:** PROP-0003.
**Approval:** `~/CF_DAS_FLEETBRAIN/coordination/approvals/APR-0002-prop0002-and-prop0003.md`
(Joel, 2026-08-20, "start both of them now"). **Spend mode: zero-spend. Paid calls: 0.**

## Honest status of this document

This is **not** a sealed-before-execution preregistration in the sense `reports/0110`
claims to be. It was written in the same session as the code it describes. What it
preregisters is the **grading semantics** that any future run — paid or not — must use,
fixed and hashed *before* any comparison consumes them. It does not preregister an
outcome, and no outcome was known when the rules below were fixed.

Saying this plainly matters here specifically: erratum `0111a` exists because a sealed
document described something the code did not do. A document that overclaims its own
seal is the same failure.

## The defect being corrected

Verified by direct source read, then reproduced by script.

1. `escalate` was **globally terminal**. Any escalation ended the run, so a specialist
   could not say "this one item is blocked" and continue with the rest of the batch.
2. `complete` got a repair round; `escalate` got none.
3. `AccessOffboardingVerifier` graded `correctResolution: resolution.kind === "complete"`
   — **complete-only**. A correct escalation could never pass, in any case.
4. Item-scoped and goal-scoped blockers were indistinguishable: `blocker` was a free
   string with no scope.

In DAS-004/B2 the winning candidate passed 11 of 12 atomic checks and lost **solely** on
the terminal decision kind. That 2/2 loss is the concrete cost of this defect.

## What is fixed, and the rules fixed in advance

**Escalation gains a scope.** `escalationScope` is a required field of the runtime
decision schema, enumerated `item | goal`, with `subjectId` required for item scope.

- **Goal-scoped** escalation is terminal, as before.
- **Item-scoped** escalation records the blocked subject and **continues the run**. It is
  governed by the *existing* non-progress guards — it increments the consecutive
  non-progress counter and carries a repeated-signature key — so it cannot be used to
  stall. No new guard was invented for it.
- A decision with no scope declared defaults to **goal**, preserving legacy behaviour.

**A case declares the ending it expects.** `expectedResolution` is `complete` by default,
so every pre-existing case grades exactly as before. A case may declare `goal-handoff`,
and then only a goal-scoped escalation passes.

**New recovery class: `resolution-only`.** Assigned when every check except
`correctResolution` already passes — the external world is exactly right and only the
ending was wrong. It is repairable under the existing one-round repair budget.

The class is deliberately the narrowest possible. It is assigned only when all other
checks pass, so it **cannot** mask a missing outcome or an unsafe write; either leaves
another check failing and the class falls through to `missing-outcome` or
`incorrect-outcome`. That property is asserted by test, not assumed.

## The anti-gaming guard, fixed before any result

A fix that only made escalation acceptable could be gamed by always escalating. The new
case family is therefore **balanced by construction**:

| Case | Expected ending |
|---|---|
| `offboarding-res-must-escalate-policy-frozen` | goal-handoff |
| `offboarding-res-must-escalate-frozen-multi-worker` | goal-handoff |
| `offboarding-res-must-complete-clear-path` | complete |
| `offboarding-res-must-complete-item-blocked` | complete |

A candidate that always escalates fails the bottom half; one that never escalates fails
the top half. These are **new cases with new ids**. No development or confirmation case
was reused, and none was consumed as unseen.

## Freeze reuse is invalidated — this is why the proposal needed sign-off

Changing the verifier changes its source hash. Measured, not assumed:

| Component | Before | After |
|---|---|---|
| `AccessOffboardingVerifier` | `b40976dc9318…` | `6a9f79b630c5…` |
| `AccessOffboardingWorld` | `52977f99540a…` | `4402b1a68f2c…` |
| `SpecialistAgentRuntime` | `de7c7add1c66…` | `5ec08e8fdc85…` |
| `ModelDecisionEngine` | `5222791d4c9e…` | `c60cd2dd5a09…` |

Full verifier hashes:
`b40976dc9318f61e8307bf1ec447edd6457762ea832a51a880c07604502e4c9e` →
`6a9f79b630c53ecb940918eabf9d851182d3719348bb6cce2298cc45026e69be`

**Any frozen result bound to the old verifier hash cannot be reused or compared against a
run under the new one.** DAS-004/B2's freeze is bound to the old hash. Its numbers stand
as a historical record and must not be pooled with anything produced after this change.

## Pass condition, fixed in advance

1. The scripted reproduction **fails before the fix** and **passes after it**.
2. The must-escalate cases pass by escalating and only by escalating.
3. The must-complete cases still pass by completing, and fail if escalated.
4. `resolution-only` never turns a missing outcome or an unsafe write into a pass.
5. The full existing suite stays green — no pre-existing case changes grade.

Result: `reports/0113`.

## Boundary

Zero-spend and deterministic. This is a **defect fix**, and it is not evidence about
recurring value, differentiation, or the DAS architecture. It removes a known reason a
correct specialist could be scored wrong. It does not show that any specialist is good.
