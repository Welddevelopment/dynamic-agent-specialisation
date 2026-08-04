# Commercial specialist import, recommendation and activation lifecycle

Date: 2026-08-05

## Result

The commercial product boundary can now carry one specialist from an imported existing configuration through a frozen comparison result into an integrity-checked recommendation, optional technical evidence, controlled activation and runtime-neutral JSON export.

The implementation adds:

- a credential-rejecting current-agent import boundary;
- exact candidate validation against the commercial role contract;
- integrity checking for completed commercial comparison results;
- a versioned neutral specialist bundle containing the complete candidate rather than only a prompt;
- an activation gate bound to the exact driver, adapter versions, environment and independent verifier used by the frozen comparison;
- an explicit rollback receipt targeting a prior verified bundle;
- executive, engineering and forensic evidence views; and
- loss explanations for every serious alternative while keeping the recommended specialist selected by default.

The human may inspect or export everything, but manual selection is not required. The system still makes the default recommendation and retains the existing agent when the promised improvement is unproved.

## Safety properties

- Credentials cannot enter imports or bundles.
- Bundle, comparison and activation hashes are verified before use.
- Candidate authority cannot silently expand after evaluation.
- The activation environment must reproduce the frozen driver, adapter versions and verifier binding.
- A result must contain at least three safe perfect repeat runs before it can become a bundle.
- Export is blocked after mutation.

## Validation

Focused lifecycle tests pass 4/4, including tamper rejection. No model calls or new spend occurred.

## Boundary

This completes the generic product mechanics for import → recommendation → controlled activation/export. The tests use a deterministic simulated comparison result. A fresh model-backed run through the commercial procurement pack is still required before claiming a new empirical recommendation. The JSON bundle is runtime-neutral; LangGraph, CrewAI and MCP-specific adapters remain separate next steps.
