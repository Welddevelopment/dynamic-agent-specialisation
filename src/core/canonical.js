import { createHash, randomUUID } from "node:crypto";

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digest(value) { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
export function id(prefix) { return `${prefix}-${randomUUID()}`; }
export function deepClone(value) { return structuredClone(value); }

