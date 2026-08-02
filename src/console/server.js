import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDeterministicReference } from "../run.js";
import { ImprovementConsoleStore } from "./improvement-store.js";

const port = Number(process.env.PORT ?? 4391);
const directory = path.dirname(fileURLToPath(import.meta.url));
const run = runDeterministicReference();
const statePath = path.resolve(process.env.DAS_CONSOLE_STATE_PATH ?? "artifacts/console/improvement-state.json");
const improvementStore = new ImprovementConsoleStore({ filePath: statePath });

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

function consoleState() {
  return {
    boundary: "Private local console — synthetic evidence only",
    paidModelCostUsd: run.paidModelCostUsd,
    evidenceValid: run.evidenceValid,
    improvementRunnerAvailable: false,
    improvement: improvementStore.snapshot(),
    historicalImprovementRuns: [historicalPiece2()].filter(Boolean),
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
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
};

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/api/state") return json(response, 200, consoleState());
    if (request.method === "POST" && request.url === "/api/improvement/configure") {
      improvementStore.configure(await readJson(request));
      return json(response, 200, consoleState());
    }
    if (request.method === "POST" && request.url === "/api/improvement/disable") {
      improvementStore.disable();
      return json(response, 200, consoleState());
    }
    if (request.method === "POST" && request.url === "/api/improvement/start") {
      await improvementStore.start(await readJson(request));
      return json(response, 200, consoleState());
    }
    const asset = request.method === "GET" ? assets[request.url] : null;
    if (asset) {
      response.writeHead(200, { "content-type": asset[1], "cache-control": "no-store" });
      response.end(fs.readFileSync(path.join(directory, asset[0])));
      return;
    }
    json(response, 404, { error: "Not found" });
  } catch (error) {
    json(response, 409, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, "127.0.0.1", () => console.log(`Specialist Compiler console: http://127.0.0.1:${port}`));
