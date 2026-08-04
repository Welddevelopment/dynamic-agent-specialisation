import { compileLocalOpenApiAdapterPackage } from "../product/openapi-adapter-files.js";

const [specFile, configFile, outputDirectory] = process.argv.slice(2);
if (!specFile || !configFile || !outputDirectory) throw new Error("Usage: npm run adapter:openapi:compile -- <openapi.json> <adapter-config.json> <new-output-directory>");
const result = compileLocalOpenApiAdapterPackage({ specFile, configFile, outputDirectory });
console.log(JSON.stringify({ outputDirectory: result.root, files: result.files, adapterId: result.plan.adapterId, operations: result.plan.operations.length, planHash: result.plan.planHash, readyForCustomerActivation: false, evidenceBoundary: result.evidenceBoundary }, null, 2));
