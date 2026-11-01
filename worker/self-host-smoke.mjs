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
import { verifySelfHost } from "../scripts/self-host-verify.mjs";
import { runLiveCheck } from "../scripts/self-host-live-check.mjs";
import { wranglerInvocation } from "./self-host-wrangler.mjs";
import { build as esbuildBuild } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_NAME = "wrangler.selfhost.smoke.toml";
const CONFIG = join(ROOT, CONFIG_NAME);
const DEV_VARS = join(ROOT, ".dev.vars");
let smokeStage = "preflight";
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
  const invocation = wranglerInvocation(ROOT, [
    "dev", "--local", "--config", CONFIG, "--persist-to", persistence,
    "--ip", "127.0.0.1", "--port", String(port)
  ]);
  const child = spawn(invocation.executable, invocation.args, {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: LOCAL_ENV
  });
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


// Exercise the real Worker+D1 path for EVERY active Studio card and all six
// retired styles (which must remain openable after removal from the picker).
// Load the exact versioned TypeScript model using the locked local bundler:
// no hand-written duplicate fixtures that could diverge from the editor.
const ACTIVE_CARDS = [
  "pixel-card", "terminal-card", "rpg-card",
  "mc-overworld", "mc-nether", "mc-end"
];
const RETIRED_CARDS = [
  "modern-card", "cozy-card", "space-card",
  "notebook-card", "neon-card", "minimal-card"
];
async function catalogModel() {
  const built = await esbuildBuild({
    entryPoints: [join(ROOT, "src", "model.ts")],
    bundle: true, platform: "node", format: "esm",
    write: false, logLevel: "silent"
  });
  assert.equal(built.outputFiles?.length, 1, "One bundled shared model expected");
  return import("data:text/javascript;base64," +
    Buffer.from(built.outputFiles[0].text).toString("base64"));
}
async function publishAndVerifyCatalog(api) {
  const model = await catalogModel();
  assert.deepEqual([...model.CARD_THEMES], ACTIVE_CARDS,
    "Catalog smoke must track EXACTLY the six selectable editor styles");
  const all = [...ACTIVE_CARDS, ...RETIRED_CARDS];
  const catalog = [];
  for (const theme of all) {
    const slug = "catalog-" + randomBytes(8).toString("hex");
    const design = model.clonePreset(theme);
    assert.equal(design.theme, theme);
    const create = await api("/v1/admin/counters", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + ADMIN_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ slug, owner: "self-host-tester", design })
    });
    assert.equal(create.status, 201, "Real D1 creation failed for " + theme);
    assert.equal((await create.json()).hits, 0);
    const path = "/v1/counters/" + slug + ".svg";
    const head = await api(path, { method: "HEAD" });
    assert.equal(head.status, 200, "HEAD failed for " + theme);
    assert.equal(head.headers.get("content-type")?.startsWith("image/svg+xml"), true);
    const initial = await checked(await api("/v1/admin/counters/" + slug, {
      headers: { Authorization: "Bearer " + ADMIN_TOKEN }
    }), 200);
    assert.equal(initial.hits, 0, "HEAD must not increment " + theme);
    const ip = "203.0.113.99";
    const image = await api(path, { headers: { "CF-Connecting-IP": ip } });
    assert.equal(image.status, 200, "SVG request failed for " + theme);
    const svg = await image.text();
    assert.match(svg, /<svg\b/);
    assert(svg.includes(">1</text>"), "Live increment absent in SVG for " + theme);
    if (theme.startsWith("mc-")) {
      assert(svg.includes('shape-rendering="crispEdges"'),
        "Voxel scene missing after D1 publish: " + theme);
      assert(!svg.includes("<image "), "Voxel templates must remain standalone vector SVG");
    } else if (ACTIVE_CARDS.includes(theme)) {
      assert(svg.includes("data:image/avif;base64,"),
        "Original approved artwork lost during publish: " + theme);
    }
    const duplicate = await api(path, { headers: { "CF-Connecting-IP": ip } });
    assert.equal(duplicate.status, 200);
    const state = await checked(await api("/v1/admin/counters/" + slug, {
      headers: { Authorization: "Bearer " + ADMIN_TOKEN }
    }), 200);
    assert.equal(state.hits, 1, "Deduplication failed on " + theme);
    catalog.push({ slug, theme, ip, svgMarker: theme === "mc-overworld" ? "ovsky" :
      theme === "mc-nether" ? "nsky" : theme === "mc-end" ? "esky" : null });
  }
  // Updating the design must not reset the D1 visit counter.
  const nether = catalog.find(row => row.theme === "mc-nether");
  const updatedDesign = model.clonePreset("mc-nether");
  updatedDesign.layers = updatedDesign.layers.map(layer =>
    layer.id === "heading" ? { ...layer, text: "PERSISTED NETHER CARD" } : layer);
  const updated = await api("/v1/admin/counters/" + nether.slug + "/design", {
    method: "POST",
    headers: { Authorization: "Bearer " + ADMIN_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ design: updatedDesign })
  });
  assert.equal(updated.status, 200, "Minecraft design update failed in real local D1");
  return catalog;
}
async function verifyCatalogAfterRestart(api, catalog) {
  assert.equal(catalog.length, 12);
  for (const { slug, theme, ip, svgMarker } of catalog) {
    const state = await checked(await api("/v1/admin/counters/" + slug, {
      headers: { Authorization: "Bearer " + ADMIN_TOKEN }
    }), 200);
    assert.equal(state.hits, 1, "D1 count lost on restart for " + theme);
    const response = await api("/v1/counters/" + slug + ".svg", {
      headers: { "CF-Connecting-IP": ip }
    });
    assert.equal(response.status, 200, "Persisted SVG failed for " + theme);
    const svg = await response.text();
    assert(svg.includes(">1</text>"), "Counter lost from persisted SVG: " + theme);
    if (svgMarker) assert(svg.includes(svgMarker), "Scene lost after restart: " + theme);
    if (theme === "mc-nether") assert(svg.includes("PERSISTED NETHER CARD"));
    if (ACTIVE_CARDS.includes(theme) && !theme.startsWith("mc-")) {
      assert(svg.includes("data:image/avif;base64,"),
        "Approved raster artwork lost after restart: " + theme);
    }
    const again = await checked(await api("/v1/admin/counters/" + slug, {
      headers: { Authorization: "Bearer " + ADMIN_TOKEN }
    }), 200);
    assert.equal(again.hits, 1, "Restart reread must not double-count " + theme);
  }
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
    smokeStage = "generate-test-config";
    const template = await readFile(join(ROOT, "wrangler.selfhost.example.toml"), "utf8");
    const config = makeConfig(template, {
      worker: "wvt-selfhost-disposable",
      database: "wvt-selfhost-disposable-db",
      "database-id": "c0000000-0000-4000-8000-000000000001"
    }, [randomInt(100_000, 999_999), randomInt(1_000_000, 2_000_000)]);
    await writeFile(CONFIG, config, { flag: "wx", mode: 0o600 });
    configCreated = true;
    smokeStage = "create-fake-secrets";
    await writeFile(DEV_VARS,
      "ADMIN_TOKEN=" + ADMIN_TOKEN + "\nVISIT_HASH_SECRET=" + VISIT_SECRET + "\n",
      { flag: "wx", mode: 0o600 });
    devVarsCreated = true;
    await writeFile(tokenPath, ADMIN_TOKEN + "\n", { flag: "wx", mode: 0o600 });
    await writeFile(designPath, JSON.stringify(DESIGN), { flag: "wx", mode: 0o600 });

    // All database operations use --local AND isolated --persist-to.
    // Deliberately DO NOT accept dynamic/remote migration flags.
    smokeStage = "local-d1-migrations";
    const migration = wranglerInvocation(ROOT, [
      "d1", "migrations", "apply", "DB", "--local", "--config", CONFIG,
      "--persist-to", persistence
    ]);
    execFileSync(migration.executable, migration.args, {
      cwd: ROOT, env: LOCAL_ENV, stdio: "pipe", timeout: 90000
    });

    const port = randomInt(18000, 45000);
    smokeStage = "local-worker-startup";
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
    smokeStage = "publish-with-local-cli";
    const published = await cli("create", {
      owner: "self-host-tester", design: designPath
    });
    assert.match(published, /!\[Visitor counter\]\(http:\/\/127\.0\.0\.1:/);
    assert(!published.includes(ADMIN_TOKEN), "Admin secret must never appear in CLI output");
    // A real disposable local Worker/D1 must list existing counters without writes.
    const listing = await execute({
      command: "list", api: origin, "token-file": tokenPath
    });
    assert(listing.includes(SLUG), "Read-only list must recover the real slug");
    assert.match(listing, /upstream requests/);
    assert(!listing.includes(ADMIN_TOKEN));
    assert.equal((await api("/v1/admin/counters")).status, 401);

    smokeStage = "verify-read-only-deployment-health";
    const readiness = await verifySelfHost({
      api: origin, "token-file": tokenPath, slug: SLUG
    });
    assert.equal(readiness.checkedSlug, SLUG);
    assert.equal(readiness.budget.admitted, 0,
      "Read-only verification must not record any visits");
    assert.equal(readiness.noDatabaseWrites, true);

    const imagePath = "/v1/counters/" + SLUG + ".svg";
    assert.equal((await api(imagePath, { method: "HEAD" })).status, 200);
    assert.match(await cli("inspect"), /Recorded upstream requests: 0/);
    smokeStage = "image-count-and-dedupe";
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

    smokeStage = "publish-active-and-retired-card-catalog-in-local-D1";
    const catalog = await publishAndVerifyCatalog(api);
    smokeStage = "update-design";
    const modified = { ...DESIGN, layers: DESIGN.layers.map(
      layer => layer.id === "heading" ? { ...layer, text: "UPDATED AND PERSISTED" } : layer
    ) };
    await writeFile(designPath, JSON.stringify(modified));
    assert.match(await cli("update", { design: designPath }), /Counter ready/);
    assert.match(await cli("inspect"), /Recorded upstream requests: 1/,
      "Changing a design must preserve accumulated hits");
    const updated = await api(imagePath, { method: "HEAD" });
    assert.equal(updated.status, 200, "HEAD must never add a visit");

    smokeStage = "restart-local-worker";
    await shutdown(running.child);
    running = undefined;
    running = await start(port, persistence);
    smokeStage = "verify-twelve-card-catalog-after-worker-restart";
    await verifyCatalogAfterRestart(api, catalog);
    smokeStage = "post-restart-count-check";
    assert.match(await cli("inspect"), /Recorded upstream requests: 1/,
      "Counts must persist after restart in the same local D1");
    smokeStage = "post-restart-svg-check";
    // Wrangler's local proxy may inject a source IP for a bare GET. Reuse
    // the already-counted test IP rather than adding a new visit to our
    // counter while verifying only the design persisted.
    const afterRestart = await api(imagePath, {
      method: "GET", headers: { "CF-Connecting-IP": "203.0.113.17" }
    });
    assert.equal(afterRestart.status, 200);
    assert.match(await afterRestart.text(), /UPDATED AND PERSISTED/);
    smokeStage = "post-restart-no-double-count";
    assert.match(await cli("inspect"), /Recorded upstream requests: 1/);
    smokeStage = "simulate-consented-remote-acceptance-locally";
    const liveReport = await runLiveCheck({
      api: origin, owner: "self-host-tester",
      "confirm-worker": "wvt-selfhost-disposable",
      "token-file": tokenPath, consent: true
    }, {
      allowLoopbackTest: true,
      newSlug: () => "livecheck-" + randomBytes(7).toString("hex")
    });
    assert.equal(liveReport.runtime, "LOCAL_INTEGRATION");
    assert.equal(liveReport.result, "PASS");
    assert.equal(liveReport.observed.sameClientRequestDeduplication, "PASS");
    assert.equal(liveReport.independentCloudflareAccountOwnership, "NOT_VERIFIED");

    console.log("PASS: self-hosted Wrangler local migrations, private CLI publishing, " +
      "all 6 active/6 retired D1 designs, SVG, deduplication, updates, restart persistence, closed OAuth and local acceptance simulation.");
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
    console.error("Self-hosted local smoke failed at " + smokeStage +
      ". No remote Cloudflare resource was touched.");
    process.exitCode = 1;
  });
}
