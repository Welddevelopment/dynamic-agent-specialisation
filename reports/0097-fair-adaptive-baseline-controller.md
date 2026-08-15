# Checkpoint 0097 — fair adaptive-baseline controller

Date: 2026-08-14  
Work item: DAS-004 / Lane B2  
Spend: $0  
Model calls: 0

## Result

DAS now has a zero-spend prospective substrate for a fair comparison against a genuinely adaptive agent engineer rather than a fixed prompt baseline.

Both comparison arms:

- start from the exact same imported current agent;
- receive the same bounded role, tools, context, policies, authority ceiling, verifier and development cases;
- receive equal engineering and task-execution call, spend and wall-clock allowances;
- may retain the current agent, revise a complete package, switch to an allowed model, or fork another complete package;
- see only their own sanitized independent development feedback;
- eliminate a candidate immediately after an unsafe attempt or incorrect external side effect;
- freeze one development winner before the same fresh confirmation vault is released once;
- cannot substitute a fallback winner after confirmation or activate a specialist.

The controller validates every complete package, checks exact parent lineage and material differences, rejects model/tool/context/authority/verifier widening, collapses exact design duplicates, and keeps a bounded diverse beam. It records automated engineering separately from real human effort and separates engineering-resource accounting from operating-resource accounting.

## Deterministic rehearsal

An immutable fictional procurement rehearsal exercised both arms through common development and fresh confirmation:

- DAS control selected: `das-control-fork`;
- adaptive-engineer control selected: `adaptive-control-revision`;
- fresh confirmation released exactly once after both winners were frozen;
- unresolved reservations: 0;
- unsafe attempts and incorrect external effects: 0 in the positive rehearsal;
- spend and model calls: 0.

Receipt:

- `artifacts/adaptive-baseline/checkpoint-0097-v1/receipt.json`
- protocol hash: `5857cb829d7470753c98adf23263cdfe754841022f5a7712df9e83d5181499aa`
- result hash: `6b50c7f6a595f1ef5e8303c34e96f1738df8c45326a1f81aaea4c504f9afe419`
- receipt hash: `43139409b89523f430a8c2523b27acb11b7a5baa98858e183f39a28093700c54`

This rehearsal proves the comparison machinery and its boundaries, not that DAS beats the adaptive baseline. Its scores were deterministic controls chosen to exercise selection and confirmation.

## Negative controls

The focused tests also verified that:

- protocol mutation of the imported agent, authority, verifier, cases, model allowlist or resource envelope fails closed;
- role, authority, verifier, tool or context widening fails candidate validation;
- model switching is allowlist-only and cannot hide other configuration changes;
- an incorrect-side-effect child stops after its first recorded case and cannot remain in the beam;
- exact duplicate designs are not evaluated twice;
- wrong development cases and wrong verifier receipts are rejected;
- a projected resource overrun fails before execution;
- unresolved reservations block completion;
- if either arm has no safe development winner, confirmation remains sealed and no fallback is chosen.

## Validation

- New focused suite: 7/7 passed.
- Adjacent optimisation/candidate-scale/commercial comparison suite: 29/29 passed.
- Full deterministic repository suite: passed with the dot reporter.

## Preserved validity boundary

Historical candidate-scale V7 and the prepared 40-candidate arm cannot be relabelled as the adaptive-baseline result. V7 consumed its cases, produced no safe 150-arm selection winner, and did not preregister an adaptive comparator. A future empirical result requires a fresh role/case family and a separately frozen paid plan.

This checkpoint does not establish that DAS beats a strong adaptive engineer, reduces real human agent-engineering time, generalizes across roles, creates customer value, or is production-ready. No paid comparison has been authorized or run.

## Next gate

The zero-spend B2 substrate is complete. A genuine head-to-head run is blocked on a new prospective role/case pack, exact model/pricing plan and Joel's separate paid approval. The active zero-spend productization lane proceeds to DAS-022: qualify customer-local write safety and an independently authenticated observer without turning structural compilation into execution readiness.

