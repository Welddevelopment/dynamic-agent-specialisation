# DAS-004/B2 v1 pre-call authorization failure

The first sealed DAS-004/B2 plan did not reach paid execution.

- Attempt 1 failed before campaign state creation because the launch command supplied a pricing hash that did not match the sealed plan.
- Attempt 2 supplied the exact hash but failed before campaign state creation because the plan labelled the Seoul calendar date as the current UTC date. At the check, local time was 2026-08-14 while UTC remained 2026-08-13.
- Provider requests: **0**.
- Durable reservations: **0**.
- Settled calls: **0**.
- Spend: **$0**.
- Campaign state, cache, evidence and result files: **not created**.

The v1 plan and preflight remain preserved. They are invalid for paid execution and must not be described as an empirical run. V2 re-freezes the same role, cases, budgets and comparison rules with the correct current UTC pricing date; it has a new campaign, protocol and plan hash.
