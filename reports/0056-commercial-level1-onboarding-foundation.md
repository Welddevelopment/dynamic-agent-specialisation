# Commercial Level 1 onboarding foundation

Date: 2026-08-04

## Outcome

The private console now contains a guided customer journey for creating a bounded specialist role without requiring the customer to understand prompt engineering, model selection or agent frameworks.

The flow captures:

- company and role outcome;
- supported role family;
- systems and knowledge sources;
- required checks, approval rules and forbidden actions;
- explicit allowed, approval-bound and forbidden action vocabularies;
- at least five representative cases;
- independently observable success measures and completion rules;
- quality, cost and speed priorities;
- hard task cost and latency limits; and
- whether an existing agent must be included in the later comparison.

## Honest readiness boundary

The product presents three separate states:

1. **Design preview** — enough information exists to draft the role.
2. **Ready for comparison** — enough information exists to construct a fair bounded comparison contract. This is not a result.
3. **Controlled activation** — every required system and external verifier is executable inside a bounded approved environment.

A walkthrough correctly reached the first two states and remained blocked on activation because the fictional intake supplied declarations rather than executable customer adapters, approved environments and a verified external-state checker.

## Safety and persistence

- credential-like fields are rejected recursively;
- intake text and list sizes are bounded;
- saved sessions are versioned and written with restricted file permissions;
- record and store integrity hashes detect mutation;
- generated drafts cannot claim that generated cases have passed;
- saving starts no comparison, model call or activation; and
- every unsupported or missing activation input remains visible as a question.

## Customer surface

The console now has a primary **Create specialist** journey with a plain-English welcome, role selection, progressive guided inputs, a no-credentials boundary, an independent-verification explanation and a dense final readiness review. Optional technical evidence remains separate from the normal onboarding path.

GSAP is packaged locally for restrained onboarding and review transitions. The product logic does not depend on motion.

## Validation

- focused commercial tests: 6/6 passed;
- complete local suite: 141/141 passed before final presentation-only motion wiring;
- JavaScript syntax checks passed after final wiring;
- local browser walkthrough completed every onboarding stage, saved the role, observed the exact three activation blockers, restarted the server, reloaded the persisted role and confirmed the corrected **Ready for comparison** wording;
- local browser reported no console errors; and
- the live heading contained GSAP-applied transition state.

No paid model call was made.

## Remaining work

The largest immediate gap is the join from a saved customer role to a real bounded comparison runner. The current flow compiles a validated draft, but it does not yet:

- create the executable role adapter and verifier;
- freeze exposed and unseen customer cases;
- import and run the customer’s existing agent;
- generate and eliminate candidate packages;
- run prospective validation, adversarial, unseen and repeatability stages; or
- publish the final recommendation and alternatives into the durable registry.

Those steps are the next commercial Level 1 checkpoint. Level 1.5 and Level 2 work remain separate parallel tracks.
