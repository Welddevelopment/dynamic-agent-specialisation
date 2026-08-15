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
