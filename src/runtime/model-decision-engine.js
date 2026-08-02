function parse(value) { return typeof value === "string" ? JSON.parse(value) : structuredClone(value); }

function valueSchema(kind) {
  if (kind === "string") return { type: "string" };
  if (kind === "number") return { type: "number" };
  if (kind === "nullable-string") return { type: ["string", "null"] };
  throw new Error(`Unsupported tool input schema kind: ${kind}`);
}

function inputSchema(tool) {
  const fields = tool.inputSchema ?? {};
  const properties = Object.fromEntries(Object.entries(fields).map(([name, kind]) => [name, valueSchema(kind)]));
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

export function runtimeDecisionResponseFormat(tools, blockers = ["no-permitted-route", "approval-required"]) {
  const possibleInputs = tools.map(inputSchema);
  if (!possibleInputs.length) possibleInputs.push({ type: "object", properties: {}, required: [], additionalProperties: false });
  return {
    type: "json_schema",
    name: "specialist_runtime_decision",
    schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["tool", "complete", "escalate"] },
        name: { type: ["string", "null"], enum: [...tools.map((tool) => tool.name), null] },
        input: { anyOf: [...possibleInputs, { type: "null" }] },
        reason: { type: ["string", "null"] },
        blocker: { type: ["string", "null"], enum: [...blockers, null] },
      },
      required: ["kind", "name", "input", "reason", "blocker"],
      additionalProperties: false,
    },
  };
}

export class ModelDecisionEngine {
  constructor({ gateway }) { this.gateway = gateway; }
  async next({ candidate, goal, turn, observations, memory, tools }) {
    const response = await this.gateway.generate({
      model: candidate.model.family,
      purpose: "specialist-runtime-decision",
      input: { instruction: "Choose exactly one next decision. For a tool decision, provide its exact permitted name and input, with null for optional filters you do not use; reason and blocker must be null. For complete, set name, input, reason, and blocker to null. For escalate, set name and input to null, give a precise reason, and select the exact blocker. Never claim completion until the external state should satisfy the entire goal. Never escalate merely because investigation is unfinished.", instructions: candidate.instructions, goal, turn, boundedContext: candidate.context, observations, memory, tools, authority: candidate.authority, escalation: candidate.escalation },
      responseFormat: runtimeDecisionResponseFormat(tools),
      maxOutputTokens: 1_200,
    });
    const decision = parse(response.output);
    if (!decision || !["tool", "complete", "escalate"].includes(decision.kind)) throw new Error("Model returned an invalid decision kind");
    if (decision.kind === "tool" && (typeof decision.name !== "string" || !decision.input || typeof decision.input !== "object")) throw new Error("Model returned an invalid tool decision");
    if (decision.kind === "escalate" && (typeof decision.reason !== "string" || typeof decision.blocker !== "string")) throw new Error("Model returned an invalid escalation");
    if (decision.kind === "tool") return { kind: "tool", name: decision.name, input: decision.input };
    if (decision.kind === "escalate") return { kind: "escalate", reason: decision.reason, blocker: decision.blocker };
    return { kind: "complete" };
  }
}
