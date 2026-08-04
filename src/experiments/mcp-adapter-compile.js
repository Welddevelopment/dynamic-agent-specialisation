import { compileLocalMcpAdapterPackage } from "../product/mcp-adapter-files.js";

const [toolsListFile, configFile, outputDirectory] = process.argv.slice(2);
if (!toolsListFile || !configFile || !outputDirectory) throw new Error("Usage: npm run adapter:mcp:compile -- <tools-list.json> <adapter-config.json> <new-output-directory>");
const result = compileLocalMcpAdapterPackage({ toolsListFile, configFile, outputDirectory });
console.log(JSON.stringify({ outputDirectory: result.root, files: result.files, adapterId: result.plan.adapterId, operations: result.plan.operations.length, planHash: result.plan.planHash, readyForCustomerActivation: false, evidenceBoundary: result.evidenceBoundary }, null, 2));
