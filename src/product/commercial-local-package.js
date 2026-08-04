import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { digest } from "../core/canonical.js";
import { assertCommercialActivationReceipt, assertCommercialSpecialistBundle } from "./commercial-specialist-lifecycle.js";

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writePrivate(file, value) { fs.writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" }); fs.chmodSync(file, 0o600); }
function mode(file) { return fs.statSync(file).mode & 0o777; }
function withoutHash(value, key) { const copy = structuredClone(value); delete copy[key]; return copy; }

const FILES = Object.freeze({
  config: "config.json",
  bundle: "specialist-bundle.json",
  activation: "activation-receipt.json",
  token: "access-token",
  receipt: "package-receipt.json",
  state: "state",
});

export function prepareCommercialLocalPackage({ directory, bundle, activation, accessToken = crypto.randomBytes(32).toString("base64url") }) {
  assertCommercialSpecialistBundle(bundle);
  assertCommercialActivationReceipt(activation, { bundle });
  const root = path.resolve(directory);
  requireCondition(!fs.existsSync(root), "Commercial package directory already exists; refuse to overwrite it");
  requireCondition(Buffer.byteLength(accessToken) >= 32, "Commercial package access token must contain at least 32 bytes");
  fs.mkdirSync(root, { recursive: false, mode: 0o700 });
  fs.chmodSync(root, 0o700);
  fs.mkdirSync(path.join(root, FILES.state), { mode: 0o700 });
  const config = {
    schemaVersion: "das.commercial-local-package-config.v1",
    hostname: "127.0.0.1",
    port: 0,
    roleId: bundle.role.id,
    bundleHash: bundle.bundleHash,
    activationHash: activation.activationHash,
    stateDirectory: FILES.state,
    runLedgerFile: `${FILES.state}/runs.json`,
    accessTokenFile: FILES.token,
    credentialPolicy: "Secrets stay in owner-only customer-local files and are never copied into evidence exports.",
  };
  config.configHash = digest(config);
  writePrivate(path.join(root, FILES.config), config);
  writePrivate(path.join(root, FILES.bundle), bundle);
  writePrivate(path.join(root, FILES.activation), activation);
  writePrivate(path.join(root, FILES.token), `${accessToken}\n`);
  const receipt = {
    schemaVersion: "das.commercial-local-package-receipt.v1",
    roleId: bundle.role.id,
    bundleHash: bundle.bundleHash,
    activationHash: activation.activationHash,
    configHash: config.configHash,
    files: {
      config: { path: FILES.config, hash: digest(config), mode: "0600" },
      bundle: { path: FILES.bundle, hash: digest(bundle), mode: "0600" },
      activation: { path: FILES.activation, hash: digest(activation), mode: "0600" },
      token: { path: FILES.token, contentHash: digest(accessToken), mode: "0600", redacted: true },
      state: { path: FILES.state, mode: "0700" },
    },
    evidenceBoundary: "Customer-local package receipt. It proves file assembly and binding only; it does not prove runtime success or customer deployment.",
  };
  receipt.receiptHash = digest(receipt);
  writePrivate(path.join(root, FILES.receipt), receipt);
  return Object.freeze({ root, config, receipt });
}

export function diagnoseCommercialLocalPackage({ directory }) {
  const root = path.resolve(directory);
  const paths = Object.fromEntries(Object.entries(FILES).filter(([, name]) => name !== FILES.state).map(([key, name]) => [key, path.join(root, name)]));
  const gates = [];
  const gate = (id, check, detail) => gates.push({ id, passed: Boolean(check), detail });
  try {
    gate("package-directory-private", mode(root) === 0o700, `mode:${mode(root).toString(8).padStart(4, "0")}`);
    const config = readJson(paths.config);
    const bundle = readJson(paths.bundle);
    const activation = readJson(paths.activation);
    const receipt = readJson(paths.receipt);
    const token = fs.readFileSync(paths.token, "utf8").trim();
    let bundleValid = false; let activationValid = false;
    try { bundleValid = assertCommercialSpecialistBundle(bundle); } catch {}
    try { activationValid = assertCommercialActivationReceipt(activation, { bundle }); } catch {}
    gate("bundle-integrity", bundleValid, bundle.bundleHash ?? "missing");
    gate("activation-integrity", activationValid, activation.activationHash ?? "missing");
    gate("config-integrity", config.configHash && digest(withoutHash(config, "configHash")) === config.configHash, config.configHash ?? "missing");
    gate("exact-binding", config.bundleHash === bundle.bundleHash && config.activationHash === activation.activationHash && config.roleId === bundle.role.id, "config→bundle→activation");
    gate("loopback-only", config.hostname === "127.0.0.1" || config.hostname === "::1", config.hostname);
    gate("private-config", mode(paths.config) === 0o600, `mode:${mode(paths.config).toString(8)}`);
    gate("private-bundle", mode(paths.bundle) === 0o600, `mode:${mode(paths.bundle).toString(8)}`);
    gate("private-activation", mode(paths.activation) === 0o600, `mode:${mode(paths.activation).toString(8)}`);
    gate("private-token", mode(paths.token) === 0o600 && Buffer.byteLength(token) >= 32, `mode:${mode(paths.token).toString(8)};bytes:${Buffer.byteLength(token)}`);
    gate("private-state", mode(path.join(root, FILES.state)) === 0o700, `mode:${mode(path.join(root, FILES.state)).toString(8)}`);
    gate("receipt-integrity", receipt.receiptHash && digest(withoutHash(receipt, "receiptHash")) === receipt.receiptHash, receipt.receiptHash ?? "missing");
    gate("receipt-exact-binding", receipt.roleId === bundle.role.id && receipt.bundleHash === bundle.bundleHash && receipt.activationHash === activation.activationHash && receipt.configHash === config.configHash, "receipt→config→bundle→activation");
    gate("receipt-file-hashes", receipt.files?.config?.hash === digest(config) && receipt.files?.bundle?.hash === digest(bundle) && receipt.files?.activation?.hash === digest(activation) && receipt.files?.token?.contentHash === digest(token), "all packaged inputs match receipt");
    let stateWritable = true;
    try { fs.accessSync(path.join(root, FILES.state), fs.constants.R_OK | fs.constants.W_OK); } catch { stateWritable = false; }
    gate("state-readable-writable", stateWritable, FILES.state);
    gate("token-redacted-from-package-records", !JSON.stringify({ config, bundle, activation, receipt }).includes(token), "token absent from JSON package records");
    gate("node-runtime", Number(process.versions.node.split(".")[0]) >= 24, process.versions.node);
  } catch (error) {
    gate("package-readable", false, error instanceof Error ? error.message : String(error));
  }
  return Object.freeze({ schemaVersion: "das.commercial-local-package-diagnostics.v1", ready: gates.length > 0 && gates.every((item) => item.passed), gates, checkedAt: new Date().toISOString(), evidenceBoundary: "Local package diagnostics only. Customer adapter, verifier and real workflow acceptance remain separate activation evidence." });
}

export function loadCommercialLocalPackage({ directory }) {
  const diagnostics = diagnoseCommercialLocalPackage({ directory });
  requireCondition(diagnostics.ready, `Commercial local package is not ready: ${diagnostics.gates.filter((item) => !item.passed).map((item) => item.id).join(",")}`);
  const root = path.resolve(directory);
  return Object.freeze({
    root,
    config: readJson(path.join(root, FILES.config)),
    bundle: readJson(path.join(root, FILES.bundle)),
    activation: readJson(path.join(root, FILES.activation)),
    accessToken: fs.readFileSync(path.join(root, FILES.token), "utf8").trim(),
    ledgerPath: path.join(root, FILES.state, "runs.json"),
    diagnostics,
  });
}
