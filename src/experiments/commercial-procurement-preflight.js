import fs from "node:fs";
import path from "node:path";
import { preflightCommercialProcurementPack } from "../product/commercial-procurement-pack.js";

const outputDirectory = path.resolve("artifacts/commercial/procurement-v1");
fs.mkdirSync(outputDirectory, { recursive: true });
const { pack, receipt } = await preflightCommercialProcurementPack();
fs.writeFileSync(path.join(outputDirectory, "preflight-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
fs.writeFileSync(path.join(outputDirectory, "comparison-contract.json"), `${JSON.stringify(pack.contract, null, 2)}\n`, "utf8");
fs.writeFileSync(path.join(outputDirectory, "participant-manifest.json"), `${JSON.stringify(pack.participants.map(({ candidate, ...participant }) => ({ ...participant, candidate })), null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receiptHash: receipt.receiptHash, freezeHash: receipt.contractFreezeHash, cases: receipt.caseCounts, participants: receipt.participantHashes.length, modelCalls: receipt.modelCalls, spendUsd: receipt.spendUsd }, null, 2));
