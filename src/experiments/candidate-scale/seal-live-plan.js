import fs from "node:fs";
import path from "node:path";
import { createCommercialSupportPack } from "../../product/commercial-support-pack.js";
import { candidateScaleCasePackHash, assertCandidateScaleLiveCasePack } from "./live-case-pack.js";
import { createCandidateScaleExecutionPlan } from "./execution-plan.js";

const root = path.resolve("artifacts/candidate-scale/v1");
const casePackPath = path.join(root, "private-live-case-pack.json");
if (!fs.existsSync(casePackPath)) throw new Error("Fresh private candidate-scale case pack is missing; no live plan can be sealed");
const pack = createCommercialSupportPack();
const role = pack.roleDraft.compiled.brief;
const casePack = JSON.parse(fs.readFileSync(casePackPath, "utf8"));
assertCandidateScaleLiveCasePack(casePack, { roleId: role.id, verifierId: pack.driver.verifier.id });
const plan = createCandidateScaleExecutionPlan({ casePackHash: candidateScaleCasePackHash(casePack) });
const output = path.join(root, "live-execution-plan.json");
fs.writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
fs.chmodSync(output, 0o600);
process.stdout.write(`${JSON.stringify({ status: "live-plan-sealed-zero-spend", planHash: plan.planHash, casePackHash: plan.casePackHash, maximumSpendUsd: plan.projectedMaximumSpendUsd, output }, null, 2)}\n`);

