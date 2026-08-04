# Persistence integrity repair and technical readiness audit

Date: 2026-08-05

## Serious issue found

The first full claim-layer readiness audit found that the saved commercial RevOps comparison contract could not pass its own integrity check after JSON reload.

The ten ordinary RevOps cases that use the default territory policy carried an optional `territoryRules: undefined` field in memory. The canonical hash included that JavaScript-only value, but JSON persistence omitted it. The semantic task data and deterministic test behavior were unchanged; however, the resulting frozen contract was not independently reloadable. Existing pack tests missed this because they rebuilt the contract in memory instead of validating the persisted file.

## Repair

- The RevOps case constructor now omits the optional field when no override exists. An explicit empty array remains distinct and is still preserved for no-territory cases.
- Commercial comparison sealing now refuses any record whose digest changes after a JSON serialize/parse round trip.
- A regression test deliberately inserts an `undefined` field and confirms that commitment fails before an artifact can be written.
- The affected zero-spend commitments were regenerated from source:
  - commercial RevOps comparison contract, preflight and model-campaign plan;
  - RevOps post-comparison gate and aggregate gate receipt;
  - the multi-role local network rehearsal receipt; and
  - the prospective three-role Fleet plan's sealed-task commitment.
- No historical paid model result, Level 1 registry selection or cost record was edited or reinterpreted.

The current RevOps commercial freeze is `36568b71e0221eff7aecec0d7039bb280a92351ba729070803a48f9372476be4`. The current prospective Fleet plan is `648a5ecd88d25e3fd046d5b53e4e60923a7a215f8ed66595f54eb73cd83fda28`. Any future paid approval must bind these current commitments rather than an older plan hash.

## Readiness audit

A new machine-checked audit now verifies the current claim layers together:

- all three Level 1 selections and every referenced source-evidence SHA-256;
- the durable Level 1 registry and selected record hashes;
- all three commercial comparison freezes, preflights and model plans;
- all three packaged local network rehearsals;
- the three-role deterministic Level 1.5 lifecycle and sealed post-comparison gates;
- the deterministic Level 2 role-gap return, five-profile generality matrix and Fleet Intake; and
- the prospective Level 2 plan and preflight while confirming that no empirical result artifact exists.

The generated audit is `artifacts/readiness/technical-readiness-v1.json`. It explicitly keeps prospective human setup, fresh commercial model comparison, empirical Level 1.5, prospective model-backed Level 2, customer deployment, production reliability and market demand open.

## Validation

- Focused persistence/readiness tests: 12/12 passed.
- Full local repository suite: 247/247 passed.
- RevOps deterministic reference: 12/12 passed.
- RevOps shortcut controls remained discriminating.
- Post-comparison references: 6/6 passed; weak controls: 0/6.
- Support and RevOps authenticated loopback rehearsals passed again.
- New model calls: 0.
- New paid-model spend: `$0`.
- Historical cumulative paid-model spend remains `$23.10699808`.

## Evidence boundary

This repair restores persistence integrity and adds a machine-checked view of what is and is not complete. It does not turn deterministic mechanisms into empirical model results, customer evidence or production reliability. The readiness audit is itself a local integrity receipt, not an external certification.
