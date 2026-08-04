import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { assessCommercialReadiness, normalizeCommercialIntake } from "./commercial-intake.js";

function payload(state) { const copy = structuredClone(state); delete copy.integrityHash; return copy; }

export class CommercialOnboardingStore {
  #state;
  constructor({ filePath = null, now = () => new Date().toISOString(), state = null } = {}) {
    this.filePath = filePath;
    this.now = now;
    this.#state = state ?? { schemaVersion: "das.commercial-onboarding-store.v1", revision: 0, sessions: [], events: [], integrityHash: null };
    this.#verify();
  }
  saveIntake(input) {
    const intake = normalizeCommercialIntake(input);
    const previous = this.latest(intake.sessionId);
    const revision = (previous?.revision ?? 0) + 1;
    const record = { sessionId: intake.sessionId, revision, savedAt: this.now(), intake, readiness: assessCommercialReadiness(intake) };
    record.recordHash = digest(record);
    this.#state.sessions.push(record);
    this.#state.revision += 1;
    this.#state.events.push({ at: this.now(), type: previous ? "onboarding.updated" : "onboarding.created", sessionId: intake.sessionId, revision, highestReadyStage: record.readiness.highestReadyStage, recordHash: record.recordHash });
    this.#seal();
    this.#persist();
    return structuredClone(record);
  }
  latest(sessionId) { return structuredClone(this.#state.sessions.filter((item) => item.sessionId === sessionId).at(-1) ?? null); }
  list() { const ids = [...new Set(this.#state.sessions.map((item) => item.sessionId))]; return ids.map((id) => this.latest(id)); }
  snapshot() { this.#seal(); return structuredClone(this.#state); }
  static load(filePath, { now = () => new Date().toISOString() } = {}) { return new CommercialOnboardingStore({ filePath, now, state: JSON.parse(fs.readFileSync(filePath, "utf8")) }); }
  #seal() { this.#state.integrityHash = digest(payload(this.#state)); }
  #persist() { if (!this.filePath) return; fs.mkdirSync(path.dirname(this.filePath), { recursive: true }); const temporary = `${this.filePath}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(this.snapshot(), null, 2)}\n`, { encoding: "utf8", mode: 0o600 }); fs.renameSync(temporary, this.filePath); }
  #verify() {
    if (this.#state.schemaVersion !== "das.commercial-onboarding-store.v1") throw new Error("Unsupported onboarding-store schema");
    if (this.#state.integrityHash && digest(payload(this.#state)) !== this.#state.integrityHash) throw new Error("Onboarding-store integrity mismatch");
    for (const record of this.#state.sessions ?? []) { const copy = structuredClone(record); const expected = copy.recordHash; delete copy.recordHash; if (digest(copy) !== expected) throw new Error("Onboarding record integrity mismatch"); }
    if (!this.#state.integrityHash) this.#seal();
  }
}
