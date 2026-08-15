import assert from "node:assert/strict";
import test from "node:test";
import { digest } from "../src/core/canonical.js";
import { createCommercialSupportPack } from "../src/product/commercial-support-pack.js";
import { createDeterministicRoleDiscoveryPreviewProvider } from "../src/product/deterministic-role-discovery-preview.js";
import { proposeOnboardingSystemImport } from "../src/product/onboarding-system-import.js";
import {
  assertProvisionalRoleContract,
  createRoleDiscoveryRequest,
  createServerVerifiedSystemImportReceipt,
  discoverRoleFromPlainEnglish,
  roleDiscoveryConfirmationTargetHash,
} from "../src/product/plain-english-role-discovery.js";
import {
  createDeterministicRoleDiscoveryProvider,
  plainEnglishDiscoveryFixtures,
} from "./fixtures/plain-english-role-discovery-fixtures.js";

function approvedCases() {
  return {
    id: "redacted-cases-v1",
    label: "Approved redacted case examples",
    approvedForDiscovery: true,
    content: { cases: ["known incident", "ordinary how-to", "credit requiring review", "security handoff", "duplicate ticket"] },
  };
}

function currentAgent() {
  return {
    id: "current-agent-v1",
    label: "Approved current agent configuration",
    approvedForDiscovery: true,
    content: { model: "existing-model", tools: ["ticket-read", "ticket-reply"], instructionVersion: "support-v3" },
  };
}

function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: { title: "Support sandbox", version: "1.0.0" },
    servers: [{ url: "https://support.example.test" }],
    paths: {
      "/tickets/{ticketId}": {
        parameters: [{ name: "ticketId", in: "path", required: true, schema: { type: "string" } }],
        get: { operationId: "getTicket", summary: "Read one ticket", responses: { "200": { description: "ok" } } },
      },
      "/tickets/{ticketId}/reply": {
        post: {
          operationId: "replyToTicket",
          summary: "Send one reply",
          parameters: [{ name: "ticketId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["message"], additionalProperties: false, properties: { message: { type: "string" } } } } } },
          responses: { "200": { description: "ok" } },
        },
      },
    },
  };
}

function systemImportProposal() {
  const intake = createCommercialSupportPack().intake;
  return proposeOnboardingSystemImport({
    intake,
    systemId: intake.systems[0].id,
    source: { kind: "openapi", document: openApiDocument() },
    provenance: { acquisition: "engineer-local-fixture", label: "Pinned local support schema" },
  });
}

function verifiedSystemImportReceipt(proposal = systemImportProposal()) {
  return createServerVerifiedSystemImportReceipt({
    proposal,
    verification: {
      verifiedBy: "assisted-onboarding-journey",
      verificationId: `${proposal.sessionId}:${proposal.proposalId}`,
      verificationHash: digest({ proposalHash: proposal.proposalHash, source: "unit-test-record" }),
    },
  });
}

function confirmationFor(contract, path, value, confirmedBy = "Procurement owner") {
  const prior = contract.facts.find((fact) => fact.path === path);
  assert.ok(prior, `Missing prior discovery fact for ${path}`);
  return {
    path,
    value,
    confirmed: true,
    confirmedBy,
    confirmedRole: "Business owner",
    priorFactId: prior.factId,
    priorFactHash: roleDiscoveryConfirmationTargetHash(prior),
  };
}

function providerWithFacts(facts, extras = {}) {
  const provider = {
    id: extras.id ?? "test-provider",
    version: "1.0.0",
    async discover(request) {
      return {
        schemaVersion: "das.role-discovery-provider-output.v1",
        requestHash: request.requestHash,
        roleFamily: extras.roleFamily ?? "support-operations",
        roleFamilyConfidence: .8,
        facts,
        warnings: [],
        usage: extras.usage ?? { modelCalls: 0, externalRequests: 0, spendUsd: 0 },
      };
    },
  };
  if (extras.usagePolicy) provider.usagePolicy = extras.usagePolicy;
  return provider;
}

function modelUsage(overrides = {}) {
  return {
    modelCalls: 1,
    externalRequests: 1,
    spendUsd: .01,
    inputTokens: 1_000,
    cachedInputTokens: 0,
    outputTokens: 200,
    elapsedMs: 250,
    provider: "fake-metered-provider",
    requestedModel: "gpt-5.6-luna",
    resolvedModel: "gpt-5.6-luna",
    cached: false,
    ...overrides,
  };
}

function discoveryUsageAuthorization(providerId = "authorized-model-provider", overrides = {}) {
  return {
    schemaVersion: "das.role-discovery-usage-authorization.v1",
    campaignId: "test-model-discovery-campaign",
    planHash: "a".repeat(64),
    providerId,
    maximumCalls: 1,
    maximumExternalRequests: 1,
    maximumSpendUsd: .5,
    ...overrides,
  };
}

test("provider-neutral discovery drafts a provenance-rich contract but grants nothing", async () => {
  const contract = await discoverRoleFromPlainEnglish({
    provider: createDeterministicRoleDiscoveryProvider(),
    input: {
      ...plainEnglishDiscoveryFixtures.support,
      approvedArtifacts: [approvedCases()],
      currentAgentConfiguration: currentAgent(),
    },
  });
  assert.equal(assertProvisionalRoleContract(contract), true);
  assert.equal(contract.roleFamily.proposed, "support-operations");
  assert.equal(contract.provider.usage.spendUsd, 0);
  assert.equal(contract.facts.find((item) => item.path === "input.ordinaryLanguageDescription").status, "observed");
  assert.equal(contract.facts.find((item) => item.path === "role.outcome").status, "inferred-proposal");
  assert.equal(contract.facts.find((item) => item.path === "success.measures").status, "inferred-proposal");
  const representativeCases = contract.facts.find((item) => item.path === "evaluation.representativeCases");
  assert.equal(representativeCases.status, "inferred-proposal");
  assert.equal(representativeCases.provenance[0].claimedBasis, "artifact");
  assert.equal(representativeCases.provenance[0].locatorVerified, false);
  const currentConfiguration = contract.facts.find((item) => item.path === "currentAgent.configuration");
  assert.equal(currentConfiguration.status, "inferred-proposal");
  assert.equal(currentConfiguration.provenance[0].claimedBasis, "current-agent");
  assert.equal(currentConfiguration.provenance[0].locatorVerified, false);
  assert.equal(contract.facts.find((item) => item.path === "authority.allowedActions").customerConfirmationRequired, true);
  assert.deepEqual(contract.authorizations, { authorityGranted: false, credentialsAccepted: false, modelSpend: false, comparisonExecution: false, customerWrites: false, activation: false });
  assert.equal(contract.readiness.executableEnvironmentReady, false);
  assert.equal(contract.readiness.comparisonReady, false);
});

test("support, procurement and RevOps fixtures share the same core without role-specific authority", async () => {
  const provider = createDeterministicRoleDiscoveryProvider();
  for (const key of ["support", "procurement", "revops"]) {
    const fixture = plainEnglishDiscoveryFixtures[key];
    const contract = await discoverRoleFromPlainEnglish({ provider, input: { description: fixture.description } });
    assert.equal(contract.roleFamily.proposed, fixture.expectedFamily);
    assert.equal(contract.roleFamily.supported, true);
    assert.equal(contract.facts.some((item) => item.path === "role.outcome"), true);
    assert.equal(contract.facts.filter((item) => item.category === "consequential-confirmation").every((item) => item.status !== "customer-confirmed"), true);
    assert.equal(contract.authorizations.authorityGranted, false);
  }
});

test("production deterministic provider is an explicit structural preview with zero usage", async () => {
  const contract = await discoverRoleFromPlainEnglish({
    provider: createDeterministicRoleDiscoveryPreviewProvider(),
    input: { description: plainEnglishDiscoveryFixtures.revops.description },
  });
  assert.equal(contract.roleFamily.proposed, "revenue-operations");
  assert.deepEqual(contract.provider.usage, { modelCalls: 0, externalRequests: 0, spendUsd: 0 });
  assert.equal(contract.warnings.some((item) => item.includes("Deterministic structural preview only")), true);
  assert.equal(contract.readiness.comparisonReady, false);
});

test("explicit confirmation can settle business truth but cannot prove executable evidence", async () => {
  const initial = await discoverRoleFromPlainEnglish({
    provider: createDeterministicRoleDiscoveryProvider(),
    input: { description: plainEnglishDiscoveryFixtures.procurement.description },
  });
  const contract = await discoverRoleFromPlainEnglish({
    provider: createDeterministicRoleDiscoveryProvider(),
    input: {
      description: plainEnglishDiscoveryFixtures.procurement.description,
      customerConfirmations: [
        confirmationFor(initial, "authority.allowedActions", ["read approved demand", "create draft purchase orders"]),
        confirmationFor(initial, "forbiddenActions.actions", ["submit purchase orders", "use unapproved suppliers"]),
        confirmationFor(initial, "approvals.requiredActions", ["every submitted order"]),
        confirmationFor(initial, "limits.monetary", { currency: "GBP", amount: 500, action: "draft-only" }),
      ],
    },
  });
  assert.equal(contract.facts.find((item) => item.path === "limits.monetary").status, "customer-confirmed");
  assert.equal(contract.facts.find((item) => item.path === "limits.monetary").executable, false);
  assert.equal(contract.readiness.executableEnvironmentReady, false);
  await assert.rejects(
    discoverRoleFromPlainEnglish({
      provider: createDeterministicRoleDiscoveryProvider(),
      input: {
        description: plainEnglishDiscoveryFixtures.procurement.description,
        customerConfirmations: [{ path: "execution.adapters.aaaaaaaaaaaa", value: { status: "verified" }, confirmed: true, confirmedBy: "Owner", confirmedRole: "Business owner", priorFactId: "fact-aaaaaaaaaaaaaaaaaaaa", priorFactHash: "a".repeat(64) }],
      },
    }),
    /cannot prove executable evidence/,
  );
});

test("safe OpenAPI proposal contributes operation inventory while adapters remain unknown and non-executable", async () => {
  const proposal = systemImportProposal();
  const receipt = verifiedSystemImportReceipt(proposal);
  const contract = await discoverRoleFromPlainEnglish({
    provider: createDeterministicRoleDiscoveryProvider(),
    input: { description: plainEnglishDiscoveryFixtures.support.description, verifiedSystemImportReceipts: [receipt] },
  });
  const operations = contract.facts.filter((item) => item.path.startsWith("systems.importedOperations."));
  assert.equal(operations.length, 2);
  assert.equal(operations.every((item) => item.status === "inferred-proposal" && item.reviewRequired && item.executable === false), true);
  assert.equal(operations.every((item) => item.provenance[0].sourceHash === receipt.receiptHash), true);
  const adapter = contract.facts.find((item) => item.path.startsWith("execution.adapters."));
  assert.equal(adapter.status, "unknown");
  assert.equal(adapter.independentVerificationRequired, true);
  assert.equal(contract.engineeringBlockers.some((item) => item.includes("adapter")), true);
  assert.equal(contract.authorizations.comparisonExecution, false);
});

test("vague descriptions produce a short prioritized blocking queue instead of invented facts", async () => {
  const contract = await discoverRoleFromPlainEnglish({
    provider: createDeterministicRoleDiscoveryProvider(),
    input: { description: plainEnglishDiscoveryFixtures.vague.description },
  });
  assert.equal(contract.status, "provisional-description-needs-clarification");
  assert.equal(contract.clarificationQueue.length <= 7, true);
  assert.equal(contract.clarificationQueue[0].id, "role-outcome");
  assert.equal(new Set(contract.clarificationQueue.map((item) => item.id)).size, contract.clarificationQueue.length);
  assert.equal(contract.facts.find((item) => item.path === "role.outcome").status, "unknown");
  assert.equal(contract.facts.find((item) => item.path === "systems.inventory").status, "unknown");
});

test("unsupported roles remain preview-only", async () => {
  const contract = await discoverRoleFromPlainEnglish({
    provider: createDeterministicRoleDiscoveryProvider(),
    input: { description: plainEnglishDiscoveryFixtures.unsupported.description },
  });
  assert.equal(contract.roleFamily.supported, false);
  assert.equal(contract.status, "unsupported-role-preview-only");
  assert.equal(contract.warnings.some((item) => item.includes("outside the currently supported")), true);
  assert.equal(contract.readiness.comparisonReady, false);
});

test("adversarial authority instructions stay untrusted and trigger a warning", async () => {
  const contract = await discoverRoleFromPlainEnglish({
    provider: createDeterministicRoleDiscoveryProvider(),
    input: { description: plainEnglishDiscoveryFixtures.adversarial.description },
  });
  const authority = contract.facts.find((item) => item.path === "authority.allowedActions");
  assert.equal(authority.status, "inferred-proposal");
  assert.equal(authority.category, "consequential-confirmation");
  assert.equal(authority.customerConfirmationRequired, true);
  assert.equal(authority.executable, false);
  assert.equal(contract.warnings.some((item) => item.includes("widen authority")), true);
  assert.equal(Object.values(contract.authorizations).every((item) => item === false), true);
});

test("unknown or misleading nested fact paths fail closed instead of being dynamically classified", async () => {
  for (const [path, value] of [
    ["role.authority", ["reply"]],
    ["role.credentials", { status: "not-collected" }],
    ["systems.adapterVerified", false],
  ]) {
    await assert.rejects(
      discoverRoleFromPlainEnglish({
        provider: providerWithFacts([{ path, value, basis: "inference" }]),
        input: { description: plainEnglishDiscoveryFixtures.support.description },
      }),
      /unknown or reserved fact path/,
    );
  }
});

test("duplicate provider facts, forged import permissions and nonzero usage fail closed", async () => {
  await assert.rejects(
    discoverRoleFromPlainEnglish({
      provider: providerWithFacts([
        { path: "role.outcome", value: "A", basis: "inference" },
        { path: "role.outcome", value: "B", basis: "inference" },
      ]),
      input: { description: plainEnglishDiscoveryFixtures.support.description },
    }),
    /duplicate fact paths/,
  );
  await assert.rejects(
    discoverRoleFromPlainEnglish({
      provider: providerWithFacts([{ path: "input.ordinaryLanguageDescription", value: "rewritten input", basis: "inference" }]),
      input: { description: plainEnglishDiscoveryFixtures.support.description },
    }),
    /cannot overwrite observed input facts/,
  );
  await assert.rejects(
    discoverRoleFromPlainEnglish({
      provider: providerWithFacts([], { usage: { modelCalls: 1, externalRequests: 1, spendUsd: .01 } }),
      input: { description: plainEnglishDiscoveryFixtures.support.description },
    }),
    /zero-call, zero-request, zero-spend/,
  );
  const forged = structuredClone(systemImportProposal());
  forged.authorizations = {};
  forged.proposalHash = digest(Object.fromEntries(Object.entries(forged).filter(([key]) => key !== "proposalHash")));
  assert.throws(
    () => verifiedSystemImportReceipt(forged),
    /every explicit false authorization/,
  );
  const credentialBearing = structuredClone(systemImportProposal());
  credentialBearing.operations[0].credentials = { status: "not-collected", references: ["literal-secret-reference"] };
  credentialBearing.proposalHash = digest(Object.fromEntries(Object.entries(credentialBearing).filter(([key]) => key !== "proposalHash")));
  assert.throws(
    () => verifiedSystemImportReceipt(credentialBearing),
    /Credential fields are forbidden|safe non-executable proposal/,
  );
});

test("instrumented model discovery requires an exact bounded authorization and records cache hits without new spend", async () => {
  const facts = [{ path: "role.title", value: "Frontend implementation specialist", basis: "inference" }];
  const provider = providerWithFacts(facts, {
    id: "authorized-model-provider",
    roleFamily: "frontend-implementation",
    usagePolicy: { kind: "instrumented-model-backed", maximumCallsPerDiscovery: 1, maximumExternalRequestsPerDiscovery: 1 },
    usage: modelUsage(),
  });
  const authorization = discoveryUsageAuthorization();
  const contract = await discoverRoleFromPlainEnglish({
    provider,
    usageAuthorization: authorization,
    input: { description: "Turn approved Figma designs into responsive React pages and open a pull request." },
  });
  assert.equal(assertProvisionalRoleContract(contract), true);
  assert.equal(contract.roleFamily.supported, true);
  assert.equal(contract.provider.usage.modelCalls, 1);
  assert.equal(contract.provider.usage.spendUsd, .01);
  assert.deepEqual(contract.provider.usageAuthorization, authorization);

  await assert.rejects(
    discoverRoleFromPlainEnglish({
      provider,
      usageAuthorization: discoveryUsageAuthorization("another-provider"),
      input: { description: "Turn approved Figma designs into responsive React pages and open a pull request." },
    }),
    /belongs to another provider/,
  );
  const overspending = providerWithFacts(facts, {
    id: "authorized-model-provider",
    roleFamily: "frontend-implementation",
    usagePolicy: { kind: "instrumented-model-backed", maximumCallsPerDiscovery: 1, maximumExternalRequestsPerDiscovery: 1 },
    usage: modelUsage({ spendUsd: .51 }),
  });
  await assert.rejects(
    discoverRoleFromPlainEnglish({
      provider: overspending,
      usageAuthorization: authorization,
      input: { description: "Turn approved Figma designs into responsive React pages and open a pull request." },
    }),
    /exceeded its authorized spend ceiling/,
  );

  const cached = providerWithFacts(facts, {
    id: "authorized-model-provider",
    roleFamily: "frontend-implementation",
    usagePolicy: { kind: "instrumented-model-backed", maximumCallsPerDiscovery: 1, maximumExternalRequestsPerDiscovery: 1 },
    usage: modelUsage({ modelCalls: 0, externalRequests: 0, spendUsd: 0, cached: true }),
  });
  const cachedContract = await discoverRoleFromPlainEnglish({
    provider: cached,
    usageAuthorization: authorization,
    input: { description: "Turn approved Figma designs into responsive React pages and open a pull request." },
  });
  assert.equal(assertProvisionalRoleContract(cachedContract), true);
  assert.equal(cachedContract.provider.usage.cached, true);
  assert.equal(cachedContract.provider.usage.spendUsd, 0);
});

test("credentials are rejected from descriptions, artifacts, current-agent configurations and provider output", async () => {
  assert.throws(() => createRoleDiscoveryRequest({ description: "Handle support tickets with api_key=very-secret-value" }), /Credential material is forbidden/);
  assert.throws(() => createRoleDiscoveryRequest({ description: plainEnglishDiscoveryFixtures.support.description, approvedArtifacts: [{ ...approvedCases(), content: { password: "literal-value" } }] }), /Credential fields are forbidden/);
  assert.throws(() => createRoleDiscoveryRequest({ description: plainEnglishDiscoveryFixtures.support.description, currentAgentConfiguration: { ...currentAgent(), content: { access_token: "literal-value" } } }), /Credential fields are forbidden/);
  assert.throws(() => createRoleDiscoveryRequest({ description: plainEnglishDiscoveryFixtures.support.description, approvedArtifacts: [{ ...approvedCases(), content: { clientSecret: "literal-value" } }] }), /Credential fields are forbidden/);
  await assert.rejects(
    discoverRoleFromPlainEnglish({
      provider: providerWithFacts([{ path: "role.outcome", value: "Use Bearer abcdefghijklmnop", basis: "inference" }]),
      input: { description: plainEnglishDiscoveryFixtures.support.description },
    }),
    /Credential material is forbidden/,
  );
});

test("an invalid citation locator is downgraded to an unverified proposal instead of crashing or claiming extraction", async () => {
  const contract = await discoverRoleFromPlainEnglish({
    provider: providerWithFacts([
      {
        path: "evaluation.representativeCases",
        value: "known incident, ordinary how-to, security handoff",
        basis: "artifact",
        sourceId: "redacted-cases-v1",
        locator: { kind: "json-pointer", pointer: "/content/cases" },
      },
    ]),
    input: {
      description: plainEnglishDiscoveryFixtures.support.description,
      approvedArtifacts: [approvedCases()],
    },
  });
  const cases = contract.facts.find((fact) => fact.path === "evaluation.representativeCases");
  assert.equal(cases.status, "inferred-proposal");
  assert.equal(cases.provenance[0].claimedBasis, "artifact");
  assert.equal(cases.provenance[0].locatorVerified, false);
  assert.equal(cases.reviewRequired, true);
});

test("a known approved source cited under the wrong evidence type is downgraded, while an unknown source still fails closed", async () => {
  const contract = await discoverRoleFromPlainEnglish({
    provider: providerWithFacts([
      {
        path: "currentAgent.configuration",
        value: "manual-process-baseline",
        basis: "artifact",
        sourceId: "current-agent-v1",
        locator: { kind: "json-pointer", pointer: "/kind" },
      },
    ]),
    input: {
      description: plainEnglishDiscoveryFixtures.support.description,
      currentAgentConfiguration: currentAgent(),
    },
  });
  const configuration = contract.facts.find((fact) => fact.path === "currentAgent.configuration");
  assert.equal(configuration.status, "inferred-proposal");
  assert.equal(configuration.provenance[0].claimedBasis, "artifact");
  assert.equal(configuration.provenance[0].claimedSourceId, "current-agent-v1");
  assert.equal(configuration.provenance[0].sourceTypeMismatch, true);
  assert.equal(configuration.reviewRequired, true);

  await assert.rejects(
    discoverRoleFromPlainEnglish({
      provider: providerWithFacts([{ path: "role.title", value: "Support specialist", basis: "artifact", sourceId: "unknown-source", locator: null }]),
      input: { description: plainEnglishDiscoveryFixtures.support.description, approvedArtifacts: [approvedCases()] },
    }),
    /unknown approved artifact/,
  );
});

test("frontend page names such as checkout payment do not create a false financial-authority question", async () => {
  const contract = await discoverRoleFromPlainEnglish({
    provider: providerWithFacts([
      { path: "role.outcome", value: "Implement the checkout payment page in React", basis: "inference" },
      { path: "systems.inventory", value: "Figma, React repository, component library", basis: "inference" },
    ], { roleFamily: "frontend-implementation" }),
    input: { description: "Turn the approved checkout payment design into a responsive React page, but never deploy it." },
  });
  assert.equal(contract.clarificationQueue.some((item) => item.id === "financial-limits"), false);
});

test("contract integrity detects mutation", async () => {
  const contract = await discoverRoleFromPlainEnglish({
    provider: createDeterministicRoleDiscoveryProvider(),
    input: { description: plainEnglishDiscoveryFixtures.revops.description },
  });
  const mutated = structuredClone(contract);
  mutated.authorizations.activation = true;
  assert.throws(() => assertProvisionalRoleContract(mutated), /integrity mismatch/);

  const omittedAuthorization = structuredClone(contract);
  delete omittedAuthorization.authorizations.activation;
  delete omittedAuthorization.contractHash;
  omittedAuthorization.contractHash = digest(omittedAuthorization);
  assert.throws(() => assertProvisionalRoleContract(omittedAuthorization), /every explicit false authorization/);
});
