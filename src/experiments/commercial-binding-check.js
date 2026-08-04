import fs from "node:fs";
import path from "node:path";
import { assessCommercialBindingDescriptor } from "../product/commercial-binding-kit.js";

function argument(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
const intakeFile = argument("--intake");
const bindingFile = argument("--binding");
if (!intakeFile || !bindingFile) throw new Error("Usage: npm run commercial:binding:check -- --intake <intake.json> --binding <binding.json>");
const intake = JSON.parse(fs.readFileSync(path.resolve(intakeFile), "utf8"));
const descriptor = JSON.parse(fs.readFileSync(path.resolve(bindingFile), "utf8"));
const assessment = assessCommercialBindingDescriptor({ intake, descriptor });
process.stdout.write(`${JSON.stringify(assessment, null, 2)}\n`);
if (!assessment.readyForAcceptance) process.exitCode = 2;
