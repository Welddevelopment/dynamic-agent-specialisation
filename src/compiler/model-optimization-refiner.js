import { digest } from "../core/canonical.js";
import { validateCandidate, differenceDimensions } from "./candidate.js";
import { candidatePortfolioResponseFormat } from "./model-architect.js";

function parse(value) { return typeof value === "string" ? JSON.parse(value) : structuredClone(value); }

export class ModelOptimizationRefiner {
  constructor({ gateway, maxOutputTokens = 8_000 }) { this.gateway = gateway; this.maxOutputTokens = maxOutputTokens; }
  async refine({ brief, parent, diagnosis, contract, round }) {
    const response = await this.gateway.generate({
      model: "candidate-optimization-policy",
      purpose: "target-driven-specialist-optimization",
      input: {
        instruction: "Return exactly one complete revised candidate. Use only the supplied development measurements. Read the independent verification summary for each failed case and convert each precise missing external outcome into an explicit completion rule; never guess from the score alone. Preserve every passing safety and outcome behaviour, the exact model family, authority ceiling, independent verifier and bounded role. Diagnose redundant context, repeated reads, unnecessary tool use or overly long instructions only where measurements support it. Make the smallest high-potential revision toward every missed target. Do not speculate about validation, adversarial or unseen cases. Do not weaken the target or quality floor.",
        contract,
        brief,
        parent,
        observableDevelopmentDiagnosis: diagnosis,
      },
      responseFormat: candidatePortfolioResponseFormat(brief, 1),
      maxOutputTokens: this.maxOutputTokens,
    });
    const payload = parse(response.output);
    if (!Array.isArray(payload.candidates) || payload.candidates.length !== 1) throw new Error("Optimization refiner returned the wrong candidate count");
    const child = payload.candidates[0];
    child.id = `${parent.id}:opt-${round}`;
    child.version = `${Number(parent.version?.split(".")[0] ?? 1) + 1}.0.0`;
    child.model = structuredClone(parent.model);
    child.provenance = {
      kind: "compiler-refinement",
      parents: [parent.fingerprint ?? digest(parent)],
      rationale: "Target-driven revision grounded in visible development quality, cost, time and tool-use measurements.",
      diagnosisHash: digest(diagnosis),
      contractId: contract.id,
      round,
    };
    const validation = validateCandidate(child, brief);
    if (!validation.valid) throw new Error(`Optimized candidate failed contract: ${validation.reasons.join(",")}`);
    const differences = differenceDimensions(parent, validation.candidate);
    if (!differences.length) throw new Error("Optimization refiner produced no material configuration change");
    return { candidate: validation.candidate, differences, modelReceipt: { provider: response.provider, model: response.model, resolvedModel: response.resolvedModel, actualUsd: response.actualUsd, elapsedMs: response.elapsedMs } };
  }
}
