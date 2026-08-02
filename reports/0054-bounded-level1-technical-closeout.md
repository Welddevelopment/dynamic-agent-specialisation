# Bounded Level 1 technical closeout

Date: 2026-08-02

## Verdict

The bounded three-role **technical mechanism** is complete.

This is narrower than saying the complete commercial or external evidence case is finished. The system has not yet proved human setup-time savings, customer value, production reliability, or general superiority over LangChain, CrewAI, Microsoft, or other agent-building workflows.

## What is technically complete

The same compiler and runtime boundary now supports three substantially different rich roles: procurement, SaaS support operations, and CRM/RevOps. Across them it can:

1. accept the complete company brief;
2. construct multiple complete specialist packages rather than prompts alone;
3. reject packages that violate authority, verifier, context, tool, memory, cost, or latency contracts;
4. compare candidates with strong-general, ordinary-manual, and expert-manual baselines;
5. preserve sealed prospective cases until the candidate and baselines are frozen;
6. use independent external-state verification rather than candidate self-grading;
7. preserve failures, retries, exact costs, latency, tool use, side effects, and handoffs;
8. select a compiler specialist only when it wins, otherwise retain the existing setup;
9. save the exact winner and three serious alternatives per role in a durable, integrity-checked registry;
10. reload the registry, detect tampering, and fail closed if current policies, authority, tools, or active work no longer permit activation or switching.

## Final role decisions

| Role | Frozen decision | Reason |
|---|---|---|
| Procurement | Retain ordinary-manual Luna | Both final packages generalized and repeated safely; the existing specialist was slightly cheaper under the frozen ranking. |
| SaaS support | Activate compiler-created Luna specialist | It ranked first on the prospective comparison and then passed 12/12 fresh repeats safely. |
| CRM / RevOps | Retain ordinary-manual Luna | Both finalists passed the prospective comparison, but the compiler Terra package was materially more expensive and passed 11/12 repeats versus the selected baseline's 12/12. |

This mixed result is the intended product behavior: the compiler can return “keep what you already have” rather than selling an unproved replacement.

## Durable registry

The final selection artifact is `artifacts/level1/registry-v1.json`. It contains versioned selected packages, non-selected alternatives, frozen/repeat/current-runtime evidence summaries, compatibility hashes, source-artifact hashes, record hashes, and a whole-registry integrity hash.

The registry is not merely an export receipt. Its selected records can pass into the existing activation control plane. Any saved-state mutation is detected before reuse, and environment mismatch still blocks activation.

## Human-effort boundary

`HumanEffortLedger` prospectively records elapsed time, decisions, edits, and interventions, and is tested. No real prospective engineer sessions have been conducted. Baseline setup estimates and historical development effort are not substitutes for that study.

Allowed statement: the product is instrumented to compare human configuration effort.

Not allowed: the compiler has proved it reduces human configuration time.

## Validation

- Full local suite: 112/112 passed.
- Durable registry tests: save/reload, tamper refusal, and fail-closed activation all passed.
- Current-runtime cross-role confirmation: 3/3 passed.
- Exact cumulative paid-model spend: `$23.10699808`.

Machine-readable verdict: `artifacts/level1/technical-closeout-v1.json`.

## Remaining evidence and product gaps

- prospective comparison with real human agent engineers;
- customer-owned roles, systems, policies, and success criteria;
- longer-running production behavior and security review;
- fair runnable component/workflow comparisons against relevant incumbent approaches;
- evidence that the commercial promise is valuable enough to buy.

Those gaps do not make the technical mechanism incomplete. They prevent broader evidence and market claims.

