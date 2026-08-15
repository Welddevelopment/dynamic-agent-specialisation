import fs from "node:fs";
import path from "node:path";
import { digest } from "../../core/canonical.js";
import { AccessOffboardingVerifier, AccessOffboardingWorld } from "../../worlds/access-offboarding-world.js";
import { accessOffboardingConfirmationPayloads, accessOffboardingDevelopmentCases } from "../../worlds/access-offboarding-cases.js";
import { runReferenceAccessOffboardingCase } from "./reference-preflight.js";
import { assertDas004B2Preregistration, createDas004B2Preregistration, DAS004_B2_ARTIFACT_ROOT } from "./protocol.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function writeNew(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

const artifactRoot = path.resolve(DAS004_B2_ARTIFACT_ROOT);
if (fs.existsSync(artifactRoot)) throw new Error("DAS-004/B2 v1 preregistration already exists; preserve it and create a new version instead of overwriting");
const plan = assertDas004B2Preregistration(createDas004B2Preregistration());
const allCases = [
  ...accessOffboardingDevelopmentCases,
  ...accessOffboardingConfirmationPayloads.map((payload, index) => ({ id: `confirmation-${index + 1}`, ...structuredClone(payload) })),
];
const reference = [];
for (const testCase of allCases) {
  const result = await runReferenceAccessOffboardingCase(testCase);
  requireCondition(result.result.status === "completed" && result.result.verification?.passed, `Deterministic reference failed ${testCase.id}`);
  reference.push({ caseId: testCase.id, passed: true, outcomeScore: result.result.verification.outcomeScore, deniedAttempts: result.externalState.deniedAttempts.length, stateHash: digest(result.externalState) });
}

const unsafeTask = { id: "negative-privileged-revocation", ...structuredClone(accessOffboardingDevelopmentCases[2]) };
const unsafeWorld = new AccessOffboardingWorld({ task: unsafeTask });
let unsafeBlocked = false;
try { await unsafeWorld.execute("revoke-access-grant", { workerId: "worker-dana", grantId: "grant-dana-prod", idempotencyKey: "negative:privileged" }); }
catch (error) { unsafeBlocked = String(error?.message).includes("requires-handoff"); }
requireCondition(unsafeBlocked, "Privileged-revocation negative control did not fail closed");
const emptyWorld = new AccessOffboardingWorld({ task: unsafeTask });
const emptyVerifier = new AccessOffboardingVerifier({ task: unsafeTask, initialState: emptyWorld.initial });
const emptyVerification = await emptyVerifier.verify({ externalState: emptyWorld.externalState(), resolution: { kind: "complete" } });
requireCondition(!emptyVerification.passed && emptyVerification.outcomeScore < 1, "Do-nothing negative control unexpectedly passed");

const preflightCore = {
  schemaVersion: "das.das004-b2-preflight.v1",
  campaignId: plan.campaignId,
  planHash: plan.planHash,
  createdAt: new Date().toISOString(),
  deterministicReference: { passed: reference.length, total: allCases.length, cases: reference },
  negativeControls: { privilegedRevocationBlocked: unsafeBlocked, doNothingPassed: emptyVerification.passed, doNothingOutcomeScore: emptyVerification.outcomeScore },
  fairness: {
    protocolHash: plan.protocol.protocolHash,
    sameImportedAgent: plan.sharedAccess.sameImportedAgent,
    sameEnvironment: plan.sharedAccess.sameRoleToolsContextPoliciesAuthorityVerifier,
    sameCases: plan.sharedAccess.sameDevelopmentCases && plan.sharedAccess.sameConfirmationVault,
    sameModelsAndProvider: true,
    sameResourceHash: plan.sharedAccess.samePerArmLimitsHash,
    confirmationHidden: !plan.caseFreeze.confirmationVisibleDuringEngineering,
    noFallback: plan.protocol.confirmation.releaseRule.includes("both arm winners"),
  },
  budget: { plannedMaximumUsd: plan.resources.plannedCombinedMaximumUsd, hardCeilingUsd: plan.resources.hardCampaignCeilingUsd, bufferUsd: plan.resources.safetyBufferUsd, modelCalls: 0, spendUsd: 0 },
  status: "sealed-zero-spend-awaiting-exact-authorized-run",
};
const preflight = { ...preflightCore, preflightHash: digest(preflightCore) };
writeNew(path.join(artifactRoot, "plan.json"), plan);
writeNew(path.join(artifactRoot, "preflight.json"), preflight);

const report = `# DAS-004/B2 prospective adaptive-baseline comparison — v2 preregistration\n\nPricing verified UTC date: 2026-08-13  \nStatus: **sealed before paid execution**  \nPaid calls: **0**  \nSpend: **$0**\n\n## Primary question\n\n${plan.primaryQuestion}\n\n## Frozen experiment\n\n- Fresh role: bounded fictional employee access offboarding.\n- Shared start: \`${plan.role.importedAgentId}\` / \`${plan.role.importedAgentFingerprint}\`.\n- Development: ${plan.caseFreeze.developmentCount} frozen cases, digest \`${plan.caseFreeze.developmentCaseDigest}\`.\n- Confirmation: ${plan.caseFreeze.confirmationCount} fresh cases, vault digest \`${plan.caseFreeze.confirmationVaultDigest}\`; hidden until both winners freeze.\n- Shared model allowlist: ${plan.sharedAccess.sameModelAllowlist.join(", ")}.\n- Shared engineering model/provider: ${plan.sharedAccess.sameEngineeringModel} / ${plan.sharedAccess.sameProvider}.\n- Equal per-arm resource envelope hash: \`${plan.sharedAccess.samePerArmLimitsHash}\`.\n- Safety is a hard gate. There is no post-confirmation fallback or activation.\n\n## Arms\n\n- **DAS:** ${plan.arms.das}\n- **Strong adaptive engineer:** ${plan.arms["adaptive-engineer"]}\n\nBoth are automated engineering procedures. This experiment does **not** measure real human engineer time.\n\n## Verdict rule\n\n- Quality win: ${plan.confirmationVerdictRule.qualityWin}\n- Efficiency win: ${plan.confirmationVerdictRule.efficiencyWin}\n- Tie: ${plan.confirmationVerdictRule.tie}\n- Safety: ${plan.confirmationVerdictRule.safety}\n\n## Deterministic preflight\n\n- Reference cases: ${reference.length}/${allCases.length} passed.\n- Privileged-revocation attack: blocked.\n- Do-nothing control: failed as expected.\n- Planned maximum: $${plan.resources.plannedCombinedMaximumUsd.toFixed(2)} under a hard $${plan.resources.hardCampaignCeilingUsd.toFixed(2)} ceiling; $${plan.resources.safetyBufferUsd.toFixed(2)} remains unallocated.\n\n## Integrity\n\n- Plan hash: \`${plan.planHash}\`\n- Protocol hash: \`${plan.protocol.protocolHash}\`\n- Pricing hash: \`${plan.pricing.pricingHash}\`\n- Preflight hash: \`${preflight.preflightHash}\`\n\n## Evidence boundary\n\nOne prospective fictional local paired comparison only. No customer data, human-engineer comparison, activation, production evidence, CF integration or public claim is authorized. A DAS tie or loss is a valid result and must be preserved. V1 was preserved as a zero-call pre-execution UTC-date failure and is not empirical evidence.\n`;
writeNew(path.resolve("reports/0110-das004-b2-prospective-adaptive-comparison-v2-preregistration.md"), report);
process.stdout.write(`${JSON.stringify({ status: preflight.status, planHash: plan.planHash, protocolHash: plan.protocol.protocolHash, preflightHash: preflight.preflightHash, reference: `${reference.length}/${allCases.length}`, calls: 0, spendUsd: 0, artifactRoot }, null, 2)}\n`);
