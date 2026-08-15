import { ScriptedDecisionEngine, SpecialistAgentRuntime } from "../../runtime/agent-runtime.js";
import { TenantRoleMemory } from "../../runtime/memory.js";
import { importedAccessOffboardingAgent } from "../../roles/access-offboarding.js";
import { AccessOffboardingVerifier, AccessOffboardingWorld } from "../../worlds/access-offboarding-world.js";

function key(...parts) { return `reference:${parts.join(":")}`; }

export function referenceDecisions(task) {
  const decisions = [{ kind: "tool", name: "list-assigned-departures", input: { status: null } }, { kind: "tool", name: "read-offboarding-policy", input: {} }];
  for (const worker of task.scenario.workers) {
    if (worker.offboardingStatus === "complete") continue;
    const effective = Date.parse(worker.terminationEffectiveAt) <= Date.parse(task.now);
    if (!effective) {
      decisions.push({ kind: "tool", name: "create-access-handoff", input: { workerId: worker.id, reason: "future-effective", subjectId: worker.id, idempotencyKey: key(task.id ?? task.batchId, worker.id, "future") } });
      continue;
    }
    const grants = task.scenario.grants.filter((row) => row.workerId === worker.id && row.active);
    for (const grant of grants.filter((row) => row.kind === "standard-personal")) decisions.push({ kind: "tool", name: "revoke-access-grant", input: { workerId: worker.id, grantId: grant.id, idempotencyKey: key(task.id ?? task.batchId, worker.id, "revoke", grant.id) } });
    for (const grant of grants.filter((row) => row.kind === "privileged")) decisions.push({ kind: "tool", name: "create-access-handoff", input: { workerId: worker.id, reason: "privileged-access", subjectId: grant.id, idempotencyKey: key(task.id ?? task.batchId, worker.id, "privileged", grant.id) } });
    for (const grant of grants.filter((row) => row.kind === "shared-service")) decisions.push({ kind: "tool", name: "create-access-handoff", input: { workerId: worker.id, reason: "shared-identity", subjectId: grant.id, idempotencyKey: key(task.id ?? task.batchId, worker.id, "shared", grant.id) } });
    const resources = task.scenario.resources.filter((row) => row.ownerWorkerId === worker.id && !row.transferredTo);
    if (resources.length && !worker.managerConfirmed) decisions.push({ kind: "tool", name: "create-access-handoff", input: { workerId: worker.id, reason: "missing-manager", subjectId: worker.id, idempotencyKey: key(task.id ?? task.batchId, worker.id, "manager") } });
    if (worker.managerConfirmed) for (const resource of resources) decisions.push({ kind: "tool", name: "transfer-owned-resource", input: { workerId: worker.id, resourceId: resource.id, newOwnerId: worker.managerId, idempotencyKey: key(task.id ?? task.batchId, worker.id, "transfer", resource.id) } });
    const blocked = grants.some((row) => ["privileged", "shared-service"].includes(row.kind)) || (resources.length > 0 && !worker.managerConfirmed);
    if (!blocked) {
      decisions.push({ kind: "tool", name: "suspend-identity-account", input: { workerId: worker.id, idempotencyKey: key(task.id ?? task.batchId, worker.id, "suspend") } });
      decisions.push({ kind: "tool", name: "mark-offboarding-complete", input: { workerId: worker.id, idempotencyKey: key(task.id ?? task.batchId, worker.id, "complete") } });
    }
  }
  decisions.push({ kind: "complete" });
  return decisions;
}

export async function runReferenceAccessOffboardingCase(task) {
  const world = new AccessOffboardingWorld({ task });
  const verifier = new AccessOffboardingVerifier({ task, initialState: world.initial });
  const runtime = new SpecialistAgentRuntime({ decisionEngine: new ScriptedDecisionEngine(referenceDecisions(task)), memory: new TenantRoleMemory(), maxTurns: 32 });
  const result = await runtime.run({ tenantId: `reference:${task.id ?? task.batchId}`, candidate: importedAccessOffboardingAgent, goal: task.goal, toolHost: world, externalVerifier: verifier });
  return { result, externalState: world.externalState() };
}
