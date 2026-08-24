# 0122 — Guard validation v1: guards emitted, guards mis-aimed, incumbents won by default

**Date:** 2026-08-24. **Campaign:** `das013-guard-validation-v1` (PROP-0009, APR-0006).
**Spend: $0.7894977 of the $3 ceiling; 934 settled calls; zero unresolved; attested;
ledger intact. Preregistered verdict: `guardThesisSupported: false` via
`guardEmissionFailure` — with a diagnosis the preregistration's failure taxonomy did
not anticipate, recorded here precisely.**

## What the sealed rule said vs what actually happened

The mechanism-attribution rule keyed on "winners carrying no guards", anticipating the
model might not emit guards. The receipt shows exactly that (`dasWinnersCarryingGuards:
0`) — but the CAUSE is different and more instructive:

1. **The compiler emitted guards on every candidate** — 8 per candidate, all three
   kinds, including 19 `deny-write-if-observed-row` guards across the roles. Replaying
   validation offline on the cached raw outputs: **every guard-carrying candidate
   validated cleanly.** Nothing was dropped at admission.
2. **Guard-carrying candidates lost their lanes anyway.** In development screening the
   guarded candidates went unsafe (r4, r5) or underperformed (r3), so the lane winner
   everywhere was the guardless INCUMBENT — hence zero guards on winners.
3. **The guards were mis-aimed.** Inspection of the raw emissions: generic
   `stable-retry-key` and `require-prior-read` sprayed across tools, and observed-row
   guards pointed at the wrong tool/source/field combinations — while the specific
   precondition each role's policy names (the same-key retry on `adjust-stock-level`;
   the service-owned row check on `rotate-credential`) went uncovered or mis-specified.
   The trap writes walked straight past the guards that existed.

## The finding

**The guard mechanism works; model-driven guard COMPILATION is now the weak joint.**
Deterministic tests prove correctly-aimed guards kill all three walls. A live model
asked to emit guards as one field among fourteen in a full candidate produces
plausible-looking, badly-aimed ones. Guard targeting — mapping a specific policy
sentence to a specific tool, source, and match — is its own compilation problem and
deserves its own compilation PASS, not a schema slot.

Secondary observations, single-sample каждая: the adaptive arm produced one TRUTH-safe
winner (1/3 vs the panel's 0/3); the das r5 incumbent screened unsafe in its own lane
(consistent with the panel's incumbent-unsafety finding); no unsafe activation anywhere
— the gate's hard line is now 16-for-16 across three campaigns.

## Status

The guard thesis is **untested at the model boundary, not refuted**: the mechanism
never got a fairly-aimed shot. Next iteration (same APR-0006 envelope, ~$2.21
remaining): a dedicated guard-compilation step — one policy fact at a time, with the
role's tool and row vocabulary in context — then reseal and rerun. Cosmetic debt noted:
the shared adapter stamps panel candidates with `b3-compiler-*` ids; fix before v2.
