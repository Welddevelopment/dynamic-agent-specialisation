import { digest } from "../core/canonical.js";

export class ExecutionAttestor {
  #declared = new Map();
  #reached = new Map();
  constructor(declaredEntryPoints) {
    for (const declaration of declaredEntryPoints ?? []) {
      for (const field of ["armId", "module", "exportName"]) {
        if (!declaration[field]) throw new Error(`Entry-point declaration missing ${field}`);
      }
      this.#declared.set(declaration.armId, { module: declaration.module, exportName: declaration.exportName });
    }
    if (!this.#declared.size) throw new Error("Execution attestation needs at least one declared entry point");
  }
  wrap(armId, fn) {
    const declared = this.#declared.get(armId);
    if (!declared) throw new Error(`No declared entry point for arm: ${armId}`);
    if (typeof fn !== "function") throw new Error(`Entry point for ${armId} is not a function`);
    const reached = this.#reached;
    return function attested(...args) {
      reached.set(armId, (reached.get(armId) ?? 0) + 1);
      return fn.apply(this, args);
    };
  }
  assertAllReached() {
    const missing = [...this.#declared.keys()].filter((armId) => !(this.#reached.get(armId) > 0));
    if (missing.length) {
      throw new Error(`Declared entry points never executed: ${missing.join(", ")} — the campaign description does not match what ran`);
    }
  }
  receipt() {
    const core = {
      schemaVersion: "das.execution-attestation.v1",
      arms: [...this.#declared.entries()].map(([armId, declared]) => ({
        armId,
        module: declared.module,
        exportName: declared.exportName,
        invocations: this.#reached.get(armId) ?? 0,
      })),
    };
    return { ...core, attestationHash: digest(core) };
  }
}
