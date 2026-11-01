#!/usr/bin/env node
/**
 * Disposable real-Wrangler integration test for self-hosted counters.
 *
 * Explicit local-only flags, a random D1 UUID, a separate --persist-to
 * directory and never-committed fake credentials. This cannot deploy or
 * migrate a remote database and refuses to replace any existing .dev.vars.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import { readFile, writeFile, rm, mkdtemp, stat } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeConfig } from "../scripts/self-host-setup.mjs";
import { execute } from "../scripts/self-host-publish.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_NAME = "wrangler.selfhost.smoke.toml";
const CONFIG = join(ROOT, CONFIG_NAME);
const DEV_VARS = join(ROOT, ".dev.vars");
const WRANGLER = process.platform === "win32"
  ? join(ROOT, "node_modules", ".bin", "wrangler.cmd")
  : join(ROOT, "node_modules", ".bin", "wrangler");
const LOCAL_ENV = {
  ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false",
  CLOUDFLARE_API_TOKEN: "", CLOUDFLARE_ACCOUNT_ID: ""
};
const ADMIN_TOKEN = randomBytes(48).toString("hex");
const VISIT_SECRET = randomBytes(48).toString("hex");
const SLUG = "selfhost-" + randomBytes(6).toString("hex");
const DESIGN = {
  schemaVersion: 1, theme: "pixel", width: 420, height: 220,
  background: "#101820", accent: "#7ee787",
  layers: [
    { id: "heading", kind: "text", x: 24, y: 24, width: 330, height: 36,
      text: "SELF-HOSTED OK", fontSize: 18, color: "#7ee787", visible: true },
    { id: "visits", kind: "count", x: 24, y: 88, width: 330, height: 70,
      text: "", fontSize: 44, color: "#7ee787", visible: true }
  ]
};

async function exists(path) {
  try { await stat(path); return true; }
  catch (e) { if (e?.code === "ENOENT") return false; throw e; }
}

async function shutdown(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  for (let i = 0; i < 40 && child.exitCode === null; i++) await sleep(100);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function start(port, persistence) {
  let logs = "";
  const child = spawn(WRANGLER, [
    "dev", "--local", "--config", CONFIG, "--persist-to", persistence,
    "--ip", "127.0.0.1", "--port", String(port)
  ], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: LOCAL_ENV });
  const capture = data => { logs = (logs + String(data)).slice(-6000); };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.on("error", capture);
  const origin = "http://127.0.0.1:" + port;
  try {
    for (let attempt = 0; attempt < 90; attempt++) {
      if (child.exitCode !== null) throw Error("Local Wrangler exited before health became ready");
      try {
        const response = await fetch(origin + "/health", {
          signal: AbortSignal.timeout(1000), redirect: "error"
        });
        if (response.status === 200) return { child, origin };
      } catch { /* wait for the local runtime */ }
      await sleep(500);
    }
    throw Error("Local Wrangler did not become ready");
  } catch {
    await shutdown(child);
    // Never dump runtime logs, user configuration or sensitive headers.
    throw Error("Self-host Worker failed to boot in the disposable local environment");
  }
}

async function checked(response, status) {
  assert.equal(response.status, status, "Unexpected local Worker HTTP status");
  return response.json();
}

export async function smokeSelfHostedCounter() {
  // Both paths are ignored, but the test also refuses to replace a real
  // developer's local secrets/config. No automatic cleanup of existing files.
  if (await exists(CONFIG) || await exists(DEV_VARS)) {
    throw Error("Existing local self-host config or .dev.vars: refusing to overwrite");
  }
  const persistence = await mkdtemp(join(tmpdir(), "wvt-selfhost-d1-"));
  const designDir = await mkdtemp(join(tmpdir(), "wvt-selfhost-design-"));
  const tokenPath = join(designDir, "private-admin-token");
  const designPath = join(designDir, "design.json");
  let configCreated = false, devVarsCreated = false, running;
  try {
    const template = await readFile(join(ROOT, "wrangler.selfhost.example.toml"), "utf8");
    const config = makeConfig(template, {
      worker: "wvt-selfhost-disposable",
      database: "wvt-selfhost-disposable-db",
      "database-id": "c0000000-0000-4000-8000-000000000001"
    }, [randomInt(100_000, 999_999), randomInt(1_000_000, 2_000_000)]);
    await writeFile(CONFIG, config, { flag: "wx", mode: 0o600 });
    configCreated = true;
    await writeFile(DEV_VARS,
      "ADMIN_TOKEN=" + ADMIN_TOKEN + "\nVISIT_HASH_SECRET=" + VISIT_SECRET + "\n",
      { flag: "wx", mode: 0o600 });
    devVarsCreated = true;
    await writeFile(tokenPath, ADMIN_TOKEN + "\n", { flag: "wx", mode: 0o600 });
    await writeFile(designPath, JSON.stringify(DESIGN), { flag: "wx", mode: 0o600 });

    // All database operations use --local AND isolated --persist-to.
    // Deliberately DO NOT accept dynamic/remote migration flags.
    execFileSync(WRANGLER, [
      "d1", "migrations", "apply", "DB", "--local", "--config", CONFIG,
      "--persist-to", persistence
    ], { cwd: ROOT, env: LOCAL_ENV, stdio: "pipe", timeout: 90000 });

    const port = randomInt(18000, 45000);
    running = await start(port, persistence);
    const origin = running.origin;
    const api = (path, init) => fetch(origin + path, {
      ...init, redirect: "error", signal: AbortSignal.timeout(8000)
    });
    assert.equal((await api("/health")).status, 200);
    assert.equal((await api("/v1/my/counters", {
      headers: { Origin: "https://guitar0788.github.io" }
    })).status, 503, "Self-hosted OAuth must remain disabled");
    assert.equal((await api("/v1/admin/counters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: SLUG, owner: "test-user" })
    })).status, 401, "Anonymous administration must be denied");

    const cli = (command, other = {}) => execute({
      command, api: origin, slug: SLUG, "token-file": tokenPath, ...other
    });
    const published = await cli("create", {
      owner: "self-host-tester", design: designPath
    });
    assert.match(published, /!\[Visitor counter\]\(http:\/\/127\.0\.0\.1:/);
    assert(!published.includes(ADMIN_TOKEN), "Admin secret must never appear in CLI output");

    const imagePath = "/v1/counters/" + SLUG + ".svg";
    assert.equal((await api(imagePath, { method: "HEAD" })).status, 200);
    assert.match(await cli("inspect"), /Recorded upstream requests: 0/);
    const first = await api(imagePath, {
      headers: { "CF-Connecting-IP": "203.0.113.17" }
    });
    assert.equal(first.status, 200);
    assert.match(await first.text(), /SELF-HOSTED OK/);
    assert.match(await cli("inspect"), /Recorded upstream requests: 1/);
    assert.equal((await api(imagePath, {
      headers: { "CF-Connecting-IP": "203.0.113.17" }
    })).status, 200);
    assert.match(await cli("inspect"), /Recorded upstream requests: 1/,
      "Deduplication must not increment on repeated requests");

    const modified = { ...DESIGN, layers: DESIGN.layers.map(
      layer => layer.id === "heading" ? { ...layer, text: "UPDATED AND PERSISTED" } : layer
    ) };
    await writeFile(designPath, JSON.stringify(modified));
    assert.match(await cli("update", { design: designPath }), /Counter ready/);
    assert.match(await cli("inspect"), /Recorded upstream requests: 1/,
      "Changing a design must preserve accumulated hits");
    const updated = await api(imagePath, { method: "HEAD" });
    assert.equal(updated.status, 200, "HEAD must never add a visit");

    await shutdown(running.child);
    running = undefined;
    running = await start(port, persistence);
    assert.match(await cli("inspect"), /Recorded upstream requests: 1/,
      "Counts must persist after restart in the same local D1");
    const afterRestart = await api(imagePath, { method: "GET" });
    assert.equal(afterRestart.status, 200);
    assert.match(await afterRestart.text(), /UPDATED AND PERSISTED/);
    assert.match(await cli("inspect"), /Recorded upstream requests: 1/);
    console.log("PASS: self-hosted Wrangler local migrations, private CLI publishing, " +
      "SVG, deduplication, design update, restart persistence, and closed OAuth.");
  } finally {
    if (running) await shutdown(running.child);
    if (devVarsCreated) await rm(DEV_VARS, { force: true });
    if (configCreated) await rm(CONFIG, { force: true });
    await rm(designDir, { recursive: true, force: true });
    await rm(persistence, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  smokeSelfHostedCounter().catch(() => {
    console.error("Self-hosted local smoke failed. No remote Cloudflare resource was touched.");
    process.exitCode = 1;
  });
}
