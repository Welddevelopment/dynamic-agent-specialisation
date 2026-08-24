import { digest } from "../../core/canonical.js";
import { validateCandidate } from "../../compiler/candidate.js";
import { ModelCandidateArchitect } from "../../compiler/model-architect.js";
import { ModelCandidateRefiner } from "../../compiler/model-refiner.js";

/**
 * The DAS arm of DAS-004/B3 — the real model-backed compiler, not a persona.
 *
 * Erratum 0111a: B2's "DAS arm" was `ModelAdaptiveDesigner` given a three-sentence persona
 * that told a model to imitate the DAS procedure. The compiler never executed. This arm
 * actually calls `ModelCandidateArchitect.propose` and `ModelCandidateRefiner.refine`, which
 * is the same model-backed compiler path the paid Level 1 three-role campaign used
 * (`src/experiments/piece3-support-viability.js:31`).
 *
 * NOT `compileSpecialist()`. That is the deterministic reference pipeline: four hard-coded
 * variants carrying `model.family: "model-policy"`, evaluated by `planWorkItem` with zero
 * model calls, and it requires a role object (`createWorld`, `verify`, `cases.development`,
 * `unseen.release`, `registry`) that this campaign's brief does not have. Running it as the
 * DAS arm would put a $0 deterministic process against a paid model process and break the
 * equal-resources premise the comparison rests on.
 *
 * ── Two declared bookkeeping steps, stated here because they are not design decisions ──
 *
 * 1. MODEL NORMALIZATION. `candidatePortfolioResponseFormat` leaves `model.family` free, but
 *    the protocol freezes an allowlist. Generated candidates are normalized onto the frozen
 *    execution family, exactly as the Level 1 campaign did. The compiler chooses the design;
 *    the harness chooses nothing but which permitted engine executes it.
 * 2. LINEAGE STAMPING. The controller requires `provenance.parents` to contain the exact
 *    parent fingerprint. The architect generates a portfolio, not a parent-linked action, so
 *    the adapter records lineage. It never edits instructions, context, tools, memory,
 *    authority, escalation, limits or strategy — the scored design dimensions.
 *
 * Neither step invents design. Both are disclosed in the preregistration.
 */

function requireCondition(condition, message) { if (!condition) throw new Error(message); }

export const B3_COMPILER_PROVENANCE_KIND = "das-compiler-generated";

export class CompilerArchitectDesigner {
  constructor({ armId = "das", brief, gateway, executionModelFamily, executionModelTier = "standard", minimumCandidates = 2, maxOutputTokens = 12_000, knowledgeEntries = [] }) {
    requireCondition(armId === "das", "The compiler arm is the das arm");
    requireCondition(brief && gateway, "Compiler architect designer needs a brief and a gateway");
    requireCondition(executionModelFamily, "Compiler architect designer needs a frozen execution model family");
    this.armId = armId;
    this.brief = brief;
    this.gateway = gateway;
    this.executionModelFamily = executionModelFamily;
    this.executionModelTier = executionModelTier;
    this.minimumCandidates = minimumCandidates;
    this.knowledgeEntries = structuredClone(knowledgeEntries);
    // Public: the runner installs the attested entry point directly on this instance, so
    // the declaration in the preregistration is the code that runs.
    this.architect = new ModelCandidateArchitect({ gateway, minimumCandidates, maxOutputTokens, guardVocabulary: true });
    this.refiner = new ModelCandidateRefiner({ gateway, maxOutputTokens });
    this.calls = { architect: 0, refiner: 0 };
  }

  /** The declared entry points, for the preregistration's attestation block. */
  static entryPoints() {
    return [
      { armId: "das", module: "src/compiler/model-architect.js", exportName: "ModelCandidateArchitect", methodName: "propose" },
    ];
  }

  async estimate({ round, beam, maximumActions }) {
    void round; void beam; void maximumActions;
    // One whole architect (or refiner) call, reserved conservatively — the same reserve the
    // adaptive arm declares, so neither arm gets a cheaper reservation than the other.
    return { maximumUsd: 0.125, maximumCalls: 1 };
  }

  #normalize({ raw, parent, index, round }) {
    const candidate = structuredClone(raw);
    delete candidate.fingerprint;
    candidate.roleId = this.brief.id;
    candidate.id = `b3-compiler-r${round}-${index + 1}`;
    candidate.version = `1.0.${round}`;
    candidate.model = { family: this.executionModelFamily, tier: this.executionModelTier };
    candidate.verifier = { kind: "independent-external-state", binding: this.brief.successCriteria.verifierId };
    candidate.provenance = {
      kind: B3_COMPILER_PROVENANCE_KIND,
      parents: [parent.fingerprint],
      rationale: String(raw.provenance?.rationale ?? "Compiler-generated complete candidate."),
    };
    const validation = validateCandidate(candidate, this.brief);
    return validation.valid ? validation.candidate : null;
  }

  async propose({ round, parents, developmentFeedback, allowedModelFamilies, maximumChildrenPerParent, hiddenCases }) {
    requireCondition(hiddenCases == null, "Compiler arm received hidden confirmation material");
    requireCondition(allowedModelFamilies.includes(this.executionModelFamily), "Frozen execution family is outside the campaign allowlist");
    const parent = parents[0];
    requireCondition(parent?.fingerprint, "Compiler arm needs a frozen parent");

    const failures = (developmentFeedback ?? []).filter((row) => row && row.passed === false);

    // Round 1 generates a portfolio. Later rounds refine against verifier-grounded failures —
    // this is the compiler's own diagnose-then-repair path, not a free-form redesign.
    let rawCandidates = [];
    let receipt = null;
    if (round <= 1 || !failures.length) {
      const proposal = await this.architect.propose({
        brief: this.brief,
        knowledgeEntries: this.knowledgeEntries,
        priorSpecialists: parents.map((candidate) => ({ id: candidate.id, version: candidate.version, compatibility: null, evidence: null })),
      });
      this.calls.architect += 1;
      rawCandidates = proposal.candidates;
      receipt = proposal.modelReceipt;
      requireCondition(rawCandidates.length > 0, "Model architect returned no valid candidates");
    } else {
      const refined = await this.refiner.refine({ brief: this.brief, parent, developmentFailures: failures });
      this.calls.refiner += 1;
      rawCandidates = refined.candidate ? [refined.candidate] : [];
      receipt = refined.modelReceipt ?? null;
    }

    const limit = Math.max(1, Math.min(rawCandidates.length, maximumChildrenPerParent * parents.length, 4));
    const actions = [];
    for (const [index, raw] of rawCandidates.slice(0, limit).entries()) {
      const candidate = this.#normalize({ raw, parent, index, round });
      if (!candidate) continue;
      if (candidate.fingerprint === parent.fingerprint) continue;
      actions.push({
        kind: "fork",
        parentFingerprint: parent.fingerprint,
        rationale: candidate.provenance.rationale,
        candidate,
      });
    }

    // Fallback only. Campaign-level retain-existing is NOT decided here — the incumbent sits
    // in the beam and wins by ranking if nothing beats it, which is how the Level 1 campaigns
    // produced two retain-existing outcomes. This branch covers the narrower case where the
    // compiler generated nothing that validates against the frozen role contract.
    if (!actions.length) {
      actions.push({ kind: "retain", parentFingerprint: parent.fingerprint, rationale: "No generated candidate validated against the frozen role contract; retaining the existing agent.", candidate: null });
    }

    return {
      actions,
      accounting: { actualUsd: receipt?.actualUsd ?? 0, actualCalls: 1 },
      responseReceipt: {
        responseHash: digest({ round, actions: actions.map((action) => action.candidate?.fingerprint ?? "retain") }),
        model: receipt?.model ?? null,
        provider: receipt?.provider ?? null,
        cached: receipt?.cached === true,
        compilerPath: round <= 1 || !failures.length ? "ModelCandidateArchitect.propose" : "ModelCandidateRefiner.refine",
      },
    };
  }
}
