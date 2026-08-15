import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digest } from "../src/core/canonical.js";
import { SourceGroundedBindingDraftStore } from "../src/product/source-grounded-binding-draft-store.js";

function session({ revision = 0, previousRevisionHash = null } = {}) {
  const value = { schemaVersion: "das.source-grounded-binding-draft-session.v1", sessionId: "draft-session", revision, previousRevisionHash, gates: { executable: false, activationReady: false } };
  value.sessionHash = digest(value);
  return value;
}

test("source-grounded draft store persists exact linked revisions and reloads", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "das-draft-store-"));
  const filePath = path.join(root, "drafts.json");
  const store = new SourceGroundedBindingDraftStore({ filePath });
  const first = session();
  store.save(first);
  assert.deepEqual(store.save(first), first);
  const second = session({ revision: 1, previousRevisionHash: first.sessionHash });
  store.save(second);
  assert.deepEqual(SourceGroundedBindingDraftStore.load(filePath).load("draft-session"), second);
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
});

test("source-grounded draft store rejects stale, conflicting and mutated sessions", () => {
  const store = new SourceGroundedBindingDraftStore();
  const first = session();
  store.save(first);
  assert.throws(() => store.save(session({ revision: 1, previousRevisionHash: digest("wrong") })), /stale or conflicting/);
  const changed = structuredClone(first); changed.gates.executable = true;
  assert.throws(() => store.save(changed), /integrity/);
  const snapshot = store.snapshot(); snapshot.sessions[0].gates.activationReady = true;
  assert.throws(() => new SourceGroundedBindingDraftStore({ state: snapshot }), /integrity/);
});
