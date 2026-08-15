import { digest } from "../../core/canonical.js";
import { compactPriorDesignMemory } from "./batched-architect.js";
import { candidatePortfolioResponseFormatV6, canonicalizeV6RawCandidate, pairedV6ContextModeForBatch, PAIRED_V6_ARCHITECT_INSTRUCTION } from "./paired-v6-contract.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function parse(value) { return typeof value === "string" ? JSON.parse(value) : structuredClone(value); }

export class PairedV6ModelBatchArchitect {
  constructor({ gateway, model = "candidate-architect-policy", maxOutputTokens = 16_000, reasoningEffort = "low" }) {
    requireCondition(gateway && typeof gateway.generate === "function", "v6 architect requires a metered gateway");
    this.gateway = gateway; this.model = model; this.maxOutputTokens = maxOutputTokens; this.reasoningEffort = reasoningEffort;
  }

  async proposeBatch({ brief, knowledgeEntries = [], priorSpecialists = [], priorDesignMemory, batchIndex, count }) {
    const contextMode = pairedV6ContextModeForBatch(batchIndex);
    const request = {
      model: this.model,
      purpose: "candidate-scale-v6-construct-contract-safe-specialist-batch",
      input: { instruction: PAIRED_V6_ARCHITECT_INSTRUCTION, experiment: { batchIndex, requestedCount: count, contextMode }, frozenContextSources: brief.environment.contextSources, brief, knowledgeEntries, priorSpecialists: priorSpecialists.map((entry) => ({ id: entry.id, version: entry.version, compatibility: entry.compatibility, evidence: entry.evidence })), priorDesignMemory },
      responseFormat: candidatePortfolioResponseFormatV6(brief, count, contextMode),
      maxOutputTokens: this.maxOutputTokens,
      reasoningEffort: this.reasoningEffort,
    };
    const response = await this.gateway.generate(request);
    const payload = parse(response.output);
    requireCondition(Array.isArray(payload.candidates) && payload.candidates.length === count, `v6 architect batch ${batchIndex} returned ${payload.candidates?.length ?? 0}/${count} packages`);
    const candidates = payload.candidates.map((candidate) => canonicalizeV6RawCandidate(candidate, brief, contextMode));
    return { candidates, requestHash: digest(request), modelReceipt: { provider: response.provider, model: response.model, resolvedModel: response.resolvedModel ?? response.model, actualUsd: Number(response.actualUsd ?? 0), elapsedMs: Number(response.elapsedMs ?? 0), cached: response.cached === true, contextMode } };
  }
}

export class DeterministicPairedV6BatchArchitect {
  constructor({ sourceArchitect }) { this.sourceArchitect = sourceArchitect; this.generated = []; }
  async proposeBatch({ brief, priorDesignMemory, batchIndex, count }) {
    const contextMode = pairedV6ContextModeForBatch(batchIndex);
    const raw = await this.sourceArchitect.proposeBatch({ brief, priorDesignMemory, batchIndex, count });
    const candidates = raw.candidates.map((candidate) => {
      const value = structuredClone(candidate); delete value.fingerprint;
      const selectiveSources = brief.environment.contextSources.slice(0, Math.max(1, brief.environment.contextSources.length - 1));
      value.context = contextMode === "complete" ? { sourceMode: "complete", selection: value.context.selection } : { sourceMode: "selective", sources: selectiveSources, selection: value.context.selection };
      const { requireCompleteContext, ...strategy } = value.strategy; value.strategy = strategy;
      return canonicalizeV6RawCandidate(value, brief, contextMode);
    });
    this.generated.push(...candidates);
    return { candidates, requestHash: digest({ deterministic: true, batchIndex, count, contextMode, priorDesignMemoryHash: compactPriorDesignMemory(this.generated.slice(0, -candidates.length)).memoryHash }), modelReceipt: { provider: "deterministic-v6-fixture", model: "none", actualUsd: 0, elapsedMs: 0, cached: false, contextMode } };
  }
}
