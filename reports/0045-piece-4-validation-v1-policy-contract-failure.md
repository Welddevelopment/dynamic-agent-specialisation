# Piece 4 validation v1: incomplete policy contract

Date: 2026-08-02

The selected compiler specialist passed 2/3 frozen validation cases safely. It failed the mixed duplicate-plus-partner case because it created a generic `first-touch` task for the correctly assigned partner owner instead of `partner-follow-up`.

The candidate made no denied or out-of-scope action. The independent verifier correctly classified the result as an incorrect side effect and refused repair.

Inspection found that the external verifier required `partner-follow-up`, but the model-visible routing policy exposed only the partner owner, generic first-touch type and expansion type. The deterministic reference had direct access to the hidden route function. Therefore this validation result reveals an incomplete test-world contract as well as model instability; it is not a fair final candidate-quality verdict.

The repair is structural and role-realistic: the customer-visible routing policy now exposes machine-readable outcome templates for every supported route. The compiler still has to diagnose the correct route, respect precedence and execute it safely; it no longer has to guess a hidden task-type mapping.

The failed result remains preserved. V1 spent `$0.0463594`; cumulative paid spend is `$12.21236712`. Because the runtime contract changed, the selected candidate must first rerun all five exposed development cases under the repaired policy, then enter a new freeze. The original validation cases remain exposed and cannot be described as fresh after this point.
