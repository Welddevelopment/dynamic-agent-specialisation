import fs from "node:fs";
import path from "node:path";
import { createTechnicalReadinessAudit } from "../product/technical-readiness-audit.js";

const output = path.resolve("artifacts/readiness/technical-readiness-v1.json");
const audit = createTechnicalReadinessAudit();
fs.mkdirSync(path.dirname(output), { recursive: true });
const temporary = `${output}.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(audit, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(temporary, output);
fs.chmodSync(output, 0o600);
process.stdout.write(`${JSON.stringify({ output, auditHash: audit.auditHash, level1: audit.level1.status, commercial: audit.commercial.status, level15: audit.level15.status, level2: audit.level2.status, externalGates: audit.externalGates }, null, 2)}\n`);
