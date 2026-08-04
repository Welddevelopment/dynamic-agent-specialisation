import assert from "node:assert/strict";
import { createCommercialLocalSidecar } from "../product/commercial-local-sidecar.js";

const sidecar = createCommercialLocalSidecar({ dispatch: async ({ method, pathname, authorization }) => ({
  status: method === "GET" && pathname === "/health" && authorization === "Bearer smoke-token" ? 200 : 401,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  body: { ok: method === "GET" && pathname === "/health" && authorization === "Bearer smoke-token" },
}) });

const address = await sidecar.listen({ hostname: "127.0.0.1", port: 0 });
try {
  const response = await fetch(`http://127.0.0.1:${address.port}/health`, { headers: { authorization: "Bearer smoke-token" } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  process.stdout.write(`${JSON.stringify({ passed: true, hostname: address.address, dynamicPort: true, responseStatus: response.status })}\n`);
} finally {
  await sidecar.close();
}
