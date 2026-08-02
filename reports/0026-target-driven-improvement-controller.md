# Target-driven self-improvement controller checkpoint

## Product behaviour now represented

The optimisation target is customer-configurable rather than fixed at ten percent. A contract can specify:

- metrics to increase or decrease;
- the minimum improvement required for each metric;
- correctness, outcome-quality and safety floors that cannot be traded away;
- a hard model-spend limit;
- a hard wall-clock limit;
- maximum rounds and refinements;
- minimum repeat evidence;
- how much stagnation is acceptable; and
- the minimum estimated chance of success required before another refinement is purchased.

The first concrete helper expresses Joel's example: preserve perfect correctness and safety while seeking at least ten percent lower model cost and ten percent lower median completion time.

## Rational stopping

The controller does not blindly refine every candidate. It orders candidates by eligibility and distance from the requested frontier, removes candidates too far below the quality floor or too far from the requested objectives, and optionally accepts an evidence-based success-probability estimate before paying for refinement.

It stops with an explicit reason when:

1. every requested target is reached on development evidence;
2. the hard model budget is reached;
3. the hard time budget is reached;
4. too many rounds produce negligible progress;
5. no remaining candidate has a plausible improvement path; or
6. the precommitted round limit is reached.

When the target is missed, the best candidate found is still preserved with its exact measurements and gaps. The target cannot be weakened during a campaign, and unseen cases are unavailable to the improvement loop.

## Evidence boundary

This checkpoint tests the generic controller deterministically. It does not yet prove that a model can use the diagnoses to achieve a real ten-percent cost-and-speed improvement, that the success-probability estimator is calibrated, or that the controller generalises across business roles. Those require the harder second-role model campaign.
