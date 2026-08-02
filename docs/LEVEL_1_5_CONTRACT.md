# Bounded Level 1.5 contract

Level 1 builds and selects a specialist. Level 1.5 keeps that specialist useful after selection without turning the system into an autonomous fleet manager.

## Technical finish line

1. Ingest only integrity-checked observations produced by the bound independent external-state verifier.
2. Keep version-specific performance windows across success, outcome quality, unsafe attempts, model cost, latency, tool use, and human intervention.
3. Quarantine immediately after an unsafe attempt. Treat ordinary performance drift separately.
4. Keep further optimization optional and disabled by default. A drift signal may create a transparent request, but cannot spend model budget without an explicit start and a verified role-specific runner.
5. Bind every optimization request to the active specialist version, exact target metrics, quality floor, model-spend limit, time limit, round limit, and stop policy.
6. A development winner is not a live winner. It must pass offline evidence, shadow observation, and a small explicitly authorized canary.
7. Preserve the current specialist and alternatives throughout the trial.
8. Promote only after all gates pass. Quarantine an unsafe challenger immediately.
9. Roll back a regressing promoted specialist to the prior proven record without losing its evidence.
10. Persist monitoring, requests, canary stage, promotion, rollback, and audit events across restart with integrity checks.
11. Expose the lifecycle and exact reasoning in the console without making human selection necessary for routine operation.
12. Exercise the same lifecycle across the three rich Level 1 roles before claiming bounded technical completion.

## Not Level 1.5

- deciding that the company needs an entirely new business role;
- creating or deleting departments or coordinating a fleet toward company strategy;
- silently weakening quality targets;
- unlimited self-improvement;
- spending money merely because drift was detected;
- promoting a challenger directly from development tests;
- claiming that synthetic lifecycle tests prove production monitoring or customer value.

Those strategic role-creation and fleet-allocation decisions belong closer to Level 2.

## Status — 2026-08-02

The monitoring, bounded request, offline/shadow/canary, promotion, quarantine, rollback, persistence, runtime-observation, audit and console foundations are implemented. A deterministic three-role rehearsal passes. Full bounded Level 1.5 remains open pending a fresh model-backed joined lifecycle and a verified live role-specific runner/dispatcher.
