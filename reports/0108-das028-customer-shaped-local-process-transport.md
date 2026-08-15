# Checkpoint 0108 — DAS-028 customer-shaped local-process transport

Date: 2026-08-14  
Status: completed, private local evidence  
Spend/model/network: $0; zero model calls; loopback HTTP only; no external network or customer data

## Result

DAS-028 passed its frozen finish line for the strict DAS-027 declarative
subset. The generated action and observer implementations no longer depend on
injected in-memory transports in this experiment. For each of two fresh
fictional packages, DAS started three distinct local processes:

1. a credential-handle issuer/verifier;
2. an authenticated action server;
3. a separately authenticated read-only observer server.

The two packages were a new OpenAPI cold-chain exception workflow and a new
pinned-MCP equipment-isolation workflow. Both traversed the existing reviewed
DAS-024/023/025/026 chain, used the unchanged DAS-027 implementation compiler,
passed the unchanged DAS-023 qualification, and entered separately signed
DAS-020 nonactivating bundles.

## Exact evidence

- 2/2 fresh fictional packages passed.
- 20/20 unchanged canonical controls passed.
- 34/34 frozen transport and trust-boundary attacks passed.
- 3 separate local processes per package, on three distinct ports.
- Action, observer and credential-service process identities were distinct.
- Action and observer used disjoint credential aliases and independently
  scoped opaque handles.
- 2/2 post-commit response-loss cases restarted the action and observer
  processes, adopted identity-valid replacements, reattached to the same
  durable state, found exactly one write, and replayed zero writes.
- 0 observer writes, 0 surviving incorrect effects, and 0 credential values or
  opaque handles in durable evidence.
- 2/2 signed packages remained explicitly nonactivating.
- 4 generated executable files / 322 generated lines across the two packages;
  this count is the unchanged generated DAS-027 runtime, not customer product
  code or a claim about human setup time.
- Full deterministic repository suite: 492 passed, 0 failed, 0 skipped.
- Focused DAS-028 suite: 4 passed, 0 failed.
- Final result identity:
  `c52b6b8d251b9e819a7986c6149f16b22624a5aa3643a092a49de09ee07a54e6`.

## Transport and failure coverage

The final run exercised actual JSON serialization/deserialization and checked:

- exact OpenAPI method/path/query/header/body and pinned-MCP
  server/version/tool/schema identities;
- authenticated success plus explicit missing-authentication 401 and
  wrong-plane 403 responses;
- connection failure, malformed JSON, oversized responses, conflicting HTTP
  framing and a timeout-before-commit race;
- precise path/tool redirects, host/DNS changes, port/server substitution and
  unadopted identity drift;
- authority revocation immediately before the network send, with no request
  reaching the action process;
- canonical unavailable, stale, incorrect, duplicate, collateral and unknown
  observer outcomes;
- generated implementation mutation and cross-package evidence substitution;
- a same-process observer shortcut and a false TLS claim.

The transport is deliberately `http://127.0.0.1` only. The false-TLS attack is
a check that the evidence cannot call it TLS, not evidence that TLS exists.

## Preserved failures and repairs

Ten pre-seal attempt directories and one superseded pre-final green directory
remain under `artifacts/onboarding/`. They exposed six distinct problems and
one missing explicit coverage item:

1. the first pinned-MCP fixture violated the existing canonical idempotency-key
   contract;
2. the corrected answers did not yet match the fixture's literal source field;
3. a safe secret-process instance label collided with the credential-material
   scanner;
4. the new process-boundary wording incorrectly tried to promote the frozen
   DAS-020 evidence scope;
5. MCP observation phase metadata was not propagated into the actual request;
6. generated MCP action requests carried the identity as
   `inputSchemaHash`, while the process boundary initially required a duplicate
   `operationIdentityHash` field;
7. the first green run lacked explicit connection-failure and 401 checks, so it
   was preserved and superseded rather than declared final.

The final run changed neither the canonical controls nor their expectations.
The fixes normalized the real transport to existing generated contracts and
kept the nonactivating evidence scope unchanged.

## What this establishes

Inside the strict flat-primitive, one-write, explicit-reconciliation subset,
DAS can generate separate action and independent observer modules and run them
over real authenticated localhost process boundaries for both OpenAPI and
pinned MCP. It can preserve exact authority, direct observation, failure
classification and no-replay recovery across actual process replacement.

## What remains false or unproved

- no TLS, remote-network, hostile-OS or production-security claim;
- no real provider, customer credential, customer process or customer data;
- no customer-environment acceptance or customer-executable operation;
- no activation, deployment, production reliability, demand or human setup
  time;
- no arbitrary OpenAPI/MCP, nested-schema, custom-authentication, streaming or
  custom-transform support;
- no CF dependency or CF–DAS integration.

The signed bundle is ready only for nonactivating handoff. Its activation and
customer-execution fields remain false by construction.

## Artifacts

- Final report: `artifacts/onboarding/das028-customer-shaped-local-process-v1/result.json`
- Final summary: `artifacts/onboarding/das028-customer-shaped-local-process-v1/summary.json`
- Preregistration: `reports/0107-das028-customer-shaped-local-process-transport-preregistration.md`
- Product boundary: `src/product/customer-local-process-transport.js`
- Process harness: `src/experiments/das028-local-process-runtime/`
- Regression suite: `test/customer-local-process-transport.test.js`

## Next technical decision

The local process-boundary gate is green. The next productization work should
not repeat another renamed localhost pair. The highest-value choices are now:

1. a fresh non-author human onboarding study (A6), which is externally
   dependent and must not be simulated;
2. a real customer-local binding/environment acceptance, which is
   customer-dependent;
3. if a non-customer zero-spend lane is still preferred, add pinned local TLS
   and stronger process/secret isolation as a new explicit security boundary,
   or extend the declarative compiler only to a source shape that a measured
   prospect actually requires;
4. keep the separate strong-adaptive model comparison behind its frozen paid
   approval gate.

