import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCommercialSupportPack } from "../src/product/commercial-support-pack.js";

function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: { title: "Customer Support", version: "1.0.0" },
    paths: {
      "/tickets/{ticketId}": {
        get: { operationId: "getTicket", responses: { "200": { description: "ok" } } },
      },
    },
  };
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Console server did not start")), 10_000);
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.includes("Specialist Compiler console:")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Console server stopped before startup (${code}): ${output}`));
    });
  });
}

async function post(url, body) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { response, body: await response.json() };
}

test("customer-local HTTP endpoint joins saved intake to a review-only import", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "das-system-import-endpoint-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const port = 47_000 + Math.floor(Math.random() * 1_000);
  const child = spawn(process.execPath, ["src/console/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DAS_CONSOLE_STATE_PATH: path.join(root, "improvement.json"),
      DAS_ONBOARDING_STATE_PATH: path.join(root, "intake.json"),
      DAS_ASSISTED_ONBOARDING_STATE_DIRECTORY: path.join(root, "assisted"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill("SIGTERM"));
  try {
    await waitForServer(child);
  } catch (error) {
    if (/listen EPERM/.test(String(error))) {
      t.skip("The sandbox does not allow a temporary localhost listener; this endpoint test runs when local bind permission is available.");
      return;
    }
    throw error;
  }
  const base = `http://127.0.0.1:${port}`;
  const intake = createCommercialSupportPack().intake;
  const saved = await post(`${base}/api/commercial/intake`, intake);
  assert.equal(saved.response.status, 200);
  const imported = await post(`${base}/api/commercial/system-import`, {
    sessionId: intake.sessionId,
    systemId: intake.systems[0].id,
    sourceKind: "openapi",
    sourceLabel: "support schema",
    document: openApiDocument(),
    selectedNames: [],
  });
  assert.equal(imported.response.status, 200);
  assert.equal(imported.body.proposal.operationCount, 1);
  assert.equal(imported.body.proposal.operations[0].authority, "not-granted");
  assert.equal(imported.body.proposal.operations[0].executable, false);
  assert.equal(imported.body.commercial.assistedOnboarding.generated.systemImportProposals, 1);
  assert.equal(imported.body.commercial.assistedOnboarding.stages.executableComparisonEnvironmentReady, false);
  assert.doesNotMatch(JSON.stringify(imported.body.proposal), /sourceHash|proposalHash|intakeHash/);

  const reviewed = await post(`${base}/api/commercial/system-import/review`, {
    sessionId: intake.sessionId,
    systemId: intake.systems[0].id,
    sourceKind: "openapi",
    sourceLabel: "support schema",
    document: openApiDocument(),
    selectedNames: [],
    confirmedBy: "Support owner",
    decisions: {
      operationChoices: [{ sourceName: "getTicket", approved: true, targetExposedName: `${intake.systems[0].id}:read-ticket`, confirmedMode: "read", authorityAction: null, requiredContextSources: ["ticket-thread"] }],
      contextChoices: imported.body.proposal.review.contextSources.map((sourceId) => ({ sourceId, approved: true })),
    },
  });
  assert.equal(reviewed.response.status, 200);
  assert.equal(reviewed.body.review.status, "customer-confirmed-engineering-required");
  assert.equal(reviewed.body.review.gates.executable, false);
  assert.equal(reviewed.body.review.authorizations.execution, false);
  assert.ok(reviewed.body.review.setupCoverage.generatedOrCustomerConfirmed > 0);
  assert.ok(reviewed.body.review.setupCoverage.remainingEngineerOrIndependentProof > 0);
  assert.equal(reviewed.body.commercial.assistedOnboarding.generated.bindingWorkPlans, 1);
  assert.equal(reviewed.body.commercial.assistedOnboarding.stages.executableComparisonEnvironmentReady, false);
  assert.doesNotMatch(JSON.stringify(reviewed.body.review), /sourceHash|proposalHash|confirmationHash|workPlanHash|intakeHash/);

  const discovered = await post(`${base}/api/commercial/discover-role`, {
    sessionId: intake.sessionId,
    description: "Handle assigned customer support tickets, resolve routine billing and incident questions, and escalate anything outside delegated authority.",
    companyName: "Example Co",
    industry: "B2B software",
    operatingContext: "Tickets enter one assigned queue.",
  });
  assert.equal(discovered.response.status, 200);
  assert.equal(discovered.body.preview.provider.modelCalls, 0);
  assert.equal(discovered.body.preview.provider.externalRequests, 0);
  assert.equal(discovered.body.preview.provider.spendUsd, 0);
  assert.equal(discovered.body.preview.recordedSystemProposals.count, 1);
  assert.equal(discovered.body.preview.safeHandoff.permitted, true);
  assert.equal(Object.values(discovered.body.preview.authorizations).every((value) => value === false), true);
  assert.equal(discovered.body.preview.readiness.executableEnvironmentReady, false);
  assert.doesNotMatch(JSON.stringify(discovered.body.preview), /proposalHash|sourceHash|intakeHash|boundedInputSchemaHash|\/Users\//);

  const credential = openApiDocument();
  credential["x-api-key"] = "literal-secret-value";
  const rejected = await post(`${base}/api/commercial/system-import`, {
    sessionId: intake.sessionId,
    systemId: intake.systems[0].id,
    sourceKind: "openapi",
    sourceLabel: "support schema",
    document: credential,
  });
  assert.equal(rejected.response.status, 409);
  assert.match(rejected.body.error, /Credential values are forbidden/);
});
