import { digest } from "../../core/canonical.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function object(properties) { return { type: "object", properties, required: Object.keys(properties), additionalProperties: false }; }

function candidateSchema({ brief, allowedModelFamilies, parentFingerprints, provenanceKind }) {
  return object({
    id: { type: "string", minLength: 1 },
    roleId: { type: "string", enum: [brief.id] },
    model: object({ family: { type: "string", enum: allowedModelFamilies }, tier: { type: "string" } }),
    instructions: object({ style: { type: "string" }, emphasis: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 } }),
    context: object({ sources: { type: "array", items: { type: "string", enum: brief.environment.contextSources }, minItems: 1 }, selection: { type: "string" } }),
    tools: { type: "array", items: { type: "string", enum: brief.environment.tools }, minItems: 1 },
    memory: object({ kind: { type: "string" }, scope: { type: "string" } }),
    authority: object({ allowedActions: { type: "array", items: { type: "string", enum: brief.authority.allowedActions } } }),
    escalation: object({ enabled: { type: "boolean", enum: [true] }, threshold: { type: "number", minimum: 0, maximum: 1 }, mode: { type: "string" } }),
    verifier: object({ kind: { type: "string", enum: ["independent-external-state"] }, binding: { type: "string", enum: [brief.successCriteria.verifierId] } }),
    limits: object({ maxCostPerTaskUsd: { type: "number", exclusiveMinimum: 0, maximum: brief.priorities.maxCostPerTaskUsd }, maxLatencyMs: { type: "number", exclusiveMinimum: 0, maximum: brief.priorities.maxLatencyMs } }),
    strategy: object({ qualityWeight: { type: "number", minimum: 0 }, costWeight: { type: "number", minimum: 0 }, speedWeight: { type: "number", minimum: 0 }, riskTolerance: { type: "number", minimum: 0 }, requireCompleteContext: { type: "boolean" } }),
    provenance: object({ kind: { type: "string", enum: [provenanceKind] }, parents: { type: "array", items: { type: "string", enum: parentFingerprints }, minItems: 1 }, rationale: { type: "string" } }),
    version: { type: "string" },
  });
}

function actionFormat({ brief, allowedModelFamilies, parents, maximumActions, provenanceKind, armId, round }) {
  const fingerprints = parents.map((candidate) => candidate.fingerprint);
  const action = object({
    kind: { type: "string", enum: ["retain", "revise", "switch-model", "fork"] },
    parentFingerprint: { type: "string", enum: fingerprints },
    rationale: { type: "string" },
    candidate: { anyOf: [{ type: "null" }, candidateSchema({ brief, allowedModelFamilies, parentFingerprints: fingerprints, provenanceKind })] },
  });
  return {
    type: "json_schema",
    name: `das004_b2_${armId.replace(/[^a-z0-9]+/gi, "_")}_round_${round}`,
    schema: object({ actions: { type: "array", items: action, minItems: 1, maxItems: maximumActions } }),
  };
}

function parse(output) { return typeof output === "string" ? JSON.parse(output) : structuredClone(output); }

function requireUniqueValues(values, label) {
  requireCondition(Array.isArray(values), `${label} must be an array`);
  requireCondition(new Set(values).size === values.length, `${label} contains duplicate values`);
}

function assertStructuredOutputSemantics(actions) {
  for (const [index, action] of actions.entries()) {
    if (!action?.candidate) continue;
    requireUniqueValues(action.candidate.context?.sources, `actions[${index}].candidate.context.sources`);
    requireUniqueValues(action.candidate.tools, `actions[${index}].candidate.tools`);
    requireUniqueValues(action.candidate.authority?.allowedActions, `actions[${index}].candidate.authority.allowedActions`);
    requireUniqueValues(action.candidate.provenance?.parents, `actions[${index}].candidate.provenance.parents`);
  }
}

function sharedInstruction() {
  return [
    "Return only the strict structured response.",
    "You are engineering a complete bounded specialist, not writing a one-off answer to a case.",
    "Use only the supplied role, tools, context, policies, authority, verifier and model allowlist.",
    "Never grant authority, remove independent verification or copy hidden assumptions into the candidate.",
    "Development feedback is externally verified but may be noisy and incomplete; improve general operating rules rather than memorizing case ids or literal worker names.",
    "A retain action must set candidate to null. Every other action must return one complete candidate with the exact parent fingerprint in provenance.parents.",
    "Revise keeps the parent's model. Switch-model changes only model.family/tier. Fork may alter several justified dimensions.",
    "Candidate ids and versions must be new. Keep instructions concise enough to execute reliably.",
  ].join(" ");
}

function armInstruction(armId) {
  if (armId === "das") return [
    "Operate the actual DAS bounded candidate-search procedure.",
    "Diagnose verifier-grounded failure patterns, preserve hard safety invariants, then search a deliberately diverse small portfolio across instruction hierarchy, context selection, tools, memory, confidence, limits, model and strategy.",
    "Prefer material architecture differences over cosmetic wording changes, compare the complete beam, and retain a parent when no plausible change is better.",
  ].join(" ");
  return [
    "Act as a genuinely strong adaptive AI agent engineer.",
    "Inspect all available development feedback, critique the current full package, and use your best judgment to retain, revise, switch model or fork.",
    "You may change any permitted package dimension and may explore multiple plausible designs; do not act like a fixed prompt baseline.",
    "Be skeptical of brittle case patches, unnecessary complexity and expensive model switches.",
  ].join(" ");
}

export class ModelAdaptiveDesigner {
  constructor({ armId, brief, gateway, engineeringModel = "gpt-5.6-terra", maxOutputTokens = 4_000, purposePrefix = "das004-b2" }) {
    requireCondition(["das", "adaptive-engineer"].includes(armId), "Unknown adaptive designer arm");
    this.armId = armId;
    this.purposePrefix = purposePrefix;
    this.brief = brief;
    this.gateway = gateway;
    this.engineeringModel = engineeringModel;
    this.maxOutputTokens = maxOutputTokens;
  }

  #request({ round, parents, developmentFeedback, allowedModelFamilies, maximumChildrenPerParent }) {
    const maximumActions = Math.max(1, Math.min(parents.length * maximumChildrenPerParent, 4));
    const provenanceKind = this.armId === "das" ? "das-compiler-generated" : "adaptive-engineer-generated";
    return {
      model: this.engineeringModel,
      purpose: `${this.purposePrefix}-${this.armId}-engineering-round-${round}`,
      input: {
        instruction: `${sharedInstruction()} ${armInstruction(this.armId)}`,
        comparisonArm: this.armId,
        round,
        role: this.brief,
        parents,
        developmentFeedback,
        allowedModelFamilies,
        maximumActions,
        completeCandidateDimensions: ["model", "instructions", "context", "tools", "memory", "authority", "escalation", "verifier", "limits", "strategy", "provenance", "version"],
        prohibitedInference: ["confirmation cases", "customer evidence", "authority outside the role", "self-verification"],
      },
      responseFormat: actionFormat({ brief: this.brief, allowedModelFamilies, parents, maximumActions, provenanceKind, armId: this.armId, round }),
      maxOutputTokens: this.maxOutputTokens,
      reasoningEffort: "medium",
    };
  }

  async estimate({ round, beam, maximumActions }) {
    // The controller intentionally supplies only invariant summaries at the
    // estimate boundary. Reserve a conservative whole-call maximum rather
    // than underestimating the later full-candidate prompt.
    void round; void beam; void maximumActions;
    return { maximumUsd: 0.125, maximumCalls: 1 };
  }

  async propose({ round, parents, developmentFeedback, allowedModelFamilies, maximumChildrenPerParent, hiddenCases }) {
    requireCondition(hiddenCases == null, "Adaptive designer received hidden confirmation material");
    const request = this.#request({ round, parents, developmentFeedback, allowedModelFamilies, maximumChildrenPerParent });
    const projectedUsd = this.gateway.projectCost(request);
    requireCondition(projectedUsd <= 0.125 + 1e-12, `Engineering request exceeds the preregistered per-call reserve: $${projectedUsd}`);
    const response = await this.gateway.generate(request);
    const payload = parse(response.output);
    requireCondition(Array.isArray(payload.actions), "Adaptive designer returned no actions");
    assertStructuredOutputSemantics(payload.actions);
    return {
      actions: payload.actions,
      accounting: { actualUsd: response.actualUsd ?? 0, actualCalls: 1 },
      responseReceipt: { responseHash: digest(response.output), model: response.resolvedModel ?? response.model, usage: response.usage, cached: response.cached === true },
    };
  }
}
