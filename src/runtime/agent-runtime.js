export class SpecialistAgentRuntime {
  constructor({ decisionEngine, memory, evidence, maxTurns = 12 }) {
    this.decisionEngine = decisionEngine; this.memory = memory; this.evidence = evidence; this.maxTurns = maxTurns;
  }
  async run({ tenantId, candidate, goal, toolHost, externalVerifier }) {
    const session = { tenantId, roleId: candidate.roleId, specialistVersion: candidate.version, goal, observations: [], toolReceipts: [], reconciled: false };
    for (let turn = 1; turn <= this.maxTurns; turn += 1) {
      const priorMemory = this.memory.read(session);
      const decision = await this.decisionEngine.next({ candidate, goal, turn, observations: structuredClone(session.observations), memory: priorMemory, tools: toolHost.definitions().filter((tool) => candidate.tools.includes(tool.name)) });
      this.evidence?.append("runtime.decision", { tenantId, candidateId: candidate.id, turn, decision });
      if (decision.kind === "escalate") {
        const verification = await externalVerifier.verify({ goal, candidate, session, externalState: toolHost.externalState(), resolution: { kind: "handoff", blocker: decision.blocker } });
        this.evidence?.append("runtime.external-verification", { tenantId, candidateId: candidate.id, verification });
        return { status: verification.passed ? "handoff" : "verification-failed", reason: decision.reason, blocker: decision.blocker, verification, session };
      }
      if (decision.kind === "complete") {
        const verification = await externalVerifier.verify({ goal, candidate, session, externalState: toolHost.externalState(), resolution: { kind: "complete", blocker: null, reconciled: session.reconciled } });
        this.evidence?.append("runtime.external-verification", { tenantId, candidateId: candidate.id, verification });
        if (!verification.passed) return { status: "verification-failed", verification, session };
        this.memory.append({ ...session, record: { kind: "verified-outcome", goal, verification } });
        return { status: "completed", verification, session };
      }
      if (decision.kind !== "tool") throw new Error("Decision engine returned an unsupported decision kind");
      const definition = toolHost.definitions().find((tool) => tool.name === decision.name);
      if (!definition || !candidate.tools.includes(decision.name)) return { status: "blocked", reason: `tool-not-allowed:${decision.name}`, session };
      const requiredAction = toolHost.requiredAction(decision.name);
      if (requiredAction && !candidate.authority.allowedActions.includes(requiredAction)) return { status: "blocked", reason: `authority-missing:${requiredAction}`, session };
      let receipt;
      try {
        receipt = await toolHost.execute(decision.name, decision.input, { tenantId, candidateId: candidate.id, turn });
      } catch (error) {
        if (typeof toolHost.reconcile !== "function") return { status: "blocked", reason: `tool-outcome-unknown:${decision.name}`, error: error instanceof Error ? error.message : String(error), session };
        const reconciliation = await toolHost.reconcile(decision.name, decision.input, { tenantId, candidateId: candidate.id, turn });
        this.evidence?.append("runtime.tool-reconciled", { tenantId, candidateId: candidate.id, turn, tool: decision.name, reconciliation });
        if (reconciliation.classification !== "completed") return { status: "blocked", reason: `tool-outcome-${reconciliation.classification}:${decision.name}`, reconciliation, session };
        session.reconciled = true;
        receipt = { id: `reconciled:${decision.name}:${turn}`, output: reconciliation.output, reconciled: true };
      }
      session.toolReceipts.push(receipt);
      session.observations.push({ tool: decision.name, output: receipt.output });
      this.memory.append({ ...session, record: { kind: "tool-receipt", tool: decision.name, receipt } });
      this.evidence?.append("runtime.tool-executed", { tenantId, candidateId: candidate.id, turn, tool: decision.name, receipt });
    }
    return { status: "blocked", reason: "turn-limit-reached", session };
  }
}

export class ScriptedDecisionEngine {
  constructor(decisions) { this.decisions = decisions.map((decision) => structuredClone(decision)); }
  async next() {
    if (!this.decisions.length) return { kind: "escalate", reason: "script-exhausted" };
    return this.decisions.shift();
  }
}
