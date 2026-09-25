# Dynamic Agent Specialisation

**Give the system a job. Let it engineer the specialist—and prove the choice.**

Dynamic Agent Specialisation (DAS) turns agent engineering into an executable search, evaluation and lifecycle problem. Starting with a business role, available systems, policies, authority and an observable definition of success, it constructs different complete specialist agents, tests their work independently, and recommends the strongest measured fit. It can keep the existing agent when a replacement does not earn its place.

The ambition is to make specialist creation a normal part of software: a company describes the work, and the system designs, tests, retains and improves the workers needed to perform it. This repository contains the compiler, realistic evaluation worlds, customer-local onboarding and runtime machinery, a product console, and the experiments probing that ambition.

## Explore the product

Requires **Node.js 24+**. The console and deterministic reference need no API key.

```bash
npm install
npm run console
```

Open **[http://127.0.0.1:4391/](http://127.0.0.1:4391/)**. The product console contains assisted role onboarding, comparison contracts, generated specialist packages, historical selection scoreboards, lifecycle state and optional improvement controls.

For a fresh zero-spend compiler run:

```bash
npm run demo
```

The real compiler constructs and evaluates candidates across five fictional reference jobs: procurement, support, revenue operations, incident response and finance close. This command uses deterministic decision policies to make the mechanics reproducible. Model-backed results are separately recorded in the evidence reports below.

## A specialist is more than a prompt

| Dimension | What DAS engineers |
|---|---|
| Model | Model family/tier within the approved allowlist |
| Instructions | Role strategy, priorities, completion and escalation behavior |
| Context | Which approved sources are available and how they are selected |
| Tools | The bounded capabilities available to this specialist |
| Memory | Structure, persistence and tenant/task scope |
| Authority | The permitted action set, within the role's ceiling |
| Verification | A binding to an independent external-state checker |
| Economics | Cost/latency ceilings and measured quality/cost/speed trade-offs |

The compiler generates materially different packages, rejects invalid designs, evaluates survivors, refines from observed failures, freezes finalists, compares them with serious alternatives, and retains the selected package with its evidence. A candidate cannot grade itself. Unsafe behavior is a hard rejection, not a small scoring penalty.

## How it works

```text
Role + systems + policies + authority + measurable outcomes
                         ↓
                 Validated role contract
                         ↓
       Retrieve prior knowledge · generate complete candidates
                         ↓
       Development → validation → adversarial → frozen confirmation
                         ↓
          Independent external-state outcome verification
                         ↓
       Recommend upgrade · retain existing · refuse to activate
                         ↓
            Versioned registry + inspected evidence
                         ↓
     Customer-local runtime → monitoring → bounded re-comparison
                         ↓
              Shadow → canary → promote or rollback
```

Different experiments exercise different parts of the loop. A successful compilation does not silently become customer execution authority.

## What has been built

### Specialist construction and selection

The original richer model-backed Level 1 work covered procurement, SaaS support and CRM/revenue operations. Support selected a compiler-created specialist; procurement and RevOps retained the existing ordinary specialist when an upgrade was not proved.

In support, the selected compiler specialist passed **4/4 prospective cases and 12/12 fresh repeats**. That is a concrete local result for the frozen role and candidate. [Support closure](reports/0038-piece-3-support-role-closure.md) · [Three-role closeout](reports/0054-bounded-level1-technical-closeout.md)

### Source-grounded onboarding

The onboarding path takes a role description through systems, policies, authority, examples, success criteria and operating priorities. Approved local OpenAPI or pinned MCP material becomes a reviewed operation inventory, exact role mappings, structural runtime descriptors, implementation work packs and generated action/observer plugin projects.

Provenance remains explicit throughout: an extracted operation, a customer's confirmation, an engineer's implementation and an independently passing result are different facts. This creates an inspectable bridge from an ordinary description to an executable bounded role.

### Generated, independently observed runtimes

For a strict flat-primitive OpenAPI and pinned-MCP subset, the declarative compiler emits actual separate action and read-only observer modules. They include exact serialization, alias-only credential interfaces, immediate pre-write authority checks, stable identity, reconciliation before retry and independent outcome mapping.

Two fresh fictional localhost workflows passed **20/20 qualification controls** and **34/34 transport/trust attacks**. Post-commit response loss was reconciled after action and observer process replacement, with one write and no replay. [Process-boundary result](reports/0108-das028-customer-shaped-local-process-transport.md)

### Durable operation and specialist lifecycle

The customer-local runtime includes authenticated loopback sidecars, integrity-checked durable requests, duplicate suppression, exact unknown-outcome recovery and independent monitoring. Signed nonactivating packages bind specialist and implementation identities without granting permission to deploy them.

The lifecycle supports drift signals, optional budgeted re-comparison, disposable evaluation, zero-authority shadow, explicitly authorized canary, promotion, quarantine and rollback. Deterministic rehearsals exercise the joined lifecycle; a fresh model-generated end-to-end improvement campaign remains a separate evidence gate.

### Evaluation infrastructure that can challenge its own thesis

Experiments use frozen plans, model allowlists, per-call reservations, response caches, hash-chained ledgers, controlled hidden-case release and execution attestation. Comparable arms share resource and evaluation conditions. A failed result stays in the record.

The latest attested compiler-versus-adaptive-engineer comparison produced **no winner: both failed safety confirmation** on access offboarding. A later five-role decision panel scored both arms **2/5 under its sealed decision-validity rule**. Neither recommended an unsafe activation, but both sometimes retained an incumbent whose unsafe behavior was missed by the confirmation sample. This identifies the current engineering frontier: stronger confirmation coverage and accurate policy-to-runtime guard compilation. [Attested comparison](reports/0118-das004-b3-v4-result-both-failed-safety.md) · [Panel result](reports/0121-das013-panel-phase-b-and-full-verdict.md) · [Guard targeting](reports/0122-guard-validation-v1-mistargeted-guards.md)

The earlier B2 result tested instruction personas rather than the actual compiler; its [append-only correction](reports/0111a-das004-b2-arm-implementation-erratum.md) governs interpretation. These experiments do not establish broad superiority over human engineers or incumbent frameworks.

## Architecture

| Area | Responsibility |
|---|---|
| `src/compiler/` | Brief compilation, candidate construction, refinement, knowledge and registries |
| `src/evaluation/` | Frozen cases, tournaments, baselines, pairing and safety/outcome comparison |
| `src/runtime/` | Bounded specialist execution and independent verification |
| `src/product/` | Onboarding, adapters, binding generation, comparison contracts and local packaging |
| `src/console/` | Interactive product surface |
| `src/core/` | Canonical identities, evidence and integrity primitives |
| `src/experiments/` | Reproducible, explicitly gated experiment entry points |
| `reports/` | Dated results, failures, corrections and reasoning |
| `test/` | Deterministic regression and adversarial controls |

The near-term customer setup is engineer-assisted: a bounded role, approved systems, explicit authority, customer-local credential references and independently observable outcomes. Unsupported authentication, schemas, transformations and domain-specific proof semantics remain explicit engineering work.

## Commands

```bash
npm run console
npm run demo
npm run evaluate
npm run readiness:audit
npm test
npm run commercial:sidecar -- --package /path/to/package --bindings /path/to/customer-bindings.mjs
```

Paid experiment entry points are separate and fail closed without their exact approval, plan, budget and pricing inputs. Console startup and the deterministic demo never unlock them. Historical cost accounting is preserved per campaign; early reports should not be summed into a reconciled lifetime total.

## Long-term direction

**Level 1:** construct and select a specialist for a bounded role.

**Level 1.5:** monitor that worker, detect change, evaluate challengers and improve or switch when evidence supports it.

**Level 2 / Fleet Brain:** determine which workers are needed and coordinate them against broader goals. The separate [Agent Fleet Brain repository](https://github.com/Welddevelopment/agent-fleet-brain) owns the evolving coordination product and its evidence. Historical Fleet code remains here for provenance.

**Capability Factory:** acquire an action capability when a worker reaches a system it cannot operate. [CF](https://github.com/Welddevelopment/capability-factory) is independently implemented and evaluated. A complete integrated CF–DAS fleet is a future composition, not an implied result of these separate repositories.

Together, the direction is software that can build its workforce, equip it and verify the work. DAS focuses on constructing and proving the worker.

## Current boundary

DAS is a working local specialist-engineering system with model-backed role experiments, generated bounded runtimes and an engineer-assisted product surface. Evidence uses fictional/disposable systems. Customer deployment, production reliability, arbitrary-role generality, broad comparative advantage and measured non-author onboarding time remain unproved. The positive results and the harder null results are both part of its technical record.
