# Resumable prospective Level 2 model runner

Date: 2026-08-05

## Result

The frozen three-role prospective Fleet campaign now has a durable paid-model runner, but the paid campaign was deliberately not executed.

The runner can release the sealed procurement, support and RevOps tasks only after all previously frozen authorization gates pass. It then runs the exact selected Level 1 specialist for each assignment, independently verifies each fictional external outcome, records the result through the durable bounded-fleet controller and completes the parent goal only if all three exact assignments pass safely.

## Durable safety and restart behavior

- A durable budget guard reserves and records spend under the exact campaign id and `$1.30` ceiling.
- Model responses are cached and a hash-chained evidence ledger is preserved.
- The frozen plan artifact is rehashed and compared with a freshly rebuilt preflight before task release.
- Candidate id, candidate fingerprint, case id, assignment, verifier, model cost and external verification result are bound before a Fleet observation can be accepted.
- Private progress is integrity hashed and written atomically with owner-only permissions.
- Each independently verified result is persisted before the fleet controller advances. A restart can record that saved observation without repeating the model-backed action.
- A second progress write follows controller advancement. Identical replay is idempotent; conflicting progress or controller evidence fails closed.
- A failed verification, unsafe attempt, incorrect side effect, incomplete quantity or fleet cost breach halts the parent campaign and preserves a private failure artifact.
- Completed campaigns can be reopened without paying for or executing completed assignments again.

## Authorization boundary

The entry point is `npm run level2:prospective:run`. It remains disabled unless the environment contains all of the following at once:

1. global paid-call approval;
2. the exact campaign-specific approval phrase;
3. the exact frozen plan hash;
4. an explicit limit covering all three selected task ceilings and no greater than `$1.30`;
5. the same-day pricing date and exact pricing-table hash; and
6. an API key.

An attempted run without approval failed before task release with `Global paid model calls are not approved`. It made no model call and spent nothing.

## Validation

- Focused prospective Fleet tests: 8/8 passed.
- Full local repository suite: 244/244 passed.
- `git diff --check`: passed.
- New paid-model calls: 0.
- New paid-model spend: `$0`.
- Historical cumulative paid-model spend remains `$23.10699808`.

The restart test specifically simulates an independently verified result saved before controller advancement, restores it after restart, and confirms that a second restore remains idempotent with one recorded observation.

## Evidence boundary

This checkpoint proves that the already-frozen prospective experiment can be executed durably and fail closed after separate explicit approval. It does not prove that the selected model specialists will pass the fresh cases, that a model-backed Level 2 parent goal has completed, that arbitrary company goals can be decomposed, or that the product is customer- or production-ready.

The empirical Level 2 result remains unrun and requires separate paid-model authorization.
