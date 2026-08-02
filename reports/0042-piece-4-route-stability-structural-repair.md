# Piece 4 route-stability structural repair

Date: 2026-08-02

Three instruction-only refinement rounds did not produce a stable RevOps specialist. The first two each passed 4/5 development cases safely. The third was deliberately run twice and passed 8/10 safely, but its misses migrated:

- one run omitted a final qualified disposition;
- another treated a normal APAC web lead as a partner lead after partner-specific repair language had been added.

This is evidence against continuing to append case-specific prompt rules. The route-specific language began contaminating other routes.

Structural changes:

1. The compiler knowledge base now includes an exposed-development observation: multi-record specialists should maintain a separate evidence-selected route and required-outcome checklist per item, finish every outcome on that route, and audit all assigned items before completion without cross-item route bleed.
2. Candidate generation explicitly uses supplied engineering knowledge as design priors and no longer optimizes for minimal strings at the expense of complete operational rules.
3. The independent RevOps verifier classifies a failed outcome as `missing-outcome`, `incorrect-side-effect`, `unsafe`, or `unknown`.
4. The generic runtime may provide exactly one verifier-guided repair round only for `missing-outcome`. Incorrect or unsafe side effects fail immediately; the agent still cannot grade itself.

The full suite passes 100/100. No model calls were made for these structural changes. Cumulative spend remains `$11.60892934`. All prior paid results remain historical because the compiler knowledge and runtime verification loop have changed. A fresh candidate portfolio and fresh development gate are required before validation.
