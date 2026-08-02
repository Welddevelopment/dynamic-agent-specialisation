import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { createRealisticProcurementUnseenVault } from "../worlds/realistic-procurement-cases.js";
import { cycle3ValidationCases, cycle3AdversarialCases } from "../worlds/realistic-procurement-cycle3-cases.js";
import { realisticProcurementStrategies } from "../evaluation/realistic-procurement-strategies.js";
import { RealisticProcurementCompany, RealisticProcurementVerifier } from "../worlds/realistic-procurement-company.js";
import { SpecialistAgentRuntime } from "../runtime/agent-runtime.js";
import { ModelDecisionEngine } from "../runtime/model-decision-engine.js";

const search = JSON.parse(fs.readFileSync("artifacts/runs/piece2-cycle3-search/v1/summary.json", "utf8"));
const validation = JSON.parse(fs.readFileSync("artifacts/runs/piece2-cycle3-validation/v1/summary.json", "utf8"));
const adversarial = JSON.parse(fs.readFileSync("artifacts/runs/piece2-cycle3-adversarial/v1/summary.json", "utf8"));
const baseline = JSON.parse(fs.readFileSync("artifacts/runs/piece2-baselines/v1/summary.json", "utf8"));
if (!search.selectedCandidate || !validation.advance || !adversarial.advance || baseline.status !== "completed") throw new Error("Pre-unseen gates are incomplete");
const candidate = search.selectedCandidate;
const withoutFingerprint = structuredClone(candidate); delete withoutFingerprint.fingerprint;
if (digest(withoutFingerprint) !== candidate.fingerprint) throw new Error("Selected candidate fingerprint is stale");
for (const item of baseline.baselines) { const clone = structuredClone(item); delete clone.fingerprint; if (digest(clone) !== item.fingerprint) throw new Error(`Baseline fingerprint is stale: ${item.id}`); }
const vault = createRealisticProcurementUnseenVault();
const record = {
  schemaVersion: 1,
  roleId: "realistic-procurement-specialist",
  frozenAt: new Date().toISOString(),
  candidate,
  modelBaselines: baseline.baselines,
  deterministicBaselines: realisticProcurementStrategies.map((strategy) => ({ id: strategy.id, sourceHash: digest(strategy.run.toString()) })),
  cases: { cycle3ValidationHash: digest(cycle3ValidationCases), cycle3AdversarialHash: digest(cycle3AdversarialCases), unseenHash: vault.digest, unseenCount: vault.count },
  boundaries: { runtimeHash: digest(SpecialistAgentRuntime.toString()), decisionEngineHash: digest(ModelDecisionEngine.toString()), worldHash: digest(RealisticProcurementCompany.toString()), verifierHash: digest(RealisticProcurementVerifier.toString()) },
  preUnseenEvidence: { searchHash: digest(search), validationHash: digest(validation), adversarialHash: digest(adversarial), baselineHash: digest(baseline) },
  selectionRule: ["zero unsafe attempts", "unseen pass count", "combined pass count", "model cost", "tool calls", "latency"],
  claimBoundary: "One frozen procurement evaluation only; no customer, production, multi-role, or universal reliability claim.",
};
const freeze = { ...record, freezeHash: digest(record) };
const output = path.resolve("evidence/piece2-procurement-freeze.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(freeze, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, freezeHash: freeze.freezeHash, candidate: { id: candidate.id, fingerprint: candidate.fingerprint }, baselines: baseline.baselines.map((item) => ({ id: item.id, fingerprint: item.fingerprint })), unseenHash: vault.digest, unseenCount: vault.count }, null, 2));
