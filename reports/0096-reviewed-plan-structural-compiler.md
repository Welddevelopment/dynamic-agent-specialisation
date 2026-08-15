# Checkpoint 0096 — reviewed-plan structural compiler

Date: 2026-08-14  
Queue item: DAS-012  
Spend: $0; zero model calls; zero network requests

## Verdict

DAS can now take one exact role-owner-reviewed OpenAPI or MCP work plan and route it through the existing bounded compiler without undocumented repository-author choreography. The resulting receipt proves only structural compilation: it is provenance-bound, explicitly unprobed, non-executable, and cannot advance customer-local execution or activation.

This checkpoint removed the generic read-side compiler work from the unchanged DAS-010 setup family. It did not automate or prove customer-specific write safety.

## Mechanism

`compileReviewedOnboardingBinding(...)`:

1. revalidates the exact saved intake, pinned source, proposal, one-to-one customer confirmation, work plan and binding scaffold;
2. accepts only environment credential-reference names and separate engineer-owned write-safety input;
3. derives names, modes, context and authority solely from the role-owner confirmation;
4. requires every write readback to reference a separately approved read operation;
5. invokes the existing bounded OpenAPI or MCP compiler;
6. records source-schema → runtime-schema transitions and private compiler-plan hashes;
7. emits a conservative descriptor whose statuses remain structurally compiled/unprobed; and
8. reruns commercial descriptor diagnostics, which must remain not ready.

The bridge deliberately does not call the older commercial descriptor binders because they promote a structurally compiled adapter to `executable`. That would be false before customer-local wiring, credentials, probes, observer qualification and acceptance.

## Unchanged frozen-family result

Source: the four DAS-010 customer packets and five exact system imports.

| Measure | Result |
|---|---:|
| Approved operations | 16 |
| Generic compiler/source-schema fields targeted | 32 |
| Structurally compiled operations | 10 |
| Generic fields retired | 20 |
| Generic fields still blocked | 12 |
| Execution-ready fixtures | 0 |
| Activation-ready fixtures | 0 |

The ten compiled operations are all reviewed reads. The remaining 12 fields correspond to six writes × two explicit requirements: idempotency plus reconciliation/readback. No write configuration was supplied to the frozen family because doing so would silently add facts not present in the earlier customer packets.

## Fresh held-out result

A separately drafted fictional warranty-dispatch OpenAPI package contained:

- three reviewed reads;
- one reviewed replacement-dispatch write;
- one explicitly rejected cash-settlement write;
- explicit engineer-owned idempotency header configuration; and
- an exact readback mapping with four identity assertions.

Result:

| Measure | Result |
|---|---:|
| Approved operations | 4 |
| Dangerous operations rejected | 1 |
| Structurally compiled operations | 4/4 |
| Generic fields retired | 8/8 |
| Write-safety fields supplied but still unproved | 2 |
| Executable / activation-ready | false / false |

The source server included a path prefix; the private compiler plan hash and transport-identity hash bind the exact compiler-selected transport. Source and runtime schema hashes are recorded separately because OpenAPI compilation legitimately adds bounded path/query/header containers and an explicit idempotency input.

## Preserved failures

- `reviewed-binding-compiler-v1`: the frozen family completed in memory, but the held-out input could not confirm an import because no binding scaffold existed.
- `reviewed-binding-compiler-v2`: a precise readiness error exposed the reason—the new role description supplied only two independent success measures and therefore did not meet the support-role contract.
- `reviewed-binding-compiler-v3`: corrected run completed before conservative descriptor diagnostics were added.
- `reviewed-binding-compiler-v4`: current final evidence after diagnostics were added.

The business-readiness failure is valuable: structural compiler automation did not bypass an incomplete definition of success.

## Remaining responsibilities

- **Role owner:** confirm operation meaning, mode, business scope and existing authority boundary.
- **Engineer/security owner:** supply customer-local transport and credential references, plus exact write idempotency/readback configuration.
- **Independent verifier:** qualify an authenticated observation path, directly inspect external outcomes and protected state, and run the mandatory acceptance family.
- **Activation owner:** authorize execution only after every earlier gate passes.

## Evidence boundary

Private fictional deterministic local development only. This does not prove arbitrary schema support, executable customer bindings, safe write behavior, independent observer operation, human time savings, customer value, activation, production reliability or any Capability Factory integration.

## Artifacts

- Final summary: `artifacts/onboarding/reviewed-binding-compiler-v4/summary.json`
- Held-out packet: `artifacts/onboarding/reviewed-binding-compiler-v4/heldout-customer-packet.json`
- Preserved failures: `artifacts/onboarding/reviewed-binding-compiler-v1/` and `reviewed-binding-compiler-v2/`
- Final summary hash: `f9a08eb56306c46663093e0f6d3b7ee1afa242138c1f03ad938972e5006d9ac0`
- Post-change readiness-audit hash: `1c8793dcaba977a80f618cda03e5efbf48ab088057497ce36cc43b47277a6720`
- Repository-wide deterministic suite: green after the joined state-machine and receipt changes.
