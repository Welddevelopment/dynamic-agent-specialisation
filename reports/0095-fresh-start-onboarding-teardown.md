# Checkpoint 0095 — fresh-start onboarding teardown

Date: 2026-08-14  
Queue item: DAS-010  
Spend: $0; zero model calls; zero network requests

## Verdict

DAS can now take fresh, explicitly supplied fictional role facts plus reviewed OpenAPI/MCP material through a repeatable assisted setup path without silently borrowing author knowledge. It proposes exact bounded operation mappings, preserves consequential customer confirmation, emits non-executable adapter/verifier work plans, records every remaining owner and blocker, survives a new process, and replays from a second clean root.

This is a real reduction in author-only setup work, not an executable unknown-customer specialist. All four fixtures stopped honestly at `comparison-design-complete-binding-required`; execution and activation remained false.

## Frozen experiment family

The experiment used four separately stored customer packets and sealed expected-result files:

1. support operations with reviewed OpenAPI material;
2. procurement with reviewed MCP tool material;
3. RevOps with one OpenAPI system and one MCP system; and
4. frontend implementation as a deliberate `design-and-scaffold-only` lifecycle control.

Every fixture started in a new temporary state root. The runner imported only the customer packet, generated review suggestions, applied the packet's explicit role-owner decisions, generated binding/verifier work plans and the readiness receipt, then spawned a fresh Node process to reload the saved state. A second clean-root replay had to produce the same semantic result. The sealed expected mappings were used only for scoring.

## Before/after repair

The first implementation was preserved under `artifacts/onboarding/fresh-start-teardown-v1/`. It proposed 14 of 16 expected mappings (87.5%). Independent per-operation matching allowed two source operations to compete for the same role target and treated the ambiguous MCP name `stagePurchase` too literally.

The repair changed the mapper to choose a global one-to-one assignment and added source-grounded mode/name normalization. No fixture, expected result or safety gate was changed. The final v3 family proposed all 16 expected targets and all saved-authority matches correctly. All 16 still required explicit role-owner confirmation; the software did not self-approve them.

## Final result

| Measure | Result |
|---|---:|
| Fresh fictional fixtures | 4 |
| Full-lifecycle role hypotheses | 3 |
| Deliberate lifecycle-stop controls | 1 |
| Approved imported operations | 16 |
| Exact target proposals | 16/16 |
| Role-owner confirmations preserved | 16/16 |
| Dangerous/out-of-scope operations rejected | 5 |
| Fresh-process reloads | 4/4 |
| Exact clean-root semantic replays | 4/4 |
| False execution-ready or activation-ready states | 0 |
| Silent author-only injections | 0 |
| Model calls / spend | 0 / $0 |

The integrity-bound ledgers recorded 388 field-level setup units:

| Owner/status | Units |
|---|---:|
| DAS-generated defaults/proposals/scaffolds | 113 |
| Explicit role-owner decisions or confirmations | 171 |
| Engineer implementation still required | 44 |
| Independent verifier/acceptance proof still required | 36 |
| Precise unknown or blocked | 24 |

These units are factual fields and gates, not equally weighted effort, code volume or human time. The total active machine time was approximately 57 ms. That is recorded only as machine execution time and cannot support any claim about customer onboarding time.

All 262 facts actually used to advance the four journeys had traceable provenance. Template/default values are now labelled as DAS/template inputs rather than customer-supplied facts. Customer statements such as “verified” or “ready” remain declarations and never become independent proof.

Within the 171 binding-work-plan fields specifically, 91 are already complete, 32 are generic compiler or source-schema work, 12 require customer-specific write-safety implementation, and 36 require independent verifier or acceptance proof.

## What remains manual and why

- **Role owner:** confirm that proposed source operations really correspond to the business role, classify consequential read/write behavior, and confirm existing authority boundaries. DAS must not automate business truth or grant itself authority.
- **Engineer:** bind customer-local transport/authentication, compile runtime request shapes, and implement write idempotency and reconciliation where the source does not prove them. Generated plans contain no credentials.
- **Independent verifier:** implement and authenticate direct external-state observation, then run mandatory acceptance. A generated assertion inventory is not proof.
- **Administrator/security owner:** provide local access and approve any eventual activation. This experiment created neither.

## Next technical decision

The largest reusable software omission is no longer discovering the next command. It is compiling an exact reviewed work plan through the existing bounded OpenAPI/MCP compilers and descriptor diagnostics without pretending the result has been probed.

DAS-012 should therefore add a `compileReviewedOnboardingBinding` bridge that:

1. re-requires the pinned source and checks its digest;
2. consumes only explicit confirmed mappings;
3. invokes the existing source-specific compiler;
4. emits separate action and observation descriptors where supported;
5. marks the output `structurally-compiled-runtime-unprobed`; and
6. continues to block execution until customer-local observer qualification and fixed acceptance succeed.

The prospective independent-user setup study remains necessary. An author-run teardown cannot prove usability or human setup-time reduction.

## Evidence boundary

Private deterministic local development only. This checkpoint does not establish self-serve onboarding, executable unfamiliar-customer bindings, arbitrary OpenAPI/MCP support, customer value, human setup time, activation, production reliability, an improved specialist, or integration with Capability Factory.

## Artifacts

- Preserved first result: `artifacts/onboarding/fresh-start-teardown-v1/`
- Intermediate provenance repair: `artifacts/onboarding/fresh-start-teardown-v2/`
- Final result: `artifacts/onboarding/fresh-start-teardown-v3/`
- Final summary hash: `e526ff220f59eb53e825272a59ba01ac6ec0ef633c423e3d61ea90a525d55c29`
- Frozen protocol hash: `a39b6afa4a620d508de481e88d218c9956aaba55146800cd8c68667f50cdd57a`
- Post-change technical-readiness audit hash: `fdb65dadb98975f537554741ce8df7f6716c3274367fa20238f0bbc205bde46a`
- Repository-wide deterministic suite: green; the localhost system-import endpoint also passed separately under local-port permission.
