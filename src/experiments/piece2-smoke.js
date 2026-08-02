import fs from "node:fs";
import path from "node:path";
import { BudgetGuard } from "../core/budget.js";
import { EvidenceLedger } from "../core/evidence.js";
import { MeteredModelGateway, ModelResponseCache } from "../core/model-gateway.js";
import { ModelCandidateArchitect } from "../compiler/model-architect.js";
import { ModelDecisionEngine } from "../runtime/model-decision-engine.js";
import { procurementRole } from "../roles/procurement.js";
import { OpenAIResponsesProvider } from "../providers/openai-responses.js";
import { RealisticProcurementCompany, londonDueTomorrowTask } from "../worlds/realistic-procurement-company.js";

const SMOKE_LIMIT_USD = 2;
const PRIOR_SPEND_USD = 0.006418;
const MODEL = "gpt-5.6-luna";
const pricing = { inputPerMillionUsd: 0.20, cachedInputPerMillionUsd: 0.02, outputPerMillionUsd: 1.20 };

if (process.env.DAS_ENABLE_PAID_MODEL_CALLS !== "JOEL_APPROVED") throw new Error("Paid smoke requires DAS_ENABLE_PAID_MODEL_CALLS=JOEL_APPROVED");
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing");

const outputDir = path.resolve("artifacts/runs/piece2-smoke/attempt-3");
fs.mkdirSync(outputDir, { recursive: true });
const evidence = new EvidenceLedger(path.join(outputDir, "evidence.jsonl"));
const budget = new BudgetGuard({ hardLimitUsd: SMOKE_LIMIT_USD - PRIOR_SPEND_USD, warningUsd: 1.50 - PRIOR_SPEND_USD });
const provider = new OpenAIResponsesProvider({
  apiKey: process.env.OPENAI_API_KEY,
  pricing,
  allowPaidCalls: true,
  environment: process.env,
  modelMap: { "candidate-architect-policy": MODEL },
});
const gateway = new MeteredModelGateway({ provider, budget, cache: new ModelResponseCache(), evidence, secrets: [process.env.OPENAI_API_KEY] });

let summary;
try {
  const architect = new ModelCandidateArchitect({ gateway, minimumCandidates: 2, maxOutputTokens: 8_000 });
  const proposal = await architect.propose({ brief: procurementRole.brief, knowledgeEntries: [], priorSpecialists: [] });
  if (proposal.candidates.length < 1) throw new Error("No valid model-backed candidate survived validation");
  const candidate = proposal.candidates[0];
  provider.modelMap[candidate.model.family] = MODEL;
  const world = new RealisticProcurementCompany({ task: londonDueTomorrowTask });
  const engine = new ModelDecisionEngine({ gateway });
  const decision = await engine.next({ candidate, goal: londonDueTomorrowTask.goal, turn: 1, observations: [], memory: [], tools: world.definitions() });
  if (decision.kind === "tool" && !world.definitions().some((tool) => tool.name === decision.name)) throw new Error(`Runtime chose undefined tool ${decision.name}`);
  if (decision.kind === "complete") throw new Error("Runtime declared a fresh unresolved task complete");
  summary = {
    status: "passed",
    model: MODEL,
    validCandidates: proposal.candidates.length,
    rejectedCandidates: proposal.rejected.length,
    firstDecision: decision,
    budget: { ...budget.snapshot(), priorSpendUsd: PRIOR_SPEND_USD, cumulativeSpentUsd: PRIOR_SPEND_USD + budget.spentUsd, cumulativeHardLimitUsd: SMOKE_LIMIT_USD },
    evidenceValid: evidence.verify(),
  };
} catch (error) {
  summary = { status: "failed", model: MODEL, error: error instanceof Error ? error.message : String(error), budget: { ...budget.snapshot(), priorSpendUsd: PRIOR_SPEND_USD, cumulativeSpentUsd: PRIOR_SPEND_USD + budget.spentUsd, cumulativeHardLimitUsd: SMOKE_LIMIT_USD }, evidenceValid: evidence.verify() };
}

fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
if (summary.status !== "passed") process.exitCode = 1;
