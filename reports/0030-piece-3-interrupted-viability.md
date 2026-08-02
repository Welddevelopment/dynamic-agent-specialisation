# Piece 3 interrupted viability attempt

The first support viability attempt was stopped before completion because the test environment, not the product hypothesis, was producing invalid work.

The local knowledge search used exact substring matching. A normal query such as “How to invite a teammate or analyst to a workspace” returned no result for the article “Inviting a teammate.” One candidate then repeatedly searched instead of being evaluated on support performance.

The interrupted evidence chain was preserved and verified:

- 295 evidence records;
- 75 reserved calls;
- 74 calls with captured actual cost;
- known actual spend: $0.0486698;
- one possibly in-flight call conservatively counted at its $0.0020162 projection;
- total conservatively accounted spend: $0.050686;
- unseen cases released: no; and
- performance result usable: no.

The environment now uses bounded token/prefix matching for ordinary wording. Service credits also require an exact verified billing event, preventing a partial credit from being used to bypass a larger approval. The generic runtime now stops repeated identical reads and long read-only non-progress loops.

The replacement run has a new attempt id and evidence directory. The interrupted attempt will never be relabelled as a valid campaign.
