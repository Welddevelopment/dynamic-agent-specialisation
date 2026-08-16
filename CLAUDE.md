# Dynamic Agent Specialisation

Part of a three-startup group. The hub is `~/CF_DAS_FLEETBRAIN` — read
`CLAUDE.md` and `workstreams/das/STATE.md` there before starting work.

This repo is workstream **`das`**, class **authority**. It owns DAS technical
state, evidence, maturity — and the Fleet Brain implementation.

## Talk to Joel in plain English. No jargon.

Never say "small context loss is fine" or "this should work per the docs".
Verify, or flag it cleanly.

## Start here

**`docs/ARCHITECTURE_MAP.md`** — how this system actually works: the compile
pipeline, the runtime loop, the money/evidence substrate, the invariants, and
where to touch for a given change. Written from a full read of the core modules.
Read it before touching code; it saves re-deriving the system every session.

Structure only — no results or spend. Those live in `reports/` and
`docs/LIVING_TECHNICAL_BACKLOG.md`.

## What lives here

DAS builds and evaluates specialist agents. **Agent Fleet Brain is built here
too**, as Bounded Level 2 (`artifacts/fleet/`, 2026-08-05). Fleet Brain has no
repo of its own by design — that is correct, not an oversight.

## Standing facts

- Everything currently ends with **zero executable operations**. Deliberate.
- **DAS-028 completed** at checkpoint 0108 (2026-08-14). Reports run to 0111.
- **DAS work items live in the Capability Factory repo**, not here:
  `~/Desktop/Capability Factory/coordination/engineering-queue/index.json`.
  Grepping this repo for a DAS-0NN item finds nothing and proves nothing — that
  mistake was made once and wrongly concluded an item was invented.
  This repo numbers by **checkpoint** (0001–0111) and **lane** (A1, A2, A6, B1,
  B2, B3, B4). Both systems are real.
- **DAS-013 is real, open (`ready`), and has never run.** "Adversarially test
  autonomous specialist design against strong adaptive single-agent and
  expert-designed baselines on unseen role families." The review calls it *"still
  a decisive open test."* **Until it runs, the core thesis is unconfirmed.**
- **DAS-004 / Lane B2** is a narrower, completed comparison — not DAS-013. It ran
  2026-08-13 (report 0111): same task outcome 1/2 each, DAS 19% more expensive and
  23% slower, *"a safety win, not an efficiency win."* One fictional role, single
  paired sample. Cross-role replication open.
- **Lifetime paid-model spend: $25.711985** (report 0089). The $25 figure is a scoped Level 1 ceiling, not a lifetime cap - see below.
  Do not confuse it with the DAS-004/B2 campaign figure of $0.36181282.
- The real evidence is `docs/LIVING_TECHNICAL_BACKLOG.md` and `reports/`. Two
  objections have survived all fourteen self-audits: **unclear recurring value**
  and **weak differentiation**. Gate **A6** (fresh non-author user study) has
  never run, so every setup-burden claim currently rests on nothing.

## Spending rules

Max **$1 per gate**, **$3 cumulative** before a new checkpoint. One paid campaign
at a time. Never auto-retry an ambiguous outcome. The remaining six discovery
benchmark cases are **not authorized** — they need a new seal.

Any spend needs explicit approval.

The **$25 figure is a scoped ceiling**, not a lifetime cap: `docs/PAID_MODEL_GATE.md`
defines it as step 4 of the Level 1 spend ladder ("frozen comparison"). Level 1
spend was $23.107, under it. Lifetime $25.71 exceeds $25 only because it adds
prospective V1/V2 and the support comparison, which ran under separate campaign
ceilings. **This is not a breach.**

## Never do

- Merge DAS evidence with Capability Factory evidence. They stay separate, and
  cross-repository integration is not authorized.
- Hide services or proof work behind the word "automation". Joel's own teardown
  found 36 of 171 fields were independent proof — that stays visible.
- Tidy away failures or costs. They are preserved on purpose.
- Implement anything without an approval in `coordination/approvals/`.

## Codex note

`AGENTS.md` here is the old Codex protocol. Kept for reference; the hub is
authoritative.
