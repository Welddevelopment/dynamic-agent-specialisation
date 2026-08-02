function parse(value) { return typeof value === "string" ? JSON.parse(value) : structuredClone(value); }

export class ModelDecisionEngine {
  constructor({ gateway }) { this.gateway = gateway; }
  async next({ candidate, goal, turn, observations, memory, tools }) {
    const response = await this.gateway.generate({
      model: candidate.model.family,
      purpose: "specialist-runtime-decision",
      input: { instruction: "Return JSON only using exactly one permitted decision shape.", instructions: candidate.instructions, goal, turn, boundedContext: candidate.context, observations, memory, tools, authority: candidate.authority, escalation: candidate.escalation, decisionShapes: [{ kind: "tool", name: "defined tool name", input: {} }, { kind: "complete" }, { kind: "escalate", reason: "precise blocker" }] },
      responseFormat: { oneOf: [{ kind: "tool", name: "string", input: "object" }, { kind: "complete" }, { kind: "escalate", reason: "string" }] },
    });
    const decision = parse(response.output);
    if (!decision || !["tool", "complete", "escalate"].includes(decision.kind)) throw new Error("Model returned an invalid decision kind");
    if (decision.kind === "tool" && (typeof decision.name !== "string" || !decision.input || typeof decision.input !== "object")) throw new Error("Model returned an invalid tool decision");
    if (decision.kind === "escalate" && typeof decision.reason !== "string") throw new Error("Model returned an invalid escalation");
    return decision;
  }
}
