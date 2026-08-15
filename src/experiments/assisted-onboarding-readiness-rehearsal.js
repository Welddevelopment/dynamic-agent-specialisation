import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { AssistedCommercialOnboardingJourney } from "../product/assisted-onboarding-journey.js";

function representativeFrontendIntake() {
  return {
    sessionId: "fictional-frontend-readiness-v1",
    company: { name: "Fictional Design Co", industry: "Software", operatingContext: "Approved design tasks end at a reviewable draft pull request." },
    role: { templateId: "frontend-implementation", title: "Frontend implementation specialist", outcome: "Turn approved designs into responsive React source.", completionRule: "Complete only after independent repository checks pass and a draft pull request exists without merge or deployment.", escalationOwner: "Frontend lead" },
    systems: [
      { id: "approved-design-source", name: "Approved Figma handoff", kind: "customer system", access: "none", adapterStatus: "missing", contextSources: ["approved design"], tools: [{ name: "read-approved-design", mode: "read" }] },
      { id: "react-repository", name: "React repository", kind: "customer system", access: "none", adapterStatus: "missing", contextSources: ["repository", "component library", "repository policy"], tools: [{ name: "read-repository", mode: "read" }, { name: "write-assigned-source", mode: "write" }, { name: "open-draft-pr", mode: "write" }] },
    ],
    knowledgeSources: [{ name: "Repository policy", kind: "policy", contentHash: digest("fictional-repository-policy-v1"), current: true }],
    policies: [
      { rule: "Check the approved design version and assigned source paths.", kind: "required-check", confirmed: true },
      { rule: "A missing approved component requires review.", kind: "approval", confirmed: true },
      { rule: "Never merge, deploy or change protected files.", kind: "forbidden", confirmed: true },
    ],
    authority: { allowedActions: ["write-assigned-source", "open-draft-pr"], approvalActions: ["propose-component"], forbiddenActions: ["merge", "deploy", "write-protected-files"] },
    examples: Array.from({ length: 5 }, (_, index) => ({ situation: `Fictional frontend case ${index + 1}`, expected: `Externally checked bounded result ${index + 1}`, source: "synthetic", redacted: true })),
    success: { measures: ["approved source outcome", "only assigned files changed", "draft PR exists without merge or deployment"], verifierMode: "independent-external-state", verifierStatus: "declared", owner: "Fictional test owner" },
    priorities: { quality: 1, cost: .25, speed: .2, maximumCostPerTaskUsd: .5, maximumLatencyMs: 300_000, goal: "Preserve verified quality first." },
    currentAgent: { mode: "none" },
    dataHandling: { localOnly: true, productionDataIncluded: false, redactionConfirmed: true },
  };
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "das-readiness-rehearsal-"));
try {
  const journey = new AssistedCommercialOnboardingJourney({ stateDirectory: temporary, now: () => "2026-08-14T00:00:00.000Z" });
  const intake = representativeFrontendIntake();
  journey.saveBusinessIntake(intake);
  const receipt = journey.readinessReceipt(intake.sessionId);
  const outputDirectory = path.resolve("artifacts/onboarding/readiness-receipt-v1");
  const output = path.join(outputDirectory, "frontend-design-scaffold-receipt.json");
  fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  const temporaryOutput = `${output}.tmp`;
  fs.writeFileSync(temporaryOutput, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryOutput, output);
  console.log(JSON.stringify({ output, receiptHash: receipt.receiptHash, comparisonDesignComplete: receipt.readiness.comparisonDesign.complete, executionReady: receipt.readiness.execution.ready, activationReady: receipt.readiness.activation.ready, blockers: receipt.exactBlockers }, null, 2));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
