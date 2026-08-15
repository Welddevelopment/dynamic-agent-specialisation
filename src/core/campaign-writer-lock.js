import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { digest } from "./canonical.js";

const LOCK_FILENAME = ".campaign-writer.lock.json";
const RECOVERY_CONFIRMATION = "RECOVER_STALE_CAMPAIGN_WRITER_LOCK";
const SIGNAL_EXIT_CODES = Object.freeze({ SIGHUP: 129, SIGINT: 130, SIGTERM: 143 });

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function withoutHash(value, key = "integrityHash") { const copy = structuredClone(value); delete copy[key]; return copy; }
function writePrivate(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, filePath); fs.chmodSync(filePath, 0o600);
}

function lockPathFor(stateDirectory) { return path.join(path.resolve(stateDirectory), LOCK_FILENAME); }

function processLiveness(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return { state: "unknown", reason: "owner-pid-is-invalid" };
  try { process.kill(pid, 0); return { state: "live", reason: pid === process.pid ? "owner-is-current-process" : "owner-process-responds" }; }
  catch (error) {
    if (error?.code === "ESRCH") return { state: "stale", reason: "owner-process-does-not-exist" };
    if (error?.code === "EPERM") return { state: "live", reason: "owner-process-exists-but-is-not-inspectable" };
    return { state: "unknown", reason: `owner-process-check-failed:${error?.code ?? "unknown"}` };
  }
}

export class CampaignWriterLockError extends Error {
  constructor(message, details = {}) { super(message); this.name = "CampaignWriterLockError"; this.code = "CAMPAIGN_WRITER_LOCKED"; this.details = Object.freeze(structuredClone(details)); }
}

export function inspectCampaignWriterLock({ stateDirectory }) {
  const lockPath = lockPathFor(stateDirectory);
  if (!fs.existsSync(lockPath)) return Object.freeze({ exists: false, lockPath, integrity: "absent", liveness: { state: "absent", reason: "no-lock-file" } });
  const bytes = fs.readFileSync(lockPath);
  let metadata;
  try { metadata = JSON.parse(bytes.toString("utf8")); }
  catch { return Object.freeze({ exists: true, lockPath, bytesHash: digest(bytes.toString("base64")), integrity: "corrupt", liveness: { state: "unknown", reason: "lock-json-is-invalid" }, metadata: null }); }
  const integrity = metadata?.schemaVersion === "das.campaign-writer-lock.v1" && metadata.integrityHash === digest(withoutHash(metadata)) ? "valid" : "corrupt";
  const liveness = integrity === "valid" ? processLiveness(metadata.pid) : { state: "unknown", reason: "lock-integrity-is-invalid" };
  return Object.freeze({ exists: true, lockPath, bytesHash: digest(bytes.toString("base64")), integrity, liveness, metadata: Object.freeze(structuredClone(metadata)) });
}

export function acquireCampaignWriterLock({ stateDirectory, campaignId, runnerVersion, now = () => new Date(), pid = process.pid, ownerId = crypto.randomUUID() }) {
  requireCondition(stateDirectory, "Campaign writer lock needs a state directory");
  requireCondition(typeof campaignId === "string" && campaignId.trim(), "Campaign writer lock needs a campaign id");
  requireCondition(typeof runnerVersion === "string" && runnerVersion.trim(), "Campaign writer lock needs a runner version");
  fs.mkdirSync(path.resolve(stateDirectory), { recursive: true, mode: 0o700 });
  const lockPath = lockPathFor(stateDirectory);
  const acquiredAt = now().toISOString();
  const processStartedAt = new Date(Date.now() - process.uptime() * 1_000).toISOString();
  const metadataCore = { schemaVersion: "das.campaign-writer-lock.v1", lockVersion: 1, campaignId, runnerVersion, ownerId, pid, processStartedAt, acquiredAt };
  const metadata = Object.freeze({ ...metadataCore, integrityHash: digest(metadataCore) });
  let descriptor;
  try {
    descriptor = fs.openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = inspectCampaignWriterLock({ stateDirectory });
    throw new CampaignWriterLockError(`Candidate-scale campaign ${campaignId} already has a ${existing.liveness.state} writer lock; normal startup will not take it over`, { requestedCampaignId: campaignId, existing });
  }
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } catch (error) {
    try { fs.closeSync(descriptor); } catch {}
    try { fs.unlinkSync(lockPath); } catch {}
    throw error;
  }

  let released = false;
  const signalHandlers = new Map();
  function removeProcessGuards() {
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    signalHandlers.clear();
  }
  function release() {
    if (released) return false;
    const current = inspectCampaignWriterLock({ stateDirectory });
    requireCondition(current.exists && current.integrity === "valid" && current.metadata.ownerId === ownerId && current.metadata.integrityHash === metadata.integrityHash, "Campaign writer lock ownership changed; refusing to remove another or corrupted lock");
    fs.closeSync(descriptor); descriptor = null;
    fs.unlinkSync(lockPath); released = true; removeProcessGuards(); return true;
  }
  function installProcessGuards() {
    if (released || signalHandlers.size) return;
    for (const signal of Object.keys(SIGNAL_EXIT_CODES)) {
      // A signal can arrive while a provider request is in flight. Deleting the
      // lock would let another writer repeat an unknown-cost call. Leave the
      // valid lock on disk; the OS closes the descriptor and audited stale-lock
      // recovery is then required before any future writer can proceed.
      const handler = () => { process.exit(SIGNAL_EXIT_CODES[signal]); };
      signalHandlers.set(signal, handler); process.once(signal, handler);
    }
  }
  return Object.freeze({ lockPath, metadata, installProcessGuards, release, isReleased: () => released });
}

export async function withCampaignWriterLock(options, operation) {
  requireCondition(typeof operation === "function", "Campaign writer lock needs an operation");
  const lease = acquireCampaignWriterLock(options); lease.installProcessGuards();
  try { return await operation(lease); }
  finally { if (!lease.isReleased()) lease.release(); }
}

export function recoverStaleCampaignWriterLock({ stateDirectory, expectedLockHash, audit, now = () => new Date() }) {
  const inspected = inspectCampaignWriterLock({ stateDirectory });
  requireCondition(inspected.exists, "There is no campaign writer lock to recover");
  requireCondition(inspected.integrity === "valid", "A corrupt lock cannot be recovered automatically; preserve it for manual forensic review");
  requireCondition(inspected.liveness.state === "stale", `Only a demonstrably stale lock can be recovered; current state is ${inspected.liveness.state}`);
  requireCondition(expectedLockHash === inspected.metadata.integrityHash, "Stale-lock recovery approval is not bound to the exact lock metadata");
  requireCondition(audit?.confirmation === RECOVERY_CONFIRMATION, `Stale-lock recovery requires confirmation=${RECOVERY_CONFIRMATION}`);
  requireCondition(typeof audit.approvedBy === "string" && audit.approvedBy.trim().length >= 2 && typeof audit.reason === "string" && audit.reason.trim().length >= 12, "Stale-lock recovery needs an accountable approver and reason");
  const recoveryDirectory = path.join(path.resolve(stateDirectory), "writer-lock-recovery"); fs.mkdirSync(recoveryDirectory, { recursive: true, mode: 0o700 });
  const recoveryId = `${now().toISOString().replaceAll(":", "-")}-${inspected.metadata.integrityHash.slice(0, 16)}`;
  const archivedLockPath = path.join(recoveryDirectory, `${recoveryId}.lock.json`);
  fs.renameSync(inspected.lockPath, archivedLockPath);
  const receiptCore = { schemaVersion: "das.campaign-writer-lock-recovery.v1", recoveryId, recoveredAt: now().toISOString(), campaignId: inspected.metadata.campaignId, recoveredLockHash: inspected.metadata.integrityHash, recoveredLockBytesHash: inspected.bytesHash, archivedLockPath, priorOwner: { ownerId: inspected.metadata.ownerId, pid: inspected.metadata.pid, processStartedAt: inspected.metadata.processStartedAt, acquiredAt: inspected.metadata.acquiredAt, runnerVersion: inspected.metadata.runnerVersion }, livenessEvidence: inspected.liveness, audit: { confirmation: audit.confirmation, approvedBy: audit.approvedBy.trim(), reason: audit.reason.trim() } };
  const receipt = { ...receiptCore, receiptHash: digest(receiptCore) }; const receiptPath = path.join(recoveryDirectory, `${recoveryId}.receipt.json`); writePrivate(receiptPath, receipt);
  return Object.freeze({ receipt: Object.freeze(receipt), receiptPath, archivedLockPath });
}

export const CAMPAIGN_WRITER_LOCK_FILENAME = LOCK_FILENAME;
export const CAMPAIGN_WRITER_LOCK_RECOVERY_CONFIRMATION = RECOVERY_CONFIRMATION;
