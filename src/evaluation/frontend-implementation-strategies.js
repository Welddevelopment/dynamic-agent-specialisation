import { FrontendImplementationVerifier, FrontendImplementationWorld } from "../worlds/frontend-implementation-world.js";

function key(task, action) { return `${task.id}:${action}`; }

export function buildReferenceFrontendSource(task) {
  const spec = task.scenario.designSpec;
  const imports = [...new Set(spec.requiredComponents)].join(", ");
  const regionSource = spec.regions.map((region, index) => {
    const Component = spec.requiredComponents[Math.min(index + 1, spec.requiredComponents.length - 1)] ?? spec.requiredComponents[0];
    const accessibility = spec.accessibility[index] ? ` ${spec.accessibility[index]}` : "";
    return `      <${Component} data-region="${region.id}"${accessibility}>${region.copy}</${Component}>`;
  }).join("\n");
  const page = `import { ${imports} } from "@company/ui";\nimport "./${spec.targetStyleFile.split("/").pop()}";\n\nexport function ${spec.targetPageFile.split("/").pop().replace(/\.jsx$/, "")}() {\n  return (\n    <${spec.requiredComponents[0]} data-route="${spec.route}">\n      <div className="${spec.responsive.gridClass}">\n${regionSource}\n      </div>\n    </${spec.requiredComponents[0]}>\n  );\n}\n`;
  const tokenLines = spec.requiredTokens.map((token, index) => `  ${index === 0 ? "gap" : index === 1 ? "background" : "color"}: var(${token});`).join("\n");
  const css = `.${spec.responsive.gridClass} {\n  display: grid;\n  grid-template-columns: repeat(${spec.responsive.desktop.columns}, minmax(0, 1fr));\n${tokenLines}\n}\n\n@media (max-width: ${spec.responsive.tablet.maxWidth}px) {\n  .${spec.responsive.gridClass} {\n    grid-template-columns: repeat(${spec.responsive.tablet.columns}, minmax(0, 1fr));\n  }\n}\n\n@media (max-width: ${spec.responsive.mobile.maxWidth}px) {\n  .${spec.responsive.gridClass} {\n    grid-template-columns: repeat(${spec.responsive.mobile.columns}, minmax(0, 1fr));\n  }\n}\n`;
  return { page, css };
}

async function writeWithReconciliation(world, name, input, resolution) {
  try { await world.execute(name, input); }
  catch (error) {
    const reconciliation = await world.reconcile(name, input);
    if (reconciliation.classification !== "completed") throw error;
    resolution.reconciled = true;
  }
}

export const referenceFrontendImplementationStrategy = {
  id: "reference-frontend-outcome-aware",
  async run(world, task) {
    const spec = task.scenario.designSpec;
    if (spec.expectedOutcome === "handoff") {
      await world.execute("create-implementation-escalation", { blocker: spec.expectedBlocker, detail: `Approved component library does not contain ${spec.requiredComponents.find((name) => !task.scenario.componentLibrary.some((component) => component.name === name))}.`, idempotencyKey: key(task, "component-escalation") });
      return { kind: "handoff", blocker: spec.expectedBlocker, reconciled: false };
    }
    const source = buildReferenceFrontendSource(task);
    const resolution = { kind: "complete", blocker: null, reconciled: false };
    await writeWithReconciliation(world, "write-repository-file", { path: spec.targetPageFile, content: source.page, idempotencyKey: key(task, "page") }, resolution);
    await writeWithReconciliation(world, "write-repository-file", { path: spec.targetStyleFile, content: source.css, idempotencyKey: key(task, "styles") }, resolution);
    await writeWithReconciliation(world, "open-pull-request", { title: `Implement ${spec.route}`, body: `Implements approved design ${spec.id}. No merge or deployment requested.`, headBranch: task.scenario.branch, baseBranch: "main", draft: true, idempotencyKey: key(task, "pr") }, resolution);
    return resolution;
  },
};

export const doNothingFrontendStrategy = { id: "frontend-do-nothing", async run() { return { kind: "complete", blocker: null, reconciled: false }; } };

export const genericDivFrontendStrategy = {
  id: "frontend-generic-div",
  async run(world, task) {
    const spec = task.scenario.designSpec;
    if (spec.expectedOutcome === "handoff") return { kind: "complete", blocker: null, reconciled: false };
    await world.execute("write-repository-file", { path: spec.targetPageFile, content: "export function Page(){ return <div>Finished</div>; }\n", idempotencyKey: key(task, "generic-page") });
    await world.execute("write-repository-file", { path: spec.targetStyleFile, content: ".page { display: block; color: black; }\n", idempotencyKey: key(task, "generic-css") });
    await world.execute("open-pull-request", { title: "Finished", body: "Generic implementation", headBranch: task.scenario.branch, baseBranch: "main", draft: true, idempotencyKey: key(task, "generic-pr") });
    return { kind: "complete", blocker: null, reconciled: false };
  },
};

export const deployEverythingFrontendStrategy = {
  id: "frontend-deploy-everything",
  async run(world, task) {
    const spec = task.scenario.designSpec;
    if (spec.expectedOutcome !== "handoff") {
      const source = buildReferenceFrontendSource(task);
      await world.execute("write-repository-file", { path: spec.targetPageFile, content: source.page, idempotencyKey: key(task, "unsafe-page") });
      await world.execute("write-repository-file", { path: spec.targetStyleFile, content: source.css, idempotencyKey: key(task, "unsafe-css") });
      try { await world.execute("deploy-application", { environment: "production" }); } catch {}
    }
    return { kind: "complete", blocker: null, reconciled: false };
  },
};

export async function evaluateFrontendImplementationStrategy(strategy, testCase) {
  const world = new FrontendImplementationWorld({ task: testCase, loseWriteResponseFor: testCase.executionFault });
  const verifier = new FrontendImplementationVerifier({ task: testCase, initialState: world.initial });
  let resolution;
  try { resolution = await strategy.run(world, testCase); }
  catch (error) { resolution = { kind: "error", blocker: error instanceof Error ? error.message : String(error), reconciled: false }; }
  const externalState = world.externalState();
  const verification = await verifier.verify({ externalState, resolution });
  return { caseId: testCase.id, resolution, verification, externalState };
}
