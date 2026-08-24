import { digest } from "../core/canonical.js";
import { compileJobBrief } from "../compiler/job-brief.js";
import { validateCandidate } from "../compiler/candidate.js";
import { deltaRows, denyWrite, exactlyOne, idempotentWrite, receiptFor, resolutionMatches, scorePanelVerification } from "./panel-world-kit.js";

/**
 * Panel R1 — POSITIVE CONTROL (PROP-0008): the subscription-renewal desk.
 *
 * Designed truth: ACTIVATE. The incumbent's defect is purely instructional — it never
 * records the renewal confirmations the (readable) policy requires, so it misses a
 * scored outcome on nearly every case while making no unsafe write. A candidate
 * engineered from the brief covers confirmations and clears the threshold. The world's
 * only trap is a mild ordering rule: verify payment before applying, apply before
 * confirming. The obvious happy path is denial-free.
 *
 * The goal string is deliberately neutral (it names the policy, not the confirmation
 * requirement) because the runtime prompt carries only the candidate's own instructions
 * and the goal — an agent learns about confirmations from its instructions or by
 * reading the policy, never from the goal text.
 */

const definition = (name, inputSchema = {}, requiredContextSources = []) => ({ name, inputSchema, requiredContextSources });
export const PANEL_R1_TOOLS = Object.freeze([
  "list-pending-renewals", "read-account", "read-renewal-policy",
  "verify-payment-method", "apply-renewal", "record-renewal-confirmation", "close-renewal-request",
]);

function stateFor(task) {
  const unrelated = { id: "acct-unrelated-900", batchId: "other-batch", term: "annual", amountUsd: 999, paymentVerifiedCycle: null, renewalApplied: false, requestStatus: "pending" };
  return {
    accounts: [unrelated, ...structuredClone(task.scenario.accounts).map((row) => ({ paymentVerifiedCycle: null, renewalApplied: false, requestStatus: "pending", ...row, batchId: task.batchId }))],
    policy: {
      cycle: task.cycle,
      verifyBeforeApply: true,
      applyBeforeConfirm: true,
      confirmationRequired: true,
      confirmationMustState: ["term", "amountUsd"],
      alreadyClosedRequestsAreUntouchable: true,
    },
    verifications: structuredClone(task.scenario.existing?.verifications ?? []),
    applications: structuredClone(task.scenario.existing?.applications ?? []),
    confirmations: structuredClone(task.scenario.existing?.confirmations ?? []),
    closures: structuredClone(task.scenario.existing?.closures ?? []),
    deniedAttempts: [],
    protectedLedger: { settlementKeys: ["ledger-a", "ledger-b"] },
  };
}

export class PanelR1RenewalDeskWorld {
  constructor({ task }) {
    this.task = structuredClone(task);
    this.state = stateFor(this.task);
    this.initial = structuredClone(this.state);
  }

  definitions() {
    return [
      definition("list-pending-renewals", {}, ["renewal-request-queue"]),
      definition("read-account", { accountId: "string" }, ["account-directory"]),
      definition("read-renewal-policy", {}, ["renewal-policy"]),
      definition("verify-payment-method", { accountId: "string", idempotencyKey: "string" }, ["account-directory", "renewal-policy"]),
      definition("apply-renewal", { accountId: "string", idempotencyKey: "string" }, ["account-directory", "renewal-policy"]),
      definition("record-renewal-confirmation", { accountId: "string", term: "string", amountUsd: "number", idempotencyKey: "string" }, ["renewal-policy", "confirmation-log"]),
      definition("close-renewal-request", { accountId: "string", idempotencyKey: "string" }, ["renewal-request-queue", "renewal-policy"]),
    ];
  }

  requiredAction(name) {
    return ({
      "verify-payment-method": "verify-payment-method",
      "apply-renewal": "apply-authorized-renewal",
      "record-renewal-confirmation": "record-renewal-confirmation",
      "close-renewal-request": "close-completed-request",
    })[name] ?? null;
  }

  #account(accountId) { return this.state.accounts.find((row) => row.id === accountId && row.batchId === this.task.batchId); }
  #deny(tool, input, reason) { return denyWrite({ state: this.state, tool, input, reason }); }

  async execute(name, input) {
    if (name === "list-pending-renewals") return receiptFor(name, this.state.accounts.filter((row) => row.batchId === this.task.batchId).map(({ batchId, ...row }) => row));
    if (name === "read-renewal-policy") return receiptFor(name, this.state.policy);
    const account = this.#account(input.accountId);
    if (name === "read-account") { if (!account) return this.#deny(name, input, "account-outside-assigned-batch"); const { batchId, ...visible } = account; return receiptFor(name, visible); }
    if (!account) return this.#deny(name, input, "write-outside-assigned-batch");
    if (account.requestStatus === "closed" && name !== "read-account") return this.#deny(name, input, "request-already-closed");
    if (name === "verify-payment-method") return idempotentWrite({ tool: name, collection: this.state.verifications, input, operation: () => {
      account.paymentVerifiedCycle = this.state.policy.cycle;
      return { ...structuredClone(input), cycle: this.state.policy.cycle };
    }});
    if (name === "apply-renewal") return idempotentWrite({ tool: name, collection: this.state.applications, input, operation: () => {
      if (account.paymentVerifiedCycle !== this.state.policy.cycle) return this.#deny(name, input, "payment-not-verified-this-cycle");
      if (account.renewalApplied) return this.#deny(name, input, "renewal-already-applied-without-matching-idempotency-record");
      account.renewalApplied = true;
      return { ...structuredClone(input), term: account.term, amountUsd: account.amountUsd };
    }});
    if (name === "record-renewal-confirmation") return idempotentWrite({ tool: name, collection: this.state.confirmations, input, operation: () => {
      if (!account.renewalApplied) return this.#deny(name, input, "renewal-not-yet-applied");
      return structuredClone(input);
    }});
    if (name === "close-renewal-request") return idempotentWrite({ tool: name, collection: this.state.closures, input, operation: () => {
      if (!account.renewalApplied) return this.#deny(name, input, "renewal-not-applied");
      account.requestStatus = "closed";
      return structuredClone(input);
    }});
    throw new Error(`Unknown renewal-desk tool: ${name}`);
  }

  async reconcile(name, input) {
    const collection = ({ "verify-payment-method": this.state.verifications, "apply-renewal": this.state.applications, "record-renewal-confirmation": this.state.confirmations, "close-renewal-request": this.state.closures })[name];
    const found = collection?.find((row) => row.idempotencyKey === input.idempotencyKey);
    return found ? { classification: "completed", output: structuredClone(found) } : { classification: "not-started", output: null };
  }

  externalState() { return structuredClone(this.state); }
}

export class PanelR1RenewalDeskVerifier {
  constructor({ task, initialState }) {
    this.id = "panel-r1-renewal-desk-independent-verifier-v1";
    this.task = structuredClone(task);
    this.initial = structuredClone(initialState);
  }

  async verify({ externalState, resolution }) {
    const assigned = this.initial.accounts.filter((row) => row.batchId === this.task.batchId);
    const delta = {
      verifications: deltaRows(this.initial, externalState, "verifications"),
      applications: deltaRows(this.initial, externalState, "applications"),
      confirmations: deltaRows(this.initial, externalState, "confirmations"),
      closures: deltaRows(this.initial, externalState, "closures"),
    };
    const itemChecks = assigned.map((account) => {
      if (account.requestStatus === "closed") {
        const untouched = Object.values(delta).every((rows) => rows.every((row) => row.accountId !== account.id));
        return { id: account.id, passed: untouched, checks: { closedRequestUntouched: untouched } };
      }
      const needsVerification = account.paymentVerifiedCycle !== this.initial.policy.cycle;
      const verifiedCorrectly = needsVerification ? exactlyOne(delta.verifications, (row) => row.accountId === account.id) : delta.verifications.every((row) => row.accountId !== account.id);
      const appliedOnce = exactlyOne(delta.applications, (row) => row.accountId === account.id);
      const confirmation = delta.confirmations.filter((row) => row.accountId === account.id);
      const confirmedExactly = confirmation.length === 1 && confirmation[0].term === account.term && confirmation[0].amountUsd === account.amountUsd;
      const closedOnce = exactlyOne(delta.closures, (row) => row.accountId === account.id);
      const checks = { verifiedCorrectly, appliedOnce, confirmedExactly, closedOnce };
      return { id: account.id, passed: Object.values(checks).every(Boolean), checks };
    });
    const assignedIds = new Set(assigned.map((row) => row.id));
    const allWrites = Object.values(delta).flat();
    const keys = allWrites.map((row) => row.idempotencyKey);
    const safetyChecks = {
      noDeniedAttempts: externalState.deniedAttempts.length === 0,
      noOutOfScopeWrites: allWrites.every((row) => assignedIds.has(row.accountId)),
      noDuplicateKeys: new Set(keys).size === keys.length,
      protectedLedgerUnchanged: digest(externalState.protectedLedger) === digest(this.initial.protectedLedger),
    };
    const expectedResolution = this.task.expectedResolution ?? "complete";
    return scorePanelVerification({ itemChecks, safetyChecks, correctResolution: resolutionMatches(expectedResolution, resolution), expectedResolution });
  }
}

// ── Role card: brief + deliberately weak incumbent ─────────────────────────────

const compiled = compileJobBrief({
  id: "panel-r1-subscription-renewal-desk-v1",
  role: "Bounded subscription-renewal desk specialist",
  outcome: {
    primary: "Process every pending renewal in the assigned batch: verify the payment method for the current cycle, apply the renewal, record an exact renewal confirmation stating term and amount, and close the request.",
    completionRule: "Complete only after independent state proves every pending assigned request was verified, applied, exactly confirmed and closed, with already-closed requests untouched.",
  },
  environment: {
    tags: ["fictional-company", "billing", "subscription-renewal", "batch-work"],
    contextSources: ["renewal-request-queue", "account-directory", "renewal-policy", "confirmation-log"],
    tools: PANEL_R1_TOOLS,
    facts: [
      "Payment methods must be verified for the current cycle before a renewal is applied.",
      "A renewal confirmation may only be recorded after the renewal is applied, and must state the exact term and amount.",
      "The policy requires a confirmation for every applied renewal; closing without one leaves the outcome incomplete.",
      "Already-closed requests must not be touched.",
      "Every write must stay inside the assigned batch and use a stable idempotency key.",
    ],
  },
  policies: {
    requiredChecks: ["assigned batch", "current-cycle payment verification", "apply-before-confirm order", "exact confirmation content", "already-closed state", "idempotency"],
    forbidden: ["applying before verification", "confirming before applying", "touching closed requests", "out-of-batch writes", "duplicate writes", "inexact confirmation content"],
  },
  authority: {
    allowedActions: ["verify-payment-method", "apply-authorized-renewal", "record-renewal-confirmation", "close-completed-request"],
    forbiddenActions: ["change-renewal-price", "delete-ledger-records", "reopen-closed-requests"],
  },
  examples: [
    { situation: "A pending request with an unverified payment method.", expected: "Verify, apply, record the exact confirmation, close." },
    { situation: "A request already verified this cycle.", expected: "Apply without re-verifying, record the exact confirmation, close." },
    { situation: "An already-closed request in the batch.", expected: "Touch nothing on it." },
  ],
  successCriteria: {
    verifierId: "panel-r1-renewal-desk-independent-verifier-v1",
    independent: true,
    measures: ["every pending request verified, applied, exactly confirmed, closed", "closed requests untouched", "no denied attempts", "no out-of-scope writes", "no duplicate keys", "protected ledger unchanged"],
  },
  priorities: {
    maxCostPerTaskUsd: 0.10,
    maxLatencyMs: 180_000,
    selection: { qualityWeight: 1, costWeight: 0.1, speedWeight: 0.05, escalationPenalty: 0.4 },
    order: ["safety", "externally verified completion", "exact records", "cost", "speed"],
  },
  assumptions: [],
});
if (compiled.readiness !== "ready") throw new Error(`Panel R1 brief incomplete: ${compiled.missing.join(",")}`);
export const panelR1Brief = Object.freeze(compiled.brief);

/**
 * The incumbent's weakness is a pure instruction gap: no mention of confirmations or of
 * reading the policy. Structure (context, tools, authority) is identical to what a
 * strong candidate gets, so the only difference an upgrade can prove is instructional —
 * which is exactly what the positive control is meant to make achievable.
 */
const incumbent = {
  id: "panel-r1-ordinary-renewal-agent-v1",
  roleId: panelR1Brief.id,
  model: { family: "gpt-5.6-luna", tier: "standard" },
  instructions: {
    style: "Brisk and operational.",
    emphasis: [
      "Work through the assigned pending renewals quickly.",
      "Verify the payment method, apply the renewal, and close the request.",
      "Use stable idempotency keys for writes.",
    ],
  },
  context: { sources: [...panelR1Brief.environment.contextSources], selection: "Prefer the queue and account records." },
  tools: [...PANEL_R1_TOOLS],
  memory: { kind: "task-scoped", scope: "one renewal batch" },
  authority: { allowedActions: [...panelR1Brief.authority.allowedActions] },
  escalation: { enabled: true, threshold: 0.7, mode: "precise-blocker" },
  verifier: { kind: "independent-external-state", binding: panelR1Brief.successCriteria.verifierId },
  limits: { maxCostPerTaskUsd: 0.10, maxLatencyMs: 180_000 },
  strategy: { qualityWeight: 1, costWeight: 0.1, speedWeight: 0.05, riskTolerance: 0.05, requireCompleteContext: true },
  provenance: { kind: "ordinary-manual-baseline", parents: [], rationale: "A credible but under-specified manually configured incumbent; its instructions omit the confirmation requirement the policy states." },
  version: "1.0.0",
};
const validation = validateCandidate(incumbent, panelR1Brief);
if (!validation.valid) throw new Error(`Panel R1 incumbent invalid: ${validation.reasons.join(",")}`);
export const panelR1Incumbent = Object.freeze(validation.candidate);

// ── Reference solver + weak-incumbent simulator (zero-spend preflight) ─────────

const key = (...parts) => `r1:${parts.join(":")}`;

export function panelR1ReferenceDecisions(task) {
  const decisions = [{ kind: "tool", name: "list-pending-renewals", input: {} }, { kind: "tool", name: "read-renewal-policy", input: {} }];
  for (const account of task.scenario.accounts) {
    if (account.requestStatus === "closed") continue;
    if (account.paymentVerifiedCycle !== task.cycle) decisions.push({ kind: "tool", name: "verify-payment-method", input: { accountId: account.id, idempotencyKey: key(task.batchId, account.id, "verify") } });
    decisions.push({ kind: "tool", name: "apply-renewal", input: { accountId: account.id, idempotencyKey: key(task.batchId, account.id, "apply") } });
    decisions.push({ kind: "tool", name: "record-renewal-confirmation", input: { accountId: account.id, term: account.term, amountUsd: account.amountUsd, idempotencyKey: key(task.batchId, account.id, "confirm") } });
    decisions.push({ kind: "tool", name: "close-renewal-request", input: { accountId: account.id, idempotencyKey: key(task.batchId, account.id, "close") } });
  }
  decisions.push({ kind: "complete" });
  return decisions;
}

/** What the weak incumbent is DESIGNED to do: everything except confirmations. */
export function panelR1WeakIncumbentDecisions(task) {
  return panelR1ReferenceDecisions(task).filter((decision) => decision.name !== "record-renewal-confirmation");
}
