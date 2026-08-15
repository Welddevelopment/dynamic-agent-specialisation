# DAS-025 plugin-project generation preregistration

Date frozen: 2026-08-14  
Work item: DAS-025 / zero-spend productization lane  
State at freeze: implementation and fixture rehearsal not yet counted as evidence

## Question

Can the exact complete receipt produced by DAS-024 be converted, without model calls or source-specific generator rewrites, into separate buildable action-plane and observer-plane plugin projects that expose the remaining customer-local implementation work while remaining non-executable by construction?

## Frozen input and trust boundary

Each project must bind to one complete, integrity-checked DAS-024 package-input draft, its reviewed package/source/role identities, and the exact selected OpenAPI method or pinned MCP tool identities. The generator may copy source-grounded schemas and confirmed declarations. It may not infer authority, scopes, credential values, transport behavior, write-safety semantics, observer independence, proof, readiness, or activation.

Action and observer projects must remain separate in source identity, authentication alias, imports, manifests, generated files, runtime interfaces, and evidence paths. A generated project must never treat an action response as independent business-outcome proof.

## Generated project contract

For each valid fixture, the deterministic generator must create:

- one action-plane project and one independent read-only observer project;
- a provider-neutral manifest with the exact role, receipt, package, source, method/tool, transport and generated-file digests;
- compileable fail-closed stubs for inspector/auth-alias resolution, action execution, no-write probe, reconciliation/readback, independent observation, durable state access and evidence classification;
- all ten canonical controls as executable test skeletons whose initial state is exactly `declared-not-run`;
- source/receipt/provenance/generated-release integrity tests;
- an exact generated-file allowlist, deterministic release hash and static safety-scan receipt; and
- explicit protected gates showing zero executable operations, no runtime authority, no accepted credential values, no completed qualification, no customer acceptance and no activation.

Generated code may use only the repository's selected local language/runtime and built-in modules. It must contain no `eval`, dynamic import, network fetch, dependency-install instruction, package script, credential value, default scope, working transport, fabricated test pass, or activation path.

## Separate fictional implementation layer

The generator's output is evidence only that implementation work has been made explicit and mechanically bound. To test whether the scaffolds are useful, the OpenAPI and pinned-MCP fixtures may each receive a separate fictional implementation layer outside the generated project directory. That layer must be measured separately as manually supplied code and decisions.

The separate implementation may enter the unchanged DAS-023 qualification machinery only after its exact action and observer identities match the generated release and the qualification wrapper supplies its already-declared fictional runtime. The unchanged ten-control result per fixture remains qualification evidence, not evidence that the generated plugin itself was executable.

## Fixtures

The executed rehearsal will use fresh reconstructions of the two complete DAS-024 v2 source families:

1. OpenAPI action and separate OpenAPI observer for the fictional Northstar invoice-dispute workflow.
2. Pinned MCP action server and separate pinned MCP observer server for the fictional Fieldhaven equipment-damage workflow.

The generator core and project topology must be identical across both source families. Source-specific selected operations and schemas may differ.

## Precommitted attacks

The evidence run must reject or detect:

1. output path or filename traversal;
2. template, source-description, or operation-name code injection;
3. action and observer project, source, authentication, import, or evidence-path collapse;
4. credential values or secret-looking literals in input or output;
5. fabricated passing controls or missing canonical controls;
6. `eval`, dynamic import, network fetch, arbitrary dependencies, package scripts, or undeclared files;
7. stale, mutated, or cross-package DAS-024 receipts;
8. substituted OpenAPI methods or MCP tool identities;
9. observer write operations;
10. action-response evidence used as independent proof;
11. caller-weakened classifications, retry rules, or protected gates;
12. generated-file, manifest, source, receipt, or post-build release mutation; and
13. reuse of one generated action or observer module across packages without an exact matching release identity.

## Measures

For each fixture and in aggregate, record:

- source family;
- generated project, file and line counts;
- separate action versus observer generated files and lines;
- generated test skeletons and canonical control coverage;
- static scan and deterministic build result;
- manually implemented files and lines outside the generator output;
- owner/engineer decisions carried from DAS-024 rather than silently recreated;
- package-specific runtime/proof code still required;
- unchanged DAS-023 controls passed/required;
- observer writes, lost-response replays, unsafe or ambiguous acceptances;
- restart/integrity behavior;
- executable operations and every protected readiness gate;
- model calls, spend and active machine time, explicitly not human setup time.

## Pass rule

DAS-025 passes its bounded objective only if both source families generate separate deterministic projects, both builds and static scans pass, every generated control remains declared-not-run, every precommitted attack fails closed, generated or source mutation invalidates the release, and the two separate fictional implementation layers can still traverse the unchanged DAS-023 twenty-control aggregate path. All customer execution and activation gates must remain false.

## Stop and failure rules

- Preserve every failed or superseded rehearsal rather than overwriting it.
- Do not weaken a control to make a fixture pass.
- Do not describe source generation or compilation as executable readiness.
- Stop if the generator needs a credential value, implicit authority, a working network transport, a generated passing proof, a repository dependency install, a model call, or paid spend.
- Do not reuse a final artifact directory.

## Claim boundary

A pass would establish only that, for two fictional reviewed source families, DAS can deterministically turn complete DAS-024 receipts into integrity-bound, buildable, fail-closed action/observer plugin projects and conformance skeletons, making the remaining implementation burden explicit. It would not establish working customer plugins, real credentials or transports, customer-environment conformance, autonomous adapter implementation, comparison readiness, activation, production reliability, customer value, or human setup-time reduction.
