# DAS-004/B2 v2 structured-output rejection and usage reconciliation

UTC checkpoint: 2026-08-13

## What happened

The first authorized v2 process completed the imported specialist's development evaluation, then OpenAI rejected the first Terra engineering request with HTTP 400 before inference. The response schema contained `uniqueItems`, which the Responses API strict structured-output surface does not permit.

This is a provider-schema compatibility failure, not an experiment result. No adaptive engineering action, adaptive-engineer arm, confirmation-vault release, comparison verdict, or activation occurred.

## Durable usage state before continuation

- Settled Luna runtime calls: **35**
- Settled spend: **$0.0254922**
- Rejected Terra engineering requests: **1**
- Charge for the rejected request: **$0**
- Active reservations: **0**
- Outcome-unknown reservations: **0**
- Integrity-checked cached responses: **35**

The provider error carried `definitivelyNotCharged=true`; reservation 36 is durably recorded as `cancelled` with resolution `verified-not-charged-provider-rejection` and retry class `request`.

## Repair boundary

The unsupported `uniqueItems` annotations were removed from the provider-facing schema. The identical uniqueness requirements remain enforced immediately after structured-output parsing for context sources, tools, authority actions, and provenance parents. A targeted regression proves that the outgoing schema contains no `uniqueItems` key and duplicate values still fail closed.

The role, imported agent, cases, confirmation vault, models, budgets, resource limits, scoring, selection, safety rules, and protocol hash are unchanged. The existing v2 campaign state is continued only because all provider usage is exactly reconciled; the prior 35 responses are reused from the integrity-checked cache rather than purchased again.

## Verification before continuation

Focused protocol, controller, world, provider, budget-correlation, writer-lock, authorization, and schema-compatibility tests: **31/31 passed**.

This document preserves a private local development failure. It is not evidence that either comparison arm won, and it authorizes no public claim.
