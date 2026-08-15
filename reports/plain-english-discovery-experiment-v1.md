# Plain-English discovery experiment v1 checkpoint

## Implemented without model spend

- A seven-case, prospectively authored benchmark for a normal frontend designer, plus support and RevOps generalization controls.
- A strict structured-output model provider whose output schema permits only canonical fact paths.
- Explicit untrusted-evidence handling for approved descriptions, artifacts, current-agent material, and system-import proposals.
- An independent deterministic scorer for correctness, provenance, consequential assumptions, unsupported authority, clarification burden, edit distance, and readiness truth.
- An OpenAI Responses provider that meters cache writes separately instead of treating the model's own output as usage evidence.
- A durable one-call plan with exact benchmark, request, expected-contract, model-request, pricing, and plan hashes.
- A `$0.50` fail-closed durable smoke budget. The final sealed projected one-call maximum was `$0.0041655`; the larger ceiling was deliberate interruption headroom, not a spending target.
- An atomic spend ledger, response cache, hash-chained evidence log, and private report destination for the later smoke.

The repaired full deterministic suite now passes all **400** checks: 399 inside the restricted sandbox plus the one localhost-bound endpoint check when run with local-bind permission.

## Paid smoke result

One paid call ran under the exact frozen plan:

- model: `gpt-5.6-luna`, Standard, low reasoning;
- input tokens: 1,398;
- cache-write tokens: 1,395;
- output tokens: 2,057, including 426 reasoning tokens;
- settled spend: **$0.00281775**;
- additional calls during repair/replay: **0**;
- unresolved reservations: **0**.

The response correctly identified `frontend-implementation`, supplied every required benchmark path, retained zero executable authority, and did not overstate comparison or activation readiness. Independent scoring passed with 100% required-field presence, 0.8889 semantic-token coverage, 100% accepted provenance accounting, 100% required consequential-question recall, zero unsupported authority, and normalized contract edit distance 0.1151.

The first post-call attempt did not produce a report because the core still rejected any nonzero provider usage. Subsequent cached processing exposed two more provenance integration defects. Each was repaired fail-safely: inaccurate citations are now downgraded to review-required inferences; unknown source identities still fail closed. The final passing report therefore evaluates the original response after deterministic repairs. It is not a second independent model sample.

## Not run

No full specialist comparison has run. No customer data, customer system, public deployment, outreach, or activation is involved.

## Decision after the smoke

- If authority inference is nonzero or readiness is overstated: stop, preserve the result, repair, and reseal a new version.
- If provenance or consequential-question recall fails: stop and repair before generalization.
- The canonical contract passed. The remaining six frozen cases still require a separately sealed and reviewed bounded campaign; the original plan explicitly prohibited automatic scaling.
- Do not infer universal onboarding performance from a single passing contract.
