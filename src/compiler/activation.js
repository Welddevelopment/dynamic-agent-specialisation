import { digest } from "../core/canonical.js";

export function activationReadiness({ specialist, role, currentEnvironment, activeTasks = [] }) {
  const checks = [
    { id: "role", passed: specialist.candidate.roleId === role.id },
    { id: "policies", passed: currentEnvironment.policyHash === digest(role.brief.policies) },
    { id: "authority", passed: currentEnvironment.authorityHash === digest(role.brief.authority) },
    { id: "systems", passed: role.brief.environment.tools.every((tool) => currentEnvironment.availableTools.includes(tool)) },
    { id: "verification", passed: specialist.evidence.safetyViolations === 0 && specialist.evidence.successRate > 0 },
    { id: "transition", passed: activeTasks.every((task) => task.status === "terminal") },
  ];
  return { ready: checks.every((check) => check.passed), checks };
}

