// The V7 recovery campaign keeps the V6 architect request byte-for-byte
// compatible. Only the surrounding campaign namespace and writer lock change.
export {
  PairedV6ModelBatchArchitect as PairedV7ModelBatchArchitect,
  DeterministicPairedV6BatchArchitect as DeterministicPairedV7BatchArchitect,
} from "./paired-v6-architect.js";
