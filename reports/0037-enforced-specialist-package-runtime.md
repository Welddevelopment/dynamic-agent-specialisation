# Enforced specialist-package runtime

Date: 2026-08-02

## Why this phase was required

The compiler already produced candidates containing model, instructions, context, tools, memory, authority, escalation, verifier, limits, strategy, provenance and version. Before this checkpoint, model, instructions, tools and authority materially affected execution, but several other fields were descriptive rather than reliably enforced. A complete bounded Level 1 system cannot fairly claim to construct and test a complete specialist package if the runtime ignores meaningful package dimensions.

## Newly enforced behavior

- **Verifier binding:** when a candidate names an independent verifier, activation fails before any model call if the supplied verifier has a different identity.
- **Context-to-tool binding:** tools can declare the context sources they require. The runtime hides a candidate tool when its required source is absent, and candidates that require complete context fail activation if any declared tool becomes unavailable.
- **Memory policy:** task-scoped memory is isolated to one run; explicitly tenant-scoped memory can be reused only for the same tenant, role and specialist version; disabled memory stores nothing.
- **Task cost limit:** the decision engine projects the next call before spending and refuses it when it would exceed the candidate's remaining per-task model budget. Actual model cost is also accumulated and checked before an action can run.
- **Task latency limit:** elapsed time is tracked throughout the run and the runtime fail-closes before executing a new action after the candidate limit is crossed.
- **Escalation confidence:** every model decision now includes calibrated confidence. A tool action or completion below the candidate threshold is blocked before execution.
- **Strategy and limits:** the model decision context now receives the candidate's quality/cost/speed/risk strategy, memory policy, hard limits and remaining budget rather than only its instructions and tools.
- **Candidate validation:** independent verifier identity, numeric limits, escalation threshold, strategy fields, memory policy, tools and context sources are validated against the role brief.

Tool authority and action authority remain separate hard runtime checks. Independent external-state verification still occurs after a claimed completion or handoff.

## Validation

- Full local suite: 73/73 passed.
- New direct tests cover verifier mismatch, missing context, low-confidence fail-close, task-versus-tenant memory isolation and projected per-task cost refusal.
- No paid model call was used in this phase.

## Evidence boundary

This is local runtime-contract evidence, not evidence that every generated candidate uses the controls well. It does not prove self-reported confidence is calibrated, customer policies are correct, or a specialist succeeds on fresh business cases. Because the model decision schema and execution contract changed, earlier paid results remain preserved historical evidence but must not serve as the final post-change Level 1 evaluation.
