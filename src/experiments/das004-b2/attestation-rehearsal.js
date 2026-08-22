import { digest } from "../../core/canonical.js";
import { attestInstanceEntryPoint, attestorForSealedEntryPoints, declareArmEntryPoints } from "../../evaluation/execution-attestation.js";
import { accessOffboardingBrief } from "../../roles/access-offboarding.js";
import { ModelAdaptiveDesigner } from "./model-adaptive-designer.js";
import { DAS004_B2_ARM_ENTRY_POINTS } from "./protocol.js";

/**
 * Zero-spend rehearsal of the PROP-0002 attestation gate.
 *
 * It runs the real gated sequence — sealed declaration, resolution against the real
 * modules, attested entry points installed on real designer instances, then
 * assertAllReached() — and only emits a quotable result once that gate passes. No model
 * call is made: the gateway is a local stub that charges nothing and reaches no network.
 *
 * The point of the rehearsal is the negative case. Pass a declaration that does not match
 * the code the rehearsal actually runs and the campaign must die before any number exists.
 */

const REHEARSAL_ARMS = Object.freeze(["das", "adaptive-engineer"]);

/** A local stand-in for the metered gateway. It cannot spend, and it cannot reach a network. */
export class ZeroSpendStubGateway {
  constructor({ armId }) { this.armId = armId; this.calls = 0; }
  projectCost() { return 0; }
  async generate(request) {
    this.calls += 1;
    const output = JSON.stringify({
      actions: [{
        kind: "retain",
        rationale: `rehearsal-no-change-${this.armId}`,
        parentId: request.input.parents[0]?.id ?? null,
      }],
    });
    return { output, actualUsd: 0, usage: { inputTokens: 0, outputTokens: 0 }, resolvedModel: request.model, cached: true };
  }
}

/** The rehearsal's stand-in for a campaign round. It calls whatever `propose` the runner installed. */
async function runRehearsalRound(designers) {
  const proposals = {};
  for (const armId of REHEARSAL_ARMS) {
    proposals[armId] = await designers[armId].propose({
      round: 1,
      parents: [{ id: "rehearsal-parent-1" }],
      developmentFeedback: [],
      allowedModelFamilies: ["gpt-5.6-luna"],
      maximumChildrenPerParent: 1,
      hiddenCases: null,
    }).catch((error) => ({ rehearsalProposalError: error instanceof Error ? error.message : String(error) }));
  }
  return proposals;
}

/**
 * @param entryPoints sealed declaration to run under (defaults to the campaign's own)
 * @param skipArm     arm to deliberately never invoke, to exercise the never-executed gate
 * @returns a quotable rehearsal result, or throws before one exists
 */
export async function runAttestationRehearsal({ entryPoints = DAS004_B2_ARM_ENTRY_POINTS, skipArm = null, repositoryRoot = process.cwd() } = {}) {
  const attestor = await attestorForSealedEntryPoints(entryPoints, { repositoryRoot });

  const designers = {};
  for (const armId of REHEARSAL_ARMS) {
    const designer = new ModelAdaptiveDesigner({ armId, brief: accessOffboardingBrief, gateway: new ZeroSpendStubGateway({ armId }) });
    designers[armId] = attestInstanceEntryPoint(attestor, armId, designer);
  }

  const proposals = await runRehearsalRound(
    skipArm ? { ...designers, [skipArm]: { propose: async () => ({ actions: [], skipped: true }) } } : designers,
  );

  // THE GATE. Nothing below this line may be quoted if this throws.
  attestor.assertAllReached();
  const attestation = attestor.receipt();
  if (!attestation.declarationsVerified) throw new Error("Rehearsal attestation was not verified against the declared modules");

  const spendUsd = REHEARSAL_ARMS.reduce((sum, armId) => sum + (designers[armId].gateway?.calls ?? 0) * 0, 0);
  const core = {
    schemaVersion: "das.das004-b2-attestation-rehearsal.v1",
    quotable: true,
    arms: REHEARSAL_ARMS,
    proposalsReceived: Object.fromEntries(REHEARSAL_ARMS.map((armId) => [armId, Array.isArray(proposals[armId]?.actions) ? proposals[armId].actions.length : 0])),
    executionAttestation: attestation,
    distinctArmEntryPoints: new Set(entryPoints.arms.map((row) => `${row.module}#${row.exportName}.${row.methodName ?? ""}`)).size === entryPoints.arms.length,
    spendUsd,
    modelCallsMade: 0,
    evidenceBoundary: "Local zero-spend rehearsal of the execution-attestation gate only. It is not evidence about any specialist, any arm's quality, or the DAS architecture.",
  };
  return Object.freeze({ ...core, rehearsalHash: digest(core) });
}

/** Convenience: the deliberately wrong declarations the rehearsal is meant to be run against. */
export const WRONG_DECLARATIONS = Object.freeze({
  moduleDoesNotExist: () => declareArmEntryPoints([
    { armId: "das", module: "src/compiler/not-a-real-module.js", exportName: "compileSpecialist", methodName: null },
    { armId: "adaptive-engineer", module: "src/experiments/das004-b2/model-adaptive-designer.js", exportName: "ModelAdaptiveDesigner", methodName: "propose" },
  ]),
  claimsCompilerButRunsDesigner: () => declareArmEntryPoints([
    { armId: "das", module: "src/compiler/compiler.js", exportName: "compileSpecialist", methodName: null },
    { armId: "adaptive-engineer", module: "src/experiments/das004-b2/model-adaptive-designer.js", exportName: "ModelAdaptiveDesigner", methodName: "propose" },
  ]),
  wrongMethodOnRightClass: () => declareArmEntryPoints([
    { armId: "das", module: "src/experiments/das004-b2/model-adaptive-designer.js", exportName: "ModelAdaptiveDesigner", methodName: "estimate" },
    { armId: "adaptive-engineer", module: "src/experiments/das004-b2/model-adaptive-designer.js", exportName: "ModelAdaptiveDesigner", methodName: "propose" },
  ]),
});
