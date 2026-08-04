import fs from "node:fs";
import path from "node:path";
import { writeCommercialBindingScaffold } from "../product/commercial-binding-kit.js";

function argument(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
const intakeFile = argument("--intake");
const output = argument("--output");
if (!intakeFile || !output) throw new Error("Usage: npm run commercial:binding:scaffold -- --intake <intake.json> --output <new-directory>");
const intake = JSON.parse(fs.readFileSync(path.resolve(intakeFile), "utf8"));
const result = writeCommercialBindingScaffold({ directory: path.resolve(output), intake });
process.stdout.write(`${JSON.stringify({ root: result.root, files: result.files, readyForAcceptance: result.readyForAcceptance, descriptorHash: result.descriptor.descriptorHash, evidenceBoundary: result.evidenceBoundary }, null, 2)}\n`);
