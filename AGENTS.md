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

## Piece 4 RevOps Cycle 2 freeze — 2026-08-02

- The repaired machine-readable routing policy passed the full 5/5 development regression safely.
- A fresh precommitted Cycle 2 contains three validation cases, three adversarial precedence cases and four sealed prospective unseen cases.
- The same compiler-selected Terra specialist is frozen unchanged. Baselines and runtime contracts are hashed before evaluation.
- Every exposed Cycle 2 case passes the deterministic reference. No Cycle 2 model call has yet been made.
- See `reports/0047-piece-4-cycle2-freeze.md`.

## Independent completion at hard runtime limits — 2026-08-02

- Cycle 2 validation v1 passed 2/3. In the failed five-route case, every external item outcome was correct and safe, but the candidate's `$0.55` task budget blocked its final `complete` model call.
- The runtime now invokes the bound independent external verifier at cost, latency or turn limits. It completes only if the entire real outcome already passes; otherwise the original limit block remains.
- This preserves the customer's budget and does not let the candidate grade itself.
- The runtime change requires a fresh prospective evaluation and later cross-role confirmation. Do not retroactively rewrite the preserved 2/3 result.
- See `reports/0048-independent-limit-completion.md`.

## Piece 4 limit regression and Cycle 3 freeze — 2026-08-02

- The preserved five-route case now passes with every outcome correct, zero unsafe attempts and independent completion at `$0.536557`, below the specialist's `$0.55` model limit.
- Cycle 3 freezes three never-run precedence cases as validation, three new compound adversarial cases and the four still-sealed Cycle 2 prospective cases.
- Candidate, baselines, role, runtime and cases are hashed. Every exposed Cycle 3 case passes the deterministic reference.
- Correct cumulative paid spend is `$17.04477832` before Cycle 3.
- See `reports/0049-piece-4-limit-regression-and-cycle3-freeze.md`.

## Piece 4 RevOps Cycle 3 pre-unseen gates — 2026-08-02

- The unchanged compiler-selected Terra specialist passed validation 3/3 and adversarial 3/3 with perfect external outcomes, zero unsafe attempts and zero repair rounds.
- Freeze hash: `9887a5fd4232a854e0659b28db11a21d26c89a1a2c4cd39fbad9c049c367c2f6`.
- Correct cumulative paid spend is `$17.55329432`. Four prospective cases remain sealed until the committed candidate-plus-baselines release.
- See `reports/0050-piece-4-cycle3-pre-unseen-gates.md`.

## Piece 4 RevOps unseen comparison — 2026-08-02

- The compiler-selected Terra specialist passed 4/4 prospective unseen cases safely, including the six-route batch and lost-response recovery.
- Ordinary-manual Luna also passed 4/4 safely and was much cheaper: `$0.0529328` versus compiler Terra `$0.906052`. The product correctly selects retain-existing rather than an unproved upgrade.
- Strong-general Terra passed 4/4; expert-manual Sol passed 3/4 because the shared `$0.55` task ceiling stopped its expensive six-route run incomplete.
- Do not claim a RevOps optimization win. Fresh-repeat stability is still required for both selected baseline and compiler specialist.
- Correct cumulative paid spend is `$20.20587712`.
- See `reports/0051-piece-4-revops-unseen-comparison.md`.

## Piece 4 RevOps repeatability — 2026-08-02

- Selected ordinary Luna passed 12/12 fresh repeats safely at `$0.17375196`.
- Compiler Terra passed 11/12 safely at `$2.698924`; one six-route repeat stopped before the final revoked-consent item at its task budget.
- RevOps closes as a retain-existing result, not an optimization win. The product rejected the less stable, more expensive compiler package.
- Correct cumulative paid spend is `$23.07855308`, leaving `$1.92144692` under the fixed `$25` ceiling.
- See `reports/0052-piece-4-revops-repeatability.md`.

## Bounded Level 1 technical closeout — 2026-08-02

- The bounded three-role technical mechanism is complete across realistic fictional procurement, SaaS-support and CRM/RevOps worlds.
- Final product decisions are mixed by design: retain the ordinary Luna specialist for procurement; activate the compiler-created Luna specialist for support; retain the ordinary Luna specialist for RevOps.
- The compiler specialist won the support prospective comparison and passed 12/12 fresh repeats. The system rejected unproved upgrades in the other two roles rather than forcing a compiler win.
- The selected specialist for each role passed a representative high-risk case on the current shared runtime: 3/3, zero unsafe/denied attempts, `$0.028445` incremental spend.
- A durable integrity-checked registry now preserves the exact versioned winner and three serious alternatives per role, reloads after process exit, detects mutation, and remains subject to fail-closed environment and transition checks before activation or switching.
- Full local suite: 112/112 passed. Exact cumulative paid-model spend: `$23.10699808` under the fixed `$25` ceiling.
- This completes the bounded technical mechanism, not the external evidence case. Do not claim prospective human setup savings, customer value, production reliability, universal role coverage, or general superiority over LangChain, CrewAI, Microsoft, or other workflows.
- The human-effort ledger is implemented and tested, but zero real prospective human-engineer sessions have been conducted.
- See `reports/0053-cross-role-current-runtime-confirmation.md`, `reports/0054-bounded-level1-technical-closeout.md`, `artifacts/level1/registry-v1.json`, and `artifacts/level1/technical-closeout-v1.json`.

## Level 1.5 lifecycle foundation — 2026-08-02

- Full bounded Level 1.5 is not yet claimed.
- Real runtime verdicts can now become sealed version-specific monitor observations, but only when the specialist is bound to the supplied independent verifier and an independent terminal verdict exists.
- Monitoring distinguishes ordinary drift from safety: drift may create a bounded optimization request; any unsafe active observation halts the role immediately.
- Optional optimization remains disabled by default. Even when enabled, a request cannot spend without explicit confirmation and a verified role-specific runner. Development winners never auto-promote.
- Challenger lifecycle is disposable offline → zero-authority shadow → explicitly authorized bounded canary → promote or quarantine. Shadow evidence with any committed business write is rejected; canary evidence cannot exceed its authorized traffic fraction.
- A promoted specialist can roll back to the prior proven registry record after independently monitored regression.
- Monitoring, requests, halts, canary stage, registry records and events persist with integrity checks across restart.
- A deterministic three-role rehearsal passed all six checks at `$0`: healthy procurement continued; support drift created a `$1`-capped unstarted request and exercised promotion plus rollback; unsafe RevOps halted.
- The private console has a read-only lifecycle page grounded in saved Level 1/1.5 artifacts. Its served data and syntax were verified; final in-app visual QA did not complete because the preview tab did not attach cleanly.
- Remaining finish-line work: a fresh model-backed joined lifecycle from drift-triggered bounded search through prospective offline/shadow/canary evaluation, plus a verified live role-specific runner/dispatcher. Customer and production evidence remain separate gaps.
- See `docs/LEVEL_1_5_CONTRACT.md`, `reports/0055-level1-5-lifecycle-foundation.md`, and `artifacts/level15/rehearsal-v1/`.

## Commercial Level 1 onboarding foundation — 2026-08-04

- A normal company can now enter a guided private-console journey from ordinary role language through systems, hard policies and authority, representative cases, independent success checks, operating priorities and an existing-agent decision.
- The same intake and compiler-draft boundary works across support operations, procurement coverage and CRM/revenue operations. Support remains the first polished commercial path.
- Readiness is deliberately split into design preview, ready for comparison and controlled activation. “Ready for comparison” means the contract can support a fair run; it never implies a comparison has run or an improvement has been proved.
- Controlled activation remains blocked until every required system has a bounded approved environment and executable adapter, and an executable independent external-state verifier is connected.
- Credentials are rejected from onboarding records. Saved sessions are versioned, integrity checked and reload after restart. Saving does not call a model, spend money, run a comparison or activate a specialist.
- The customer-facing console flow was exercised end to end in the local browser, including restart persistence and honest readiness rendering. The complete local suite passed 141/141 before checkpointing; focused commercial tests passed again after the final motion layer. No paid model call was made.
- This checkpoint makes the role-intake product usable, but does not yet join an arbitrary saved customer role to an executable comparison campaign. That join is the next commercial Level 1 dependency.
- See `docs/COMMERCIAL_LEVEL1_CONTRACT.md` and `reports/0056-commercial-level1-onboarding-foundation.md`.

## Commercial comparison contract and runner — 2026-08-04

- A comparison-ready intake can now be frozen with its exact role draft, verified system-driver bindings, independent verifier, participants, stage cases, priorities, improvement threshold, candidate ceiling, spend ceiling and wall-clock limit.
- A supplied current agent must be included. Strong-general, ordinary-manual and expert-manual baselines are mandatory; the compiler cannot win by comparing only with weak or missing alternatives.
- Development, validation, adversarial and unseen cases are separated before execution. Unseen payloads stay in a sealed vault and release only after a compiler candidate passes bound validation and adversarial gates with zero unsafe attempts and zero incorrect side effects.
- The generic asynchronous runner verifies every observation came from the frozen independent verifier, stops before a projected call exceeds budget, eliminates unsafe candidates before unseen evaluation, runs fresh repeatability and retains the existing agent when the promised improvement is not proved.
- This is a zero-cost orchestration foundation. It is not yet a model-backed customer comparison, an executable customer adapter, customer evidence or commercial proof.
- Complete local suite: 150/150 passed. No paid model call was made.
- See `reports/0057-commercial-comparison-contract-and-runner.md`.

## Commercial procurement executable pack — 2026-08-05

- The commercial runner now has a complete disposable procurement pack: normalized onboarding, a namespaced verified driver, an independent external-state verifier, an imported current agent, strong-general/ordinary-manual/expert-manual baselines, four compiler candidates and 5 development + 2 validation + 3 adversarial + 2 sealed unseen cases.
- The deterministic reference passed 12/12. Do-nothing passed only 3/12, order-every-demand 4/12 and cheapest-offer 6/12, showing that the world rejects plausible shortcuts rather than telegraphing one trivial answer.
- The commercial improvement contract now supports separately frozen outcome, cost and speed targets. Every declared target must pass; an equal-quality replacement can win through proved cost/speed reduction, while an unproved replacement retains the imported current agent.
- The complete local suite passes 155/155. Preflight used zero model calls, zero spend and did not release the unseen vault.
- This is executable disposable-world readiness, not a model-backed commercial result, arbitrary agent import, customer evidence or production readiness. A fresh model campaign still requires separate explicit spend approval.
- See `reports/0058-commercial-procurement-executable-pack.md` and `artifacts/commercial/procurement-v1/`.

## Commercial specialist lifecycle — 2026-08-05

- The generic product path now supports credential-rejecting current-agent import, exact role compatibility validation, integrity-checked comparison results, a neutral complete specialist bundle, controlled activation bound to the frozen driver/adapter/verifier environment, rollback authorization and JSON export.
- Executive, engineering and forensic evidence views explain the default recommendation and why alternatives lost. Humans receive full optional transparency without becoming required selectors.
- A selection cannot become a bundle unless it has at least three safe perfect repeat runs. Mutated results, candidates or bundles fail closed; credentials are rejected recursively.
- Focused lifecycle tests pass 4/4. No paid calls were made.
- The lifecycle mechanics are complete, but the tests use a deterministic comparison receipt. A fresh model-backed commercial procurement run remains required for a new empirical result.
- See `reports/0059-commercial-specialist-lifecycle.md`.

## Commercial comparison console — 2026-08-05

- The private console now has a customer-facing Comparison workspace backed by the executable commercial procurement pack rather than placeholder UI.
- It exposes the frozen role, stage counts, 12/12 deterministic preflight, eight serious comparison participants, rejected shortcut controls, frozen cost/speed targets and exact paid-execution boundary.
- Automatic recommendation remains the default; candidate expansion and frozen receipts provide optional technical transparency rather than requiring human selection.
- Commercial state now has a separately tested builder that keeps `preflight-ready`, `comparison-complete`, `recommended` and `controlled-active` distinct. A preflight cannot masquerade as a model result.
- The full local suite passes 162/162. Desktop browser inspection covered the complete comparison journey. No paid calls were made.
- This is a private local fictional-evidence surface, not customer improvement proof or production readiness. A fresh commercial model campaign still requires explicit spend approval.
- See `reports/0060-commercial-comparison-console.md`.

## Commercial specialist host interoperability — 2026-08-05

- A controlled-active specialist can now be invoked through a direct JavaScript boundary, a LangGraph-compatible async state node, or a transport-neutral MCP `tools/list` / `tools/call` adapter.
- The host submits only a stable request id and ordinary goal. The exact activated DAS bundle retains authority, memory, limits, customer-local tools and independent external verification.
- Same-process duplicate request ids return the original result; a conflicting goal under the same id fails closed. Host receipts are sanitized and exclude raw observations, credentials and customer records.
- CrewAI is described only as `requires-customer-wiring` through its documented MCP support. No native CrewAI package, remote MCP transport or external framework runtime was installed or claimed.
- Full local suite passes 166/166. No paid calls were made.
- Post-restart idempotency and an authenticated customer-local network sidecar remain separate next steps.
- See `reports/0061-commercial-specialist-interop.md`.

## Durable customer-local commercial sidecar — 2026-08-05

- Controlled-active specialists now have an authenticated loopback HTTP sidecar and an owner-only, integrity-checked durable request ledger.
- Identical completed requests return their original receipt; conflicting request-id reuse fails closed. Runtime failures remain blocked instead of being silently retried.
- Interrupted pending work becomes `outcome-unknown` after restart. Only the activated independent verifier can classify it as completed, not started, incorrect or still unknown; an exact retry is unlocked only by a verified `not-started` result.
- The sidecar accepts a stable request id plus ordinary goal, caps JSON at 32 KiB and exposes only sanitized status. Credentials, raw tool observations and customer records are not persisted in its run receipts.
- Full local suite passes 172/172. A real authenticated loopback HTTP smoke test also passed on a random port. No paid calls were made.
- This is a local library/transport, not yet a packaged daemon, signed installer, customer deployment, production reliability claim or external security review.
- See `docs/COMMERCIAL_LOCAL_SIDECAR.md` and `reports/0062-durable-commercial-sidecar.md`.

## Packaged procurement network activation rehearsal — 2026-08-05

- A customer-local package builder now writes a new owner-only directory containing the exact specialist bundle, activation, loopback config, generated token, state directory and redacted package receipt; it refuses to overwrite existing state.
- Readiness diagnostics check 17 gates across integrity, exact receipt/file binding, file modes, token length/redaction, state access, loopback configuration and Node compatibility. Loading fails closed unless every gate passes.
- A zero-cost disposable procurement rehearsal traversed package reload → authenticated loopback HTTP → activated specialist runtime → one intended draft purchase → independent external-state verification → durable status → identical duplicate suppression.
- Exact result: package 17/17, HTTP 200/200/200, completed, verification passed, one intended write, zero incorrect effects, duplicate suppressed, zero model calls and zero spend.
- Full local suite passes 174/174.
- The rehearsal used a deterministic scripted decision path. It is not a fresh model comparison, customer improvement proof, signed daemon, customer deployment or production reliability claim.
- See `reports/0063-packaged-network-activation-rehearsal.md` and `artifacts/commercial/procurement-v1/network-activation-rehearsal.json`.

## Resumable commercial model campaign preparation — 2026-08-05

- The fresh commercial procurement comparison now has a zero-cost frozen plan across eight participants, at most 102 task evaluations and 2,448 model turns if every participant survives every gate.
- Paid execution remains disabled unless global and campaign-specific approval phrases, an explicit limit no greater than the frozen `$10` ceiling, a current-UTC-date pricing confirmation, the exact pricing-table hash and an API key are all present.
- Per-call reservations, exact spend, response cache and hash-chained evidence now persist across restart. An interrupted provider call remains `outcome-unknown` and reserves its maximum projected cost until explicitly reconciled.
- Mixed-model pricing is resolved per model. Operational evaluation cost and incremental campaign spend are now separate, so cached resumes neither erase real operating cost nor double-charge campaign spend. Model-reported latency remains distinct from replay wall time.
- The full local suite passes 183/183. The paid campaign was not run, so there is no fresh model-backed commercial result or improvement claim.
- See `reports/0064-resumable-commercial-model-campaign.md` and `artifacts/commercial/procurement-v1/model-campaign-plan.json`.

## Commercial runtime monitoring — 2026-08-05

- The customer-local commercial path now converts each completed sanitized run into persistent, version-specific independent outcome evidence bound to the exact specialist bundle, activation and verifier.
- One verified unsafe attempt or incorrect side effect halts new work immediately. Ordinary outcome, cost or latency drift waits for the configured evidence minimum and may create only a no-spend `awaiting-explicit-approval` re-comparison request.
- Duplicate run receipts do not inflate monitoring. Owner-only state survives restart, detects mutation and can backfill completed ledger receipts without rerunning their business actions.
- The sidecar exposes authenticated `GET /v1/operations` status without exposing credentials or raw customer records. Its local package now reserves a separate operations-state path.
- The updated disposable network rehearsal joined package → loopback submit → action → independent verification → durable run → monitoring → duplicate suppression with one intended write, zero incorrect effects, one observation, zero model calls and zero spend.
- The full local suite passes 187/187. This is fictional deterministic local evidence, not a model-backed improvement result, customer deployment, real drift proof or complete Level 1.5 replacement cycle.
- See `reports/0065-commercial-runtime-monitoring.md`.

## One-command customer-local daemon assembly — 2026-08-05

- A prepared specialist package and customer-owned bindings module can now be assembled through one launcher into the runtime, exact tenant/tool/verifier bindings, durable request ledger, monitoring state, unknown-outcome reconciler and authenticated loopback sidecar.
- Startup validates every required binding and the exact activated verifier before listening, backfills completed run receipts into monitoring after restart, and never prints the customer-local token.
- The real loopback procurement rehearsal now uses this same daemon assembly rather than bespoke host wiring and still passes with one intended write, zero incorrect effects, one observation, duplicate suppression, zero model calls and zero spend.
- This is not an installer or a generic adapter generator. A customer-specific executable adapter and independent verifier remain activation inputs.
- See `reports/0066-one-command-customer-local-daemon.md` and `docs/COMMERCIAL_LOCAL_SIDECAR.md`.

## Commercial support executable pack — 2026-08-05

- Support operations now has a complete commercial disposable comparison pack rather than only an onboarding template: verified namespaced driver, independent external-state verifier, imported current agent, three serious manual baselines, four compiler candidates and a 5 development / 2 validation / 3 adversarial / 2 sealed-unseen case split.
- The deterministic reference passed 12/12. Do-nothing, close-everything and escalate-everything controls each passed 0/12. The unseen vault remained sealed; model calls and spend were zero.
- The complete local suite passes 192/192. This is the second materially different role family on the executable commercial machinery.
- No support model comparison or customer improvement is claimed. A fresh support campaign still needs a safe plan and explicit new spend approval. CRM/RevOps remains the commercial pack gap.
- See `reports/0067-commercial-support-executable-pack.md` and `artifacts/commercial/support-v1/`.
