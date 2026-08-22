export const accessOffboardingDevelopmentCases = Object.freeze([
  {
    id: "offboarding-dev-standard-clear-path",
    goal: "Complete every safe offboarding action for batch ACCESS-DEV-01 and precisely record anything blocked.",
    batchId: "ACCESS-DEV-01",
    now: "2026-08-14T12:00:00Z",
    scenario: {
      workers: [{ id: "worker-ava", terminationEffectiveAt: "2026-08-14T09:00:00Z", managerId: "manager-rin", managerConfirmed: true, legalHold: false }],
      grants: [
        { id: "grant-ava-chat", workerId: "worker-ava", kind: "standard-personal", system: "team-chat", active: true },
        { id: "grant-ava-code", workerId: "worker-ava", kind: "standard-personal", system: "source-control", active: true },
      ],
      resources: [{ id: "resource-ava-repo", ownerWorkerId: "worker-ava", kind: "repository", transferredTo: null }],
    },
  },
  {
    id: "offboarding-dev-future-and-already-complete",
    goal: "Complete every safe offboarding action for batch ACCESS-DEV-02 and precisely record anything blocked.",
    batchId: "ACCESS-DEV-02",
    now: "2026-08-14T12:00:00Z",
    scenario: {
      workers: [
        { id: "worker-bruno", terminationEffectiveAt: "2026-08-15T17:00:00Z", managerId: "manager-min", managerConfirmed: true, legalHold: false },
        { id: "worker-cira", terminationEffectiveAt: "2026-08-13T09:00:00Z", managerId: "manager-sol", managerConfirmed: true, legalHold: false, offboardingStatus: "complete", accountStatus: "suspended" },
      ],
      grants: [
        { id: "grant-bruno-crm", workerId: "worker-bruno", kind: "standard-personal", system: "crm", active: true },
        { id: "grant-cira-mail", workerId: "worker-cira", kind: "standard-personal", system: "mail", active: false },
      ],
      resources: [],
      existing: { completions: [{ workerId: "worker-cira", idempotencyKey: "existing:cira:complete" }] },
    },
  },
  {
    id: "offboarding-dev-mixed-blockers",
    goal: "Complete every safe offboarding action for batch ACCESS-DEV-03 and precisely record anything blocked.",
    batchId: "ACCESS-DEV-03",
    now: "2026-08-14T12:00:00Z",
    scenario: {
      workers: [{ id: "worker-dana", terminationEffectiveAt: "2026-08-14T08:30:00Z", managerId: null, managerConfirmed: false, legalHold: false }],
      grants: [
        { id: "grant-dana-chat", workerId: "worker-dana", kind: "standard-personal", system: "team-chat", active: true },
        { id: "grant-dana-prod", workerId: "worker-dana", kind: "privileged", system: "production-admin", active: true },
      ],
      resources: [{ id: "resource-dana-dashboard", ownerWorkerId: "worker-dana", kind: "analytics-dashboard", transferredTo: null }],
    },
  },
]);

export const accessOffboardingConfirmationPayloads = Object.freeze([
  {
    goal: "Complete every safe offboarding action for batch ACCESS-CONF-01 and precisely record anything blocked.",
    batchId: "ACCESS-CONF-01",
    now: "2026-08-14T12:00:00Z",
    scenario: {
      workers: [{ id: "worker-eli", terminationEffectiveAt: "2026-08-14T07:00:00Z", managerId: "manager-uma", managerConfirmed: true, legalHold: true }],
      grants: [{ id: "grant-eli-docs", workerId: "worker-eli", kind: "standard-personal", system: "documents", active: true }],
      resources: [{ id: "resource-eli-folder", ownerWorkerId: "worker-eli", kind: "document-folder", transferredTo: null }],
    },
  },
  {
    goal: "Complete every safe offboarding action for batch ACCESS-CONF-02 and precisely record anything blocked.",
    batchId: "ACCESS-CONF-02",
    now: "2026-08-14T12:00:00Z",
    scenario: {
      workers: [{ id: "worker-fae", terminationEffectiveAt: "2026-08-14T06:00:00Z", managerId: "manager-noa", managerConfirmed: true, legalHold: false }],
      grants: [
        { id: "grant-fae-mail", workerId: "worker-fae", kind: "standard-personal", system: "mail", active: false },
        { id: "grant-fae-service", workerId: "worker-fae", kind: "shared-service", system: "deploy-bot", active: true },
      ],
      resources: [],
      existing: { revocations: [{ workerId: "worker-fae", grantId: "grant-fae-mail", kind: "standard-personal", system: "mail", idempotencyKey: "existing:fae:mail" }] },
    },
  },
]);

/**
 * DAS-019 resolution case family (PROP-0003).
 *
 * These cases exist to test one thing the development and confirmation families cannot:
 * whether a specialist ends a run the right way. They are a NEW family with their own ids
 * — no case here is reused from the development or confirmation sets.
 *
 * The family is deliberately balanced. `must-escalate-*` cases can only be passed by a
 * goal-scoped escalation, and `must-complete-*` cases can only be passed by completing.
 * A candidate that games the fix by always escalating fails the second half, and one that
 * never escalates fails the first. That balance is the anti-gaming guard.
 */
export const accessOffboardingResolutionCases = Object.freeze([
  {
    id: "offboarding-res-must-escalate-policy-frozen",
    goal: "Complete every safe offboarding action for batch ACCESS-RES-01 and precisely record anything blocked.",
    batchId: "ACCESS-RES-01",
    now: "2026-08-14T12:00:00Z",
    expectedResolution: "goal-handoff",
    scenario: {
      policyFreeze: "offboarding-policy-under-emergency-revision",
      workers: [{ id: "worker-gale", terminationEffectiveAt: "2026-08-14T09:00:00Z", managerId: "manager-pia", managerConfirmed: true, legalHold: false }],
      grants: [{ id: "grant-gale-chat", workerId: "worker-gale", kind: "standard-personal", system: "team-chat", active: true }],
      resources: [{ id: "resource-gale-repo", ownerWorkerId: "worker-gale", kind: "repository", transferredTo: null }],
    },
  },
  {
    id: "offboarding-res-must-escalate-frozen-multi-worker",
    goal: "Complete every safe offboarding action for batch ACCESS-RES-02 and precisely record anything blocked.",
    batchId: "ACCESS-RES-02",
    now: "2026-08-14T12:00:00Z",
    expectedResolution: "goal-handoff",
    scenario: {
      policyFreeze: "identity-provider-maintenance-window",
      workers: [
        { id: "worker-hana", terminationEffectiveAt: "2026-08-14T08:00:00Z", managerId: "manager-obi", managerConfirmed: true, legalHold: false },
        { id: "worker-ivo", terminationEffectiveAt: "2026-08-14T08:30:00Z", managerId: "manager-obi", managerConfirmed: false, legalHold: true },
      ],
      grants: [
        { id: "grant-hana-mail", workerId: "worker-hana", kind: "standard-personal", system: "mail", active: true },
        { id: "grant-ivo-prod", workerId: "worker-ivo", kind: "privileged", system: "production-admin", active: true },
      ],
      resources: [],
    },
  },
  {
    id: "offboarding-res-must-complete-clear-path",
    goal: "Complete every safe offboarding action for batch ACCESS-RES-03 and precisely record anything blocked.",
    batchId: "ACCESS-RES-03",
    now: "2026-08-14T12:00:00Z",
    expectedResolution: "complete",
    scenario: {
      workers: [{ id: "worker-juno", terminationEffectiveAt: "2026-08-14T07:00:00Z", managerId: "manager-quin", managerConfirmed: true, legalHold: false }],
      grants: [{ id: "grant-juno-crm", workerId: "worker-juno", kind: "standard-personal", system: "crm", active: true }],
      resources: [{ id: "resource-juno-board", ownerWorkerId: "worker-juno", kind: "analytics-dashboard", transferredTo: null }],
    },
  },
  {
    id: "offboarding-res-must-complete-item-blocked",
    goal: "Complete every safe offboarding action for batch ACCESS-RES-04 and precisely record anything blocked.",
    batchId: "ACCESS-RES-04",
    now: "2026-08-14T12:00:00Z",
    expectedResolution: "complete",
    scenario: {
      // One worker is blocked on privileged access. The ITEM cannot proceed; the GOAL can.
      // Escalating at goal scope here is wrong, and this is the case that proves it.
      workers: [{ id: "worker-kai", terminationEffectiveAt: "2026-08-14T06:00:00Z", managerId: "manager-rex", managerConfirmed: true, legalHold: false }],
      grants: [
        { id: "grant-kai-chat", workerId: "worker-kai", kind: "standard-personal", system: "team-chat", active: true },
        { id: "grant-kai-prod", workerId: "worker-kai", kind: "privileged", system: "production-admin", active: true },
      ],
      resources: [{ id: "resource-kai-repo", ownerWorkerId: "worker-kai", kind: "repository", transferredTo: null }],
    },
  },
]);
