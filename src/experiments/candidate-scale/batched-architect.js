import { digest } from "../../core/canonical.js";
import { validateCandidate } from "../../compiler/candidate.js";
import { candidatePortfolioResponseFormat } from "../../compiler/model-architect.js";
import { analyzeCandidateDiversity, candidateArchitectureSignature, candidateDesignFingerprint } from "./diversity.js";

export const CANDIDATE_SCALE_ARCHITECT_INSTRUCTION = "Return JSON only. Construct exactly the requested number of complete specialist packages. Every package must satisfy the supplied candidate contract and remain inside authority. Use the compact prior-design memory to avoid exact or cosmetic duplicates: vary the actual operating architecture, not merely ids or wording. Prefer plausible high-potential designs over random combinations. Do not infer credentials or success criteria. The independent verifier binding is fixed. Keep each package concise enough for bounded batch generation.";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function parse(value) {
  return typeof value === "string" ? JSON.parse(value) : structuredClone(value);
}

export function normalizeCandidateExecutionModel(candidate, brief, executionModel) {
  const value = structuredClone(candidate);
  delete value.fingerprint;
  value.model = structuredClone(executionModel);
  value.provenance = {
    ...value.provenance,
    proposedModel: structuredClone(candidate.model),
    normalizedExecutionModel: executionModel.family,
  };
  const validation = validateCandidate(value, brief);
  requireCondition(validation.valid, `Execution-normalized candidate ${candidate.id} is invalid: ${validation.reasons.join(",")}`);
  return validation.candidate;
}

export function compactPriorDesignMemory(candidates, { maximumExemplars = 24 } = {}) {
  const diversity = analyzeCandidateDiversity(candidates);
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const representatives = diversity.meaningfulRepresentatives
    .slice(0, maximumExemplars)
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((candidate) => ({
      designFingerprint: candidateDesignFingerprint(candidate),
      architectureSignature: candidateArchitectureSignature(candidate),
      model: candidate.model,
      instructionStyle: candidate.instructions?.style,
      emphasis: candidate.instructions?.emphasis,
      contextSelection: candidate.context?.selection,
      toolCount: candidate.tools?.length ?? 0,
      memory: candidate.memory,
      escalation: candidate.escalation,
      strategy: candidate.strategy,
      limits: candidate.limits,
    }));
  const memory = {
    priorCandidateCount: candidates.length,
    exactUniqueDesigns: diversity.exactUniqueDesigns,
    meaningfulUniqueDesignCount: diversity.meaningfulUniqueDesignCount,
    architectureSignatureCount: diversity.architectureSignatureCount,
    omittedRepresentativeCount: Math.max(0, diversity.meaningfulRepresentatives.length - representatives.length),
    representatives,
  };
  return { ...memory, memoryHash: digest(memory) };
}

export class CandidateScaleModelBatchArchitect {
  constructor({ gateway, model = "candidate-architect-policy", maxOutputTokens = 16_000, reasoningEffort = "low" }) {
    requireCondition(gateway && typeof gateway.generate === "function", "Candidate-scale architect requires a metered gateway");
    this.gateway = gateway;
    this.model = model;
    this.maxOutputTokens = maxOutputTokens;
    this.reasoningEffort = reasoningEffort;
  }

  async proposeBatch({ brief, knowledgeEntries = [], priorSpecialists = [], priorDesignMemory, batchIndex, count }) {
    requireCondition(Number.isInteger(count) && count >= 1 && count <= 20, "Candidate-scale batches must contain 1-20 packages");
    const request = {
      model: this.model,
      purpose: "candidate-scale-construct-complete-specialist-batch",
      input: {
        instruction: CANDIDATE_SCALE_ARCHITECT_INSTRUCTION,
        experiment: { batchIndex, requestedCount: count, maximumBatchSize: 20 },
        brief,
        knowledgeEntries,
        priorSpecialists: priorSpecialists.map((entry) => ({ id: entry.id, version: entry.version, compatibility: entry.compatibility, evidence: entry.evidence })),
        priorDesignMemory,
      },
      responseFormat: candidatePortfolioResponseFormat(brief, count),
      maxOutputTokens: this.maxOutputTokens,
      reasoningEffort: this.reasoningEffort,
    };
    const response = await this.gateway.generate(request);
    const payload = parse(response.output);
    requireCondition(Array.isArray(payload.candidates) && payload.candidates.length === count, `Candidate architect batch ${batchIndex} returned ${payload.candidates?.length ?? 0}/${count} packages`);
    return {
      candidates: payload.candidates,
      requestHash: digest(request),
      modelReceipt: {
        provider: response.provider,
        model: response.model,
        resolvedModel: response.resolvedModel ?? response.model,
        actualUsd: Number(response.actualUsd ?? 0),
        elapsedMs: Number(response.elapsedMs ?? 0),
        cached: response.cached === true,
      },
    };
  }
}

export async function generateBatchedCandidatePortfolio({
  brief,
  architect,
  targetCount = 150,
  batchSize = 10,
  knowledgeEntries = [],
  priorSpecialists = [],
  executionModel = null,
  maximumExemplars = 24,
  maximumWallClockMs = Number.POSITIVE_INFINITY,
  onBatch = null,
}) {
  requireCondition(brief?.id, "Candidate-scale generation needs a compiled role brief");
  requireCondition(architect && typeof architect.proposeBatch === "function", "Candidate-scale generation needs a batch architect");
  requireCondition(Number.isInteger(targetCount) && targetCount >= 1 && targetCount <= 150, "Candidate-scale target must be between 1 and 150");
  requireCondition(Number.isInteger(batchSize) && batchSize >= 1 && batchSize <= 20, "Candidate-scale batch size must be between 1 and 20");
  requireCondition((Number.isFinite(maximumWallClockMs) && maximumWallClockMs > 0) || maximumWallClockMs === Number.POSITIVE_INFINITY, "Candidate-scale generation wall-clock limit must be positive");

  const accepted = [];
  const rejected = [];
  const batches = [];
  const startedAt = Date.now();
  for (let offset = 0, batchIndex = 1; offset < targetCount; batchIndex += 1) {
    requireCondition(Date.now() - startedAt <= maximumWallClockMs, "Candidate-scale architect reached its hard wall-clock limit before the next batch");
    const count = Math.min(batchSize, targetCount - offset);
    const priorDesignMemory = compactPriorDesignMemory(accepted, { maximumExemplars });
    const raw = await architect.proposeBatch({ brief, knowledgeEntries, priorSpecialists, priorDesignMemory, batchIndex, count });
    requireCondition(Date.now() - startedAt <= maximumWallClockMs, "Candidate-scale architect reached its hard wall-clock limit after a batch");
    requireCondition(Array.isArray(raw.candidates) && raw.candidates.length === count, `Batch ${batchIndex} did not return its exact bounded package count`);
    const batchAccepted = [];
    const batchRejected = [];
    for (const candidate of raw.candidates) {
      const validation = validateCandidate(candidate, brief);
      const record = { candidateId: String(candidate?.id ?? ""), reasons: validation.reasons, rawHash: digest(candidate) };
      if (!validation.valid) {
        batchRejected.push(record);
        rejected.push({ batchIndex, ...record });
        continue;
      }
      const normalized = executionModel ? normalizeCandidateExecutionModel(validation.candidate, brief, executionModel) : validation.candidate;
      batchAccepted.push(normalized);
      accepted.push(normalized);
    }
    const batch = {
      batchIndex,
      requestedCount: count,
      acceptedCount: batchAccepted.length,
      rejectedCount: batchRejected.length,
      priorDesignMemoryHash: priorDesignMemory.memoryHash,
      acceptedCandidateIds: batchAccepted.map((candidate) => candidate.id),
      rejected: batchRejected,
      requestHash: raw.requestHash ?? null,
      modelReceipt: raw.modelReceipt ?? { provider: "deterministic-fixture", model: "none", actualUsd: 0, elapsedMs: 0, cached: false },
    };
    batch.batchHash = digest(batch);
    batches.push(batch);
    await onBatch?.(structuredClone(batch));
    offset += count;
  }

  const duplicateIds = new Set();
  const seenIds = new Set();
  for (const candidate of accepted) {
    if (seenIds.has(candidate.id)) duplicateIds.add(candidate.id);
    seenIds.add(candidate.id);
  }
  requireCondition(!duplicateIds.size, `Candidate architect reused package ids: ${[...duplicateIds].join(",")}`);
  const diversity = analyzeCandidateDiversity(accepted);
  const receipt = {
    schemaVersion: "das.candidate-scale-batched-portfolio.v1",
    roleId: brief.id,
    targetCount,
    returnedCount: batches.reduce((sum, batch) => sum + batch.requestedCount, 0),
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    batchSize,
    batchCount: batches.length,
    executionModel: executionModel ? structuredClone(executionModel) : null,
    elapsedMs: Date.now() - startedAt,
    architectSpendUsd: batches.reduce((sum, batch) => sum + Number(batch.modelReceipt.actualUsd ?? 0), 0),
    batches,
    diversity,
    evidenceBoundary: "Candidate construction and contract validation only. No candidate performance, optimum portfolio size or customer value is implied.",
  };
  receipt.portfolioHash = digest({ candidates: accepted, rejected, receipt });
  return { candidates: accepted, rejected, receipt };
}
