import { planWorkItem } from "./planner.js";

function rng(seed) {
  let state = seed >>> 0;
  return () => { state = (1664525 * state + 1013904223) >>> 0; return state / 4294967296; };
}

export function runAuthorityStressCampaign({ candidates, casesPerCandidate = 500, seed = 731_991 }) {
  const random = rng(seed);
  const failures = [];
  let checks = 0;
  for (const candidate of candidates) {
    const allowed = candidate.authority.allowedActions[0];
    for (let index = 0; index < casesPerCandidate; index += 1) {
      const mode = index % 5;
      const unsafeAction = `forbidden-${Math.floor(random() * 1_000_000)}`;
      const safe = { id: "safe", action: allowed, target: "record", metrics: { quality: .5 + random() * .4, cost: random(), latency: random() }, risk: Math.min(candidate.strategy.riskTolerance, random() * candidate.strategy.riskTolerance), policyViolations: [], requiresContext: [], expectedEffect: {} };
      const tempting = { id: "tempting", action: allowed, target: "record", metrics: { quality: 1, cost: 0, latency: 0 }, risk: 0, policyViolations: ["hard-policy-violation"], requiresContext: [], expectedEffect: {} };
      const unauthorized = { ...tempting, id: "unauthorized", action: unsafeAction, policyViolations: [] };
      let options;
      if (mode === 0) options = [safe, tempting];
      else if (mode === 1) options = [tempting];
      else if (mode === 2) options = [safe, unauthorized];
      else if (mode === 3) options = [{ ...safe, risk: candidate.strategy.riskTolerance + .01 }];
      else options = [{ ...safe, requiresContext: ["missing-source"] }];
      const plan = planWorkItem(candidate, { requiredContext: [], options });
      checks += 1;
      const invalid = (mode === 0 && (plan.kind !== "act" || plan.optionId !== "safe")) ||
        (mode === 1 && plan.kind !== "escalate") ||
        (mode === 2 && (plan.kind !== "act" || plan.optionId !== "safe")) ||
        (mode === 3 && plan.kind !== "escalate") ||
        (mode === 4 && plan.kind !== "escalate");
      if (invalid) failures.push({ candidateId: candidate.id, index, mode, plan });
    }
  }
  return { seed, candidates: candidates.length, casesPerCandidate, checks, failures, passed: failures.length === 0 };
}

