#!/usr/bin/env node
/**
 * End-to-end smoke test using actual local Wrangler/workerd and local D1.
 * This script never calls Cloudflare APIs or a remote Worker and uses
 * randomly generated test-only secrets stored in ignored .dev.vars.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFile, rm } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const endpoint = "http://127.0.0.1:8791";
const wranglerExecutable = process.platform === "win32"
  ? "node_modules/.bin/wrangler.cmd"
  : "./node_modules/.bin/wrangler";
const secret = randomBytes(48).toString("hex");
const hashSecret = randomBytes(48).toString("hex");
const slug = "smoke-" + randomBytes(5).toString("hex");
const legacySlug = "legacy-" + randomBytes(5).toString("hex");
let processHandle;
let logs = "";

const api = (path, init) => fetch(endpoint + path, {
  ...init,
  signal: AbortSignal.timeout(8_000)
});
const auth = () => ({ Authorization: "Bearer " + secret });
const jsonHeaders = () => ({ ...auth(), "Content-Type": "application/json" });
const requestAdmin = (path, method = "GET", payload) => api(path, {
  method,
  headers: method === "GET" ? auth() : jsonHeaders(),
  ...(method === "GET" ? {} : { body: JSON.stringify(payload) })
});
const checkedJson = async (response, expectedStatus) => {
  const data = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(data));
  return data;
};

async function boot() {
  logs = "";
  processHandle = spawn(wranglerExecutable, [
    "dev", "--local", "--config", "wrangler.toml",
    "--ip", "127.0.0.1", "--port", "8791"
  ], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "true" } });
  const capture = chunk => { logs = (logs + chunk.toString()).slice(-16000); };
  processHandle.stdout.on("data", capture);
  processHandle.stderr.on("data", capture);
  processHandle.on("error", capture);
  for (let i = 0; i < 90; i++) {
    if (processHandle.exitCode !== null) throw Error("Wrangler stopped early: " + logs);
    try {
      const response = await api("/health");
      if (response.ok) return;
    } catch {
      // Worker is still booting.
    }
    await sleep(500);
  }
  throw Error("Wrangler did not become ready: " + logs);
}

async function shutdown() {
  if (!processHandle) return;
  const running = processHandle;
  processHandle = undefined;
  if (running.exitCode !== null) return;
  running.kill("SIGTERM");
  for (let i = 0; i < 30 && running.exitCode === null; i++) await sleep(100);
  if (running.exitCode === null) running.kill("SIGKILL");
}

async function main() {
  await writeFile(".dev.vars",
    "ADMIN_TOKEN=" + secret + "\nVISIT_HASH_SECRET=" + hashSecret + "\n",
    { mode: 0o600, flag: "wx" }); // Refuse to overwrite an existing developer secret file.

  try {
    await boot();
    assert.equal((await api("/health")).status, 200, "Health is reachable");

    const unauthorized = await api("/v1/admin/counters", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, owner: "guitar0788" })
    });
    assert.equal(unauthorized.status, 401, "Admin creation requires a token");

    await checkedJson(await requestAdmin("/v1/admin/counters", "POST", {
      slug, owner: "guitar0788"
    }), 201);

    const imagePath = "/v1/counters/" + slug + ".svg";
    const adminPath = "/v1/admin/counters/" + slug;

    const head = await api(imagePath, { method: "HEAD" });
    assert.equal(head.status, 200, "HEAD must return image metadata");
    assert.match(head.headers.get("content-type") ?? "", /image\/svg\+xml/);
    assert.equal((await checkedJson(await requestAdmin(adminPath), 200)).hits, 0);

    const first = await api(imagePath, {
      headers: { "CF-Connecting-IP": "203.0.113.16" }
    });
    assert.equal(first.status, 200, "SVG GET must be served");
    assert.match(await first.text(), /<svg\b/);

    const firstCount = (await checkedJson(await requestAdmin(adminPath), 200)).hits;
    assert.equal(firstCount, 1, "First qualifying upstream GET must increment once");

    const repeated = await Promise.all(Array.from({ length: 8 }, () =>
      api(imagePath, { headers: { "CF-Connecting-IP": "203.0.113.16" } })
    ));
    assert(repeated.every(response => response.status === 200),
      "All concurrent repeated requests should return SVG");
    assert.equal((await checkedJson(await requestAdmin(adminPath), 200)).hits,
      1, "Concurrent duplicate requests must not double-count");

    const legacyAdmin = "/v1/admin/counters/" + legacySlug;
    await checkedJson(await requestAdmin("/v1/admin/counters", "POST", {
      slug: legacySlug, owner: "guitar0788"
    }), 201);
    const legacyPayload = {
      hits: 47, source: "https://komarev.com/ghpvc/?username=example",
      capturedAt: new Date(Date.now() - 120_000).toISOString()
    };
    await checkedJson(await requestAdmin(legacyAdmin + "/legacy", "POST", legacyPayload), 200);
    assert.equal((await checkedJson(await requestAdmin(legacyAdmin), 200)).hits, 47);
    assert.equal((await requestAdmin(legacyAdmin + "/legacy", "POST", legacyPayload)).status,
      409, "A second legacy migration must not overwrite the baseline");

    const design = {
      schemaVersion: 1, theme: "pixel", width: 420, height: 220,
      background: "#101820", accent: "#7ee787",
      layers: [
        { id: "label", kind: "text", x: 24, y: 25,
          width: 330, height: 38, text: "本地计数测试 <svg>",
          fontSize: 19, color: "#7ee787", visible: true },
        { id: "visits", kind: "count", x: 24, y: 90,
          width: 330, height: 70, text: "", fontSize: 42,
          color: "#7ee787", visible: true }
      ]
    };
    await checkedJson(await requestAdmin(adminPath + "/design", "POST", { design }), 200);
    const updatedImage = await (await api(imagePath, {
      headers: { "CF-Connecting-IP": "203.0.113.16" }
    })).text();
    assert.match(updatedImage, /本地计数测试 &lt;svg&gt;/,
      "Worker must render custom Chinese labels with escaped SVG markup");

    // Record the observed total before reboot; restarting must not reset it.
    const totalBeforeRestart = (await checkedJson(await requestAdmin(adminPath), 200)).hits;
    assert.equal(totalBeforeRestart, 1,
      "Refreshing the SVG from the same source must not create a second receipt");
    // Restart the actual runtime, using the SAME .wrangler/state D1 database.
    await shutdown();
    await sleep(800);
    await boot();
    const afterRestart = await checkedJson(await requestAdmin(adminPath), 200);
    assert.equal(afterRestart.hits, totalBeforeRestart,
      "Counter must survive a local Wrangler Worker restart");
    const migrated = await checkedJson(await requestAdmin(legacyAdmin), 200);
    assert.equal(migrated.hits, 47,
      "Legacy baseline and provenance must survive Worker restart");
    assert.equal(migrated.baselineSource, legacyPayload.source);

    assert.equal((await api("/v1/counters/nonexistent.svg")).status, 404);
    console.log("PASS: local D1 migration, authenticated CRUD, atomic dedupe, " +
      "legacy guard, SVG escaping, HEAD and restart persistence.");
  } finally {
    await shutdown();
    await rm(".dev.vars", { force: true });
  }
}

main().catch(error => {
  console.error(error);
  console.error("Wrangler debug logs:\n" + logs.slice(-6000));
  process.exitCode = 1;
});
