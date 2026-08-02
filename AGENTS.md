# Dynamic Agent Specialisation

This repository is an independent project for a bounded Level 1 specialist-agent compiler.

## Hard boundaries

- Do not import from, link to, mutate, or merge evidence with Capability Factory.
- Capability Factory may be inspected read-only. Any copied code must be minimal, independently owned here, and recorded in `docs/PROVENANCE.md`.
- No paid model call without Joel's explicit approval.
- Preserve failed evaluations and exact costs. Never rewrite historical results.
- A complete Level 1 requires the same compiler core to work across at least three substantially different roles.
- A candidate cannot grade itself. Final outcomes require an independent external-state verifier.
- Safety and authority are hard gates, not weighted score components.
- Unseen evaluation cases must be frozen before finalists run.

## Product principle

Autonomous recommendation and activation by default; optional executive, engineering, and forensic transparency for human oversight.

## Piece 2 procurement result — 2026-08-02

- Piece 2 is complete with a mixed result. See `reports/0025-piece-2-complete.md`.
- The final compiler Luna specialist passed 5/5 fresh Cycle 3 cases, 2/2 frozen unseen and 6/6 repeatability cases with zero denied actions in those stages.
- The ordinary manual Luna baseline also passed 13/13 comparable final/repeat cases and was about $0.00353 cheaper, although the compiler specialist used six fewer tool calls and was faster.
- Under the frozen ranking, the product recommendation is to retain the existing ordinary specialist and not charge/activate an unproved upgrade.
- Do not claim the compiler beat ordinary manual engineering, proved human setup savings, or completed bounded Level 1.
- Freeze hash: `03c6edb44f53f429f6015d7723861cf23fc1b5ee87e6230d2ac9508c4c002aa7`.
- Total paid-model campaign spend through Piece 2: $1.98507724.
- Procurement cases are now exposed. Do not reuse them as unseen evidence for a modified candidate.
- Next valid Level 1 step is a substantially different second role using the same core and new prospective human-effort measurement.

## Optional target-driven improvement — 2026-08-02

- Further self-improvement is optional and disabled by default. Never spend model budget merely because a specialist has been compiled.
- The customer may configure metrics, minimum improvement, non-negotiable quality/safety floors, hard model spend, hard elapsed time, search rounds, repeat evidence and search persistence.
- The controller must stop with an explicit reason after success, a hard limit, repeated negligible progress, no plausible remaining path or the round ceiling. Preserve the best near-miss and every attempted design.
- Targets cannot be weakened during a run and unseen cases remain unavailable to the improvement loop.
- The private console exposes configuration, live run events, candidate measurements, rejection reasons, cumulative spend and completed receipts. Starting remains locked until a role-specific runner is attached and verified.
- See `reports/0026-target-driven-improvement-controller.md` and `reports/0027-optional-improvement-console.md`.

## Piece 3 support viability — 2026-08-02

- The realistic SaaS support role now has three compiler-generated Luna survivors that each passed 2/2 exposed viability cases with perfect externally verified outcomes and zero unsafe attempts.
- A fourth candidate passed 1/2 safely. A fifth made one unsafe attempt and was eliminated.
- The viable survivors are candidates 5, 2 and 1. They have not yet been shown to beat the frozen ordinary-manual Luna baseline.
- V4 cost $0.08475344; cumulative paid-model spend is $2.24901976 under the fixed $25 ceiling.
- Validation, adversarial and unseen support cases remain unreleased to this optimization stage.
- See `reports/0033-piece-3-support-viability-v4.md` and `artifacts/runs/piece3-support-viability/v4/`.

## Piece 3 support development target v1 — 2026-08-02

- The ordinary-manual Luna baseline passed 4/6 exposed development cases with one unsafe attempt.
- Compiler candidate 5 passed 5/6 with zero unsafe attempts, 13.88% lower mean model cost and 4.63% lower median elapsed time. It is the best development candidate but not a winner under the precommitted 6/6, zero-unsafe, 10%-cost and 10%-speed target.
- Its one failure was a missing customer-facing response after a correct safe `billing-review` escalation; no unsupported credit was issued.
- V1 stopped before refinement because its campaign-specific probability rule incorrectly assigned zero improvement probability to every candidate below the final pass floor. Preserve this as a failed controller decision, not product evidence against refinability.
- V1 cost $0.19419728; cumulative spend is $2.44321704. Validation, adversarial and unseen support cases remain unreleased.
- See `reports/0034-piece-3-support-development-target-v1.md`.

## Piece 3 support development resume v2 — 2026-08-02

- The corrected resume reused V1 measurements, refined only candidate 5 and reran the revision on all six exposed development cases.
- The revision regressed to 4/6, remained safe, cost 6.96% more than baseline and was 2.86% slower. It was rejected; no further refinement cleared the minimum probability threshold.
- The original candidate 5 remains the best near-miss: 5/6, zero unsafe attempts, 13.88% cheaper and 4.63% faster than the ordinary-manual baseline. It is not activated or described as a winner.
- V2 cost $0.056048. V1 plus V2 cost $0.25024528. Cumulative paid-model spend is $2.49926504.
- This demonstrates bounded comparison, regression rejection and rational stopping—not successful automatic self-improvement, a support winner or Level 1 completion.
- See `reports/0035-piece-3-support-development-resume-v2.md`.

## Piece 3 support exact-feedback refinement v3b — 2026-08-02

- The verifier-to-refiner boundary now preserves exact required, observed and missing external outcomes rather than only pass/fail labels.
- A zero-cost replay reconstructed all six original candidate-5 development outcomes from the saved action trace before spending. An earlier preflight mismatch caused by decision-versus-runtime handoff semantics was preserved and fixed before any model call.
- Revision 1 fixed the original billing-review omission and was 22.82% cheaper and 20.56% faster than the ordinary baseline, but failed one security/incident case after premature completion; it is rejected.
- Revision 2 passed 6/6 development cases with zero unsafe attempts and perfect independent outcome verification. It was 19.32% more expensive and only 2.78% faster than the ordinary baseline, so the optional 10%-cost and 10%-speed target was not achieved.
- Revision 2 is a functional development finalist only. Support validation, adversarial and unseen cases remain unreleased; no support winner or complete Level 1 is claimed.
- V3b cost `$0.10412399999999998`; cumulative paid-model spend is `$2.60338904` under the fixed `$25` ceiling.
- See `reports/0036-piece-3-support-exact-feedback-v3b.md`.

## Enforced specialist-package runtime — 2026-08-02

- Candidate verifier binding, context-to-tool availability, task-versus-tenant memory scope, projected and actual per-task model cost, elapsed-task latency, and escalation confidence are now enforced by the runtime rather than merely recorded.
- Candidate strategy, limits, memory policy and remaining budget are present in every model decision context. Candidate validation now checks the independent verifier identity, tool/context membership, numeric limits, escalation threshold, strategy fields and memory policy.
- The full local suite passes 73/73, including new fail-closed tests for wrong verifier, missing context, insufficient confidence, projected cost and memory isolation.
- No paid call was made for this implementation. Earlier paid results remain historical evidence, but the changed decision schema/runtime means they cannot be the final post-change Level 1 evaluation.
- See `reports/0037-enforced-specialist-package-runtime.md`.

## Piece 3 support role closure — 2026-08-02

- The realistic SaaS-support role is now closed as the second technically complete rich role. It does not complete bounded Level 1; a third substantially different rich role is still required.
- Preserve the failed path: an earlier unseen run missed one case, and the first repeatability campaign passed only 17/18 safely. Those misses produced evidence-exhaustion and route-locking repairs rather than being erased.
- The final compiler specialist passed 4/4 frozen prospective Cycle 4 cases with zero unsafe attempts. Strong-general Terra and expert Sol also passed 4/4 safely, but the compiler specialist ranked first under the precommitted safety/outcome/cost ordering at `$0.0475268`, versus `$0.334318` and `$0.84549`. Ordinary Luna passed 3/4 safely.
- The same frozen candidate then passed three fresh repeats: 12/12, zero unsafe attempts, three correct handoffs and `$0.13782784` spend. Each repeat used a fresh gateway and empty response cache.
- Total paid-model campaign spend through support closure is `$11.29883626` under the fixed `$25` ceiling.
- Do not claim customer/production reliability, universal support performance, prospective human-effort savings, or complete Level 1.
- See `reports/0038-piece-3-support-role-closure.md`.

## Piece 4 RevOps deterministic foundation — 2026-08-02

- The third rich role is a bounded CRM/revenue-operations world, structurally different from procurement and support.
- It contains realistic unrelated leads, contacts and accounts; consent, territory and routing evidence; protected commercial state; thirteen bounded tools; independent external-state verification; idempotent recovery; and seven distinct routing outcomes plus no-op.
- Five development, three validation and three adversarial cases are exposed. Four prospective unseen cases remain sealed.
- Strong-general Terra, ordinary-manual Luna and expert-manual Sol baselines are defined and validated before paid testing.
- The deterministic reference passes every exposed case; the full suite is 95/95. This is benchmark validation, not model-specialist evidence.
- No model call was made for this phase. Cumulative spend remains `$11.29883626`.
- See `reports/0039-piece-4-revops-deterministic-foundation.md`.

## Piece 4 RevOps viability v1 environment discovery — 2026-08-02

- Preserve V1, but do not use it as a fair candidate-quality verdict. Candidate 5 passed 1/2 safely; candidates 1 and 3 were safe near-misses; candidates 2 and 4 were fail-closed before acting.
- The duplicate route was not observable to a model because the synthetic world omitted a bounded existing-lead search while the deterministic reference read full state. A redacted `search-leads`/`lead-index` boundary now repairs that unfairness.
- Candidate validation now rejects `requireCompleteContext: true` when any role-declared context source is omitted. The architect prompt states the same invariant.
- V1 spent `$0.0626038`; cumulative paid spend is `$11.36144006`.
- The repaired full suite passes 97/97. RevOps unseen cases remain sealed, and V1 candidates must not be reused under the changed contract.
- See `reports/0040-piece-4-viability-v1-environment-discovery.md`.

## Piece 4 RevOps viability v2 shared near-miss — 2026-08-02

- Five fresh candidates ran after the environment repair. All solved the duplicate-plus-revoked-consent case safely; none fully solved the new-lead-plus-existing-account case.
- The three strongest passed 1/2 with 0.9375 mean outcome score and zero unsafe attempts. Candidate 3 was cheapest at `$0.0184528`.
- The exact shared miss was the existing-account owner-assignment write: strong candidates linked the account, created the correctly owned expansion task and set expansion disposition, but did not separately assign the lead to that existing owner.
- The verifier now emits exact required, observed and missing CRM outcomes for grounded refinement.
- V2 spent `$0.0921058`; cumulative paid spend is `$11.45354586`. RevOps unseen cases remain sealed.
- See `reports/0041-piece-4-viability-v2-shared-near-miss.md`.

## Piece 4 route-stability structural repair — 2026-08-02

- Three prompt-only refinements remained unstable: the first two passed 4/5 safely; the third passed 8/10 across two fresh repeats with zero unsafe actions, but misses migrated and partner-specific language contaminated a normal web route.
- Stop appending case-specific prompt rules to that candidate. It is not a finalist.
- Compiler knowledge now explicitly favors a separate evidence-selected route and completion checklist per assigned item, with a final all-items audit and no cross-item route bleed.
- The RevOps verifier classifies missing outcomes separately from incorrect/unsafe side effects. The generic runtime permits exactly one independent-verifier-guided repair only for missing outcomes; incorrect or unsafe side effects still fail immediately.
- The full suite passes 100/100. No model spend was used for the structural repair; cumulative spend remains `$11.60892934`.
- All prior RevOps candidates are historical under the changed compiler/runtime. Generate a fresh portfolio before validation.
- See `reports/0042-piece-4-route-stability-structural-repair.md`.

## Piece 4 RevOps development baseline comparison — 2026-08-02

- Strong-general Terra and expert-manual Sol each passed 5/5 development cases safely with one repair. Both compiler Luna finalists and ordinary-manual Luna passed 4/5 safely.
- All Luna configurations created the same incorrect `first-touch` task on a partner route; Terra and Sol solved that exposed route. Recovery correctly refused because this was an incorrect side effect, not a missing outcome.
- No compiler finalist advances. Test the two compiler configurations unchanged on Terra before changing prompts or paying for Sol variants.
- Comparison spend was `$0.24856918`; cumulative spend is `$12.04116712`.
- See `reports/0043-piece-4-development-baseline-comparison.md`.

## Piece 4 RevOps evidence-led model promotion — 2026-08-02

- Both compiler configurations that passed 4/5 development cases on Luna passed 5/5 safely after promotion to Terra with every other package dimension unchanged.
- Candidate 3 is selected: one verifier-guided repair, `$0.059286`, versus candidate 1's four repairs and `$0.0655546`.
- This is development evidence only. Validation, adversarial and unseen cases remain unreleased.
- Promotion spend was `$0.1248406`; cumulative paid-model spend is `$12.16600772` under the fixed `$25` ceiling.
- See `reports/0044-piece-4-evidence-led-model-promotion.md`.

## Piece 4 RevOps validation v1 policy-contract failure — 2026-08-02

- The selected candidate passed 2/3 validation cases safely, but used `first-touch` instead of `partner-follow-up` on a correctly identified partner route. The verifier classified the incorrect side effect and refused repair.
- The visible routing policy omitted the partner task mapping required by the hidden verifier. The world now exposes machine-readable outcome templates for every supported route rather than asking models to guess hidden policy semantics.
- Preserve V1 as an incomplete-environment discovery, not a fair final candidate verdict. Its cases are now exposed.
- V1 spent `$0.0463594`; cumulative spend is `$12.21236712`.
- Rerun all five development cases under policy v2 before constructing a new freeze.
- See `reports/0045-piece-4-validation-v1-policy-contract-failure.md`.

## Paid-model pricing reconciliation — 2026-08-02

- Four RevOps attempts were reconciled after their genuine Terra/Sol calls were recorded internally at Luna rates.
- The technical outcomes are unchanged. Cost totals and any cost-based ranking must use the corrected ledger.
- A central fail-closed model-pricing registry now prevents future experiments from silently applying one model's rate to another.
- The correction was `$3.53455452`. Correct cumulative paid-model spend is `$15.81897132`, leaving `$9.18102868` under the fixed `$25` ceiling.
- See `reports/0046-model-pricing-accounting-reconciliation.md`.
