import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDeterministicReference } from "../run.js";
import { buildCommercialJobDraft } from "../product/commercial-intake.js";
import { listCommercialRoleTemplates } from "../product/commercial-role-templates.js";
import { CommercialOnboardingStore } from "../product/onboarding-store.js";
import { COMMERCIAL_PRODUCT_CONFIGS, loadCommercialProductState, loadCommercialProductStates, readOptionalJson } from "./commercial-product-state.js";
import { ImprovementConsoleStore } from "./improvement-store.js";

const port = Number(process.env.PORT ?? 4391);
const directory = path.dirname(fileURLToPath(import.meta.url));
const run = runDeterministicReference();
const statePath = path.resolve(process.env.DAS_CONSOLE_STATE_PATH ?? "artifacts/console/improvement-state.json");
const improvementStore = new ImprovementConsoleStore({ filePath: statePath });
const onboardingStatePath = path.resolve(process.env.DAS_ONBOARDING_STATE_PATH ?? "artifacts/console/commercial-onboarding-state.json");
const onboardingStore = fs.existsSync(onboardingStatePath)
  ? CommercialOnboardingStore.load(onboardingStatePath)
  : new CommercialOnboardingStore({ filePath: onboardingStatePath });

function commercialState(sessionId = null) {
  const sessions = onboardingStore.list();
  const selected = sessionId ? onboardingStore.latest(sessionId) : sessions.at(-1) ?? null;
  let draft = null;
  if (selected?.readiness?.stages?.draft?.ready) {
    try { draft = buildCommercialJobDraft(selected.intake); } catch { draft = null; }
  }
  return {
    boundary: "Generated role drafts are not performance evidence. Comparison and activation require separate gates.",
    templates: listCommercialRoleTemplates(),
    sessions,
    selected,
    draft,
  };
}

function historicalPiece2() {
  const receiptPath = path.resolve("evidence/piece2-procurement-selection.json");
  if (!fs.existsSync(receiptPath)) return null;
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  return {
    id: "piece2-procurement",
    label: "Procurement specialist",
    status: "completed",
    result: "No paid upgrade recommended",
    stopReason: "Existing specialist won the frozen ranking",
    spendUsd: receipt.campaignSpendUsd,
    finalists: receipt.finalists,
    selectionHash: receipt.selectionHash,
    boundary: receipt.evidenceBoundary,
  };
}

function productEvidenceState() {
  const closeout = readOptionalJson("artifacts/level1/technical-closeout-v1.json");
  const registry = readOptionalJson("artifacts/level1/registry-v1.json");
  const lifecycle = readOptionalJson("artifacts/level15/rehearsal-v1/summary.json");
  return {
    level1: closeout,
    registry: registry ? {
      integrityHash: registry.integrityHash,
      revision: registry.revision,
      selections: registry.selections.map((record) => ({ roleId: record.roleId, selectionVersion: record.selectionVersion, decision: record.decision, candidateId: record.selected.candidate.id, candidateVersion: record.selected.candidate.version, alternativesPreserved: record.alternatives.length, recordHash: record.recordHash })),
    } : null,
    lifecycle,
  };
}

function consoleState() {
  const product = productEvidenceState();
  const latestCloseout = product.level1 ? {
    id: "bounded-level1-closeout",
    label: "Bounded Level 1 technical mechanism",
    status: product.level1.verdict.boundedLevel1TechnicalMechanismComplete ? "complete" : "incomplete",
    result: product.level1.verdict.wording,
    stopReason: "Three-role technical closeout",
    spendUsd: product.level1.paidModelSpend.cumulativeSpentUsd,
    selectionHash: product.registry?.integrityHash ?? null,
    boundary: "Fictional local evidence. No customer deployment, production reliability, or human-effort advantage claimed.",
  } : null;
  return {
    boundary: "Private local console — synthetic evidence only",
    paidModelCostUsd: run.paidModelCostUsd,
    evidenceValid: run.evidenceValid,
    improvementRunnerAvailable: false,
    improvement: improvementStore.snapshot(),
    commercial: commercialState(),
    commercialProduct: loadCommercialProductState(),
    commercialProducts: loadCommercialProductStates(),
    historicalImprovementRuns: [latestCloseout, historicalPiece2()].filter(Boolean),
    product,
    roles: run.results.map(({ role, result, comparison, baselineResults }) => ({
      id: role.id,
      name: role.brief.role,
      recommendation: result.tournament.recommendation,
      alternatives: result.tournament.frontier,
      comparison,
      candidates: result.candidates.map((candidate) => ({ id: candidate.id, model: candidate.model, context: candidate.context, tools: candidate.tools, memory: candidate.memory, authority: candidate.authority, escalation: candidate.escalation, verifier: candidate.verifier, limits: candidate.limits, strategy: candidate.strategy, provenance: candidate.provenance, fingerprint: candidate.fingerprint })),
      baselines: baselineResults,
      freeze: result.freeze,
    })),
    evidence: run.evidence.records(),
  };
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

const assets = {
  "/": ["app.html", "text/html; charset=utf-8"],
  "/app.css": ["app.css", "text/css; charset=utf-8"],
  "/improvement.css": ["improvement.css", "text/css; charset=utf-8"],
  "/lifecycle.css": ["lifecycle.css", "text/css; charset=utf-8"],
  "/commercial.css": ["commercial.css", "text/css; charset=utf-8"],
  "/comparison.css": ["comparison.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/vendor/gsap.js": [path.resolve("node_modules/gsap/dist/gsap.min.js"), "text/javascript; charset=utf-8"],
  "/vendor/ScrollTrigger.js": [path.resolve("node_modules/gsap/dist/ScrollTrigger.min.js"), "text/javascript; charset=utf-8"],
};

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/api/state") return json(response, 200, consoleState());
    if (request.method === "GET" && request.url === "/api/commercial/procurement/contract") return json(response, 200, readOptionalJson("artifacts/commercial/procurement-v1/comparison-contract.json") ?? { error: "Commercial procurement contract is not prepared" });
    if (request.method === "GET" && request.url === "/api/commercial/procurement/participants") return json(response, 200, readOptionalJson("artifacts/commercial/procurement-v1/participant-manifest.json") ?? { error: "Commercial procurement participants are not prepared" });
    if (request.method === "GET" && /^\/api\/commercial\/(support|revops)\/(contract|participants)$/.test(request.url)) {
      const [, , , role, kind] = request.url.split("/");
      const file = kind === "contract" ? COMMERCIAL_PRODUCT_CONFIGS[role].artifacts.contract : COMMERCIAL_PRODUCT_CONFIGS[role].artifacts.manifest;
      return json(response, 200, readOptionalJson(file) ?? { error: `Commercial ${role} ${kind} is not prepared` });
    }
    if (request.method === "POST" && request.url === "/api/improvement/configure") {
      improvementStore.configure(await readJson(request));
      return json(response, 200, consoleState());
    }
    if (request.method === "POST" && request.url === "/api/improvement/disable") {
      improvementStore.disable();
      return json(response, 200, consoleState());
    }
    if (request.method === "POST" && request.url === "/api/improvement/start") {
      const input = await readJson(request);
      improvementStore.start(input).catch(() => {});
      return json(response, 200, consoleState());
    }
    if (request.method === "GET" && request.url?.startsWith("/api/commercial")) {
      const url = new URL(request.url, `http://${request.headers.host ?? "127.0.0.1"}`);
      return json(response, 200, commercialState(url.searchParams.get("sessionId")));
    }
    if (request.method === "POST" && request.url === "/api/commercial/intake") {
      const saved = onboardingStore.saveIntake(await readJson(request));
      return json(response, 200, { saved, commercial: commercialState(saved.sessionId) });
    }
    const asset = request.method === "GET" ? assets[request.url] : null;
    if (asset) {
      response.writeHead(200, { "content-type": asset[1], "cache-control": "no-store" });
      const assetPath = path.isAbsolute(asset[0]) ? asset[0] : path.join(directory, asset[0]);
      response.end(fs.readFileSync(assetPath));
      return;
    }
    json(response, 404, { error: "Not found" });
  } catch (error) {
    json(response, 409, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, "127.0.0.1", () => console.log(`Specialist Compiler console: http://127.0.0.1:${port}`));
