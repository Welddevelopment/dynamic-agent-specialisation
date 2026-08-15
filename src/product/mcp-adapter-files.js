import fs from "node:fs";
import path from "node:path";
import { compileMcpAdapterPlan } from "./mcp-adapter-kit.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function readJson(file, label) {
  requireCondition(path.extname(file).toLowerCase() === ".json", `${label} must be a local JSON file`);
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

export function compileLocalMcpAdapterPackage({ toolsListFile, configFile, outputDirectory }) {
  const root = path.resolve(outputDirectory);
  requireCondition(!fs.existsSync(root), "MCP adapter package refuses to overwrite an existing directory");
  const toolsList = readJson(toolsListFile, "MCP tools/list response");
  const config = readJson(configFile, "MCP adapter config");
  const allowed = new Set(["serverId", "serverVersion", "adapterVersion", "operationBindings"]);
  requireCondition(Object.keys(config).every((key) => allowed.has(key)), "MCP adapter config contains an unsupported top-level field");
  requireCondition(!JSON.stringify(config).match(/(api[-_]?key|password|secret|access[-_]?token|private[-_]?key)/i), "MCP adapter config must not contain credential fields; server access remains in the customer-local transport");
  const plan = compileMcpAdapterPlan({ toolsList, ...config });
  fs.mkdirSync(root, { recursive: false, mode: 0o700 });
  fs.writeFileSync(path.join(root, "adapter-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  fs.writeFileSync(path.join(root, "README.md"), `# Bounded MCP adapter package\n\nThis package pins an explicitly reviewed subset of one customer-local MCP server. It contains no server credentials or transport configuration. Write tools still require runtime authority, a required idempotency field, read-back reconciliation, a separate business-outcome verifier and the mandatory customer-binding acceptance campaign.\n\nPinned tools/list hash: \`${plan.server.toolsListHash}\`\nPlan hash: \`${plan.planHash}\`\n`, { mode: 0o600, flag: "wx" });
  return Object.freeze({ root, plan, files: ["adapter-plan.json", "README.md"], readyForCustomerActivation: false, evidenceBoundary: plan.evidenceBoundary });
}
