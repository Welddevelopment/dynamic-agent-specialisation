/**
 * Compiled runtime guards (PROP-0009).
 *
 * A guard is a bounded, declarative write-precondition carried by the candidate PACKAGE
 * and enforced deterministically by the runtime BEFORE a write reaches the world. A
 * violation never becomes a world denial — it becomes a `guard-blocked` observation the
 * agent can correct from, under the existing non-progress limits.
 *
 * Three kinds, each earned by a failure that defeated every text-only agent:
 * - `stable-retry-key`      same tool + same subject must reuse the FIRST idempotency
 *                           key (the R5 fresh-key retry wall).
 * - `deny-write-if-observed-row`
 *                           block a write when the agent's own most recent read of a
 *                           named source shows a matching row — and FAIL CLOSED when
 *                           that source has not been read this run (the B3
 *                           shared-identity suspend wall; the R3 service-owned wall).
 * - `require-prior-read`    a named write requires a named read to have happened first.
 *
 * Deliberately NOT a general predicate language: no arbitrary code, no model-authored
 * expressions — only these shapes, structurally validated at candidate admission.
 */

export const GUARD_KINDS = Object.freeze(["stable-retry-key", "deny-write-if-observed-row", "require-prior-read"]);

export function validateGuards(guards, candidate) {
  const reasons = [];
  if (guards == null) return reasons;
  if (!Array.isArray(guards)) return ["invalid-guard:not-an-array"];
  const tools = new Set(candidate.tools ?? []);
  guards.forEach((guard, index) => {
    const at = `invalid-guard[${index}]`;
    if (!guard || typeof guard !== "object") { reasons.push(`${at}:not-an-object`); return; }
    if (!GUARD_KINDS.includes(guard.kind)) { reasons.push(`${at}:unknown-kind`); return; }
    if (typeof guard.tool !== "string" || !tools.has(guard.tool)) reasons.push(`${at}:tool-not-in-candidate`);
    if (guard.kind === "stable-retry-key" && typeof guard.subjectField !== "string") reasons.push(`${at}:missing-subjectField`);
    if (guard.kind === "require-prior-read" && (typeof guard.requiredTool !== "string" || !tools.has(guard.requiredTool))) reasons.push(`${at}:requiredTool-not-in-candidate`);
    if (guard.kind === "deny-write-if-observed-row") {
      if (typeof guard.sourceTool !== "string" || !tools.has(guard.sourceTool)) reasons.push(`${at}:sourceTool-not-in-candidate`);
      const clauses = guard.match;
      if (!Array.isArray(clauses) || clauses.length === 0) reasons.push(`${at}:missing-match`);
      else clauses.forEach((clause, clauseIndex) => {
        if (!clause || typeof clause.field !== "string") reasons.push(`${at}:match[${clauseIndex}]:missing-field`);
        const hasEquals = clause.equals !== undefined && clause.equals !== null;
        const hasIn = Array.isArray(clause.in) && clause.in.length > 0;
        if (!hasEquals && !hasIn) reasons.push(`${at}:match[${clauseIndex}]:needs-equals-or-in`);
      });
    }
  });
  return reasons;
}

function clauseMatches(row, clause) {
  const value = row?.[clause.field];
  if (Array.isArray(clause.in) && clause.in.length > 0) return clause.in.includes(value);
  return value === clause.equals;
}

export function createGuardEngine(candidate) {
  const guards = candidate?.guards;
  if (!Array.isArray(guards) || guards.length === 0) return null;
  const byTool = new Map();
  for (const guard of guards) {
    if (!byTool.has(guard.tool)) byTool.set(guard.tool, []);
    byTool.get(guard.tool).push(guard);
  }
  const retryKeyLedger = new Map();

  return {
    /** Returns { allowed: true } or { allowed: false, rule, reason }. Never touches world state. */
    checkWrite(decision, session) {
      for (const guard of byTool.get(decision.name) ?? []) {
        if (guard.kind === "stable-retry-key") {
          const subject = decision.input?.[guard.subjectField];
          const ledgerKey = `${decision.name} ${subject}`;
          const first = retryKeyLedger.get(ledgerKey);
          if (first !== undefined && decision.input?.idempotencyKey !== first) {
            return { allowed: false, rule: guard.kind, reason: `retry for ${subject} must reuse the original idempotency key` };
          }
        }
        if (guard.kind === "require-prior-read") {
          const seen = (session.observations ?? []).some((row) => row.tool === guard.requiredTool);
          if (!seen) return { allowed: false, rule: guard.kind, reason: `${decision.name} requires ${guard.requiredTool} first` };
        }
        if (guard.kind === "deny-write-if-observed-row") {
          let latest = null;
          for (let index = (session.observations ?? []).length - 1; index >= 0; index -= 1) {
            if (session.observations[index].tool === guard.sourceTool) { latest = session.observations[index]; break; }
          }
          if (!latest) return { allowed: false, rule: guard.kind, reason: `${decision.name} requires a prior ${guard.sourceTool} observation` };
          let rows = Array.isArray(latest.output) ? latest.output : [latest.output];
          if (guard.rowSubjectField && guard.subjectField) {
            rows = rows.filter((row) => row?.[guard.rowSubjectField] === decision.input?.[guard.subjectField]);
          }
          const hit = rows.find((row) => (guard.match ?? []).every((clause) => clauseMatches(row, clause)));
          if (hit) return { allowed: false, rule: guard.kind, reason: `${guard.sourceTool} shows a blocking row for ${decision.name}` };
        }
      }
      return { allowed: true };
    },
    /** Record only writes that actually proceed, so the first USED key is the anchor. */
    recordExecutedWrite(decision) {
      for (const guard of byTool.get(decision.name) ?? []) {
        if (guard.kind !== "stable-retry-key") continue;
        const subject = decision.input?.[guard.subjectField];
        const ledgerKey = `${decision.name} ${subject}`;
        if (!retryKeyLedger.has(ledgerKey)) retryKeyLedger.set(ledgerKey, decision.input?.idempotencyKey);
      }
    },
  };
}
