import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { acquireCampaignWriterLock, CampaignWriterLockError, inspectCampaignWriterLock, recoverStaleCampaignWriterLock, CAMPAIGN_WRITER_LOCK_RECOVERY_CONFIRMATION } from "../src/core/campaign-writer-lock.js";

function temporaryDirectory(label) { return fs.mkdtempSync(path.join(os.tmpdir(), `das-${label}-`)); }
function remove(directory) { fs.rmSync(directory, { recursive: true, force: true }); }
function child(script, arguments_) {
  return new Promise((resolve) => {
    const process_ = spawn(process.execPath, ["--input-type=module", "-e", script, ...arguments_], { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    process_.stdout.on("data", (chunk) => { stdout += chunk; }); process_.stderr.on("data", (chunk) => { stderr += chunk; });
    process_.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("exclusive writer lock rejects a second writer before it can enter", () => {
  const directory = temporaryDirectory("writer-lock-direct");
  try {
    const first = acquireCampaignWriterLock({ stateDirectory: directory, campaignId: "campaign", runnerVersion: "test", ownerId: "owner-a" });
    assert.throws(() => acquireCampaignWriterLock({ stateDirectory: directory, campaignId: "campaign", runnerVersion: "test", ownerId: "owner-b" }), (error) => error instanceof CampaignWriterLockError && error.details.existing.liveness.state === "live");
    assert.equal(first.release(), true);
    assert.equal(inspectCampaignWriterLock({ stateDirectory: directory }).exists, false);
  } finally { remove(directory); }
});

test("two concurrent processes allow exactly one writer to mutate campaign state", async () => {
  const directory = temporaryDirectory("writer-lock-processes");
  const modulePath = path.resolve("src/core/campaign-writer-lock.js");
  const script = `
    import fs from "node:fs";
    import { acquireCampaignWriterLock } from ${JSON.stringify(`file://${modulePath}`)};
    const [state, marker] = process.argv.slice(1);
    try {
      const lease = acquireCampaignWriterLock({ stateDirectory: state, campaignId: "concurrent", runnerVersion: "child" });
      fs.appendFileSync(marker, ` + "`entered:${process.pid}\\n`" + `);
      await new Promise((resolve) => setTimeout(resolve, 300));
      lease.release();
      process.stdout.write("entered");
    } catch (error) {
      if (error?.code === "CAMPAIGN_WRITER_LOCKED") { process.stdout.write("locked"); process.exit(23); }
      throw error;
    }
  `;
  const marker = path.join(directory, "mutations.log");
  try {
    const results = await Promise.all([child(script, [directory, marker]), child(script, [directory, marker])]);
    assert.deepEqual(results.map((entry) => entry.stdout).sort(), ["entered", "locked"]);
    assert.deepEqual(results.map((entry) => entry.code).sort((a, b) => a - b), [0, 23]);
    assert.equal(fs.readFileSync(marker, "utf8").trim().split("\n").length, 1);
    assert.equal(inspectCampaignWriterLock({ stateDirectory: directory }).exists, false);
  } finally { remove(directory); }
});

test("a crashed writer leaves a stale lock that needs exact audited recovery", async () => {
  const directory = temporaryDirectory("writer-lock-stale");
  const modulePath = path.resolve("src/core/campaign-writer-lock.js");
  const script = `
    import { acquireCampaignWriterLock } from ${JSON.stringify(`file://${modulePath}`)};
    acquireCampaignWriterLock({ stateDirectory: process.argv[1], campaignId: "stale", runnerVersion: "child-crash" });
  `;
  try {
    const result = await child(script, [directory]); assert.equal(result.code, 0);
    const inspected = inspectCampaignWriterLock({ stateDirectory: directory });
    assert.equal(inspected.integrity, "valid"); assert.equal(inspected.liveness.state, "stale");
    assert.throws(() => acquireCampaignWriterLock({ stateDirectory: directory, campaignId: "stale", runnerVersion: "replacement" }), CampaignWriterLockError);
    assert.throws(() => recoverStaleCampaignWriterLock({ stateDirectory: directory, expectedLockHash: "wrong", audit: { confirmation: CAMPAIGN_WRITER_LOCK_RECOVERY_CONFIRMATION, approvedBy: "test", reason: "recover exact stale test lock" } }), /exact lock metadata/);
    const recovered = recoverStaleCampaignWriterLock({ stateDirectory: directory, expectedLockHash: inspected.metadata.integrityHash, audit: { confirmation: CAMPAIGN_WRITER_LOCK_RECOVERY_CONFIRMATION, approvedBy: "test", reason: "recover exact stale test lock after child exit" }, now: () => new Date("2026-08-12T00:10:00.000Z") });
    assert.equal(recovered.receipt.recoveredLockHash, inspected.metadata.integrityHash);
    assert.equal(inspectCampaignWriterLock({ stateDirectory: directory }).exists, false);
    assert.equal(fs.existsSync(recovered.archivedLockPath), true);
  } finally { remove(directory); }
});

test("SIGTERM during a simulated in-flight call preserves a valid stale lock", async () => {
  const directory = temporaryDirectory("writer-lock-signal");
  const modulePath = path.resolve("src/core/campaign-writer-lock.js");
  const readyPath = path.join(directory, "ready");
  const script = `
    import fs from "node:fs";
    import { acquireCampaignWriterLock } from ${JSON.stringify(`file://${modulePath}`)};
    const lease = acquireCampaignWriterLock({ stateDirectory: process.argv[1], campaignId: "signal", runnerVersion: "child-signal" });
    lease.installProcessGuards();
    fs.writeFileSync(process.argv[2], "provider-call-in-flight");
    setInterval(() => {}, 1_000);
  `;
  try {
    const process_ = spawn(process.execPath, ["--input-type=module", "-e", script, directory, readyPath], { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), stdio: "ignore" });
    for (let attempts = 0; attempts < 100 && !fs.existsSync(readyPath); attempts += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(fs.existsSync(readyPath), true);
    const closed = new Promise((resolve) => process_.once("close", resolve));
    process_.kill("SIGTERM");
    await closed;
    const inspected = inspectCampaignWriterLock({ stateDirectory: directory });
    assert.equal(inspected.integrity, "valid"); assert.equal(inspected.liveness.state, "stale");
    assert.throws(() => acquireCampaignWriterLock({ stateDirectory: directory, campaignId: "signal", runnerVersion: "replacement" }), CampaignWriterLockError);
    recoverStaleCampaignWriterLock({ stateDirectory: directory, expectedLockHash: inspected.metadata.integrityHash, audit: { confirmation: CAMPAIGN_WRITER_LOCK_RECOVERY_CONFIRMATION, approvedBy: "test", reason: "recover exact signal-interrupted test lock" } });
    assert.equal(inspectCampaignWriterLock({ stateDirectory: directory }).exists, false);
  } finally { remove(directory); }
});
