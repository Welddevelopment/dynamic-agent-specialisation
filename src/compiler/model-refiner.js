import { digest } from "../core/canonical.js";
import { validateCandidate, differenceDimensions } from "./candidate.js";
import { candidatePortfolioResponseFormat } from "./model-architect.js";

function parse(value) { return typeof value === "string" ? JSON.parse(value) : structuredClone(value); }

export class ModelCandidateRefiner {
  constructor({ gateway, maxOutputTokens = 8_000 }) { this.gateway = gateway; this.maxOutputTokens = maxOutputTokens; }
  async refine({ brief, parent, developmentFailures, preserveModel = false, preserveInstructionItems = false, preserveContext = false }) {
    const response = await this.gateway.generate({
      model: "candidate-refiner-policy",
      purpose: "controlled-specialist-refinement",
      input: {
        instruction: `Return exactly one complete revised candidate. Correct only weaknesses directly supported by the supplied visible development failures. Preserve the role, authority ceiling, independent verifier, and bounded tools.${preserveModel ? " Preserve the exact model family and tier." : ""}${preserveInstructionItems ? " Retain every existing parent instructions.emphasis item exactly and unmodified; append only the minimum new item needed, up to the schema limit." : ""}${preserveContext ? " Preserve the exact parent context object; express the repair only through an added instruction item." : ""} Do not use or speculate about validation, adversarial, or unseen cases. Make the smallest useful configuration change.`,
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
    child.version = `${Number(parent.version?.split(".")[0] ?? 1) + 1}.0.0`;
    if (preserveModel) child.model = structuredClone(parent.model);
    if (preserveContext) child.context = structuredClone(parent.context);
    if (preserveInstructionItems && !(parent.instructions?.emphasis ?? []).every((item) => child.instructions?.emphasis?.includes(item))) throw new Error("Refined candidate removed a protected passing instruction");
    child.provenance = {
      kind: "compiler-refinement",
      parents: [parent.fingerprint ?? digest(parent)],
      rationale: "Minimum revision grounded only in preserved visible development failures.",
      modelPreserved: preserveModel,
      instructionItemsPreserved: preserveInstructionItems,
      contextPreserved: preserveContext,
      failureEvidence: developmentFailures.map((failure) => ({ caseId: failure.caseId, evidenceHash: digest(failure) })),
    };
    const validation = validateCandidate(child, brief);
    if (!validation.valid) throw new Error(`Refined candidate failed contract: ${validation.reasons.join(",")}`);
    const differences = differenceDimensions(parent, validation.candidate);
    if (!differences.length) throw new Error("Refiner produced no material configuration change");
    return { candidate: validation.candidate, differences, modelReceipt: { provider: response.provider, model: response.model, resolvedModel: response.resolvedModel, actualUsd: response.actualUsd } };
  }
}
