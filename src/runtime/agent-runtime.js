export class SpecialistAgentRuntime {
  #runSequence = 0;
  constructor({ decisionEngine, memory, evidence, maxTurns = 12, maxConsecutiveReads = 20, maxRepeatedIdenticalRead = 3, maxVerificationRepairRounds = 1, now = () => Date.now() }) {
    this.decisionEngine = decisionEngine; this.memory = memory; this.evidence = evidence; this.maxTurns = maxTurns; this.maxConsecutiveReads = maxConsecutiveReads; this.maxRepeatedIdenticalRead = maxRepeatedIdenticalRead; this.maxVerificationRepairRounds = maxVerificationRepairRounds; this.now = now;
  }
  async run({ tenantId, candidate, goal, toolHost, externalVerifier }) {
    const startedAtMs = this.now();
    const session = { tenantId, roleId: candidate.roleId, specialistVersion: candidate.version, runId: `${candidate.id}:run-${++this.#runSequence}`, memoryPolicy: structuredClone(candidate.memory ?? { kind: "task-scoped", scope: "current run" }), goal, observations: [], toolReceipts: [], reconciled: false, itemEscalations: [], verificationRepairRounds: 0, consecutiveReads: 0, repeatedReadSignatures: {}, modelCostUsd: 0, modelElapsedMs: 0, elapsedMs: 0 };
    if (candidate.verifier?.binding && externalVerifier?.id !== candidate.verifier.binding) {
      const reason = `verifier-binding-mismatch:${candidate.verifier.binding}`;
      this.evidence?.append("runtime.activation-blocked", { tenantId, candidateId: candidate.id, reason, suppliedVerifierId: externalVerifier?.id ?? null });
      return { status: "blocked", reason, session };
    }
    const contextSources = new Set(candidate.context?.sources ?? []);
    const availableTools = toolHost.definitions().filter((tool) => candidate.tools.includes(tool.name) && (tool.requiredContextSources ?? []).every((source) => contextSources.has(source)));
    if (candidate.strategy?.requireCompleteContext && availableTools.length !== candidate.tools.length) {
      const availableNames = new Set(availableTools.map((tool) => tool.name));
      const reason = `required-context-missing:${candidate.tools.filter((tool) => !availableNames.has(tool)).join(",")}`;
      this.evidence?.append("runtime.activation-blocked", { tenantId, candidateId: candidate.id, reason, contextSources: [...contextSources] });
      return { status: "blocked", reason, session };
    }
    const maxCostUsd = candidate.limits?.maxCostPerTaskUsd ?? Infinity;
    const maxLatencyMs = candidate.limits?.maxLatencyMs ?? Infinity;
    const threshold = candidate.escalation?.threshold ?? 0;
    for (let turn = 1; turn <= this.maxTurns; turn += 1) {
      session.elapsedMs = this.now() - startedAtMs;
      if (session.elapsedMs >= maxLatencyMs) return this.#limitOrVerifiedComplete({ tenantId, candidate, session, reason: "candidate-task-latency-limit", goal, toolHost, externalVerifier });
      const priorMemory = this.memory.read(session);
      let decision;
      try {
        decision = await this.decisionEngine.next({ candidate, goal, turn, observations: structuredClone(session.observations), memory: priorMemory, tools: availableTools, remainingCostUsd: maxCostUsd - session.modelCostUsd, remainingLatencyMs: maxLatencyMs - session.elapsedMs });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (reason === "candidate-task-cost-limit-before-call") return this.#limitOrVerifiedComplete({ tenantId, candidate, session, reason, goal, toolHost, externalVerifier });
        throw error;
      }
      session.modelCostUsd += decision.metering?.actualUsd ?? 0;
      session.modelElapsedMs += decision.metering?.elapsedMs ?? 0;
      session.elapsedMs = this.now() - startedAtMs;
      this.evidence?.append("runtime.decision", { tenantId, candidateId: candidate.id, turn, decision });
      if (session.modelCostUsd > maxCostUsd) return this.#limitOrVerifiedComplete({ tenantId, candidate, session, reason: "candidate-task-cost-limit-after-call", goal, toolHost, externalVerifier });
      if (session.elapsedMs > maxLatencyMs) return this.#limitOrVerifiedComplete({ tenantId, candidate, session, reason: "candidate-task-latency-limit-after-call", goal, toolHost, externalVerifier });
      if (decision.kind !== "escalate" && (decision.confidence ?? 1) < threshold) return this.#limitBlocked({ tenantId, candidate, session, reason: "confidence-below-candidate-threshold" });
      if (decision.kind === "escalate") {
        // DAS-019 slice: escalation scope decides whether the run ends. An item-scoped
        // blocker means "this one item cannot proceed"; it records the blocker and keeps
        // working the rest of the goal. Only a goal-scoped blocker is terminal. Scripted
        // and legacy engines that omit the scope keep the original goal-scoped behaviour.
        const escalationScope = decision.escalationScope ?? "goal";
        if (escalationScope === "item") {
          const subjectId = decision.subjectId ?? null;
          const signature = `escalate-item:${decision.blocker}:${subjectId ?? ""}`;
          session.itemEscalations.push({ blocker: decision.blocker, reason: decision.reason, subjectId, turn });
          session.observations.push({ tool: "item-escalation-recorded", output: { blocker: decision.blocker, subjectId, reason: decision.reason } });
          this.memory.append({ ...session, record: { kind: "item-escalation", blocker: decision.blocker, subjectId } });
          this.evidence?.append("runtime.item-escalation", { tenantId, candidateId: candidate.id, turn, blocker: decision.blocker, subjectId });
          session.consecutiveReads += 1;
          session.repeatedReadSignatures[signature] = (session.repeatedReadSignatures[signature] ?? 0) + 1;
          if (session.consecutiveReads > this.maxConsecutiveReads) return { status: "blocked", reason: "non-progress-read-limit", session };
          if (session.repeatedReadSignatures[signature] > this.maxRepeatedIdenticalRead) return { status: "blocked", reason: `repeated-item-escalation:${decision.blocker}`, session };
          continue;
        }
        const verification = await externalVerifier.verify({ goal, candidate, session, externalState: toolHost.externalState(), resolution: { kind: "handoff", scope: "goal", blocker: decision.blocker } });
        this.evidence?.append("runtime.external-verification", { tenantId, candidateId: candidate.id, verification });
        if (!verification.passed && this.#authorizeRepair({ tenantId, candidate, session, verification })) continue;
        return { status: verification.passed ? "handoff" : "verification-failed", reason: decision.reason, blocker: decision.blocker, verification, session };
      }
      if (decision.kind === "complete") {
        const verification = await externalVerifier.verify({ goal, candidate, session, externalState: toolHost.externalState(), resolution: { kind: "complete", blocker: null, reconciled: session.reconciled } });
        this.evidence?.append("runtime.external-verification", { tenantId, candidateId: candidate.id, verification });
        if (!verification.passed) {
          if (!this.#authorizeRepair({ tenantId, candidate, session, verification })) return { status: "verification-failed", verification, session };
          continue;
        }
        this.memory.append({ ...session, record: { kind: "verified-outcome", goal, verification } });
        return { status: "completed", verification, session };
      }
      if (decision.kind !== "tool") throw new Error("Decision engine returned an unsupported decision kind");
      const definition = availableTools.find((tool) => tool.name === decision.name);
      if (!definition || !candidate.tools.includes(decision.name)) return { status: "blocked", reason: `tool-not-allowed-or-context-missing:${decision.name}`, session };
      const requiredAction = toolHost.requiredAction(decision.name);
      if (requiredAction && !candidate.authority.allowedActions.includes(requiredAction)) return { status: "blocked", reason: `authority-missing:${requiredAction}`, session };
      if (!requiredAction) {
        session.consecutiveReads += 1;
        const signature = `${decision.name}:${JSON.stringify(decision.input)}`;
        session.repeatedReadSignatures[signature] = (session.repeatedReadSignatures[signature] ?? 0) + 1;
        if (session.consecutiveReads > this.maxConsecutiveReads) return { status: "blocked", reason: "non-progress-read-limit", session };
        if (session.repeatedReadSignatures[signature] > this.maxRepeatedIdenticalRead) return { status: "blocked", reason: `repeated-identical-read:${decision.name}`, session };
      } else {
        session.consecutiveReads = 0;
        session.repeatedReadSignatures = {};
      }
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
    return this.#limitOrVerifiedComplete({ tenantId, candidate, session, reason: "turn-limit-reached", goal, toolHost, externalVerifier });
  }
  /**
   * One repair round for a recoverable verification failure.
   *
   * `resolution-only` (DAS-019) means the external world state is already exactly right
   * and only the terminal decision kind was wrong — the B2 winner lost 2/2 on precisely
   * that. Repairing it costs one round and cannot launder a wrong world state, because
   * the class is only assigned when every other check already passes.
   */
  #authorizeRepair({ tenantId, candidate, session, verification }) {
    const repairable = ["missing-outcome", "resolution-only"].includes(verification.recoveryClass) && session.verificationRepairRounds < this.maxVerificationRepairRounds;
    if (!repairable) return false;
    session.verificationRepairRounds += 1;
    const feedback = { recoveryClass: verification.recoveryClass, itemChecks: structuredClone(verification.itemChecks ?? []), checks: structuredClone(verification.checks ?? {}) };
    session.observations.push({ tool: "independent-verifier-feedback", output: feedback });
    this.memory.append({ ...session, record: { kind: "verification-repair", feedback } });
    this.evidence?.append("runtime.verification-repair-authorized", { tenantId, candidateId: candidate.id, round: session.verificationRepairRounds, feedback });
    return true;
  }
  async #limitOrVerifiedComplete({ tenantId, candidate, session, reason, goal, toolHost, externalVerifier }) {
    const verification = await externalVerifier.verify({ goal, candidate, session, externalState: toolHost.externalState(), resolution: { kind: "complete", blocker: null, reconciled: session.reconciled, completionSource: "independent-limit-state-check" } });
    this.evidence?.append("runtime.limit-state-verified", { tenantId, candidateId: candidate.id, reason, verification });
    if (!verification.passed) return this.#limitBlocked({ tenantId, candidate, session, reason, verification });
    this.memory.append({ ...session, record: { kind: "verified-outcome", goal, verification, completionSource: "independent-limit-state-check" } });
    return { status: "completed", completionSource: "independent-limit-state-check", limitReason: reason, verification, session };
  }
  #limitBlocked({ tenantId, candidate, session, reason, verification = null }) {
    this.evidence?.append("runtime.limit-blocked", { tenantId, candidateId: candidate.id, reason, modelCostUsd: session.modelCostUsd, elapsedMs: session.elapsedMs, verification });
    return { status: "blocked", reason, verification, session };
  }
}

export class ScriptedDecisionEngine {
  constructor(decisions) { this.decisions = decisions.map((decision) => structuredClone(decision)); }
  async next() {
    if (!this.decisions.length) return { kind: "escalate", reason: "script-exhausted" };
    return { confidence: 1, metering: { actualUsd: 0, elapsedMs: 0, cached: true }, ...this.decisions.shift() };
  }
}
