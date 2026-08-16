# DAS work-item map: queue ids vs backlog lanes

Two numbering systems are both real and nothing previously mapped them. Queue ids
(`DAS-0NN`) live in `~/Desktop/Capability Factory/coordination/engineering-queue/index.json`.
Lanes (A1-A13, B1-B4) and checkpoints (0001-0111) live in this repo's
`docs/LIVING_TECHNICAL_BACKLOG.md`. **Verify against both before relying on a row** —
confidence is marked because parts of this map are inferred.

| Queue id | Backlog anchor | Checkpoint | Confidence |
|---|---|---|---|
| DAS-004 | Lane B2 — prospective adaptive comparison | 0109-0111 (ran 2026-08-13; see erratum 0111a) | high |
| DAS-005 | Lane A1 — frontend discovery -> assisted onboarding | 0092 | high |
| DAS-007 | Lane A3 — adapter/verifier scaffolding breadth ("maps directly" per backlog) | 0094 | high |
| DAS-010 | four-package teardown (171-field split) | ~0095 | medium |
| DAS-011 | integrity-bound readiness receipt | ~0093 | medium |
| DAS-012 | compiler/source-schema field retirement | ~0097 | medium |
| DAS-024 | source-grounded drafts + dependency-bound questions | 0100 | high |
| DAS-025 | non-executable action/observer plugin projects | 0101 | high |
| DAS-026 | provenance-bound transport/authority work pack | 0104 | high |
| DAS-027 | bounded declarative subset compiler | 0106 | high |
| DAS-028 | customer-shaped local process boundaries | 0108 | high |
| DAS-013 | no lane — the broad adversarial test ("still a decisive open test") | never run | high |
| DAS-019 | related to handoff/uncertainty calibration; see hub PROP-0003 | open | low |
| — (gap) | **A6 fresh non-author user study has NO queue id** | never run | high |

Known open `ready` DAS ids: 003, 006, 008, 009, 013, 014, 015, 016, 017, 018,
019, 021, 029. Paid blocking gates: DAS-008, DAS-015.
