export class HumanEffortLedger {
  #sessions = new Map();
  start({ id, approach, roleId, participant }) {
    if (this.#sessions.has(id)) throw new Error("Effort session already exists");
    this.#sessions.set(id, { id, approach, roleId, participant, startedAtMs: Date.now(), finishedAtMs: null, events: [] });
  }
  record(id, event) {
    const session = this.#sessions.get(id);
    if (!session || session.finishedAtMs) throw new Error("Effort session is not active");
    if (!event.kind || !event.description) throw new Error("Effort event requires kind and description");
    session.events.push({ ...structuredClone(event), atMs: Date.now() });
  }
  finish(id) {
    const session = this.#sessions.get(id);
    if (!session || session.finishedAtMs) throw new Error("Effort session is not active");
    session.finishedAtMs = Date.now();
    return this.summary(id);
  }
  summary(id) {
    const session = this.#sessions.get(id);
    if (!session) throw new Error("Unknown effort session");
    const end = session.finishedAtMs ?? Date.now();
    const count = (kind) => session.events.filter((event) => event.kind === kind).length;
    return { id, approach: session.approach, roleId: session.roleId, participant: session.participant, elapsedMs: end - session.startedAtMs, decisions: count("decision"), edits: count("edit"), interventions: count("intervention"), events: structuredClone(session.events), status: session.finishedAtMs ? "finished" : "active" };
  }
}

