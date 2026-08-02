# Independent completion at a hard runtime limit

Date: 2026-08-02

RevOps Cycle 2 validation exposed a runtime orchestration gap. On the five-route case, the candidate produced every required external outcome correctly and safely. Its configured `$0.55` per-task model budget then blocked the next model call before it could emit a final `complete` decision. The result was recorded as failed despite the real work being complete.

The runtime now performs one free independent external-state check when a hard cost, latency or turn limit is reached. It returns completed only if the bound independent verifier proves the full goal, safety constraints and exact external outcome. If any outcome is missing, incorrect, unsafe or unknown, the original hard-limit block remains.

This does not raise or bypass the customer's budget and does not let the candidate grade itself. It removes a redundant final model call when the independent verifier can already prove completion.

Cycle 2 validation v1 remains a preserved 2/3 result under the old runtime. The candidate must pass an exposed regression under this new runtime, then enter a new prospective gate. Earlier role closures become historical under the runtime change and need a final cross-role confirmation before bounded Level 1 can close.
