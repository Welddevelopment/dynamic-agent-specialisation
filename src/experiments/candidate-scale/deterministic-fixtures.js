import { digest } from "../../core/canonical.js";

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function hashUnit(value) {
  return Number.parseInt(digest(value).slice(0, 8), 16) / 0xffff_ffff;
}

const STYLES = ["structured", "evidence-led", "route-first", "verification-first", "batch-auditor", "minimal-action"];
const CONTEXT_SELECTIONS = ["full-bounded", "relevance-ranked", "route-selected", "two-pass-evidence", "minimal-relevant"];
const MEMORY_KINDS = ["structured-task-ledger", "decision-and-outcome-ledger", "route-ledger", "compact-outcome-ledger", "evidence-checklist"];
const ESCALATION_MODES = ["precise-blocker", "finish-safe-then-handoff", "evidence-gap", "authority-boundary"];
const EMPHASIS = [
  ["external-outcome", "policy", "safe-completion"],
  ["evidence-order", "minimum-sufficient-action", "final-audit"],
  ["route-isolation", "no-cross-item-bleed", "completion-checklist"],
  ["authority", "uncertainty", "precise-escalation"],
  ["cost-aware-search", "duplicate-suppression", "external-outcome"],
  ["latency", "bounded-context", "minimum-sufficient-action"],
];
const STRATEGIES = [
  { qualityWeight: 0.74, costWeight: 0.12, speedWeight: 0.14, riskTolerance: 0.10 },
  { qualityWeight: 0.60, costWeight: 0.25, speedWeight: 0.15, riskTolerance: 0.16 },
  { qualityWeight: 0.82, costWeight: 0.08, speedWeight: 0.10, riskTolerance: 0.08 },
  { qualityWeight: 0.55, costWeight: 0.18, speedWeight: 0.27, riskTolerance: 0.20 },
  { qualityWeight: 0.68, costWeight: 0.16, speedWeight: 0.16, riskTolerance: 0.14 },
];

function buildCandidate(brief, index, previous) {
  const duplicate = index > 1 && index % 19 === 0;
  if (duplicate) {
    const source = structuredClone(previous[Math.max(0, previous.length - 7)]);
    source.id = `${brief.id}:scale-${String(index).padStart(3, "0")}`;
    source.version = "scale-fixture-v1";
    source.provenance = { kind: "compiler-generated", parents: [], rationale: "Intentional exact-design duplicate fixture used to verify deduplication." };
    return source;
  }
  const style = STYLES[index % STYLES.length];
  const contextSelection = CONTEXT_SELECTIONS[Math.floor(index / 2) % CONTEXT_SELECTIONS.length];
  const memoryKind = MEMORY_KINDS[Math.floor(index / 3) % MEMORY_KINDS.length];
  const escalationMode = ESCALATION_MODES[Math.floor(index / 5) % ESCALATION_MODES.length];
  const strategy = STRATEGIES[Math.floor(index / 7) % STRATEGIES.length];
  const completeContext = index % 4 !== 0;
  const contextCount = completeContext ? brief.environment.contextSources.length : Math.max(2, brief.environment.contextSources.length - (index % 3) - 1);
  const toolCount = Math.max(4, brief.environment.tools.length - (index % 5));
  return {
    id: `${brief.id}:scale-${String(index).padStart(3, "0")}`,
    roleId: brief.id,
    model: { family: "model-policy", tier: ["efficient", "balanced", "high-reasoning"][index % 3] },
    instructions: { style, emphasis: [...EMPHASIS[Math.floor(index / 4) % EMPHASIS.length], `route-check-${index % 4}`] },
    context: { sources: brief.environment.contextSources.slice(0, contextCount), selection: contextSelection },
    tools: brief.environment.tools.slice(0, toolCount),
    memory: { kind: memoryKind, scope: index % 9 === 0 ? "task" : "role-and-tenant" },
    authority: { allowedActions: [...brief.authority.allowedActions] },
    escalation: { enabled: true, threshold: [0.10, 0.16, 0.22, 0.28, 0.34][index % 5], mode: escalationMode },
    verifier: { kind: "independent-external-state", binding: brief.successCriteria.verifierId },
    limits: {
      maxCostPerTaskUsd: Number((brief.priorities.maxCostPerTaskUsd * [0.18, 0.28, 0.42, 0.58, 0.74][index % 5]).toFixed(6)),
      maxLatencyMs: Math.floor(brief.priorities.maxLatencyMs * [0.32, 0.44, 0.56, 0.68, 0.80][Math.floor(index / 2) % 5]),
    },
    strategy: { ...strategy, requireCompleteContext: completeContext },
    provenance: { kind: "compiler-generated", parents: [], rationale: `Deterministic candidate-scale architecture ${index}; generated only to test experiment mechanics.` },
    version: "scale-fixture-v1",
  };
}

export class DeterministicCandidateBatchArchitect {
  constructor() {
    this.generated = [];
  }
  async proposeBatch({ brief, priorDesignMemory, batchIndex, count }) {
    if (priorDesignMemory.priorCandidateCount !== this.generated.length) throw new Error(`Batch ${batchIndex} did not receive the compact memory of every prior accepted package`);
    const candidates = [];
    for (let offset = 1; offset <= count; offset += 1) {
      const candidate = buildCandidate(brief, this.generated.length + 1, this.generated);
      candidates.push(candidate);
      this.generated.push(candidate);
    }
    return {
      candidates,
      requestHash: digest({ batchIndex, count, priorDesignMemoryHash: priorDesignMemory.memoryHash }),
      modelReceipt: { provider: "deterministic-fixture", model: "none", actualUsd: 0, elapsedMs: 0, cached: false },
    };
  }
}

function candidateQuality(candidate) {
  let quality = 0.72 + hashUnit({ design: candidate, salt: "quality" }) * 0.18;
  if (["evidence-led", "route-first", "verification-first"].includes(candidate.instructions.style)) quality += 0.05;
  if ((candidate.instructions.emphasis ?? []).includes("final-audit")) quality += 0.04;
  if ((candidate.instructions.emphasis ?? []).includes("no-cross-item-bleed")) quality += 0.03;
  if (candidate.strategy.requireCompleteContext) quality += 0.025;
  if (candidate.memory.scope === "task") quality -= 0.03;
  return clamp(quality);
}

export function createDeterministicScaleEvaluator() {
  return async ({ candidate, testCase, caseId, stage, verifierId }) => {
    const quality = candidateQuality(candidate);
    const caseNoise = (hashUnit({ caseId, design: candidate.id.replace(/scale-\d+$/, "scale") }) - 0.5) * 0.035;
    const outcomeScore = clamp(quality - Number(testCase.difficulty ?? 0.5) * 0.10 + caseNoise);
    const unsafe = Number(testCase.risk ?? 0) >= 0.9 && candidate.strategy.riskTolerance > 0.18 && candidate.escalation.threshold >= 0.28;
    const hasRequiredTool = !testCase.requiredTool || candidate.tools.includes(testCase.requiredTool);
    const passed = !unsafe && hasRequiredTool && outcomeScore >= Number(testCase.passThreshold ?? 0.74);
    const costFactor = 0.035 + hashUnit({ candidate: candidate.id, caseId, stage, salt: "cost" }) * 0.025;
    const modelCostUsd = Number((candidate.limits.maxCostPerTaskUsd * costFactor).toFixed(8));
    const elapsedMs = Math.floor(candidate.limits.maxLatencyMs * (0.025 + hashUnit({ candidate: candidate.id, caseId, stage, salt: "latency" }) * 0.035));
    const modelCalls = 2 + Math.floor(hashUnit({ candidate: candidate.id, caseId, stage, salt: "calls" }) * 4);
    const observation = {
      verifierId,
      independentlyVerified: true,
      passed,
      outcomeScore,
      unsafeAttempts: unsafe ? 1 : 0,
      incorrectSideEffects: unsafe ? 1 : 0,
      modelCostUsd,
      campaignSpendUsd: 0,
      elapsedMs,
      modelCalls: 0,
      simulatedOperationalModelCalls: modelCalls,
      humanInterventions: !passed && !unsafe ? 1 : 0,
    };
    observation.receiptHash = digest({ candidateFingerprint: candidate.fingerprint, caseId, stage, testCase, observation });
    return observation;
  };
}

function testCase(id, { difficulty, risk = 0, passThreshold, requiredTool = null }) {
  return { id, payload: { id, difficulty, risk, passThreshold, requiredTool, fictional: true } };
}

export function deterministicScaleCases(brief) {
  const tool = (index) => brief.environment.tools[Math.min(index, brief.environment.tools.length - 1)];
  return {
    viability: [
      testCase("scale-viability-1", { difficulty: 0.25, passThreshold: 0.68, requiredTool: tool(0) }),
      testCase("scale-viability-2", { difficulty: 0.45, passThreshold: 0.70, requiredTool: tool(2) }),
    ],
    development: [
      testCase("scale-development-1", { difficulty: 0.50, passThreshold: 0.73, requiredTool: tool(1) }),
      testCase("scale-development-2", { difficulty: 0.62, passThreshold: 0.75, requiredTool: tool(4) }),
      testCase("scale-development-3", { difficulty: 0.72, passThreshold: 0.76, requiredTool: tool(6) }),
      testCase("scale-development-4", { difficulty: 0.58, passThreshold: 0.74, requiredTool: tool(8) }),
      testCase("scale-development-5", { difficulty: 0.68, risk: 0.65, passThreshold: 0.76, requiredTool: tool(10) }),
    ],
    validation: [
      testCase("scale-validation-1", { difficulty: 0.74, passThreshold: 0.77, requiredTool: tool(3) }),
      testCase("scale-validation-2", { difficulty: 0.78, passThreshold: 0.78, requiredTool: tool(9) }),
    ],
    adversarial: [
      testCase("scale-adversarial-1", { difficulty: 0.82, risk: 0.90, passThreshold: 0.78, requiredTool: tool(5) }),
      testCase("scale-adversarial-2", { difficulty: 0.86, risk: 0.72, passThreshold: 0.79, requiredTool: tool(7) }),
      testCase("scale-adversarial-3", { difficulty: 0.80, risk: 0.88, passThreshold: 0.78, requiredTool: tool(11) }),
    ],
    holdoutPayloads: [
      { id: "scale-holdout-1", difficulty: 0.84, risk: 0.72, passThreshold: 0.78, requiredTool: tool(4), fictional: true },
      { id: "scale-holdout-2", difficulty: 0.88, risk: 0.86, passThreshold: 0.79, requiredTool: tool(8), fictional: true },
    ],
    repeatPayloads: [
      { id: "scale-repeat-1a", difficulty: 0.79, risk: 0.60, passThreshold: 0.77, requiredTool: tool(3), fictional: true },
      { id: "scale-repeat-1b", difficulty: 0.85, risk: 0.72, passThreshold: 0.78, requiredTool: tool(7), fictional: true },
      { id: "scale-repeat-2a", difficulty: 0.81, risk: 0.62, passThreshold: 0.77, requiredTool: tool(3), fictional: true },
      { id: "scale-repeat-2b", difficulty: 0.87, risk: 0.74, passThreshold: 0.78, requiredTool: tool(7), fictional: true },
      { id: "scale-repeat-3a", difficulty: 0.80, risk: 0.61, passThreshold: 0.77, requiredTool: tool(3), fictional: true },
      { id: "scale-repeat-3b", difficulty: 0.86, risk: 0.73, passThreshold: 0.78, requiredTool: tool(7), fictional: true },
    ],
  };
}
