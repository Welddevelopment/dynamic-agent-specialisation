import fs from "node:fs";
import path from "node:path";
import { preflightCommercialRevopsPack } from "../product/commercial-revops-pack.js";
const { pack, receipt } = await preflightCommercialRevopsPack();
const output = path.resolve("artifacts/commercial/revops-v1"); fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "preflight-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
fs.writeFileSync(path.join(output, "comparison-contract.json"), `${JSON.stringify(pack.contract, null, 2)}\n`);
fs.writeFileSync(path.join(output, "participant-manifest.json"), `${JSON.stringify(pack.participants, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
