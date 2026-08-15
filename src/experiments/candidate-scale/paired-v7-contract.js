// V7 intentionally reuses the exact V6 candidate contract. The recovery changes
// campaign isolation and locking, not the scientific candidate semantics.
export {
  PAIRED_V6_ARCHITECT_INSTRUCTION as PAIRED_V7_ARCHITECT_INSTRUCTION,
  PAIRED_V6_CONTEXT_MODE_SCHEDULE as PAIRED_V7_CONTEXT_MODE_SCHEDULE,
  pairedV6ContextModeForBatch as pairedV7ContextModeForBatch,
  candidatePortfolioResponseFormatV6 as candidatePortfolioResponseFormatV7,
  canonicalizeV6RawCandidate as canonicalizeV7RawCandidate,
  assertPairedV6ContextInvariant as assertPairedV7ContextInvariant,
  pairedV6ContractHash as pairedV7ContractHash,
} from "./paired-v6-contract.js";
