import fs from "node:fs";
import path from "node:path";
import { preflightCommercialPostcomparisonGates } from "../product/commercial-postcomparison-cases.js";

const outputDirectory = path.resolve("artifacts/commercial/postcomparison-gates-v1");
const { gates, receipt } = await preflightCommercialPostcomparisonGates();
if (!Object.values(receipt.checks).every(Boolean)) throw new Error("Commercial post-comparison gate preflight failed");
fs.mkdirSync(outputDirectory, { recursive: true });
for (const [role, { gate }] of Object.entries(gates)) {
  fs.writeFileSync(path.join(outputDirectory, `${role}-gate-contract.json`), `${JSON.stringify(gate.contract, null, 2)}\n`, { mode: 0o600 });
}
fs.writeFileSync(path.join(outputDirectory, "preflight-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ outputDirectory, receipt }, null, 2));

