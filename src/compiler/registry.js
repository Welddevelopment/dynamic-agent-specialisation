import { digest } from "../core/canonical.js";

export class SpecialistRegistry {
  #specialists = [];
  #components = [];
  retainSpecialist({ candidate, evidence, compatibility, status = "available" }) {
    const record = { id: candidate.id, version: candidate.version, status, candidate: structuredClone(candidate), evidence: structuredClone(evidence), compatibility: structuredClone(compatibility), retainedAt: new Date().toISOString() };
    record.fingerprint = digest(record);
    this.#specialists.push(record);
    return structuredClone(record);
  }
  retainComponent(component) { const record = { ...structuredClone(component), fingerprint: digest(component) }; this.#components.push(record); return structuredClone(record); }
  search({ roleTags, environmentTags }) {
    return this.#specialists.map((record) => {
      const roleOverlap = (record.compatibility.roleTags ?? []).filter((tag) => roleTags.includes(tag)).length;
      const environmentOverlap = (record.compatibility.environmentTags ?? []).filter((tag) => environmentTags.includes(tag)).length;
      return { ...structuredClone(record), similarity: roleOverlap * 2 + environmentOverlap };
    }).filter((record) => record.similarity > 0).sort((a, b) => b.similarity - a.similarity);
  }
  list() { return this.#specialists.map((entry) => structuredClone(entry)); }
}
