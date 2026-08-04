import crypto from "node:crypto";
import http from "node:http";
import { assertCommercialActivationReceipt, assertCommercialSpecialistBundle } from "./commercial-specialist-lifecycle.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32 * 1024) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function response(status, body) { return { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, body }; }

export function createCommercialSidecarDispatcher({ host, bundle, activation, accessToken }) {
  assertCommercialSpecialistBundle(bundle);
  assertCommercialActivationReceipt(activation, { bundle });
  requireCondition(host?.bundleHash === bundle.bundleHash && typeof host.submit === "function", "Sidecar requires the durable host for this exact specialist");
  const token = String(accessToken ?? "");
  requireCondition(Buffer.byteLength(token) >= 32, "Sidecar access token must contain at least 32 bytes");

  return async function dispatch({ method, pathname, authorization, body = null }) {
    if (!safeEqual(authorization, `Bearer ${token}`)) return response(401, { error: "Unauthorized" });
    if (method === "GET" && pathname === "/v1/specialist") return response(200, { roleId: bundle.role.id, title: bundle.role.title, bundleHash: bundle.bundleHash, activationHash: activation.activationHash, status: activation.status, credentialPolicy: bundle.credentialPolicy });
    if (method === "POST" && pathname === "/v1/runs") {
      try { return response(200, await host.submit(body)); }
      catch (error) { return response(409, { error: error instanceof Error ? error.message : String(error) }); }
    }
    const match = pathname.match(/^\/v1\/runs\/([^/]+)$/);
    if (method === "GET" && match) {
      const record = host.status(decodeURIComponent(match[1]));
      return record ? response(200, record) : response(404, { error: "Run not found" });
    }
    const reconcile = pathname.match(/^\/v1\/runs\/([^/]+)\/reconcile$/);
    if (method === "POST" && reconcile) {
      try { return response(200, await host.reconcile(decodeURIComponent(reconcile[1]))); }
      catch (error) { return response(409, { error: error instanceof Error ? error.message : String(error) }); }
    }
    return response(404, { error: "Not found" });
  };
}

export function createCommercialLocalSidecar({ dispatch }) {
  requireCondition(typeof dispatch === "function", "Sidecar dispatcher is required");
  const server = http.createServer(async (request, outgoing) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      const body = request.method === "POST" ? await readJson(request) : null;
      const result = await dispatch({ method: request.method, pathname: url.pathname, authorization: request.headers.authorization, body });
      outgoing.writeHead(result.status, result.headers);
      outgoing.end(JSON.stringify(result.body));
    } catch (error) {
      outgoing.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      outgoing.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  return Object.freeze({
    server,
    listen({ port = 0, hostname = "127.0.0.1" } = {}) {
      requireCondition(hostname === "127.0.0.1" || hostname === "::1", "Commercial sidecar may bind only to loopback");
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, hostname, () => { server.off("error", reject); resolve(server.address()); });
      });
    },
    close() { return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); },
  });
}
