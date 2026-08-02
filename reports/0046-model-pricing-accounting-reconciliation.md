# Model pricing accounting reconciliation

Date: 2026-08-02

Paid calls are paused until this committed reconciliation runs.

Four RevOps experiments injected Luna's `$0.20 / $1.20` input/output rates even when a participant selected Terra or Sol. Provider calls and model outputs were genuine; the bug affects only the internal dollar ledger and cost rankings.

Because the registered Terra prices are exactly 10× Luna and Sol prices exactly 25× Luna across uncached input, cached input and output, the saved per-result costs can be corrected exactly without another model call. The reconciliation script reads every affected saved result, identifies its participant model, applies the corresponding multiplier and adds only the under-recorded difference to the global campaign ledger.

The committed reconciliation added `$3.53455452` of previously unrecorded cost:

- development comparison: `$0.24856918` recorded → `$1.59387658` corrected;
- model promotion: `$0.1248406` → `$1.248406`;
- validation v1: `$0.0463594` → `$0.463594`;
- policy-v2 development regression: `$0.07204968` → `$0.7204968`.

Correct cumulative paid-model spend is now `$15.81897132`, leaving `$9.18102868` under the fixed `$25` ceiling. Future experiments must use `pricingForModel()` from the central registry.
