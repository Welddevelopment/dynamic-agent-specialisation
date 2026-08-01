import fs from "node:fs";
import path from "node:path";
import { canonicalJson, digest } from "./canonical.js";

export class EvidenceLedger {
  #previousHash = "GENESIS";
  #records = [];
  constructor(filename = null) {
    this.filename = filename;
    if (filename) fs.mkdirSync(path.dirname(filename), { recursive: true });
  }
  append(type, payload) {
    const record = { sequence: this.#records.length + 1, type, payload, previousHash: this.#previousHash };
    const sealed = { ...record, hash: digest(record) };
    this.#records.push(sealed);
    this.#previousHash = sealed.hash;
    if (this.filename) fs.appendFileSync(this.filename, `${canonicalJson(sealed)}\n`, "utf8");
    return sealed;
  }
  records() { return structuredClone(this.#records); }
  verify() {
    let previousHash = "GENESIS";
    for (let index = 0; index < this.#records.length; index += 1) {
      const { hash, ...record } = this.#records[index];
      if (record.sequence !== index + 1 || record.previousHash !== previousHash || digest(record) !== hash) return false;
      previousHash = hash;
    }
    return true;
  }
}

