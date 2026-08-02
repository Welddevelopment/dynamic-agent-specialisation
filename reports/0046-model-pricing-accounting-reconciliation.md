# Model pricing accounting reconciliation

Date: 2026-08-02

Paid calls are paused until this committed reconciliation runs.

Four RevOps experiments injected Luna's `$0.20 / $1.20` input/output rates even when a participant selected Terra or Sol. Provider calls and model outputs were genuine; the bug affects only the internal dollar ledger and cost rankings.

Because the registered Terra prices are exactly 10× Luna and Sol prices exactly 25× Luna across uncached input, cached input and output, the saved per-result costs can be corrected exactly without another model call. The reconciliation script reads every affected saved result, identifies its participant model, applies the corresponding multiplier and adds only the under-recorded difference to the global campaign ledger.

Future experiments must use `pricingForModel()` from the central registry. The corrected cumulative amount will be written here and to `AGENTS.md` after the reconciliation is executed.
