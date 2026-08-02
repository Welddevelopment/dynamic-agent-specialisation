export class TenantRoleMemory {
  #records = new Map();
  #mode(memoryPolicy = {}) {
    const kind = String(memoryPolicy.kind ?? "task-scoped").toLowerCase();
    if (kind.includes("none") || kind.includes("disabled")) return "none";
    if (kind.includes("tenant")) return "tenant";
    return "task";
  }
  #key({ tenantId, roleId, specialistVersion, runId, memoryPolicy }) {
    const mode = this.#mode(memoryPolicy);
    if (mode === "none") return null;
    return mode === "tenant"
      ? `${tenantId}\u0000${roleId}\u0000${specialistVersion}\u0000tenant`
      : `${tenantId}\u0000${roleId}\u0000${specialistVersion}\u0000${runId ?? "task"}`;
  }
  append({ tenantId, roleId, specialistVersion, runId, memoryPolicy, record }) {
    const key = this.#key({ tenantId, roleId, specialistVersion, runId, memoryPolicy });
    if (!key) return;
    const values = this.#records.get(key) ?? [];
    values.push(structuredClone(record));
    this.#records.set(key, values);
  }
  read({ tenantId, roleId, specialistVersion, runId, memoryPolicy }) {
    const key = this.#key({ tenantId, roleId, specialistVersion, runId, memoryPolicy });
    return key ? structuredClone(this.#records.get(key) ?? []) : [];
  }
}
