# Optional improvement console checkpoint

The private local console now separates the normal compiler workflow from an explicitly optional **Improve further** workspace.

The company can configure:

- any supported combination of model cost, completion speed, external outcome quality and human-intervention reduction;
- the minimum improvement for each selected metric;
- a hard paid-model budget;
- a hard wall-clock duration;
- maximum redesign rounds; and
- an early, balanced or persistent stopping posture.

Persistent search does not mean infinite search. It still stops at hard budget/time limits and when no evidence-backed reasonable path remains.

The run surface preserves every candidate evaluation, measurement, rejection, cumulative spend and final stop reason. The completed Piece 2 procurement receipt appears as historical evidence, including the decision not to recommend an unproved upgrade.

The console stores configuration locally with owner-only file permissions. Saving a contract does not start model calls. Starting requires separate explicit confirmation and a verified role-specific runner. The Start control is currently locked because the harder second-role runner has not yet been attached; the UI does not pretend otherwise.

Automated store/controller tests and a live local browser check passed. The live check enabled optional optimisation, selected cost and speed, saved a $7 hard limit, confirmed the saved state and verified that no run started.
