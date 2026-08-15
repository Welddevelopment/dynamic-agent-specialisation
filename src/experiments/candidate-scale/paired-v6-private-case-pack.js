import { digest } from "../../core/canonical.js";
import { assertPairedPrivateCasePack, createFreshPairedPrivateCasePack } from "./paired-private-case-pack.js";
import { createPairedScaleProtocolCore } from "./paired-protocol.js";
import { createPairedV6ProtocolCore } from "./paired-v6-protocol.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function withoutHash(value) { const copy = structuredClone(value); delete copy.integrityHash; return copy; }

export async function createFreshPairedV6PrivateCasePack({ seed, createdAt } = {}) {
  const source = await createFreshPairedPrivateCasePack({ ...(seed === undefined ? {} : { seed }), ...(createdAt === undefined ? {} : { createdAt }) });
  assertPairedPrivateCasePack(source, { protocol: createPairedScaleProtocolCore() });
  const protocol = createPairedV6ProtocolCore();
  const pack = {
    ...withoutHash(source),
    schemaVersion: "das.candidate-scale-paired-private-case-pack.v6-contract-repair",
    protocolCoreHash: protocol.protocolCoreHash,
    generatedForCampaign: protocol.campaignId,
    sourceGeneratorBoundary: "Freshly generated with the already-preflighted fictional support case generator; re-bound prospectively to v6 before any v6 candidate generation or performance result.",
  };
  pack.integrityHash = digest(pack);
  assertPairedV6PrivateCasePack(pack, { protocol });
  return pack;
}

export function assertPairedV6PrivateCasePack(pack, { protocol = createPairedV6ProtocolCore() } = {}) {
  requireCondition(pack?.schemaVersion === "das.candidate-scale-paired-private-case-pack.v6-contract-repair", "Unsupported v6 private case pack");
  requireCondition(pack.integrityHash && digest(withoutHash(pack)) === pack.integrityHash, "v6 private case-pack integrity mismatch");
  requireCondition(pack.protocolCoreHash === protocol.protocolCoreHash && pack.generatedForCampaign === protocol.campaignId, "v6 private cases are not bound to this protocol");
  requireCondition(pack.generatedAfterProtocolAndBaselineFreeze === true && pack.freshAndUnexposed === true, "v6 private cases are not prospectively fresh");
  requireCondition(pack.roleHash === protocol.bindings.roleHash && pack.verifierHash === protocol.bindings.verifierHash && pack.baselineHashesHash === protocol.bindings.baselineHashesHash, "v6 role/verifier/baseline binding mismatch");
  const expected = { ...protocol.evaluation.selectionCaseCounts, ...protocol.evaluation.confirmationCaseCounts }; const ids = new Set();
  for (const [stage, count] of Object.entries(expected)) {
    requireCondition(Array.isArray(pack.cases?.[stage]) && pack.cases[stage].length === count, `v6 private ${stage} count mismatch`);
    for (const testCase of pack.cases[stage]) { requireCondition(testCase.id && !ids.has(testCase.id), "v6 private cases need globally unique ids"); ids.add(testCase.id); }
  }
  requireCondition(pack.independentReferenceReceipt?.passed === true && pack.independentReferenceReceipt.unsafeAttempts === 0 && pack.independentReferenceReceipt.incorrectSideEffects === 0, "v6 private reference receipt is not clean");
  requireCondition(pack.shortcutControlReceipt?.allShortcutsRejected === true, "v6 shortcut controls were not rejected");
  return true;
}

export function pairedV6PrivateCasePackHash(pack) { return digest(pack); }
