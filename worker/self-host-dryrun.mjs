#!/usr/bin/env node
/**
 * CI-only smoke test: build the independent self-host Worker with real
 * Wrangler in --dry-run mode. No account credentials, network deployment,
 * remote D1 or secret uploads are needed. Files are disposable.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeConfig } from "../scripts/self-host-setup.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(ROOT, "wrangler.selfhost.ci.toml");
const executable = process.platform === "win32"
  ? join(ROOT, "node_modules", ".bin", "wrangler.cmd")
  : join(ROOT, "node_modules", ".bin", "wrangler");

export async function dryRunSelfHost({ run = execFileSync } = {}) {
  const outputDir = await mkdtemp(join(tmpdir(), "wvt-selfhost-bundle-"));
  let createdConfig = false;
  try {
    const template = await readFile(join(ROOT, "wrangler.selfhost.example.toml"), "utf8");
    const config = makeConfig(template, {
      worker: "wvt-selfhost-ci-only",
      database: "wvt-selfhost-ci-db",
      "database-id": "11111111-2222-4333-8444-555555555555"
    }, [120001, 120002]);
    await writeFile(configPath, config, { flag: "wx", mode: 0o600 });
    createdConfig = true;
    // Never substitute deploy for this exact --dry-run invocation.
    run(executable, [
      "deploy", "--dry-run", "--config", configPath, "--outdir", outputDir
    ], { cwd: ROOT, env: {
      ...process.env,
      WRANGLER_SEND_METRICS: "false",
      CLOUDFLARE_API_TOKEN: "",
      CLOUDFLARE_ACCOUNT_ID: ""
    }, stdio: "pipe", timeout: 90000 });
    const names = await readdir(outputDir);
    assert(names.some(name => name.endsWith(".js")), "Wrangler did not compile a JavaScript Worker");
    return names.length;
  } finally {
    if (createdConfig) await rm(configPath, { force: true });
    await rm(outputDir, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  dryRunSelfHost().then(() =>
    console.log("PASS: independent self-host Wrangler bundle compiled without remote deployment.")
  ).catch(() => {
    console.error("Self-host Wrangler --dry-run failed; no remote operation was performed.");
    process.exitCode = 1;
  });
}
