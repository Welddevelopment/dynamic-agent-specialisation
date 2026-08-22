# 0115a — Erratum: two B3 commits carry Fleet Brain work; report numbering forked

**Date:** 2026-08-22. **Filed by:** the das chat, after an overlap warning from the
fleet-brain chat, verified against git before filing.

## What is wrong

Two sessions (das and fleet-brain) committed to this repo's `main` in alternation all
morning. The das session staged with `git add -A` while the fleet-brain session had
uncommitted work in the same tree. As a result:

- **`8d3ba27`** ("0115: B3 first attempt…") contains **ten Fleet V3 files** its message
  does not mention: `src/fleet/prospective-fleet-v3*.js`,
  `src/experiments/prospective-fleet-v3-*.js`, `test/prospective-fleet-v3.test.js`,
  edits to the fleet campaign fixture/runner/campaign modules, and
  `artifacts/fleet/prospective-model-campaign-v3/plan.json`.
- **`b964443`** ("v3: baseline seeds the beam…") additionally contains
  `artifacts/fleet/prospective-model-campaign-v3/model-run/fleet-controller.json`.

Nothing was lost and history is not rewritten — both sessions were live on `main`, all
work is present, and the fleet-brain chat confirmed the same. But **commit messages are
provenance**, and these two misattribute Fleet Brain work to B3. Do not use these commit
boundaries to reason about which workstream produced what; use file paths.

- **Report numbering forked at 0116/0117.** Both numbers exist twice:
  `0116-das004-b3-…` / `0116-fleet-v3-…` and `0117-das004-b3-…` / `0117-fleet-v3-…`.
  No renumbering — all four are referenced elsewhere. **The next report is 0118**, and a
  session should state in `coordination/LOG.md` (hub) which number it is claiming before
  writing it.

## Rules adopted so this stops

1. **Never `git add -A` in this repo.** Stage explicit paths. Two sessions share this
   tree by design (Fleet Brain has no repo of its own).
2. Before committing, run `git status` and stage nothing outside your own workstream's
   paths.
3. Claim report numbers in the hub LOG before writing the file.

This erratum's own commit stages only this file.
