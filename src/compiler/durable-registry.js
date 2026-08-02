import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";

const SCHEMA_VERSION = "das.specialist-registry.v1";

function candidatePayload(candidate) {
  const copy = structuredClone(candidate);
  delete copy.fingerprint;
  return copy;
}

function assertCandidateIntegrity(candidate) {
  if (!candidate?.id || !candidate?.roleId || !candidate?.version) throw new Error("Specialist candidate is incomplete");
  if (candidate.verifier?.kind !== "independent-external-state") throw new Error("Specialist must use an independent external-state verifier");
  if (!candidate.fingerprint || digest(candidatePayload(candidate)) !== candidate.fingerprint) throw new Error(`Candidate fingerprint mismatch: ${candidate.id}`);
}

function assertSelectionEvidence(evidence, candidateId) {
  if (!evidence || evidence.candidateId !== candidateId) throw new Error(`Selection evidence does not match candidate: ${candidateId}`);
  const unsafeCount = evidence.unsafeAttempts ?? evidence.safetyViolations;
  if (unsafeCount !== 0) throw new Error(`Unsafe candidate cannot be selected: ${candidateId}`);
  if (evidence.successRate !== 1) throw new Error(`Selected candidate must pass its frozen comparison: ${candidateId}`);
}

function integrityPayload(state) {
  const copy = structuredClone(state);
  delete copy.integrityHash;
  return copy;
}

export class DurableSpecialistRegistry {
  #state;

  constructor({ registryId = "bounded-level1", clock = () => new Date().toISOString(), state = null } = {}) {
    this.clock = clock;
    this.#state = state ?? {
      schemaVersion: SCHEMA_VERSION,
      registryId,
      revision: 0,
      createdAt: this.clock(),
      updatedAt: this.clock(),
      selections: [],
      integrityHash: null,
    };
    this.#verify();
  }

  registerSelection({ role, selectedCandidate, alternatives = [], decision, evidence, compatibility, evidenceReferences = [] }) {
    if (!role?.id || selectedCandidate?.roleId !== role.id) throw new Error("Selection role does not match candidate");
    if (!["activate-compiler-specialist", "retain-existing-specialist"].includes(decision)) throw new Error("Unknown selection decision");
    assertCandidateIntegrity(selectedCandidate);
    assertSelectionEvidence(evidence, selectedCandidate.id);
    for (const alternative of alternatives) {
      assertCandidateIntegrity(alternative.candidate);
      if (alternative.candidate.roleId !== role.id) throw new Error("Alternative role does not match selection role");
    }
    if (!compatibility?.policyHash || !compatibility?.authorityHash || !compatibility?.toolsHash) throw new Error("Selection compatibility contract is incomplete");
    const previous = this.latest(role.id);
    const version = previous ? previous.selectionVersion + 1 : 1;
    const record = {
      roleId: role.id,
      selectionVersion: version,
      selectedAt: this.clock(),
      decision,
      selected: {
        candidate: structuredClone(selectedCandidate),
        evidence: structuredClone(evidence),
        status: "recommended-active",
      },
      alternatives: alternatives.map((alternative) => ({
        candidate: structuredClone(alternative.candidate),
        evidence: structuredClone(alternative.evidence ?? null),
        status: "preserved-not-selected",
      })),
      compatibility: structuredClone(compatibility),
      evidenceReferences: structuredClone(evidenceReferences),
    };
    record.recordHash = digest(record);
    this.#state.selections.push(record);
    this.#state.revision += 1;
    this.#state.updatedAt = this.clock();
    this.#seal();
    return structuredClone(record);
  }

  latest(roleId) {
    const matches = this.#state.selections.filter((selection) => selection.roleId === roleId);
    return structuredClone(matches.at(-1) ?? null);
  }

  activationRecord(roleId) {
    const selection = this.latest(roleId);
    if (!selection) return null;
    return {
      id: selection.selected.candidate.id,
      version: selection.selected.candidate.version,
      status: selection.selected.status,
      candidate: selection.selected.candidate,
      evidence: {
        ...selection.selected.evidence,
        safetyViolations: selection.selected.evidence.safetyViolations ?? selection.selected.evidence.unsafeAttempts,
      },
      compatibility: selection.compatibility,
      fingerprint: selection.recordHash,
    };
  }

  list() { return structuredClone(this.#state.selections); }

  snapshot() {
    this.#seal();
    return structuredClone(this.#state);
  }

  save(filePath) {
    const state = this.snapshot();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, filePath);
    return state;
  }

  static load(filePath, { clock = () => new Date().toISOString() } = {}) {
    const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return new DurableSpecialistRegistry({ state, clock });
  }

  #seal() { this.#state.integrityHash = digest(integrityPayload(this.#state)); }

  #verify() {
    if (this.#state.schemaVersion !== SCHEMA_VERSION) throw new Error("Unsupported specialist registry schema");
    if (!Array.isArray(this.#state.selections)) throw new Error("Specialist registry selections are invalid");
    if (this.#state.integrityHash && digest(integrityPayload(this.#state)) !== this.#state.integrityHash) throw new Error("Specialist registry integrity mismatch");
    for (const selection of this.#state.selections) {
      const copy = structuredClone(selection);
      delete copy.recordHash;
      if (digest(copy) !== selection.recordHash) throw new Error(`Specialist selection integrity mismatch: ${selection.roleId}`);
      assertCandidateIntegrity(selection.selected.candidate);
      assertSelectionEvidence(selection.selected.evidence, selection.selected.candidate.id);
      for (const alternative of selection.alternatives) assertCandidateIntegrity(alternative.candidate);
    }
    if (!this.#state.integrityHash) this.#seal();
  }
}
