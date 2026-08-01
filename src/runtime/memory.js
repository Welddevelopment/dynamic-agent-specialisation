export class TenantRoleMemory {
  #records = new Map();
  #key(tenantId, roleId, specialistVersion) { return `${tenantId}\u0000${roleId}\u0000${specialistVersion}`; }
  append({ tenantId, roleId, specialistVersion, record }) {
    const key = this.#key(tenantId, roleId, specialistVersion);
    const values = this.#records.get(key) ?? [];
    values.push(structuredClone(record));
    this.#records.set(key, values);
  }
  read({ tenantId, roleId, specialistVersion }) { return structuredClone(this.#records.get(this.#key(tenantId, roleId, specialistVersion)) ?? []); }
}

