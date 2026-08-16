# Execution attestation

**Why:** the B2 campaign's sealed preregistration described an arm the code never
ran (`reports/0111a`). Every existing integrity mechanism — hash-chained evidence,
freeze over verifier source, reserve-before-spend — protects the *numbers*. None
of it checks that the *description matches the code that executed*. This closes
that gap.

**What:** `src/evaluation/execution-attestation.js`. A campaign declares, per arm,
the module and export that constitutes that arm. The attestor wraps each entry
point, counts real invocations, and `assertAllReached()` fails the campaign before
any result is quotable if a declared entry point never executed. `receipt()`
returns a hash-stamped record to persist beside the result JSON.

**Status:** module and tests are written but **not executed on this machine —
`node` is not on PATH here** (searched PATH, homebrew, nvm, volta, asdf). Run
`node --test test/execution-attestation.test.js` before relying on it. Flagged
per the project rule: verify or state plainly.

**Wiring into a live campaign changes preregistration content and therefore needs
approval** — hub proposal PROP-0002. The module itself is additive and changes no
existing behavior.
