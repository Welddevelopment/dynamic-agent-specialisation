import path from "node:path";
import { loadCommercialLocalPackage } from "../product/commercial-local-package.js";
import { loadCommercialCustomerBindings, startCommercialSidecarDaemon } from "../product/commercial-sidecar-daemon.js";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const packageDirectory = argument("--package");
const bindingsModule = argument("--bindings");
const portInput = argument("--port");
if (!packageDirectory || !bindingsModule) throw new Error("Usage: npm run commercial:sidecar -- --package <customer-local-directory> --bindings <customer-bindings.mjs> [--port 4319]");
const localPackage = loadCommercialLocalPackage({ directory: path.resolve(packageDirectory) });
const customerBindings = await loadCommercialCustomerBindings({ modulePath: bindingsModule, localPackage });
const daemon = await startCommercialSidecarDaemon({ packageDirectory: localPackage.root, customerBindings, ...(portInput == null ? {} : { port: Number(portInput) }) });
process.stdout.write(`${JSON.stringify(daemon.publicStatus, null, 2)}\n`);

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await daemon.close();
}
process.once("SIGINT", async () => { await close(); process.exit(0); });
process.once("SIGTERM", async () => { await close(); process.exit(0); });
