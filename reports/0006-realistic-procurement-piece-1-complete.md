# Piece 1 complete: realistic procurement evaluation world

Date: 2026-08-02

## Purpose

Piece 1 replaces an answer-shaped procurement exercise with a reusable fictional workplace capable of testing whether a future model-backed specialist understands procurement outcomes, constraints, authority, and irrelevant context.

This remains an environment-validation result. It is not a model-backed specialist result and not evidence that the compiler beats a human-configured agent.

## Workplace

The resettable fictional company contains three warehouses, fifty products, twelve suppliers, more than 150 offers, inventory and reservations, existing orders and transfers, purchasing budgets, approved and unapproved demand, unrelated operational records, and inaccessible protected payroll/customer records.

The agent can read only bounded operational tools. It cannot read payroll or private customer tokens. Writes are limited to draft purchase orders and draft stock transfers inside the active task scope.

## Evaluation splits

Eleven tasks use the same company and the same outcome verifier:

- 4 development cases;
- 2 validation cases;
- 3 adversarial cases; and
- 2 frozen unseen cases released only after strategy and evaluation hashes exist.

Cases vary warehouse, product, aggregate demand, existing coverage, deadline, approved supplier availability, delegated authority, transfer availability, unnecessary-action traps, unapproved-demand traps, and a committed write whose response is deliberately lost.

Two development cases require a precise handoff rather than forced completion: no permitted route and approval required.

## Independent outcome verification

The verifier inspects final external company state rather than trusting an agent's report. It checks:

- aggregate demand coverage;
- delivery deadlines;
- approved suppliers;
- total new spending;
- draft-only authority;
- unique idempotency keys;
- task-scoped writes;
- absence of unnecessary actions;
- protected-state integrity;
- denied action attempts; and
- required reconciliation after an ambiguous write response.

It accepts multiple valid action paths where the outcome and constraints are satisfied. It does not encode one preferred click sequence.

## Zero-cost discrimination campaign

Campaign receipt: `934c7407ce2af2beddf203a0fb9c612368bb949d85a223b9d38d64c9c42b32ab`

| Strategy | Passed | Rate |
|---|---:|---:|
| Outcome-aware deterministic reference | 11/11 | 100% |
| Do nothing | 2/11 | 18.2% |
| Order every approved demand | 3/11 | 27.3% |
| Always choose the cheapest offer | 3/11 | 27.3% |

The reference passed both frozen unseen cases. None of the shortcuts passed more than 30% overall. The campaign is exactly repeatable after reset.

## Repository validation

At this checkpoint the complete repository test suite passes 33/33 tests. Paid-model cost remains $0.

## What this proves

- The workplace is rich enough to contain relevant, plausibly relevant, unrelated, and inaccessible information.
- The verifier catches several important unsafe or shallow approaches.
- One generic deterministic outcome-aware policy can solve every current case without case-specific core rewrites.
- Frozen unseen release and repeatable reset mechanics are operational.

## What this does not prove

- A model can infer the reference policy from company information.
- The compiler can generate strong model-backed candidates.
- A compiled candidate beats a strong general-agent, ordinary manual, or expert manual baseline.
- The procurement suite represents every real procurement environment.
- The wider bounded Level 1 system is complete across three realistic roles.

Those are later gates. Piece 2 begins with real candidate generation under the already fail-closed paid-model boundary, followed by fair baseline comparison only after an explicit spending approval.
