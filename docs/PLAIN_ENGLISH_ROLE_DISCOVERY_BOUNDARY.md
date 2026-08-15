# Plain-English role discovery: current boundary

## Current accurate wording

> DAS can accept an ordinary-language job description and approved local inputs, produce a provenance-labelled provisional role contract, and ask a short set of consequential clarification questions. The current zero-cost discovery path is a deterministic structural preview. It does not independently understand an arbitrary company, grant authority, connect credentials, implement adapters or verifiers, run a comparison, or activate a specialist.

The existing DAS compiler can automate specialist search only after it has a sufficiently complete trusted role contract and an executable, independently verifiable comparison environment. Plain-English discovery is a preparation layer for that contract. It is not a replacement for customer business truth or engineering evidence.

## Target wording, not a current claim

> Describe the job in ordinary language, connect approved systems, documents, and current-agent data, and DAS drafts the operating contract, asks only consequential questions, then begins the bounded compile-and-evaluate pipeline.

Reaching that target still requires a model-backed discovery benchmark, joined customer review, executable customer-local bindings, independent verifier implementation, sandbox/replay evidence, mandatory acceptance, and explicit model-spend approval.

## Implemented interface

`src/product/plain-english-role-discovery.js` exports:

- `createRoleDiscoveryRequest(input)` — normalizes one ordinary-language description plus explicitly approved artifacts, an optional approved current-agent configuration, optional pinned DAS OpenAPI/MCP import proposals, and explicit customer confirmations. Credential material is rejected.
- `assertRoleDiscoveryProvider(provider)` — defines the provider-neutral `id`, `version`, `discover(request)` boundary.
- `discoverRoleFromPlainEnglish({ provider, input })` — produces an integrity-bound `das.provisional-role-contract.v1`.
- `assertProvisionalRoleContract(contract)` — rechecks integrity, false authorization, non-executable readiness, fact classes, and status constraints.

The current interface intentionally permits only providers reporting exactly zero model calls, zero external requests, and zero spend. A later model-backed provider needs a separately approved execution and budget boundary rather than silently passing through this local deterministic route.

`src/product/deterministic-role-discovery-preview.js` is the safe provider for the current private console. It uses keyword routing and predefined structural proposals across support, procurement, and RevOps. Its own output states that it is not intelligent or model-backed extraction.

## Fact truth levels

Every fact contains a path, value, provenance, status, category, review requirements, and executable flag.

Statuses:

- `observed` — exact supplied input, such as the ordinary-language description.
- `extracted` — directly tied to a supplied description, approved artifact, approved current-agent configuration, or pinned import proposal.
- `inferred-proposal` — a provider suggestion that still needs review.
- `customer-confirmed` — an explicit customer confirmation bound to its exact fact path and value.
- `independently-verified` — reserved for later trusted evidence; the current discovery provider cannot create this status.
- `unknown` — required information that the system deliberately did not invent.

Categories:

1. `proposable` — role title, intended outcome, system inventory, potential measures, and similar drafting help.
2. `consequential-confirmation` — authority, approvals, forbidden actions, permissions, monetary/action limits, policies, and escalation. These remain blocked until explicitly confirmed.
3. `executable-evidence` — credentials references, adapters, bindings, runtimes, verifiers, sandboxes, and acceptance results. Customer confirmation alone cannot prove these; they require implementation and independent evidence.

Sensitive classification is path-wide rather than prefix-only. A provider cannot hide authority under `role.authority` or adapter claims under `systems.adapterVerified` to receive a weaker category.

## OpenAPI and MCP evidence

Discovery accepts only an integrity-valid `das.onboarding-system-import-proposal.v1` that retains every false authorization and every fail-closed readiness gate. Its operations become reviewed tool-inventory evidence. They remain non-executable. The contract separately records that adapters, authority mapping, credential references, independent verification, reconciliation, and acceptance are missing.

## Clarification behavior

The discovery layer asks at most seven high-information blocking questions at a time. It prioritizes:

1. the exact owned outcome and completion state;
2. systems and information sources;
3. allowed, approval-required, and forbidden actions;
4. monetary or action limits when relevant;
5. escalation owner and conditions;
6. externally checkable success;
7. approved representative cases and the current baseline.

Missing facts are represented as `unknown`, not filled with plausible-sounding defaults.

## Responsibility boundary

Customer responsibility:

- describe the job and supply approved/redacted inputs;
- confirm business truth, authority, approvals, limits, forbidden actions, and escalation;
- provide customer-local access references separately from discovery records.

Engineering responsibility:

- bind reviewed operations to customer-local executable adapters;
- implement direct external-state verification and unknown-outcome reconciliation;
- create a safe sandbox/replay environment;
- run mandatory acceptance and preserve immutable evidence.

DAS responsibility after those gates:

- freeze the trusted comparison contract;
- compare serious candidates and the current-agent/manual baselines fairly;
- use independent outcome verification;
- preserve safety as a hard gate;
- recommend or retain the strongest proved configuration;
- require separate approval before paid execution or controlled activation.

## Shortest model-backed benchmark after credits exist

1. Freeze a representative set of ordinary-language role descriptions across support, procurement, RevOps, vague, unsupported, and adversarial cases.
2. Have domain owners independently write the trusted target facts and minimum clarification set before running a model.
3. Add a separately approved provider wrapper with exact model, pricing, call, time, and spend limits; preserve every response and cost.
4. Score fact precision/recall, unsupported invention, consequential-question recall, unnecessary-question count, provenance accuracy, authority widening, credential leakage, and downstream contract completion effort.
5. Keep executable adapter/verifier/acceptance evidence outside the discovery score. A good role draft cannot masquerade as an executable environment.
6. Compare against the deterministic preview and a human-authored structured-intake baseline.

Until that benchmark exists, the correct evidence claim is structural: the interface, provenance model, safety classes, clarification planner, import join, and deterministic fixtures work locally at zero spend. Intelligent arbitrary-role discovery performance is unproved.
