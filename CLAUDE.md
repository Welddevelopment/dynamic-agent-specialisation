# Dynamic Agent Specialisation

Part of a three-startup group. The hub is `~/CF_DAS_FLEETBRAIN` — read
`CLAUDE.md` and `workstreams/das/STATE.md` there before starting work.

This repo is workstream **`das`**, class **authority**. It owns DAS technical
state, evidence, maturity — and the Fleet Brain implementation.

## Talk to Joel in plain English. No jargon.

Never say "small context loss is fine" or "this should work per the docs".
Verify, or flag it cleanly.

## What lives here

DAS builds and evaluates specialist agents. **Agent Fleet Brain is built here
too**, as Bounded Level 2 (`artifacts/fleet/`, 2026-08-05). Fleet Brain has no
repo of its own by design — that is correct, not an oversight.

## Standing facts

- Everything currently ends with **zero executable operations**. Deliberate.
- **DAS-028 completed** at checkpoint 0108 (2026-08-14). Reports run to 0111.
- **DAS-004 / Lane B2** was the decisive comparison against an adaptive agent, and
  it RAN on 2026-08-13 (report 0111). Same task outcome, 1/2 each. DAS was 19%
  more expensive and 23% slower. Its own words: *"a safety win, not an efficiency
  win."* Cross-role replication remains open.
  There is no work item **DAS-013** — that ID was invented in an earlier draft of
  this file and does not exist anywhere in the repo.
- **Lifetime paid-model spend: $25.711985** (report 0089), against a $25 ceiling.
  Do not confuse it with the DAS-004/B2 campaign figure of $0.36181282.
- The real evidence is `docs/LIVING_TECHNICAL_BACKLOG.md` and `reports/`. Two
  objections have survived all fourteen self-audits: **unclear recurring value**
  and **weak differentiation**. Gate **A6** (fresh non-author user study) has
  never run, so every setup-burden claim currently rests on nothing.

## Spending rules

Max **$1 per gate**, **$3 cumulative** before a new checkpoint. One paid campaign
at a time. Never auto-retry an ambiguous outcome. The remaining six discovery
benchmark cases are **not authorized** — they need a new seal.

The real evidence is `docs/LIVING_TECHNICAL_BACKLOG.md` and `reports/`, not any
summary of them. Two objections have survived all fourteen self-audits: unclear
recurring value, and weak differentiation. Gate A6 (fresh non-author user study)
has never run.

Any spend needs explicit approval.

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
