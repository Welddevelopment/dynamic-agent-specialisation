import fs from "node:fs";
import path from "node:path";
import { DurableBudgetGuard, PersistentModelResponseCache } from "../../core/durable-model-campaign.js";
import { EvidenceLedger } from "../../core/evidence.js";
import { MeteredModelGateway } from "../../core/model-gateway.js";
import { withCampaignWriterLock } from "../../core/campaign-writer-lock.js";
import { OpenAIResponsesProvider } from "../../providers/openai-responses.js";
import { AdaptiveBaselinePair, assertAdaptiveBaselinePairResult } from "../../evaluation/adaptive-baseline-pair.js";
import { attestInstanceEntryPoint, attestorForSealedEntryPoints } from "../../evaluation/execution-attestation.js";
import { EngineeringKnowledgeBase } from "../../compiler/knowledge.js";
import { seedGeneralEngineeringKnowledge } from "../../compiler/default-knowledge.js";
import { LogicalCallGateway } from "../das004-b2/logical-call-gateway.js";
import { ModelAdaptiveDesigner } from "../das004-b2/model-adaptive-designer.js";
import { CompilerArchitectDesigner } from "../das004-b3/compiler-architect-designer.js";
import { PanelAdaptiveEvaluator, runPanelModelCase } from "./evaluator.js";
import { controlInstrumentCheck, phaseVerdict, recommendFromConf, scoreRecommendation, summarizePanelRows } from "./gate.js";
import { assertPanelAuthorization, assertPanelPreregistration, createPanelRoleBundle, PANEL_ARTIFACT_ROOT, PANEL_CAMPAIGN_ID, PANEL_ENGINEERING_MODEL, PANEL_EXECUTION_MODEL, PANEL_PRICING_USD, panelTruthReleaseRole } from "./protocol.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function writePrivate(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, filePath); fs.chmodSync(filePath, 0o600);
}

const phaseId = process.argv[2];
requireCondition(["A", "B"].includes(phaseId), "Usage: run-phase.js A|B");
const root = path.resolve(PANEL_ARTIFACT_ROOT);
const plan = assertPanelPreregistration(JSON.parse(fs.readFileSync(path.join(root, "plan.json"), "utf8")));
const authorization = assertPanelAuthorization({ plan, environment: process.env });
const phase = plan.phases[phaseId];
const phaseLimitUsd = phaseId === "A" ? authorization.phaseALimitUsd : authorization.phaseBLimitUsd;
const receiptPath = path.join(root, `phase-${phaseId}-receipt.json`);
requireCondition(!fs.existsSync(receiptPath), `Panel phase ${phaseId} receipt already exists; never overwrite a completed result`);

if (phaseId === "B") {
  const aPath = path.join(root, "phase-A-receipt.json");
  requireCondition(fs.existsSync(aPath), "Phase B requires the Phase A receipt");
  const a = JSON.parse(fs.readFileSync(aPath, "utf8"));
  requireCondition(a.proceedToB === true, `Phase A's mechanical rule blocked Phase B: ${a.proceedReason}`);
}

const state = path.join(root, `phase-${phaseId}-campaign`);
await withCampaignWriterLock({ stateDirectory: state, campaignId: `${PANEL_CAMPAIGN_ID}:${phaseId}`, runnerVersion: "das013-panel-runner-v1" }, async () => {
  const budget = new DurableBudgetGuard({ filePath: path.join(state, "budget.json"), hardLimitUsd: phaseLimitUsd, warningUsd: phaseLimitUsd * 0.8, campaignId: `${PANEL_CAMPAIGN_ID}:${phaseId}` });
  requireCondition(budget.snapshot().calls.every((row) => !["reserved", "outcome-unknown"].includes(row.status)), "Panel phase has unresolved provider usage");
  const evidence = new EvidenceLedger(path.join(state, "evidence.jsonl"));
  const attestor = await attestorForSealedEntryPoints(plan.armEntryPoints, { repositoryRoot: process.cwd() });
  const knowledge = new EngineeringKnowledgeBase();
  seedGeneralEngineeringKnowledge(knowledge);
  const modelMap = { "candidate-architect-policy": PANEL_ENGINEERING_MODEL, "candidate-refiner-policy": PANEL_ENGINEERING_MODEL };
  const gatewayFor = (label) => {
    const provider = new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, pricingByModel: PANEL_PRICING_USD, allowPaidCalls: true, environment: process.env, serviceTier: "default", modelMap });
    const cache = new PersistentModelResponseCache({ filePath: path.join(state, `${label}-response-cache.json`) });
    return new LogicalCallGateway(new MeteredModelGateway({ provider, budget, cache, evidence, secrets: [process.env.OPENAI_API_KEY] }));
  };

  const startedAt = new Date().toISOString();
  evidence.append("panel.phase-started", { phaseId, planHash: plan.planHash, roles: phase.roles });
  const roleRecords = [];

  // ── Stage 1: engineering + CONF recommendation per role. No TRUTH access anywhere. ──
  for (const roleKey of phase.roles) {
    const bundle = createPanelRoleBundle(roleKey);
    const { role, protocol } = bundle;
    const gatewaysByArm = { das: gatewayFor(`${roleKey}-das`), "adaptive-engineer": gatewayFor(`${roleKey}-adaptive`), shared: gatewayFor(`${roleKey}-shared`) };
    const compilerDesigner = new CompilerArchitectDesigner({ armId: "das", brief: role.brief, gateway: gatewaysByArm.das, executionModelFamily: PANEL_EXECUTION_MODEL, minimumCandidates: 2, knowledgeEntries: knowledge.query(["general", "operations"]) });
    attestInstanceEntryPoint(attestor, "das", compilerDesigner.architect);
    const adaptiveDesigner = new ModelAdaptiveDesigner({ armId: "adaptive-engineer", brief: role.brief, gateway: gatewaysByArm["adaptive-engineer"], engineeringModel: PANEL_ENGINEERING_MODEL, purposePrefix: "das013-panel" });
    attestInstanceEntryPoint(attestor, "adaptive-engineer", adaptiveDesigner);
    const evaluator = new PanelAdaptiveEvaluator({ role, gatewaysByArm, evidence });
    const pair = new AdaptiveBaselinePair({ protocol, brief: role.brief, designers: { das: compilerDesigner, "adaptive-engineer": adaptiveDesigner }, developmentEvaluator: evaluator, confirmationEvaluator: evaluator, evidence });
    const pairResult = assertAdaptiveBaselinePairResult(await pair.run({ importedAgent: role.incumbent, developmentCases: bundle.developmentCases, confirmationVault: bundle.confirmationVault }), protocol);

    // The gate needs the incumbent's CONF numbers. CONF secrecy ends at freeze, which
    // pair.run has passed; when the pair short-circuited (an arm without a winner), the
    // direct use is recorded in the ledger rather than performed silently.
    const confCases = role.confirmationPayloads.map((payload, index) => Object.freeze({ id: `confirmation-${index + 1}`, payload: structuredClone(payload) }));
    if (pairResult.status === "confirmation-not-released") evidence.append("panel.conf-used-directly", { roleKey, reason: pairResult.reason });
    const incumbentConfRows = (await evaluator.evaluate({ armId: "shared", candidate: role.incumbent, cases: confCases, stage: "common-confirmation" })).observations;
    const incumbentConfSummary = summarizePanelRows(incumbentConfRows);

    const armRecords = {};
    for (const armId of ["das", "adaptive-engineer"]) {
      const winner = pairResult.freeze?.selected?.[armId] ? pairResult.armResults[armId].selected.candidate : null;
      const winnerConfRows = pairResult.confirmation?.[armId]?.rows ?? null;
      const winnerConfSummary = winnerConfRows ? summarizePanelRows(winnerConfRows) : null;
      const recommendation = recommendFromConf({ winnerSummary: winnerConfSummary, incumbentSummary: incumbentConfSummary });
      armRecords[armId] = { winner, winnerConfSummary, recommendation };
      evidence.append("panel.recommendation-frozen", { phaseId, roleKey, armId, recommendation, winnerFingerprint: winner?.fingerprint ?? null, winnerConfSummary, incumbentConfSummary });
    }
    roleRecords.push({ roleKey, role, bundle, pairResult, incumbentConfSummary, armRecords });
  }

  attestor.assertAllReached();
  const attestation = attestor.receipt();
  requireCondition(attestation.declarationsVerified, "Panel attestation was not verified against the declared modules");
  evidence.append("panel.stage1-attested", { phaseId, attestationHash: attestation.attestationHash });

  // ── Stage 2: TRUTH. Only now do the truth vaults open. ──
  const scoresByArm = { das: [], "adaptive-engineer": [] };
  const controlChecks = [];
  const truthDetails = [];
  for (const record of roleRecords) {
    const { roleKey, role, bundle, armRecords } = record;
    const gateway = gatewayFor(`${roleKey}-truth`);
    const candidateHashes = Object.fromEntries(Object.entries(armRecords).filter(([, r]) => r.winner).map(([armId, r]) => [`${armId}:${r.winner.id}`, r.winner.fingerprint]));
    const payloads = bundle.truthVault.release({ freezeHash: record.pairResult.freeze?.freezeHash ?? "no-freeze", role: panelTruthReleaseRole(role.brief), candidateHashes: Object.keys(candidateHashes).length ? candidateHashes : { none: "none" }, baselineHashes: { incumbent: role.incumbent.fingerprint, expert: role.expert.fingerprint } });
    const truthCases = payloads.map((payload, index) => Object.freeze({ id: `truth-${index + 1}`, payload: structuredClone(payload) }));
    const runAgent = async (label, candidate) => {
      if (!candidate) return null;
      const rows = [];
      for (const testCase of truthCases) rows.push(await runPanelModelCase({ role, candidate, testCase, gateway, evidence, armId: label, stage: "truth", tenantPrefix: "das013-panel" }));
      return summarizePanelRows(rows);
    };
    const incumbentTruth = await runAgent("incumbent", role.incumbent);
    const expertTruth = await runAgent("expert", role.expert);
    const dasTruth = await runAgent("das-winner", armRecords.das.winner);
    const adaptiveTruth = await runAgent("adaptive-winner", armRecords["adaptive-engineer"].winner);
    for (const armId of ["das", "adaptive-engineer"]) {
      const winnerTruthSummary = armId === "das" ? dasTruth : adaptiveTruth;
      scoresByArm[armId].push(scoreRecommendation({ roleKey, armId, recommendation: armRecords[armId].recommendation, winnerTruthSummary, incumbentTruthSummary: incumbentTruth }));
    }
    if (role.control) {
      controlChecks.push({ ...controlInstrumentCheck({ roleKey, designedTruth: role.designedTruth, incumbentTruthSummary: incumbentTruth, challengerTruthSummaries: [expertTruth, dasTruth, adaptiveTruth] }), designedTruth: role.designedTruth });
    }
    truthDetails.push({ roleKey, incumbentTruth, expertTruth, dasTruth, adaptiveTruth });
    evidence.append("panel.truth-scored", { phaseId, roleKey, incumbentTruth, expertTruth, dasTruth, adaptiveTruth });
  }

  const verdicts = Object.fromEntries(Object.entries(scoresByArm).map(([armId, scores]) => [armId, phaseVerdict({ phaseId, scores, controls: phaseId === "A" ? controlChecks.map((c) => ({ ...c, truthOptimal: c.valid ? c.designedTruth : "broken" })) : [] })]));
  const instrumentValid = phaseId !== "A" || controlChecks.every((check) => check.valid);
  const dasControlsCorrect = phaseId !== "A" || scoresByArm.das.every((score) => score.correct);
  const proceedToB = phaseId === "A" && instrumentValid && dasControlsCorrect && !verdicts.das.hardLineBreached;
  const budgetSnapshot = budget.snapshot();
  requireCondition(budgetSnapshot.calls.every((row) => !["reserved", "outcome-unknown"].includes(row.status)), "Panel phase ended with unresolved provider usage");
  requireCondition(evidence.verify(), "Panel evidence ledger failed integrity verification");

  const receipt = {
    schemaVersion: "das.das013-panel-phase-receipt.v1",
    campaignId: PANEL_CAMPAIGN_ID, phaseId, planHash: plan.planHash,
    startedAt, completedAt: new Date().toISOString(),
    roles: phase.roles,
    recommendations: Object.fromEntries(roleRecords.map((r) => [r.roleKey, Object.fromEntries(Object.entries(r.armRecords).map(([armId, a]) => [armId, a.recommendation]))])),
    scoresByArm, controlChecks, truthDetails, verdicts,
    instrumentValid, dasControlsCorrect,
    proceedToB, proceedReason: proceedToB ? "controls valid and DAS decided both correctly" : (phaseId === "A" ? `instrumentValid=${instrumentValid} dasControlsCorrect=${dasControlsCorrect} hardLine=${verdicts.das.hardLineBreached}` : "n/a"),
    executionAttestation: attestation,
    spendUsd: budgetSnapshot.spentUsd ?? budgetSnapshot.calls.filter((c) => c.status === "settled").reduce((s, c) => s + (c.actualUsd ?? 0), 0),
    settledCalls: budgetSnapshot.calls.filter((c) => c.status === "settled").length,
    evidenceRecords: evidence.records().length,
    automaticActivation: false,
  };
  writePrivate(receiptPath, receipt);
  process.stdout.write(`${JSON.stringify({ status: "complete", phaseId, verdictDas: verdicts.das, verdictAdaptive: verdicts["adaptive-engineer"], instrumentValid, proceedToB, spendUsd: receipt.spendUsd, settledCalls: receipt.settledCalls }, null, 2)}\n`);
});
