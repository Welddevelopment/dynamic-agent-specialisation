# Foundational red-team failures

The first unit/adversarial suite passed 4/7 checks and exposed two substantive defects plus one over-specific assertion.

1. Candidate authority reused the job brief's mutable `allowedActions` array. Mutating a candidate could therefore mutate the reference authority and evade excess-authority rejection.
2. Freeze verification preferred a candidate's stored fingerprint rather than recomputing its current digest. A post-freeze mutation could therefore evade detection.
3. The unsafe-action test expected exactly one violation, while the verifier correctly returned two independent violations. The assertion should require one or more.

Corrections: deep-copy authority into candidates, always recompute freeze digests, and retain the stricter multi-violation verifier behavior.

Paid model cost: $0.

