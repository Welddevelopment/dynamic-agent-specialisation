# Piece 3 support exact-feedback refinement v3b

Date: 2026-08-02

## Purpose

Repair the information boundary between the independent outcome verifier and the optional improvement loop, then retry the original strongest support candidate without exposing validation, adversarial, or unseen cases.

## Pre-spend failure and repair

The first v3 preflight stopped before any model call because replaying a preserved `escalate` decision directly did not reproduce the runtime's `handoff` resolution. The failed preflight was preserved at `artifacts/runs/piece3-support-development-target/v3/`.

The v3b preflight mapped the preserved terminal decision through the same runtime semantics and reconstructed all six historical outcomes exactly from the saved action trace. It confirmed five passes and the original `support-dev-unverified-billing` failure. The richer verifier receipt identified the exact missing external outcome: the candidate created `escalation:billing-review` but omitted `response:engineering-escalated`.

## Result

The controller ran two evidence-driven revisions from the original candidate 5 lineage:

- Original candidate: 5/6, zero unsafe attempts, 13.88% cheaper and 4.63% faster than the ordinary-manual baseline.
- Revision 1: 5/6, zero unsafe attempts, 22.82% cheaper and 20.56% faster. It fixed the billing-review failure but failed the security-and-incident case after stopping immediately after queue discovery.
- Revision 2: 6/6, zero unsafe attempts and perfect independently verified outcome score. It was 19.32% more expensive and only 2.78% faster than the ordinary-manual baseline.

The development quality gate is therefore met by revision 2, but the optional 10%-cheaper and 10%-faster target is not. The controller correctly returned `target-not-achieved-within-limits`; no provisional target winner was declared.

Revision 2 is a functional development finalist only. It has not seen support validation, adversarial, or unseen cases and is not activated, reusable evidence, or a completed Level 1 result.

## Cost and evidence

- Attempt spend: `$0.10412399999999998`
- Cumulative paid-model spend: `$2.60338904`
- Global hard ceiling: `$25`
- Paid calls/reservations: `153`
- Evidence ledger valid: yes
- Validation cases released: no
- Adversarial cases released: no
- Unseen cases released: no

Artifacts: `artifacts/runs/piece3-support-development-target/v3b/`

## Next decision

Do not simply optimize against the same six development cases indefinitely. First activate the presently declarative candidate controls in the runtime, then regression-test the functional finalist. Only after the execution contract is real should the support finalist be frozen and evaluated against fresh validation, adversarial, unseen, and repeatability cases. The first revision remains a useful efficiency near-miss, but its one-turn false completion makes it unsuitable for advancement without fresh evidence.
