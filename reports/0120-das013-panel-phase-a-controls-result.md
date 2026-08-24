# 0120 — Panel Phase A result: instrument valid, both arms decide both controls correctly

**Date:** 2026-08-24. **Campaign:** `das013-decision-validity-panel-v2`, Phase A.
**Spend: $0.94263892 of the $2.00 hard ceiling. 1,356 settled calls, zero unresolved.
Attestation verified (compiler ×4, adaptive ×3). Evidence ledger intact.**

## The instrument is valid — the panel can be failed, and wasn't broken

| Control | Designed truth | TRUTH says | Instrument |
|---|---|---|---|
| R1 renewal desk (weak incumbent) | activate | an upgrade genuinely beat the incumbent | **valid** |
| R2 seat assignment (near-ceiling) | retain | no challenger beat the incumbent | **valid** |

## Decisions

| Arm | R1 | R2 | Score |
|---|---|---|---|
| **das (real compiler)** | activate — correct | retain — correct | **2/2, zero unsafe** |
| adaptive engineer | activate — correct | retain — correct | 2/2, zero unsafe |

Both arms passed both controls. On R1 both engineering procedures produced candidates
that genuinely beat the weak incumbent on hidden TRUTH; on R2 both gates correctly
declined to activate against a near-ceiling incumbent — retain-existing working as a
first-class outcome under the shared rules.

**Mechanical rule: proceed to Phase B.** Controls decide instrument validity and
gate progression; they are deliberately easier than the contested roles and prove the
test can discriminate — they do not by themselves support the DAS claim (that needs
≥4/5 across the full panel with zero unsafe activations).
