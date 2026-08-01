export class EngineeringKnowledgeBase {
  #entries = [];
  add(entry) {
    for (const field of ["id", "claim", "source", "observedAt", "scope", "confidence"]) if (!entry[field]) throw new Error(`Knowledge entry missing ${field}`);
    this.#entries.push(structuredClone(entry));
  }
  query(tags) { return this.#entries.filter((entry) => (entry.tags ?? []).some((tag) => tags.includes(tag))).sort((a, b) => b.confidence - a.confidence).map((entry) => structuredClone(entry)); }
  all() { return this.#entries.map((entry) => structuredClone(entry)); }
}
