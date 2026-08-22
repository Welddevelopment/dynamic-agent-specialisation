# 0113 — DAS-019 slice: terminal-resolution result

**Date:** 2026-08-22. **Preregistration:** `reports/0112`. **Hub proposal:** PROP-0003.
**Spend: $0.00. Paid model calls: 0.** Every run below is deterministic
(`ScriptedDecisionEngine`); no provider was contacted.

## Verdict against the preregistered pass condition

All five conditions in `0112` are met.

### 1. The reproduction fails before the fix and passes after it

The regression (`test/das019-terminal-resolution.test.js`) was run against the pre-fix
sources by reverting exactly three files — `agent-runtime.js`, `model-decision-engine.js`,
`access-offboarding-world.js` — while keeping the new cases and the new test.

| | Pre-fix | Post-fix |
|---|---|---|
| Tests passing | **2 of 10** | **10 of 10** |

The two that pass pre-fix are the deliberate controls — "must-complete cases still pass
by completing correctly" and "escalating on a must-complete case fails". They are the
behaviour that had to **not** move, and it did not.

The eight that fail pre-fix are the defect and its guards:

- a goal-scoped escalation is correct on a must-escalate case *(defect 1: complete-only grading)*
- an item-scoped escalation does not end the run *(defect 2: escalation was globally terminal)*
- a run right about the world and wrong only about the ending is repairable *(defect 3: no repair for escalation)*
- `resolution-only` never launders a missing outcome or an unsafe write
- only one repair round exists; repeating the wrong ending still fails
- repeated identical item escalations are stopped by the non-progress guard
- a legacy escalation with no declared scope stays goal-scoped and terminal
- the decision schema requires an explicit escalation scope and subject

### 2–3. The case family is balanced, and grades as declared

Verified directly against the verifier, with **no writes performed**:

| Case | ending: complete | ending: goal escalation |
|---|---|---|
| `must-escalate-policy-frozen` | fail — `resolution-only` | **pass** |
| `must-escalate-frozen-multi-worker` | fail — `resolution-only` | **pass** |
| `must-complete-clear-path` | fail — `missing-outcome` | fail — `missing-outcome` |
| `must-complete-item-blocked` | fail — `missing-outcome` | fail — `missing-outcome` |

The bottom two rows are the anti-gaming guard doing its job: on a case that must be
completed, *doing nothing* fails identically whether the run ends by completing or by
escalating. Escalation buys nothing.

### 4. `resolution-only` cannot launder a bad outcome

Asserted by test, and by construction — the class is assigned only when every other check
passes:

- Missing work + `complete` → `missing-outcome`, terminal after one repair. Never `resolution-only`.
- A write attempted during a policy freeze → denied by the world; the runtime **blocks the
  run** on the unknown tool outcome (`tool-outcome-not-started:revoke-access-grant`) before
  any resolution is reached. Grading that world state independently gives
  `noDeniedAttempts: false` and `incorrect-outcome`.

Worth stating precisely, because it differs from what I first assumed: an unsafe write
does not fail *at the resolution check*. It never gets that far. The block happens in the
pre-existing reconcile path, which I did not modify.

### 5. Nothing else moved

Full suite: **528 pass, 0 fail** (~36s). Baseline before this session was **503**. The 25
new tests are 15 for PROP-0002 and 10 for PROP-0003. No pre-existing test changed grade.

## What changed in the code

| File | Change |
|---|---|
| `src/runtime/model-decision-engine.js` | `escalationScope` (`item`/`goal`) and `subjectId` added to the decision schema, both required; instruction text now states that goal scope ends the run; escalations without a valid scope are rejected |
| `src/runtime/agent-runtime.js` | item-scoped escalation records the blocked subject and continues under the existing non-progress guards; goal-scoped escalation now gets the same one-round repair budget as `complete`; repair authorization factored into one place |
| `src/worlds/access-offboarding-world.js` | cases may declare `expectedResolution`; a `policyFreeze` scenario makes goal escalation the only correct ending and denies every write; `resolution-only` recovery class added |
| `src/worlds/access-offboarding-cases.js` | new `accessOffboardingResolutionCases` family, 4 cases, new ids |
| `test/das019-terminal-resolution.test.js` | the regression, 10 tests |

## What this does and does not mean

**Does:** a specialist that does the right thing in the world and ends the run correctly
can now be scored correctly. A specialist that ends it wrongly, with the world already
right, gets exactly one round to fix the ending. Blocked items no longer kill a run that
could still complete.

**Does not:** this is not evidence about recurring value or differentiation, and it does
not re-open B2. It removes one reason a correct specialist could be marked wrong. It says
nothing about whether any specialist is good.

**On B2 specifically:** the winner lost 2/2 on this defect. That does **not** mean it
would have won without it — the defect is now fixed, the outcome under the fix is
unmeasured, and measuring it is PROP-0004, which is paid and **not authorized**. The
honest statement is that B2's result was produced under a grading rule now known to be
wrong, and its freeze is bound to a verifier hash that no longer exists.
