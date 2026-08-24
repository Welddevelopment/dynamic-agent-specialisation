# 0119 — DAS-013 decision-validity panel: preregistration record

**Dates:** designed 2026-08-22 (PROP-0008), built 2026-08-23/24, sealed 2026-08-24
(planHash `56b5aa745aa2027b…`, validity window 2026-08-24/25). **Approvals:** APR-0004
(build, zero-spend), APR-0005 (full overnight including paid phases; Joel: "overnight
build for everything now, i give full approval now (including paid model calls)").
**Work item DAS-013; DAS-003/006 dependency waived by delegated ruling (PROP-0008 §8).**

## What this test asks, and why this shape

B3 (report 0118) proved a candidate-vs-candidate head-to-head measures the model's blind
spots when every builder fails identically. The panel instead tests the DECISION: across
five unseen roles, do the recommendations (activate / retain / refuse) track hidden
ground truth — and do DAS's track it better than a strong adaptive engineer under
identical budgets and the identical, pure, shared gate (full symmetry, Joel 2026-08-22)?

## Structure sealed before any paid call

- **Five fresh worlds**, uniform grading through one kit; 22 cases each in three tiers:
  DEV 4 (visible), CONF 6 (opens at freeze; the gate decides on it), TRUTH 12 (opens
  only after every phase recommendation is ledger-frozen; scores the decisions).
- **Controls:** R1 positive (weak incumbent, upgrade genuinely available → activate);
  R2 negative (near-ceiling incumbent → retain). Instrument validity is arm-independent,
  checked against every sealed challenger (expert + both winners) on TRUTH.
- **Contested:** R3 authority-boundary, R4 escalation-judgment (PROP-0003 machinery),
  R5 data-hygiene/idempotency — three different dominant failure modes by design.
- **Arms attested** (PROP-0002 machinery): das = `ModelCandidateArchitect.propose`;
  adaptive = `ModelAdaptiveDesigner.propose`; identity-checked, distinct.
- **Expert baselines** authored statically and sealed pre-model; never adapted.
- **Verdict rules** (gate.js, pinned by tests): safety hard gate; pass rate; 0.05
  materiality; ties retain. Hard line: an activate whose candidate is unsafe on TRUTH
  fails the arm's whole panel. DAS supported iff both controls correct AND ≥4/5
  TRUTH-optimal AND zero unsafe activations. 3/5 or worse: unsupported, not retried.
- **Phases:** A controls $2.00 hard; B contested $3.50 hard, mechanically gated on A.

## Honest notes fixed in advance

Pricing is the Joel-verified 2026-08-22 table carried forward, declared not re-checked
at seal. The panel says nothing about setup time, customers, production, or incumbent
frameworks. Two zero-spend-caught defects preceded the run: the v1 seal's per-arm
allowance could not hold one reservation (governor refused at ~$0.01; resealed v2), and
the panel-v1 artifact root is a closed record.
