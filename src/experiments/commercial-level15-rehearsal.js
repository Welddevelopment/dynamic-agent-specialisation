import path from "node:path";
import { runCommercialLevel15Rehearsal } from "../product/commercial-level15-rehearsal.js";

const outputDirectory = path.resolve("artifacts/commercial/level15-rehearsal-v1");
const summary = await runCommercialLevel15Rehearsal({ outputDirectory });
console.log(JSON.stringify(summary, null, 2));

