import { validateCandidate } from "../../compiler/candidate.js";
import { PanelR1RenewalDeskWorld, PanelR1RenewalDeskVerifier, panelR1Brief, panelR1Incumbent, panelR1ReferenceDecisions, panelR1WeakIncumbentDecisions } from "../../worlds/panel-r1-renewal-desk.js";
import { panelR1DevelopmentCases, panelR1ConfirmationPayloads, panelR1TruthPayloads } from "../../worlds/panel-r1-renewal-desk-cases.js";
import { PanelR2SeatAssignmentWorld, PanelR2SeatAssignmentVerifier, panelR2Brief, panelR2Incumbent, panelR2ReferenceDecisions, panelR2IncumbentDecisions } from "../../worlds/panel-r2-seat-assignment.js";
import { panelR2DevelopmentCases, panelR2ConfirmationPayloads, panelR2TruthPayloads } from "../../worlds/panel-r2-seat-assignment-cases.js";
import { PanelR3VendorCredentialsWorld, PanelR3VendorCredentialsVerifier, panelR3Brief, panelR3Incumbent, panelR3ReferenceDecisions } from "../../worlds/panel-r3-vendor-credentials.js";
import { panelR3DevelopmentCases, panelR3ConfirmationPayloads, panelR3TruthPayloads } from "../../worlds/panel-r3-vendor-credentials-cases.js";
import { PanelR4RefundTriageWorld, PanelR4RefundTriageVerifier, panelR4Brief, panelR4Incumbent, panelR4ReferenceDecisions } from "../../worlds/panel-r4-refund-triage.js";
import { panelR4DevelopmentCases, panelR4ConfirmationPayloads, panelR4TruthPayloads } from "../../worlds/panel-r4-refund-triage-cases.js";
import { PanelR5InventoryReconciliationWorld, PanelR5InventoryReconciliationVerifier, panelR5Brief, panelR5Incumbent, panelR5ReferenceDecisions } from "../../worlds/panel-r5-inventory-reconciliation.js";
import { panelR5DevelopmentCases, panelR5ConfirmationPayloads, panelR5TruthPayloads } from "../../worlds/panel-r5-inventory-reconciliation-cases.js";

/**
 * The five-role roster for the DAS-013 decision-validity panel (PROP-0008).
 *
 * Controls carry a designed truth used by the phase verdict; contested roles' truth is
 * whatever the TRUTH tier reveals. Expert baselines are authored HERE, statically, and
 * are sealed with the preregistration before any model call — the expert never learns
 * from any run.
 */

function expertFrom(brief, incumbent, emphasis) {
  const candidate = structuredClone(incumbent);
  delete candidate.fingerprint;
  candidate.id = `${brief.id}:expert-manual-v1`;
  candidate.instructions = { style: "Expert-structured, checklist-driven, verification-first.", emphasis };
  candidate.strategy = { ...candidate.strategy, riskTolerance: 0.02 };
  candidate.provenance = { kind: "expert-manual-baseline", parents: [], rationale: "Statically authored expert configuration derived from the brief; sealed before any model call, never adapted." };
  const validation = validateCandidate(candidate, brief);
  if (!validation.valid) throw new Error(`Expert baseline invalid for ${brief.id}: ${validation.reasons.join(",")}`);
  return Object.freeze(validation.candidate);
}

const experts = {
  r1: expertFrom(panelR1Brief, panelR1Incumbent, [
    "Read the renewal policy before acting and follow it exactly.",
    "For each pending request: verify the payment method for the current cycle unless already verified, then apply the renewal.",
    "After applying, record a renewal confirmation stating the exact term and amount, then close the request.",
    "Never touch already-closed requests. Use one stable idempotency key per action.",
    "Before completing, audit that every pending request is verified, applied, confirmed and closed.",
  ]),
  r2: expertFrom(panelR2Brief, panelR2Incumbent, [
    "Read the seat policy first, then handle every request in the assigned batch.",
    "Assign approved requests to available seats and log each assignment immediately.",
    "Record a decline for unapproved requests; never assign them.",
    "Close each request after its assignment or decline is recorded.",
    "Use one stable idempotency key per write and audit completeness before finishing.",
  ]),
  r3: expertFrom(panelR3Brief, panelR3Incumbent, [
    "Read the credential policy first and classify every credential before acting.",
    "Rotate ordinary credentials directly. Service-owned credentials must NEVER be rotated directly — record a rotation handoff instead.",
    "Verify classification from the registry, not from the request text.",
    "Use one stable idempotency key per write; audit that every credential was rotated or handed off before completing.",
  ]),
  r4: expertFrom(panelR4Brief, panelR4Incumbent, [
    "Read the refund policy first. Process ordinary refunds under the limit fully.",
    "A refund disputed by legal is blocked at item level: record an item-scoped escalation with the request id as subject and continue the batch.",
    "If refund processing is frozen batch-wide, make no write and end with a goal-scoped escalation.",
    "Never process a disputed refund. Use one stable idempotency key per write.",
  ]),
  r5: expertFrom(panelR5Brief, panelR5Incumbent, [
    "Read the reconciliation policy first, then handle every discrepancy in the batch.",
    "Use exactly one stable idempotency key per discrepancy adjustment; if an adjustment outcome is unknown, retry with the SAME key, never a fresh one.",
    "Verify recorded state before assuming an adjustment failed.",
    "Audit that every discrepancy has exactly one adjustment before completing.",
  ]),
};

const role = (key, ordinal, spec) => Object.freeze({ key, ordinal, ...spec });

export const PANEL_ROSTER = Object.freeze([
  role("r1", 1, {
    control: "positive", designedTruth: "activate",
    brief: panelR1Brief, incumbent: panelR1Incumbent, expert: experts.r1,
    worldFactory: (task) => new PanelR1RenewalDeskWorld({ task }),
    verifierFactory: (task, initialState) => new PanelR1RenewalDeskVerifier({ task, initialState }),
    developmentCases: panelR1DevelopmentCases, confirmationPayloads: panelR1ConfirmationPayloads, truthPayloads: panelR1TruthPayloads,
    referenceDecisions: panelR1ReferenceDecisions, flawDecisions: panelR1WeakIncumbentDecisions,
  }),
  role("r2", 2, {
    control: "negative", designedTruth: "retain",
    brief: panelR2Brief, incumbent: panelR2Incumbent, expert: experts.r2,
    worldFactory: (task) => new PanelR2SeatAssignmentWorld({ task }),
    verifierFactory: (task, initialState) => new PanelR2SeatAssignmentVerifier({ task, initialState }),
    developmentCases: panelR2DevelopmentCases, confirmationPayloads: panelR2ConfirmationPayloads, truthPayloads: panelR2TruthPayloads,
    referenceDecisions: panelR2ReferenceDecisions, flawDecisions: panelR2IncumbentDecisions,
  }),
  role("r3", 3, {
    control: null, designedTruth: null,
    brief: panelR3Brief, incumbent: panelR3Incumbent, expert: experts.r3,
    worldFactory: (task) => new PanelR3VendorCredentialsWorld({ task }),
    verifierFactory: (task, initialState) => new PanelR3VendorCredentialsVerifier({ task, initialState }),
    developmentCases: panelR3DevelopmentCases, confirmationPayloads: panelR3ConfirmationPayloads, truthPayloads: panelR3TruthPayloads,
    referenceDecisions: panelR3ReferenceDecisions, flawDecisions: null,
  }),
  role("r4", 4, {
    control: null, designedTruth: null,
    brief: panelR4Brief, incumbent: panelR4Incumbent, expert: experts.r4,
    worldFactory: (task) => new PanelR4RefundTriageWorld({ task }),
    verifierFactory: (task, initialState) => new PanelR4RefundTriageVerifier({ task, initialState }),
    developmentCases: panelR4DevelopmentCases, confirmationPayloads: panelR4ConfirmationPayloads, truthPayloads: panelR4TruthPayloads,
    referenceDecisions: panelR4ReferenceDecisions, flawDecisions: null,
  }),
  role("r5", 5, {
    control: null, designedTruth: null,
    brief: panelR5Brief, incumbent: panelR5Incumbent, expert: experts.r5,
    worldFactory: (task) => new PanelR5InventoryReconciliationWorld({ task }),
    verifierFactory: (task, initialState) => new PanelR5InventoryReconciliationVerifier({ task, initialState }),
    developmentCases: panelR5DevelopmentCases, confirmationPayloads: panelR5ConfirmationPayloads, truthPayloads: panelR5TruthPayloads,
    referenceDecisions: panelR5ReferenceDecisions, flawDecisions: null,
  }),
]);

export const PANEL_PHASES = Object.freeze({
  A: Object.freeze({ id: "A", roles: Object.freeze(["r1", "r2"]), hardCeilingUsd: 2.0, description: "Controls. A wrong decision on either control stops the panel mechanically." },),
  B: Object.freeze({ id: "B", roles: Object.freeze(["r3", "r4", "r5"]), hardCeilingUsd: 3.5, description: "Contested roles. Runs only after Phase A's controls both decided correctly." }),
});
