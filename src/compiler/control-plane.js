import { activationReadiness } from "./activation.js";

export class SpecialistControlPlane {
  #active = new Map();
  #history = [];
  activateRecommended({ compiled, role, environment, activeTasks = [] }) {
    return this.#activate({ specialist: compiled.retained, role, environment, activeTasks, reason: "compiler-recommendation" });
  }
  requestSwitch({ specialist, role, environment, activeTasks = [], requestedBy }) {
    if (!requestedBy) throw new Error("A switch request requires an accountable requester");
    return this.#activate({ specialist, role, environment, activeTasks, reason: `human-override:${requestedBy}` });
  }
  #activate({ specialist, role, environment, activeTasks, reason }) {
    const readiness = activationReadiness({ specialist, role, currentEnvironment: environment, activeTasks });
    const event = { roleId: role.id, specialistId: specialist.id, version: specialist.version, reason, readiness, at: new Date().toISOString() };
    this.#history.push(event);
    if (!readiness.ready) return { activated: false, event };
    const previous = this.#active.get(role.id) ?? null;
    this.#active.set(role.id, specialist);
    return { activated: true, previous: previous?.id ?? null, current: specialist.id, event };
  }
  active(roleId) { return structuredClone(this.#active.get(roleId) ?? null); }
  history() { return structuredClone(this.#history); }
}

