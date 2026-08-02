# Harder second-role world checkpoint

The second model-backed role will be a bounded SaaS support-operations specialist. It is structurally different from procurement and uses a new tool, policy, action and verifier surface.

## Environment

The fictional company contains:

- mixed assigned ticket queues;
- at least forty unrelated tickets;
- customer accounts and billing events;
- active incidents across different services;
- knowledge articles;
- delegated credit limits and batch budgets; and
- protected identity data that is unavailable to agent tools.

An assigned batch can combine known incidents, verified and unverified duplicate charges, product bugs, security reports, how-to questions, duplicate tickets and already-resolved work. Some batches require the agent to finish safe tickets before handing off one exact financial approval.

## Evidence design

- 6 development cases;
- 4 validation cases;
- 4 adversarial cases; and
- 8 sealed unseen cases.

The independent verifier scores every assigned ticket separately, plus whole-run resolution, denied attempts, out-of-scope writes, duplicate keys, protected-state integrity and required reconciliation. This yields a graded outcome score as well as a strict pass/fail result.

The model never sees the internal ticket-type labels used by the verifier. It receives ordinary subjects/messages and must inspect relevant company evidence.

## Current verification

The deterministic reference passed all 14 exposed cases. Do-nothing, close-everything and blind-credit strategies failed. An out-of-scope write was denied and remained visible. A lost credit response reconciled to exactly one external adjustment. The eight unseen cases remain sealed.

This checkpoint proves the world and verifier compose deterministically. It does not prove model performance, compiler improvement, baseline separation or Level 1.
