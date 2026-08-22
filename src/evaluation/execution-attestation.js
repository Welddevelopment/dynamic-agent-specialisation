import path from "node:path";
import { pathToFileURL } from "node:url";
import { digest } from "../core/canonical.js";

const DECLARATION_FIELDS = ["armId", "module", "exportName"];

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function defaultImportModule(moduleSpecifier, repositoryRoot) {
  return import(pathToFileURL(path.resolve(repositoryRoot, moduleSpecifier)).href);
}

/**
 * Attests that the entry point a campaign DECLARED is the code that actually ran.
 *
 * Declaring an entry point is not evidence on its own. Erratum 0111a exists because a
 * sealed preregistration named the DAS compiler while a persona-prompted designer ran
 * instead. Catching that requires resolving the declaration against the real module and
 * checking identity — counting invocations per arm does not, because any function at all
 * can be counted under any arm id.
 *
 * `verifyDeclarations: true` (the default) enforces that. `false` preserves the older
 * count-only behaviour and is explicitly NOT proof that the declared code ran; it is
 * retained only for callers that attest something not addressable as a module export.
 */
export class ExecutionAttestor {
  #declared = new Map();
  #resolved = new Map();
  #reached = new Map();
  #verifyDeclarations;
  #resolutionState = "not-attempted";

  constructor(declaredEntryPoints, { verifyDeclarations = true } = {}) {
    for (const declaration of declaredEntryPoints ?? []) {
      for (const field of DECLARATION_FIELDS) {
        if (!declaration[field]) throw new Error(`Entry-point declaration missing ${field}`);
      }
      if (this.#declared.has(declaration.armId)) throw new Error(`Duplicate entry-point declaration for arm: ${declaration.armId}`);
      this.#declared.set(declaration.armId, {
        module: declaration.module,
        exportName: declaration.exportName,
        methodName: declaration.methodName ?? null,
      });
    }
    if (!this.#declared.size) throw new Error("Execution attestation needs at least one declared entry point");
    this.#verifyDeclarations = verifyDeclarations;
  }

  get verifiesDeclarations() { return this.#verifyDeclarations; }
  get resolutionState() { return this.#resolutionState; }
  declarations() { return [...this.#declared.entries()].map(([armId, declared]) => ({ armId, ...declared })); }

  /**
   * Imports every declared module and resolves the named export (and method, when the
   * declaration names one). Throws if a declaration does not point at real code.
   */
  async resolve({ repositoryRoot = process.cwd(), importModule = defaultImportModule } = {}) {
    for (const [armId, declared] of this.#declared) {
      let namespace;
      try {
        namespace = await importModule(declared.module, repositoryRoot);
      } catch (error) {
        this.#resolutionState = "failed";
        throw new Error(`Declared entry point for ${armId} does not load: ${declared.module} — ${error instanceof Error ? error.message : String(error)}`);
      }
      const exported = namespace?.[declared.exportName];
      if (exported === undefined) {
        this.#resolutionState = "failed";
        throw new Error(`Declared entry point for ${armId} is missing export ${declared.exportName} in ${declared.module}`);
      }
      let target = exported;
      if (declared.methodName) {
        const carrier = typeof exported === "function" ? exported.prototype : exported;
        target = carrier?.[declared.methodName];
        if (typeof target !== "function") {
          this.#resolutionState = "failed";
          throw new Error(`Declared entry point for ${armId} is missing method ${declared.exportName}.${declared.methodName} in ${declared.module}`);
        }
      }
      if (typeof target !== "function") {
        this.#resolutionState = "failed";
        throw new Error(`Declared entry point for ${armId} is not callable: ${declared.exportName} in ${declared.module}`);
      }
      this.#resolved.set(armId, target);
    }
    this.#resolutionState = "resolved";
    return this;
  }

  #count(armId) {
    this.#reached.set(armId, (this.#reached.get(armId) ?? 0) + 1);
  }

  /**
   * Wraps a function as an arm's entry point. Once declarations are resolved the supplied
   * function must BE the declared export/method — that identity check is what makes the
   * declaration load-bearing rather than a label.
   */
  wrap(armId, fn) {
    const declared = this.#declared.get(armId);
    if (!declared) throw new Error(`No declared entry point for arm: ${armId}`);
    if (typeof fn !== "function") throw new Error(`Entry point for ${armId} is not a function`);
    if (this.#resolutionState === "resolved") {
      const target = this.#resolved.get(armId);
      if (fn !== target) {
        const named = declared.methodName ? `${declared.exportName}.${declared.methodName}` : declared.exportName;
        throw new Error(`Entry point wrapped for ${armId} is not the declared ${named} from ${declared.module} — the campaign description does not match the code being run`);
      }
    } else if (this.#verifyDeclarations) {
      throw new Error(`Entry point for ${armId} was wrapped before declarations were resolved; call resolve() first or construct with verifyDeclarations:false`);
    }
    const count = () => this.#count(armId);
    return function attested(...args) {
      count();
      return fn.apply(this, args);
    };
  }

  /**
   * Returns the attested entry point taken FROM the resolved declaration, so a runner
   * cannot declare one function and execute another. Bind `thisArg` for instance methods.
   */
  entryPoint(armId, thisArg = undefined) {
    if (this.#resolutionState !== "resolved") throw new Error(`Entry point for ${armId} requested before declarations were resolved`);
    const target = this.#resolved.get(armId);
    if (!target) throw new Error(`No declared entry point for arm: ${armId}`);
    const attested = this.wrap(armId, target);
    return thisArg === undefined ? attested : attested.bind(thisArg);
  }

  assertAllReached() {
    if (this.#verifyDeclarations && this.#resolutionState !== "resolved") {
      throw new Error("Execution attestation cannot be asserted before declarations are resolved — an unresolved declaration is not evidence that the declared code ran");
    }
    const missing = [...this.#declared.keys()].filter((armId) => !(this.#reached.get(armId) > 0));
    if (missing.length) {
      throw new Error(`Declared entry points never executed: ${missing.join(", ")} — the campaign description does not match what ran`);
    }
    return this;
  }

  receipt() {
    const core = {
      schemaVersion: "das.execution-attestation.v2",
      declarationsVerified: this.#verifyDeclarations && this.#resolutionState === "resolved",
      resolutionState: this.#resolutionState,
      arms: [...this.#declared.entries()].map(([armId, declared]) => ({
        armId,
        module: declared.module,
        exportName: declared.exportName,
        methodName: declared.methodName,
        invocations: this.#reached.get(armId) ?? 0,
      })),
    };
    return { ...core, attestationHash: digest(core) };
  }
}

/**
 * Installs an arm's attested entry point onto the instance that a runner will call, so the
 * method the runner invokes IS the declared export. The declaration must name a methodName.
 */
export function attestInstanceEntryPoint(attestor, armId, instance) {
  const declared = attestor.declarations().find((row) => row.armId === armId);
  requireCondition(declared, `No declared entry point for arm: ${armId}`);
  requireCondition(declared.methodName, `Entry point for ${armId} declares no methodName; cannot attest an instance method`);
  requireCondition(instance && typeof instance[declared.methodName] === "function", `Instance for ${armId} has no ${declared.methodName} method`);
  instance[declared.methodName] = attestor.entryPoint(armId, instance);
  return instance;
}

/** Frozen, hashable entry-point declarations for sealing inside a preregistration. */
export function declareArmEntryPoints(declarations) {
  requireCondition(Array.isArray(declarations) && declarations.length > 0, "A campaign must declare at least one arm entry point");
  const rows = declarations.map((declaration) => {
    for (const field of DECLARATION_FIELDS) {
      requireCondition(declaration[field], `Entry-point declaration missing ${field}`);
    }
    return Object.freeze({
      armId: declaration.armId,
      module: declaration.module,
      exportName: declaration.exportName,
      methodName: declaration.methodName ?? null,
    });
  });
  const armIds = rows.map((row) => row.armId);
  requireCondition(new Set(armIds).size === armIds.length, "Duplicate arm in entry-point declarations");
  const core = Object.freeze({ schemaVersion: "das.arm-entry-points.v1", arms: Object.freeze(rows) });
  return Object.freeze({ ...core, entryPointsHash: digest(core) });
}

/** Verifies sealed declarations still hash to their seal, then builds a resolved attestor. */
export async function attestorForSealedEntryPoints(sealed, { repositoryRoot = process.cwd(), importModule } = {}) {
  requireCondition(sealed?.schemaVersion === "das.arm-entry-points.v1", "Unsupported arm entry-point declaration");
  const copy = structuredClone(sealed);
  const expected = copy.entryPointsHash;
  delete copy.entryPointsHash;
  requireCondition(expected && digest(copy) === expected, "Arm entry-point declaration integrity mismatch");
  const attestor = new ExecutionAttestor(sealed.arms, { verifyDeclarations: true });
  await attestor.resolve({ repositoryRoot, importModule });
  return attestor;
}
