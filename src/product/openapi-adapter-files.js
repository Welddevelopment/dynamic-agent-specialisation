import fs from "node:fs";
import path from "node:path";
import { compileOpenApiAdapterPlan } from "./openapi-adapter-kit.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }

function rejectCredentialValues(value, location = "config") {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectCredentialValues(item, `${location}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (location !== "config.credentialRefs" && /api[-_]?key|password|secret|access[-_]?token|private[-_]?key/i.test(key)) throw new Error(`Credential values are forbidden in OpenAPI adapter config: ${location}.${key}`);
    rejectCredentialValues(child, `${location}.${key}`);
  }
}

function readJson(file, label) {
  requireCondition(path.extname(file).toLowerCase() === ".json", `${label} must be a local JSON file`);
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

export function compileLocalOpenApiAdapterPackage({ specFile, configFile, outputDirectory }) {
  const root = path.resolve(outputDirectory);
  requireCondition(!fs.existsSync(root), "OpenAPI adapter package refuses to overwrite an existing directory");
  const spec = readJson(specFile, "OpenAPI specification");
  const config = readJson(configFile, "OpenAPI adapter config");
  rejectCredentialValues(config);
  const allowed = new Set(["adapterId", "adapterVersion", "baseUrl", "operationBindings", "credentialRefs", "maximumResponseBytes", "timeoutMs"]);
  requireCondition(Object.keys(config).every((key) => allowed.has(key)), "OpenAPI adapter config contains an unsupported top-level field");
  const plan = compileOpenApiAdapterPlan({ spec, ...config });
  fs.mkdirSync(root, { recursive: false, mode: 0o700 });
  fs.writeFileSync(path.join(root, "adapter-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  fs.writeFileSync(path.join(root, "README.md"), `# Bounded OpenAPI adapter package\n\nThis package contains an executable transport contract, not customer acceptance evidence. Connect it to the generic OpenAPI runtime, provide secrets only through the listed customer-local environment references, independently verify the full business outcome, and pass the mandatory acceptance campaign before activation.\n\nSource OpenAPI hash: \`${plan.openApi.sourceHash}\`\nPlan hash: \`${plan.planHash}\`\n`, { mode: 0o600, flag: "wx" });
  return Object.freeze({ root, plan, files: ["adapter-plan.json", "README.md"], readyForCustomerActivation: false, evidenceBoundary: plan.evidenceBoundary });
}
