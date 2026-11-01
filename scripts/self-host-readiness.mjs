#!/usr/bin/env node
/**
 * Offline release gate for a user's OWN self-host installation.
 * No subprocess, network access, Worker deployment, D1 access or secret output.
 * Reports never contain API keys, database IDs, Worker names or token hashes.
 */
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSetup } from "./self-host-setup.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HELP = [
  "Self-host offline readiness (does not contact Cloudflare):",
  "  node scripts/self-host-readiness.mjs check",
  "  node scripts/self-host-readiness.mjs check --report self-host-readiness.json",
  "No network, remote D1 migration, deploy or token upload.",
  "A PASS means local configuration is ready for independent LIVE testing only."
].join("\n") + "\n";
const REQUIRED_FILES = Object.freeze([
  "worker/index.ts", "worker/service.ts", "worker/publishing.ts",
  "src/model.ts",
  "worker/migrations/0001_initial.sql",
  "worker/migrations/0002_atomic_increment.sql",
  "worker/migrations/0003_publishing.sql",
  "worker/migrations/0004_visit_budget.sql",
  "scripts/self-host-publish.mjs", "scripts/self-host-verify.mjs",
  "wrangler.selfhost.example.toml"
]);
const PRIVATE_IGNORED = Object.freeze([
  "wrangler.selfhost.toml", ".wvt-admin-token", ".wvt-visit-secret",
  ".dev.vars"
]);
const PENDING_LIVE = Object.freeze([
  "cloudflareAccountOwnership",
  "newRemoteD1Ownership",
  "remoteMigrations",
  "deployedWorkerAndSecrets",
  "realCounterCreateUpdateAndRestart",
  "cloudflareUsageAndBilling"
]);

export function parseReadinessArgs(argv) {
  if (argv.length === 1 && ["help", "--help", "-h"].includes(argv[0])) {
    return { help: true };
  }
  if (argv.length === 1 && argv[0] === "check") return { command: "check" };
  if (argv.length === 3 && argv[0] === "check" && argv[1] === "--report" &&
      argv[2] && !argv[2].startsWith("-")) {
    return { command: "check", report: argv[2] };
  }
  throw Error("Expected check or check --report OUTPUT.json (no cloud flags)");
}

export function checkNodeVersion(version) {
  const match = typeof version === "string"
    ? version.match(/^(\d+)\.(\d+)\.(\d+)$/) : null;
  if (!match) throw Error("A supported Node.js version is required");
  const major = Number(match[1]), minor = Number(match[2]);
  // Vitest 5 requires Node ^22.12.0 || ^24.0.0 || >=26.0.0.
  if (!((major === 22 && minor >= 12) || major === 24 || major >= 26)) {
    throw Error("Node.js 22.12+ LTS, 24.x, or 26+ is required by the locked toolchain");
  }
  return true;
}

function safeLockfile(manifest, lock) {
  if (!manifest || !lock || manifest.name !== "workshop-visitor-terminal" ||
      manifest.name !== lock.name || manifest.version !== lock.version ||
      lock.lockfileVersion !== 3 || !lock.packages?.[""] ||
      Object.keys(lock.packages).length < 10) {
    throw Error("Missing or incompatible npm package-lock.json");
  }
  const root = lock.packages[""];
  for (const key of ["dependencies", "devDependencies"]) {
    if (JSON.stringify(root[key] ?? {}) !== JSON.stringify(manifest[key] ?? {})) {
      throw Error("package-lock.json does not match package.json");
    }
  }
  if (!root.devDependencies?.wrangler) throw Error("Missing locked Wrangler dependency");
  for (const [path, value] of Object.entries(lock.packages)) {
    if (!path) continue;
    if (!path.startsWith("node_modules/") ||
        !/^https:\/\/registry\.npmjs\.org\//.test(value.resolved ?? "") ||
        !/^sha512-[A-Za-z0-9+/=]+$/.test(value.integrity ?? "") ||
        !/^\d+\.\d+\.\d+/.test(value.version ?? "") ||
        value.link === true || value.inBundle === true) {
      throw Error("Untrusted or incomplete npm dependency lock");
    }
  }
  return true;
}

async function assertRequiredFiles(root) {
  for (const file of REQUIRED_FILES) {
    const item = await stat(join(root, file));
    if (!item.isFile() || item.size < 10) {
      throw Error("Required self-host source or D1 migration is empty");
    }
  }
}

export async function inspectOfflineReadiness({
  root = ROOT, nodeVersion = process.versions.node
} = {}) {
  checkNodeVersion(nodeVersion);
  // Do not expose or read any remote Cloudflare credentials.
  // This verifies the two local secrets WITHOUT returning their values.
  await checkSetup({ root });
  const ignore = await readFile(join(root, ".gitignore"), "utf8");
  for (const file of PRIVATE_IGNORED) {
    const lines = ignore.split(/\r?\n/).map(line => line.trim());
    if (!lines.includes(file)) {
      throw Error("Private config and credentials must be gitignored");
    }
  }
  const [manifest, lock] = await Promise.all([
    readFile(join(root, "package.json"), "utf8").then(JSON.parse),
    readFile(join(root, "package-lock.json"), "utf8").then(JSON.parse)
  ]);
  safeLockfile(manifest, lock);
  await assertRequiredFiles(root);
  return {
    schemaVersion: 1,
    kind: "workshop-visitor-terminal-selfhost-readiness",
    local: "PASS",
    checks: {
      node22: "PASS",
      isolatedWorkerD1Configuration: "PASS",
      privateDistinctCredentials: "PASS",
      gitignorePrivateFiles: "PASS",
      lockfileIntegrity: "PASS",
      requiredWorkerAndMigrations: "PASS"
    },
    live: Object.fromEntries(PENDING_LIVE.map(key => [key, "NOT_TESTED"])),
    releaseGate: "PENDING_INDEPENDENT_CLOUDFLARE_TEST",
    message: "Local-only readiness. No Cloudflare ownership, billing or live deployment is verified."
  };
}

export async function writeReadinessReport(report, output) {
  if (typeof output !== "string" || !output.trim()) {
    throw Error("A report output file is required");
  }
  // wx means a previous report or private user file is NEVER overwritten.
  // Never print user paths, token contents or runtime environment variables.
  await writeFile(output, JSON.stringify(report, null, 2) + "\n", {
    flag: "wx", mode: 0o600
  });
}

async function main() {
  try {
    const args = parseReadinessArgs(process.argv.slice(2));
    if (args.help) { process.stdout.write(HELP); return; }
    const report = await inspectOfflineReadiness();
    if (args.report) await writeReadinessReport(report, args.report);
    process.stdout.write(
      "PASS: offline setup, secret separation, Worker/D1 config, " +
      "locked npm dependencies and migrations.\n" +
      (args.report ? "Sanitized report created without overwriting an existing file.\n" : "") +
      "LIVE CLOUD TEST REQUIRED: Cloudflare account ownership, remote D1, " +
      "deployment, real image counting and billing remain unverified.\n"
    );
  } catch {
    // No credentials, raw config, errors from private paths or subprocess
    // output should ever appear in diagnostics.
    process.stderr.write(
      "Self-host offline readiness failed. Check local init/config, Node 22+, " +
      "private files and locked dependencies. No remote operation was attempted.\n"
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
