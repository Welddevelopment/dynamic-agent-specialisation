# Resumable commercial model campaign preparation

Date: 2026-08-05

## Outcome

The fresh commercial procurement comparison now has a zero-cost, fail-closed execution plan and a resumable paid-campaign boundary. No paid model call was made and no new comparison result is claimed.

## What is now implemented

- The campaign freezes all eight participants, the complete staged case contract, two sealed unseen cases, fresh-repeat requirements, and a maximum of 102 task evaluations / 2,448 model turns if every participant survives every gate.
- Paid execution requires five independent conditions: the global approval phrase, the campaign-specific approval phrase, an explicit positive campaign limit no greater than the frozen $10 ceiling, pricing verification dated on the current UTC day, and the exact approved pricing-table hash. An API key alone cannot enable the campaign.
- A durable per-call budget persists every reservation before a provider request. If the process ends before settlement, that reservation becomes `outcome-unknown` and continues to consume the ceiling until a verified charge or verified non-charge resolves it.
- The model-response cache is owner-only, integrity checked, and reusable after restart. Existing evidence ledgers are verified and resume from their last hash instead of beginning a second chain.
- Mixed-model campaigns use an explicit price entry for each resolved model rather than applying one model's rate to every participant.
- Operational evaluation cost remains attached to cached observations, while incremental campaign spend is measured separately from the durable budget. A resumed cached run therefore cannot appear free operationally or be charged twice against the new campaign.
- Model-reported latency is preserved separately from local cache/replay wall time so cost-and-speed comparisons remain meaningful after restart.
- Successful execution would persist an integrity-bound result, specialist bundle, evidence views, and disposable activation receipt. Failed or interrupted execution preserves a failure receipt, budget state, cache, and evidence rather than implying a result.

## Zero-cost verification

- The exact plan was generated at `artifacts/commercial/procurement-v1/model-campaign-plan.json`.
- Plan hash: `25642f...` (the full digest is preserved in the artifact).
- Pricing-table hash: `c63d69...` (the full digest is preserved in the artifact).
- Focused campaign, provider, budget, evidence, comparison-runner, and runtime tests passed 37/37.
- The complete local suite passed 183/183.
- The campaign runner passed syntax validation.

## Evidence boundary

This checkpoint proves only that a bounded campaign can be authorized, budgeted, interrupted, resumed, and recorded safely in the local implementation. It does not prove that a compiler specialist beats the imported agent, that the campaign will finish within $10, that the provider will remain available, that prices are still current on a future run date, or that this is customer/production evidence.

The fresh model campaign remains deliberately unstarted. It requires Joel's explicit new spend approval and a same-day pricing check.
