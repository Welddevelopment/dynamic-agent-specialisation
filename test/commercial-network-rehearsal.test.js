import assert from "node:assert/strict";
import test from "node:test";
import { runCommercialNetworkRehearsal } from "../src/product/commercial-network-rehearsal.js";
import { CommercialRevopsToolHost, CommercialRevopsVerifier, createCommercialRevopsPack } from "../src/product/commercial-revops-pack.js";
import { commercialRevopsCases } from "../src/worlds/realistic-revops-cases.js";

test("generic commercial network rehearsal fails before activation without explicit completion", async () => {
  const task = commercialRevopsCases.development[1];
  await assert.rejects(() => runCommercialNetworkRehearsal({
    roleId: "revops",
    pack: createCommercialRevopsPack(),
    task,
    ToolHost: CommercialRevopsToolHost,
    Verifier: CommercialRevopsVerifier,
    processEpoch: "invalid-rehearsal",
    decisions: [{ kind: "tool", name: "revops-sandbox:list-assigned-leads", input: { status: null } }],
  }), /end explicitly/);
});
