import { digest } from "../../core/canonical.js";
import { assertPairedPrivateCasePack, createFreshPairedPrivateCasePack } from "./paired-private-case-pack.js";
import { createPairedScaleProtocolCore } from "./paired-protocol.js";
import { createPairedV7ProtocolCore } from "./paired-v7-protocol.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function withoutHash(value) { const copy = structuredClone(value); delete copy.integrityHash; return copy; }

export async function createFreshPairedV7PrivateCasePack({ seed, createdAt } = {}) {
  const source = await createFreshPairedPrivateCasePack({ ...(seed === undefined ? {} : { seed }), ...(createdAt === undefined ? {} : { createdAt }) });
  assertPairedPrivateCasePack(source, { protocol: createPairedScaleProtocolCore() });
  const protocol = createPairedV7ProtocolCore();
  const pack = {
    ...withoutHash(source),
    schemaVersion: "das.candidate-scale-paired-private-case-pack.v7-single-writer-recovery",
    protocolCoreHash: protocol.protocolCoreHash,
    generatedForCampaign: protocol.campaignId,
    sourceGeneratorBoundary: "Freshly generated from the preflighted fictional support generator and prospectively bound to V7 after V6 was invalidated before performance evaluation. No V5/V6 case or candidate observation is imported.",
  };
  pack.integrityHash = digest(pack);
  assertPairedV7PrivateCasePack(pack, { protocol });
  return pack;
}

export function assertPairedV7PrivateCasePack(pack, { protocol = createPairedV7ProtocolCore() } = {}) {
  requireCondition(pack?.schemaVersion === "das.candidate-scale-paired-private-case-pack.v7-single-writer-recovery", "Unsupported V7 private case pack");
  requireCondition(pack.integrityHash && digest(withoutHash(pack)) === pack.integrityHash, "V7 private case-pack integrity mismatch");
  requireCondition(pack.protocolCoreHash === protocol.protocolCoreHash && pack.generatedForCampaign === protocol.campaignId, "V7 private cases are not bound to this protocol");
  requireCondition(pack.generatedAfterProtocolAndBaselineFreeze === true && pack.freshAndUnexposed === true, "V7 private cases are not prospectively fresh");
  requireCondition(pack.roleHash === protocol.bindings.roleHash && pack.verifierHash === protocol.bindings.verifierHash && pack.baselineHashesHash === protocol.bindings.baselineHashesHash, "V7 role/verifier/baseline binding mismatch");
  const expected = { ...protocol.evaluation.selectionCaseCounts, ...protocol.evaluation.confirmationCaseCounts };
  const ids = new Set();
  for (const [stage, count] of Object.entries(expected)) {
    requireCondition(Array.isArray(pack.cases?.[stage]) && pack.cases[stage].length === count, `V7 private ${stage} count mismatch`);
    for (const testCase of pack.cases[stage]) { requireCondition(testCase.id && !ids.has(testCase.id), "V7 private cases need globally unique ids"); ids.add(testCase.id); }
  }
  requireCondition(pack.independentReferenceReceipt?.passed === true && pack.independentReferenceReceipt.unsafeAttempts === 0 && pack.independentReferenceReceipt.incorrectSideEffects === 0, "V7 private reference receipt is not clean");
  requireCondition(pack.shortcutControlReceipt?.allShortcutsRejected === true, "V7 shortcut controls were not rejected");
  return true;
}

export function pairedV7PrivateCasePackHash(pack) { return digest(pack); }
