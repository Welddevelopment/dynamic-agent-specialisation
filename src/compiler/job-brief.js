const REQUIRED_GROUPS = ["outcome", "environment", "policies", "authority", "examples", "successCriteria", "priorities"];

export function compileJobBrief(input) {
  const brief = {
    id: String(input.id ?? "").trim(), role: String(input.role ?? "").trim(), outcome: input.outcome ?? null,
    environment: input.environment ?? null, policies: input.policies ?? null, authority: input.authority ?? null,
    examples: input.examples ?? null, successCriteria: input.successCriteria ?? null, priorities: input.priorities ?? null,
    assumptions: Array.isArray(input.assumptions) ? input.assumptions : [],
  };
  const missing = REQUIRED_GROUPS.filter((key) => brief[key] == null);
  if (!brief.id) missing.push("id");
  if (!brief.role) missing.push("role");
  const consequentialAssumptions = brief.assumptions.filter((item) => item.consequential && item.status !== "confirmed");
  return { brief, readiness: missing.length === 0 && consequentialAssumptions.length === 0 ? "ready" : "blocked", missing, consequentialAssumptions };
}

