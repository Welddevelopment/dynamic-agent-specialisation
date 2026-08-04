# Multi-role resumable campaign preparation

Date: 2026-08-05

## Outcome

The safe, resumable model-campaign path is no longer procurement-specific. Procurement, support and CRM / RevOps now each have an independently identified campaign, independently frozen approval phrase, separate durable state directory and zero-cost execution plan. A shared runner removes role-specific result-handling drift while retaining each role's own pack, evaluator, driver and verifier.

## Independent campaign gates

Each role requires all of the existing global, explicit limit, current pricing, exact pricing-hash and API-key gates, plus its own exact campaign approval phrase. Approval for one role cannot authorize another role. The default remains disabled.

Each frozen plan currently contains:

- 8 participants;
- at most 102 task evaluations;
- at most 2,448 model turns if every participant survives every gate;
- a hard contract ceiling of $10; and
- persistent budget reservations, response caching and hash-chained evidence across restart.

The structural maximum is not a spending estimate or permission to spend. Early elimination and cache reuse can make an authorized campaign materially smaller.

## Verification

- The three campaign ids and plan hashes are distinct.
- A procurement approval phrase was explicitly rejected for the support campaign.
- Support and RevOps plan artifacts were generated without model calls.
- The complete local suite passed 197/197.
- Paid model calls made: 0.
- Incremental spend: $0.

## Evidence boundary

This is campaign preparation only. No support or RevOps model candidate has been evaluated by these campaigns, no selected specialist or improvement exists, and no customer result is implied. Running any paid campaign still requires Joel's fresh exact approval and the independent spend gates described in its frozen plan.
