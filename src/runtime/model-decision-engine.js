function parse(value) { return typeof value === "string" ? JSON.parse(value) : structuredClone(value); }

function valueSchema(kind) {
  if (kind && typeof kind === "object" && !Array.isArray(kind)) return structuredClone(kind);
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
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["kind", "name", "input", "reason", "blocker", "confidence"],
      additionalProperties: false,
    },
  };
}

export class ModelDecisionEngine {
  constructor({ gateway }) { this.gateway = gateway; }
  async next({ candidate, goal, turn, observations, memory, tools, remainingCostUsd = Infinity, remainingLatencyMs = Infinity }) {
    const request = {
      model: candidate.model.family,
      purpose: "specialist-runtime-decision",
      input: { instruction: "Choose exactly one next decision. For a tool decision, provide its exact permitted name and input, with null for optional filters you do not use; reason and blocker must be null. For complete, set name, input, reason, and blocker to null. For escalate, set name and input to null, give a precise reason, and select the exact blocker. Report calibrated confidence from 0 to 1. If confidence would be below the configured threshold for acting or completing, escalate instead of acting. Never claim completion until the external state should satisfy the entire goal. Never escalate merely because investigation is unfinished.", instructions: candidate.instructions, goal, turn, boundedContext: candidate.context, observations, memory, tools, authority: candidate.authority, escalation: candidate.escalation, strategy: candidate.strategy, limits: candidate.limits, memoryPolicy: candidate.memory, remainingBudget: { modelCostUsd: Number.isFinite(remainingCostUsd) ? remainingCostUsd : null, latencyMs: Number.isFinite(remainingLatencyMs) ? remainingLatencyMs : null } },
      responseFormat: runtimeDecisionResponseFormat(tools),
      maxOutputTokens: 1_200,
    };
    const projectedUsd = this.gateway.projectCost(request);
    if (projectedUsd > remainingCostUsd) throw new Error("candidate-task-cost-limit-before-call");
    const response = await this.gateway.generate(request);
    const decision = parse(response.output);
    if (!decision || !["tool", "complete", "escalate"].includes(decision.kind)) throw new Error("Model returned an invalid decision kind");
    if (typeof decision.confidence !== "number" || decision.confidence < 0 || decision.confidence > 1) throw new Error("Model returned invalid confidence");
    if (decision.kind === "tool" && (typeof decision.name !== "string" || !decision.input || typeof decision.input !== "object")) throw new Error("Model returned an invalid tool decision");
    if (decision.kind === "escalate" && (typeof decision.reason !== "string" || typeof decision.blocker !== "string")) throw new Error("Model returned an invalid escalation");
    const metering = { actualUsd: response.actualUsd ?? 0, elapsedMs: response.elapsedMs ?? 0, cached: Boolean(response.cached) };
    if (decision.kind === "tool") return { kind: "tool", name: decision.name, input: decision.input, confidence: decision.confidence, metering };
    if (decision.kind === "escalate") return { kind: "escalate", reason: decision.reason, blocker: decision.blocker, confidence: decision.confidence, metering };
    return { kind: "complete", confidence: decision.confidence, metering };
  }
}
