# DAS architecture map

Written 2026-08-16 from a full read of `src/core`, `src/compiler`, `src/runtime`,
`src/evaluation`. **Structure only — no results, no spend, no status.** Those rot
weekly and live in `reports/` and `docs/LIVING_TECHNICAL_BACKLOG.md`.

Purpose: let a fresh session start work without re-deriving the system.

## The one-paragraph version

DAS takes a **job brief** for a business role, generates a handful of complete
**specialist candidates** (model + instructions + context + tools + memory +
authority + escalation + verifier + limits + strategy), validates them against
hard structural rules, refines the ones that failed safely, **freezes** the whole
evaluation, releases unseen cases only against that freeze hash, runs a staged
tournament, and recommends a winner — or recommends keeping the existing agent.
Every model call is reserved against a budget before it happens and settled after,
and every step appends to a hash-chained evidence ledger.

## Layout

| Directory | Lines | What it is |
|---|---|---|
| `src/core` | 420 | Money, hashing, evidence, locking. **The substrate everything depends on.** |
| `src/compiler` | 589 | Job brief → candidates → validation → refinement → recommendation |
| `src/evaluation` | 1554 | Freeze, tournament, baselines, runner, adaptive-baseline comparison |
| `src/runtime` | 206 | The agent loop that actually executes a specialist |
| `src/roles` | 484 | Role definitions (procurement, support, revops, access-offboarding…) |
| `src/worlds` | 2242 | Fictional company environments the roles act in |
| `src/lifecycle` | 726 | Drift, switching, rollback |
| `src/fleet` | 1592 | Fleet Brain — Bounded Level 2 |
| `src/product` | 12541 | Onboarding, bindings, adapters, work packs — the productization arc |
| `src/experiments` | 19429 | 187 campaign runners. One file per campaign. |
| `src/console` | 2026 | Operator UI |

Entry points: `src/cli.js`, `src/run.js`. Campaign runners are wired as npm
scripts — `pnpm run` shows ~40 of them.

## The core substrate — read this first, everything leans on it

**`core/canonical.js`** — deterministic JSON serialisation + sha256. Every hash in
the system goes through `digest()`. Key ordering is sorted, so hashes are stable.

**`core/budget.js` / `core/durable-model-campaign.js`** — money.
The pattern is **reserve → call → settle**, never call-then-count.

- `reserve()` throws if `spent + reserved + projected > hardLimit`.
- `settle()` re-checks against the actual cost.
- On restart, `DurableBudgetGuard` turns any still-`reserved` call into
  **`outcome-unknown`** with `interruption: process-ended-before-settlement`.
  **Money is assumed possibly spent until verified otherwise.**
- `reject()` marks `verified-not-charged-provider-rejection`.
- `resolveUnknown()` closes an unknown either as a verified charge or verified
  not-charged.
- File state carries an `integrityHash`; a mismatch throws on load.

**`core/campaign-writer-lock.js`** — single-writer lock for paid campaigns.
PID liveness checking, integrity-hashed metadata, and a deliberate design choice
worth knowing: on SIGINT/SIGTERM the handler **does not delete the lock**. The
comment explains why — a signal can arrive mid-provider-call, and removing the
lock would let another writer repeat an unknown-cost call. Recovery from a stale
lock requires an approver, a reason ≥12 chars, the literal confirmation string
`RECOVER_STALE_CAMPAIGN_WRITER_LOCK`, and the exact prior lock hash.

**`core/evidence.js`** — `EvidenceLedger`, hash-chained append-only JSONL.
Each record hashes `{sequence, type, payload, previousHash}`. `verify()` walks the
chain from `GENESIS`. Loading a tampered file throws.

**`core/model-gateway.js`** — `MeteredModelGateway` wraps a provider with
cache → reserve → call → settle → evidence, redacting secrets from logged
requests. `PaidCallsDisabledProvider` is the default and throws
*"Paid model calls are disabled pending Joel's approval."*

**`core/paid-campaign.js`** — `PAID_CAMPAIGN_HARD_LIMIT_USD = 25`, enforced in
`settlePaidCampaign`. This is the Level-1 frozen-comparison ceiling, **not** a
lifetime cap.

## The compile pipeline — `compiler/compiler.js`, `compileSpecialist()`

Read this function first; it is the spine, and it is only ~40 lines.

1. **`compileJobBrief`** — requires 7 groups (`outcome`, `environment`,
   `policies`, `authority`, `examples`, `successCriteria`, `priorities`) plus id
   and role. Any **consequential assumption not marked confirmed blocks the
   compile**. Readiness is `ready` or `blocked`; blocked throws.
2. **`registry.search`** by role and environment tags — prior proven specialists.
3. **`generateCandidatePortfolio`** — see below.
4. **`validateCandidate`** on each — see below.
5. Run survivors on `role.cases.development`.
6. **`proposeControlledRefinements`** — only for candidates with **zero safety
   violations**. Each change is dimension-scoped with a recorded reason:
   missing context → add those sources; unnecessary escalations → raise risk
   tolerance and lower threshold; failed external action → raise quality weight,
   lower cost weight. No change, no refinement.
7. **Two hard gates**: at least **3 valid candidates**, and at least one pair
   differing on **≥4 of 9 dimensions** — otherwise
   *"Candidate portfolio lacks meaningful architectural diversity."*
8. **`createBaselines`** then **`freezeEvaluation`**.
9. **`role.unseen.release({ freezeHash, ... })`** — unseen cases are gated on the
   freeze hash. They cannot be seen before freezing.
10. **`runStagedTournament`** on unseen; baselines run the same unseen cases.
11. **`assertFreezeIntact`** — recomputes the hash and throws if anything moved.
12. Winner retained as `recommended`; the rest of the Pareto frontier retained as
    `available-alternative`.

## Candidate generation — `compiler/generator.js`

**Four fixed archetypes**, not open-ended search:

| Archetype | Shape |
|---|---|
| `balanced` | structured, all context, quality 0.65 |
| `quality` | deliberative + counterexample check, high-reasoning tier, quality 0.82 |
| `economy` | concise, ~70% of context, efficient tier, cost weight 0.35 |
| `conservative` | verification-first, escalation threshold 0.12, risk tolerance 0.05 |

Plus up to **2 adapted** from prior proven specialists in the registry.

So the default portfolio is **4–6 candidates**. Anything describing DAS as
"generating hundreds of agents" is describing a campaign that varied this, not the
default path. Worth knowing before answering that question.

## Validation — `compiler/candidate.js`

~20 hard rejections. The ones that carry the safety argument:

- `self-grading-verifier` — a candidate whose verifier is `self-report` is rejected
- `non-independent-verifier` — must be `independent-external-state`
- `verifier-binding-mismatch` — must bind to the brief's exact `verifierId`
- `excess-authority:<action>` — cannot request authority the brief does not grant
- `credential-in-context` — no `secret:` sources
- `unknown-tool` / `unknown-context-source` — cannot invent either
- cost and latency limits cannot exceed the brief's

A valid candidate is sealed with `fingerprint: digest(candidate)`.

## Freeze — `evaluation/freeze.js`

The freeze record hashes: role id, development/validation/unseen case digests,
every candidate config, every baseline config, **and `digest(role.verify.toString())`**
— the verifier function's source text.

That last one is the important part: **you cannot edit the verifier after freezing
and still pass `assertFreezeIntact`.**

## Tournament — `evaluation/tournament.js`

Stages: `smoke` (first 2 development cases, keep ≤6) → `development` (keep ≤3) →
`validation` (keep ≤2) → finalists run the unseen cases.

At every stage, **safety violations are a hard filter** — `safe = results.filter(r
=> r.safetyViolations === 0)` — before any ranking happens.

Selection is `paretoFrontier` ∪ `rankForPriorities`, where ranking is
**safety-first**, then a weighted utility of
`successRate·quality − cost·costWeight − latency·speedWeight − incorrectEscalations·escalationPenalty`.

`recommendation` is `rankedFinalists[0] ?? null`. **Null is a legitimate outcome** —
that is the "no eligible winner" result, and `compileSpecialist` throws
*"No safe finalist survived."*

## Baselines — `evaluation/baselines.js` — READ THIS BEFORE DEFENDING A COMPARISON

`createBaselines(brief)` builds three configs **from the same brief, in the same
code, in the same shape as candidates**:

- `baseline-general` — generic instructions, only first 2 context sources
- `baseline-ordinary` — role-specific, full context
- `baseline-expert` — expert-structured, high-reasoning, quality 0.85

Each carries `effortProtocol: { setupBudgetMinutes: 10 | 180 | 960,
observedSessionRequired: true }`.

**Those minutes are declared metadata, not measured human work.** Nothing in this
file observes a human. This is exactly why the backlog says setup-time savings are
unproven and why gate A6 exists. If someone asks "how do you know a human takes
180 minutes?", the honest answer is: we don't, it is a protocol assumption.

Structurally, "beating the ordinary baseline" means beating a config this same
code wrote. That is a fair *controlled* comparison and an unfair *human* one — and
the repo is consistent about saying so.

## Runtime — `runtime/agent-runtime.js`, `SpecialistAgentRuntime.run()`

The execution loop. Blocks before starting if the supplied verifier does not match
the candidate's binding, or if `requireCompleteContext` and any tool lacks its
required context sources.

Per turn:

- latency checked **before** the call, cost and latency **after**
- `confidence < candidate.escalation.threshold` → blocked
- `escalate` → external verification of the handoff; passes → status `handoff`
- `complete` → external verification. If it fails with
  `recoveryClass: "missing-outcome"` and repair rounds remain (default **1**), the
  verifier's own feedback is appended as an observation and the loop continues.
  Otherwise `verification-failed`.
- `tool` → authority check (`requiredAction` ∈ `allowedActions`), then
  **non-progress guards**: `maxConsecutiveReads` (20) and
  `maxRepeatedIdenticalRead` (3). Any write resets both counters.
- Tool throw → `toolHost.reconcile()`. Only `classification === "completed"` may
  continue, and it sets `session.reconciled = true`. **This is the lost-response
  path** — it exists so a crashed write is never silently retried.

Hitting a turn/cost/latency limit does **not** automatically fail. It runs an
independent verification with `completionSource: "independent-limit-state-check"` —
external state decides whether the goal was actually met.

`ModelDecisionEngine` forces a strict JSON schema: exactly one of
`tool | complete | escalate`, with calibrated confidence, and a tool-name enum
restricted to permitted tools. It projects cost and throws
`candidate-task-cost-limit-before-call` **before** spending.

## The terminal-resolution asymmetry — undocumented, and it cost a campaign

Found by a cold session planning real work. **`complete` and `escalate` are not
symmetric, and nothing outside the source says so.**

- `complete` → external verification. If it fails with `recoveryClass:
  "missing-outcome"` and repair rounds remain, the verifier's feedback is fed back
  and **the loop continues**.
- `escalate` → hard-codes `resolution: { kind: "handoff" }` and is **terminal**.
  No repair branch exists on that path at all.

Worlds also disagree on what they will accept. `access-offboarding-world.js`
grades `correctResolution` as `resolution.kind === "complete"` **unconditionally**,
including for the case with a blocked item — item-level handoffs are supposed to be
recorded as tool calls, then the parent resolved as `complete`. Other worlds accept
dual resolutions.

Nothing tells the model that escalating ends the run, and nothing distinguishes an
**item-scoped** blocker from a **goal-scoped** one.

This is not theoretical. In the DAS-004/B2 campaign the winner passed 11 of 12
atomic checks on the failing case — zero unsafe attempts, zero incorrect side
effects, every item handled — and lost solely on returning the wrong terminal
decision kind. One decision away from 2/2.

**Anyone touching the runtime or writing a new world must know this.** It is also
the same failure shape as the Day 7 goal-resumption failure in Capability Factory.

## Where to make a change

| Change | Touch |
|---|---|
| New role | `src/roles/<role>.js` + a world in `src/worlds/` |
| New candidate archetype | `compiler/generator.js` variants array |
| New validation rule | `compiler/candidate.js` |
| Change selection maths | `evaluation/tournament.js` (`rankForPriorities` / `dominates`) |
| New baseline type | `evaluation/baselines.js` |
| Runtime guard or limit | `runtime/agent-runtime.js` |
| Anything touching money | `core/durable-model-campaign.js` — and expect the paid gate |
| New campaign | `src/experiments/<name>.js` + a `package.json` script |

## Invariants — do not break these

1. Verifier is independent and bound; a candidate can never grade itself.
2. Freeze covers the verifier source. Nothing changes after freeze.
3. Unseen cases release only against the freeze hash.
4. Safety violations filter before ranking, at every stage.
5. Reserve before spend; unknown outcomes stay unknown until verified.
6. Evidence is append-only and hash-chained.
7. A null recommendation is a valid result — never manufacture a winner.
8. Paid calls are disabled by default and need Joel's approval.

## Two things an investor will find in 20 minutes

Both are visible from the code alone, and the repo is already honest about both.
Have the answer ready rather than being surprised:

1. **The baselines are self-authored.** `createBaselines` writes them from the same
   brief. The 10/180/960-minute setup budgets are declared, never observed.
2. **The default portfolio is 4 archetypes + 2 adaptations**, hardcoded. Candidate
   *diversity* is enforced structurally (≥4 differing dimensions) but the
   *variety* is bounded by that list.

## Freshness

Written against 134 commits, 357 source files, ~42,280 lines. If the module table
above is materially wrong, this map needs a re-read. Structure changes slowly;
results change weekly — never add results here.
