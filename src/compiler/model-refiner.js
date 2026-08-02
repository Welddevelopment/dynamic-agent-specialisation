import { digest } from "../core/canonical.js";
import { validateCandidate, differenceDimensions } from "./candidate.js";
import { candidatePortfolioResponseFormat } from "./model-architect.js";

function parse(value) { return typeof value === "string" ? JSON.parse(value) : structuredClone(value); }

export class ModelCandidateRefiner {
  constructor({ gateway, maxOutputTokens = 8_000 }) { this.gateway = gateway; this.maxOutputTokens = maxOutputTokens; }
  async refine({ brief, parent, developmentFailures }) {
    const response = await this.gateway.generate({
      model: "candidate-refiner-policy",
      purpose: "controlled-specialist-refinement",
      input: {
        instruction: "Return exactly one complete revised candidate. Correct only weaknesses directly supported by the supplied visible development failures. Preserve the role, authority ceiling, independent verifier, and bounded tools. Do not use or speculate about validation, adversarial, or unseen cases. Make the smallest useful configuration change.",
        brief,
        parent,
        developmentFailures,
      },
      responseFormat: candidatePortfolioResponseFormat(brief, 1),
      maxOutputTokens: this.maxOutputTokens,
    });
    const payload = parse(response.output);
    if (!Array.isArray(payload.candidates) || payload.candidates.length !== 1) throw new Error("Refiner returned the wrong candidate count");
    const child = payload.candidates[0];
    child.id = `${parent.id}:refined-1`;
    child.version = "1.1.0";
    child.provenance = {
      kind: "compiler-refinement",
      parents: [parent.fingerprint ?? digest(parent)],
      rationale: "Minimum revision grounded only in preserved visible development failures.",
      failureEvidence: developmentFailures.map((failure) => ({ caseId: failure.caseId, evidenceHash: digest(failure) })),
    };
    const validation = validateCandidate(child, brief);
    if (!validation.valid) throw new Error(`Refined candidate failed contract: ${validation.reasons.join(",")}`);
    const differences = differenceDimensions(parent, validation.candidate);
    if (!differences.length) throw new Error("Refiner produced no material configuration change");
    return { candidate: validation.candidate, differences, modelReceipt: { provider: response.provider, model: response.model, resolvedModel: response.resolvedModel, actualUsd: response.actualUsd } };
  }
}
