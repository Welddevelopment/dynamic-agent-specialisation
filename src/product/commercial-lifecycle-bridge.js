import { digest } from "../core/canonical.js";
import { DurableSpecialistRegistry } from "../compiler/durable-registry.js";
import { assertCommercialSpecialistBundle, createCommercialActivationReceipt, createCommercialRollbackReceipt } from "./commercial-specialist-lifecycle.js";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function commercialLifecycleCompatibility(brief) {
  requireCondition(brief?.id && brief?.successCriteria?.verifierId, "Commercial lifecycle compatibility requires a complete role brief");
  return Object.freeze({
    roleTags: structuredClone(brief.environment?.tags ?? []),
    environmentTags: structuredClone(brief.environment?.tags ?? []),
    policyHash: digest(brief.policies ?? []),
    authorityHash: digest(brief.authority ?? {}),
    toolsHash: digest(brief.environment?.tools ?? []),
    verifierBinding: brief.successCriteria.verifierId,
  });
}

function selectionEvidence(bundle) {
  const summaries = bundle.evidence?.repeatability?.summaries ?? [];
  requireCondition(summaries.length >= 3, "Commercial lifecycle seed requires repeated selection evidence");
  return {
    candidateId: bundle.selected.candidate.id,
    successRate: Math.min(...summaries.map((item) => Number(item.passRate))),
    unsafeAttempts: summaries.reduce((sum, item) => sum + Number(item.unsafeAttempts ?? 0) + Number(item.incorrectSideEffects ?? 0), 0),
    commercialBundleHash: bundle.bundleHash,
    comparisonResultHash: bundle.evidence.resultHash,
  };
}

export function seedCommercialLifecycleRegistry({ activeBundle, alternativeBundles, brief, clock = () => new Date().toISOString() }) {
  assertCommercialSpecialistBundle(activeBundle);
  requireCondition(Array.isArray(alternativeBundles) && alternativeBundles.length > 0, "Commercial lifecycle seed requires at least one preserved alternative");
  for (const bundle of alternativeBundles) {
    assertCommercialSpecialistBundle(bundle);
    requireCondition(bundle.role.id === activeBundle.role.id, "Commercial lifecycle alternatives must belong to the active role");
  }
  requireCondition(brief?.id === activeBundle.role.id, "Commercial lifecycle brief does not match the active bundle");
  const registry = new DurableSpecialistRegistry({ registryId: `commercial-${brief.id}`, clock });
  const role = { id: brief.id, brief: structuredClone(brief) };
  const selection = registry.registerSelection({
    role,
    selectedCandidate: activeBundle.selected.candidate,
    alternatives: alternativeBundles.map((bundle) => ({ candidate: bundle.selected.candidate, evidence: selectionEvidence(bundle) })),
    decision: activeBundle.selected.type === "current-agent" ? "retain-existing-specialist" : "activate-compiler-specialist",
    evidence: selectionEvidence(activeBundle),
    compatibility: commercialLifecycleCompatibility(brief),
    evidenceReferences: [{ kind: "commercial-bundle", hash: activeBundle.bundleHash }],
  });
  return { registry, role, compatibility: commercialLifecycleCompatibility(brief), selection };
}

export function activatePromotedCommercialBundle({ registry, bundle, contract, environment, previousActivation }) {
  assertCommercialSpecialistBundle(bundle);
  const latest = registry.latest(bundle.role.id);
  requireCondition(latest?.selected?.candidate?.fingerprint === bundle.selected.candidate.fingerprint, "The promoted registry selection does not match the commercial bundle");
  return createCommercialActivationReceipt({ bundle, contract, environment, previousActivation });
}

export function authorizeCommercialRollback({ activeActivation, targetBundle }) {
  return createCommercialRollbackReceipt({ active: activeActivation, target: targetBundle });
}

