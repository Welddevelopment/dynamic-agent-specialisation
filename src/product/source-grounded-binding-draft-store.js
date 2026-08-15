import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }

export class SourceGroundedBindingDraftStore {
  #state;

  constructor({ filePath = null, state = null } = {}) {
    this.filePath = filePath;
    this.#state = state ?? {
      schemaVersion: "das.source-grounded-binding-draft-store.v1",
      sessions: [],
      storeHash: null,
    };
    this.#verify();
  }

  save(session) {
    requireCondition(session?.schemaVersion === "das.source-grounded-binding-draft-session.v1" && /^[a-f0-9]{64}$/.test(session.sessionHash ?? ""), "Draft store accepts only an integrity-bound source-grounded session");
    requireCondition(session.sessionHash === digest(withoutHash(session, "sessionHash")), "Source-grounded draft session integrity mismatch");
    const existing = this.#state.sessions.find((item) => item.sessionId === session.sessionId);
    if (existing) {
      if (existing.sessionHash === session.sessionHash) return structuredClone(existing);
      requireCondition(session.revision > existing.revision && session.previousRevisionHash === existing.sessionHash, "Draft store rejected a stale or conflicting session revision");
      this.#state.sessions = this.#state.sessions.filter((item) => item.sessionId !== session.sessionId);
    } else requireCondition(session.revision === 0 && session.previousRevisionHash === null, "Draft store first revision must be revision zero");
    this.#state.sessions.push(structuredClone(session));
    this.#state.sessions.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
    this.#seal();
    this.#persist();
    return structuredClone(session);
  }

  load(sessionId) {
    const session = this.#state.sessions.find((item) => item.sessionId === sessionId);
    return session ? structuredClone(session) : null;
  }

  snapshot() { this.#seal(); return structuredClone(this.#state); }

  static load(filePath) {
    return new SourceGroundedBindingDraftStore({ filePath, state: JSON.parse(fs.readFileSync(filePath, "utf8")) });
  }

  #seal() { this.#state.storeHash = digest(withoutHash(this.#state, "storeHash")); }

  #verify() {
    requireCondition(this.#state.schemaVersion === "das.source-grounded-binding-draft-store.v1", "Unsupported source-grounded draft-store schema");
    if (this.#state.storeHash) requireCondition(this.#state.storeHash === digest(withoutHash(this.#state, "storeHash")), "Source-grounded draft-store integrity mismatch");
    const ids = new Set();
    for (const session of this.#state.sessions ?? []) {
      requireCondition(!ids.has(session.sessionId), "Source-grounded draft store contains duplicate session ids");
      ids.add(session.sessionId);
      requireCondition(session.sessionHash === digest(withoutHash(session, "sessionHash")), "Source-grounded draft session integrity mismatch");
    }
    if (!this.#state.storeHash) this.#seal();
  }

  #persist() {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.snapshot(), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
    fs.chmodSync(this.filePath, 0o600);
  }
}
