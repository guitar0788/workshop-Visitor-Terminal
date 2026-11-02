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
import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import { readFile, writeFile, rm, mkdtemp, stat, cp, mkdir } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeConfig } from "../scripts/self-host-setup.mjs";
import { runGuidedSetup, checkWizard } from "../scripts/self-host-wizard.mjs";
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
    // Emit only a non-sensitive stage label on failure. Never print response
    // bodies, request headers, local tokens or private Worker configuration.
    smokeStage = "restart-catalog:" + theme + ":read-count";
    const state = await checked(await api("/v1/admin/counters/" + slug, {
      headers: { Authorization: "Bearer " + ADMIN_TOKEN }
    }), 200);
    assert.equal(state.hits, 1, "D1 count lost on restart for " + theme);
    smokeStage = "restart-catalog:" + theme + ":fetch-svg";
    const response = await api("/v1/counters/" + slug + ".svg", {
      headers: { "CF-Connecting-IP": ip }
    });
    assert.equal(response.status, 200, "Persisted SVG failed for " + theme);
    const svg = await response.text();
    smokeStage = "restart-catalog:" + theme + ":validate-counter";
    assert(svg.includes(">1</text>"), "Counter lost from persisted SVG: " + theme);
    if (svgMarker) {
      smokeStage = "restart-catalog:" + theme + ":validate-scene";
      assert(svg.includes(svgMarker), "Scene lost after restart: " + theme);
    }
    if (theme === "mc-nether") {
      smokeStage = "restart-catalog:" + theme + ":validate-updated-design";
      assert(svg.includes("PERSISTED NETHER CARD"));
    }
    if (ACTIVE_CARDS.includes(theme) && !theme.startsWith("mc-")) {
      smokeStage = "restart-catalog:" + theme + ":validate-raster-image";
      assert(svg.includes("data:image/avif;base64,"),
        "Approved raster artwork lost after restart: " + theme);
    }
    smokeStage = "restart-catalog:" + theme + ":recheck-count";
    const again = await checked(await api("/v1/admin/counters/" + slug, {
      headers: { Authorization: "Bearer " + ADMIN_TOKEN }
    }), 200);
    assert.equal(again.hits, 1, "Restart reread must not double-count " + theme);
  }
}


/**
 * Exercise the SAME guided setup shipped in the extracted self-host ZIP.
 * The fixture is a brand-new temporary directory; input is synthetic and
 * local, so no Cloudflare account or credential is ever needed by CI.
 * This runs in Linux, Windows and macOS standalone package smoke tests.
 */
async function smokeBundledWizard() {
  const fixture = await mkdtemp(join(tmpdir(), "wvt-wizard-extracted-"));
  const required = [
    ".gitignore", "package.json", "package-lock.json",
    "wrangler.selfhost.example.toml",
    "worker/index.ts", "worker/service.ts", "worker/publishing.ts",
    "worker/migrations/0001_initial.sql", "worker/migrations/0002_atomic_increment.sql",
    "worker/migrations/0003_publishing.sql", "worker/migrations/0004_visit_budget.sql",
    "src/model.ts", "src/card-art.ts", "src/minecraft-card-art.ts",
    "src/approved-reference-cards.ts", "src/approved-three-card-image.ts",
    "src/approved-clean-card-image.ts",
    "scripts/self-host-publish.mjs", "scripts/self-host-verify.mjs"
  ];
  try {
    for (const file of required) {
      await mkdir(dirname(join(fixture, file)), { recursive: true });
      await cp(join(ROOT, file), join(fixture, file));
    }
    const responses = [
      "OWN", "wvt-extracted-wizard", "wvt-extracted-wizard-d1",
      "12345678-1234-4abc-8123-123456789abc", "CREATE"
    ];
    const notifications = [];
    const result = await runGuidedSetup({
      root: fixture,
      ask: async () => {
        assert(responses.length > 0, "Unexpected Wizard prompt");
        return responses.shift();
      },
      notify: message => notifications.push(message)
    });
    assert.deepEqual(result, { status: "LOCAL_READY", localChecks: "PASS" });
    assert.equal(responses.length, 0, "The real first-run prompt contract changed");
    const check = await checkWizard({ root: fixture });
    assert.match(check, /NOT_TESTED/, "No actual Cloudflare acceptance claim");
    const config = await readFile(join(fixture, "wrangler.selfhost.toml"), "utf8");
    const admin = (await readFile(join(fixture, ".wvt-admin-token"), "utf8")).trim();
    const visitor = (await readFile(join(fixture, ".wvt-visit-secret"), "utf8")).trim();
    assert.match(admin, /^[a-f0-9]{96}$/);
    assert.match(visitor, /^[a-f0-9]{96}$/);
    assert.notEqual(admin, visitor);
    assert(config.includes("wvt-extracted-wizard-d1"));
    const visible = notifications.join("\n") + check;
    for (const confidential of [
      "12345678-1234-4abc-8123-123456789abc", admin, visitor
    ]) {
      assert(!visible.includes(confidential), "The wizard exposed private data");
    }
    let unexpectedPrompt = 0;
    await assert.rejects(() => runGuidedSetup({
      root: fixture,
      ask: async () => { unexpectedPrompt++; return "OWN"; }
    }), /already exists or is partial/);
    assert.equal(unexpectedPrompt, 0, "A second run must stop before asking for secrets");
    assert.equal(await readFile(join(fixture, "wrangler.selfhost.toml"), "utf8"), config);
    console.log("PASS: packaged guided Wizard created local private config, " +
      "passed readiness, redacted secrets and rejected duplicate setup on this OS.");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

export async function smokeSelfHostedCounter() {
  // Both paths are ignored, but the test also refuses to replace a real
  // developer's local secrets/config. No automatic cleanup of existing files.
  if (await exists(CONFIG) || await exists(DEV_VARS)) {
    throw Error("Existing local self-host config or .dev.vars: refusing to overwrite");
  }
  smokeStage = "packaged-guided-wizard";
  await smokeBundledWizard();
  smokeStage = "disposable-d1-setup";
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

    // Real local Worker response, not a mocked Headers object. HEAD must
    // expose safe README image headers and must leave the D1 count at zero.
    const withImage = await verifySelfHost({
      api: origin, "token-file": tokenPath, slug: SLUG
    });
    assert.equal(withImage.svgHeaders?.contentType, "image/svg+xml");
    assert.equal(withImage.svgHeaders?.cacheMaxAgeSeconds, 60);
    assert.equal(withImage.svgHeaders?.embeddableResponseHeaders, true);
    assert.equal(withImage.noDatabaseWrites, true);
    assert.match(await cli("inspect"), /Recorded upstream requests: 0/);

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
    smokeStage = "recover-stored-design-with-read-only-cli";
    const exported = await execute({
      command: "export", api: origin, slug: SLUG, "token-file": tokenPath
    }, { directory: designDir });
    assert.match(exported, /Saved existing Studio design locally/);
    const exportPath = join(designDir, "visitor-terminal-" + SLUG + ".design.json");
    const recovered = JSON.parse(await readFile(exportPath, "utf8"));
    assert.deepEqual(recovered, modified, "Recovered JSON must preserve the edited Studio design");
    assert(!exported.includes(ADMIN_TOKEN), "Export must not log admin token");
    assert.equal((await api("/v1/admin/counters/" + SLUG + "/design")).status, 401,
      "Anonymous callers must not retrieve stored editable designs");
    await assert.rejects(() => execute({
      command: "export", api: origin, slug: SLUG, "token-file": tokenPath
    }, { directory: designDir }), /backup already exists/,
    "Export must not overwrite a previous local backup");
    assert.match(await cli("inspect"), /Recorded upstream requests: 1/,
      "Design export must not record an additional visit or reset hits");
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
    smokeStage = "post-restart-read-only-design-recovery";
    const restoredExportDir = join(designDir, "after-restart");
    await mkdir(restoredExportDir, { recursive: true });
    assert.match(await execute({
      command: "export", api: origin, slug: SLUG, "token-file": tokenPath
    }, { directory: restoredExportDir }), /Saved existing Studio design locally/);
    assert.deepEqual(
      JSON.parse(await readFile(join(restoredExportDir,
        "visitor-terminal-" + SLUG + ".design.json"), "utf8")),
      modified, "Export after Worker restart must recover the exact saved design"
    );
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

    // Account deletion integration: restart this same disposable local D1 with
    // synthetic OAuth settings and a seeded verified session. No GitHub or
    // Cloudflare network request is made; the OAuth credentials are fake.
    smokeStage = "account-delete-local-publishing-config";
    const accountId = randomInt(2_000_000, 3_000_000);
    const foreignId = accountId + 1;
    const accountLogin = "local-delete-test";
    const foreignLogin = "local-foreign-test";
    const ownTokenA = randomBytes(32).toString("hex");
    const ownTokenB = randomBytes(32).toString("hex");
    const foreignToken = randomBytes(32).toString("hex");
    const ownTicket = randomBytes(32).toString("hex");
    const foreignTicket = randomBytes(32).toString("hex");
    const ownVerifier = randomBytes(32).toString("base64url");
    const foreignVerifier = randomBytes(32).toString("base64url");
    const ownChallenge = createHash("sha256").update(ownVerifier).digest("base64url");
    const foreignChallenge = createHash("sha256").update(foreignVerifier).digest("base64url");
    const hash = value => createHash("sha256").update(value).digest("hex");
    const ownSessionHashA = hash(ownTokenA);
    const ownSessionHashB = hash(ownTokenB);
    const foreignSessionHash = hash(foreignToken);
    const ownTicketHash = hash(ownTicket);
    const foreignTicketHash = hash(foreignTicket);
    const ownSlugs = [
      "v" + randomBytes(12).toString("hex"),
      "v" + randomBytes(12).toString("hex")
    ];
    const foreignSlug = "v" + randomBytes(12).toString("hex");
    const legacySlug = "v" + randomBytes(12).toString("hex");
    let bucket = 0;
    const ip = "203.0.113.77";
    const receipt = slug => createHmac("sha256", VISIT_SECRET)
      .update(slug + "\0" + ip).digest("hex");
    const sqlText = value => "'" + String(value).replace(/'/g, "''") + "'";
    const localD1 = sql => {
      const invocation = wranglerInvocation(ROOT, [
        "d1", "execute", "DB", "--local", "--config", CONFIG,
        "--persist-to", persistence, "--command", sql
      ]);
      execFileSync(invocation.executable, invocation.args, {
        cwd: ROOT, env: LOCAL_ENV, stdio: "pipe", timeout: 30000
      });
    };
    const writePublishingVars = async (pilotId, deletionEnabled) => {
      const values = [
        "ADMIN_TOKEN=" + ADMIN_TOKEN,
        "VISIT_HASH_SECRET=" + VISIT_SECRET,
        "PUBLISHING_ENABLED=true",
        "GITHUB_CLIENT_ID=localtest_123",
        "GITHUB_CLIENT_SECRET=local-test-client-secret-123456789",
        "PUBLIC_API_ORIGIN=https://workshop-visitor-terminal-staging.localtest.workers.dev/",
        "STUDIO_ORIGIN=https://guitar0788.github.io/workshop-Visitor-Terminal/",
        "PILOT_GITHUB_USER_ID=" + pilotId
      ];
      if (deletionEnabled) values.push("ACCOUNT_DELETION_ENABLED=true");
      await writeFile(DEV_VARS, values.join("\n") + "\n", { mode: 0o600 });
    };
    const restartLocalWorker = async () => {
      await shutdown(running.child);
      running = await start(port, persistence);
    };
    await writePublishingVars(accountId, false);
    await restartLocalWorker();
    // Seed and replay within one five-minute receipt bucket, even on slower CI hosts.
    bucket = Math.floor(Date.now() / 300_000);

    smokeStage = "account-delete-seed-local-only-d1-records";
    const createdAt = new Date().toISOString();
    const expiresAt = Date.now() + 60 * 60_000;
    const counterRows = [
      ...ownSlugs.map(slug => "(" + sqlText(slug) + ", " + sqlText(accountLogin) +
        ", 0, '{}', " + sqlText(createdAt) + ", " + accountId + ")"),
      "(" + sqlText(foreignSlug) + ", " + sqlText(foreignLogin) +
        ", 0, '{}', " + sqlText(createdAt) + ", " + foreignId + ")",
      "(" + sqlText(legacySlug) + ", 'legacy-admin', 0, '{}', " +
        sqlText(createdAt) + ", NULL)"
    ];
    const receiptRows = [
      ...ownSlugs.map(slug => "(" + sqlText(slug) + ", " + sqlText(receipt(slug)) +
        ", " + bucket + ")"),
      "(" + sqlText(foreignSlug) + ", " + sqlText(receipt(foreignSlug)) + ", " + bucket + ")",
      "(" + sqlText(legacySlug) + ", " + sqlText(receipt(legacySlug)) + ", " + bucket + ")"
    ];
    localD1(
      "INSERT INTO counters (slug, owner, hits, design_json, created_at, owner_user_id) VALUES " +
      counterRows.join(", ") + ";" +
      "INSERT INTO request_windows (slug, fingerprint, bucket) VALUES " +
      receiptRows.join(", ") + ";" +
      "INSERT INTO publish_sessions (session_hash, github_user_id, github_login, created_at, expires_at) VALUES " +
      "(" + sqlText(ownSessionHashA) + ", " + accountId + ", " + sqlText(accountLogin) + ", " +
        Date.now() + ", " + expiresAt + ")," +
      "(" + sqlText(ownSessionHashB) + ", " + accountId + ", " + sqlText(accountLogin) + ", " +
        Date.now() + ", " + expiresAt + ")," +
      "(" + sqlText(foreignSessionHash) + ", " + foreignId + ", " + sqlText(foreignLogin) + ", " +
        Date.now() + ", " + expiresAt + ");" +
      "INSERT INTO publish_login_tickets (ticket_hash, challenge, github_user_id, github_login, expires_at) VALUES " +
      "(" + sqlText(ownTicketHash) + ", " + sqlText(ownChallenge) + ", " + accountId + ", " +
        sqlText(accountLogin) + ", " + expiresAt + ")," +
      "(" + sqlText(foreignTicketHash) + ", " + sqlText(foreignChallenge) + ", " + foreignId + ", " +
        sqlText(foreignLogin) + ", " + expiresAt + ");"
    );
    const deleteOrigin = "https://guitar0788.github.io";
    const deleteHeaders = {
      Origin: deleteOrigin, Authorization: "Bearer " + ownTokenA,
      "Content-Type": "application/json"
    };
    const deletionBody = { confirm: "DELETE_MY_ACCOUNT", confirmLogin: accountLogin };
    const usageBeforeDeletion = await checked(await api("/v1/admin/usage", {
      headers: { Authorization: "Bearer " + ADMIN_TOKEN }
    }), 200);

    smokeStage = "account-delete-default-disabled-gate";
    const disabledDeletion = await api("/v1/my/account", {
      method: "DELETE", headers: deleteHeaders, body: JSON.stringify(deletionBody)
    });
    assert.equal(disabledDeletion.status, 404,
      "Account deletion must remain disabled without the explicit Worker flag");
    assert.equal((await api("/v1/admin/counters/" + ownSlugs[0], {
      headers: { Authorization: "Bearer " + ADMIN_TOKEN }
    })).status, 200, "Disabled deletion must leave owned data untouched");

    smokeStage = "account-delete-enable-local-only-feature-flag";
    await writePublishingVars(accountId, true);
    await restartLocalWorker();
    const wrongConfirmation = await api("/v1/my/account", {
      method: "DELETE", headers: deleteHeaders,
      body: JSON.stringify({ confirm: "DELETE", confirmLogin: accountLogin })
    });
    assert.equal(wrongConfirmation.status, 400,
      "Account deletion must require the exact destructive phrase");
    const wrongLogin = await api("/v1/my/account", {
      method: "DELETE", headers: deleteHeaders,
      body: JSON.stringify({ confirm: "DELETE_MY_ACCOUNT", confirmLogin: foreignLogin })
    });
    assert.equal(wrongLogin.status, 400,
      "Account deletion must require the exact verified GitHub login");

    smokeStage = "account-delete-atomic-local-d1-transaction";
    const deletedResponse = await api("/v1/my/account", {
      method: "DELETE", headers: deleteHeaders, body: JSON.stringify(deletionBody)
    });
    assert.equal(deletedResponse.status, 200, "Local D1 account deletion failed");
    const deletedResult = await deletedResponse.json();
    assert.deepEqual(deletedResult, {
      deleted: true, signedOutEverywhere: true, deletedCounters: 2
    });
    for (const slug of ownSlugs) {
      assert.equal((await api("/v1/admin/counters/" + slug, {
        headers: { Authorization: "Bearer " + ADMIN_TOKEN }
      })).status, 404, "Owned counter survived account deletion");
    }
    for (const slug of [foreignSlug, legacySlug, SLUG]) {
      assert.equal((await api("/v1/admin/counters/" + slug, {
        headers: { Authorization: "Bearer " + ADMIN_TOKEN }
      })).status, 200, "Foreign or legacy counter was deleted");
    }
    assert.equal((await api("/v1/me", {
      headers: { Origin: deleteOrigin, Authorization: "Bearer " + ownTokenA }
    })).status, 401, "First account session survived deletion");
    assert.equal((await api("/v1/me", {
      headers: { Origin: deleteOrigin, Authorization: "Bearer " + ownTokenB }
    })).status, 401, "Second account session survived deletion");
    const deletedTicketExchange = await api("/v1/auth/exchange", {
      method: "POST", headers: { Origin: deleteOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: ownTicket, verifier: ownVerifier })
    });
    assert.equal(deletedTicketExchange.status, 401, "Account login ticket survived deletion");
    const usageAfterDeletion = await checked(await api("/v1/admin/usage", {
      headers: { Authorization: "Bearer " + ADMIN_TOKEN }
    }), 200);
    assert.deepEqual(usageAfterDeletion, usageBeforeDeletion,
      "Deleting an account must not reset or rewrite the global aggregate daily budget");

    // Recreate one synthetic owned slug directly in the disposable D1 and
    // request it from the same IP/bucket. The prior receipt must be gone.
    smokeStage = "account-delete-receipt-cleanup-local-d1";
    localD1("INSERT INTO counters (slug, owner, hits, design_json, created_at, owner_user_id) VALUES (" +
      sqlText(ownSlugs[0]) + ", " + sqlText(accountLogin) + ", 0, '{}', " +
      sqlText(new Date().toISOString()) + ", " + accountId + ");");
    const reissuedImage = await api("/v1/counters/" + ownSlugs[0] + ".svg", {
      headers: { "CF-Connecting-IP": ip }
    });
    assert.equal(reissuedImage.status, 200);
    assert.match(await reissuedImage.text(), />1<\/text>/,
      "A stale visit receipt survived deletion and blocked a fresh counter's first visit");
    const foreignBefore = await checked(await api("/v1/admin/counters/" + foreignSlug, {
      headers: { Authorization: "Bearer " + ADMIN_TOKEN }
    }), 200);
    const legacyBefore = await checked(await api("/v1/admin/counters/" + legacySlug, {
      headers: { Authorization: "Bearer " + ADMIN_TOKEN }
    }), 200);
    assert.equal(foreignBefore.hits, 1);
    assert.equal(legacyBefore.hits, 1);
    assert.equal((await api("/v1/counters/" + foreignSlug + ".svg", {
      headers: { "CF-Connecting-IP": ip }
    })).status, 200);
    assert.equal((await api("/v1/counters/" + legacySlug + ".svg", {
      headers: { "CF-Connecting-IP": ip }
    })).status, 200);
    assert.equal((await checked(await api("/v1/admin/counters/" + foreignSlug, {
      headers: { Authorization: "Bearer " + ADMIN_TOKEN }
    }), 200)).hits, 1, "Foreign visit receipt was deleted");
    assert.equal((await checked(await api("/v1/admin/counters/" + legacySlug, {
      headers: { Authorization: "Bearer " + ADMIN_TOKEN }
    }), 200)).hits, 1, "Legacy visit receipt was deleted");

    // Change only the local pilot ID to prove a second numeric account's
    // session and ticket were not revoked by the first account's deletion.
    smokeStage = "account-delete-cross-account-preservation";
    await writePublishingVars(foreignId, true);
    await restartLocalWorker();
    assert.equal((await api("/v1/me", {
      headers: { Origin: deleteOrigin, Authorization: "Bearer " + foreignToken }
    })).status, 200, "Foreign account session was revoked");
    const foreignTicketExchange = await api("/v1/auth/exchange", {
      method: "POST", headers: { Origin: deleteOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: foreignTicket, verifier: foreignVerifier })
    });
    assert.equal(foreignTicketExchange.status, 200,
      "Foreign account login ticket was deleted");
    const foreignProfile = await foreignTicketExchange.json();
    assert.equal(foreignProfile.user.id, foreignId);
    console.log("PASS: local D1 account deletion is opt-in, exact-confirmed and atomic; " +
      "own counters/receipts/tickets/sessions are removed while foreign/legacy data and global budget survive.");

    console.log("PASS: self-hosted Wrangler local migrations, private CLI publishing, " +
      "all 6 active/6 retired D1 designs, read-only design recovery, SVG, deduplication, updates, restart persistence, closed OAuth and local acceptance simulation.");
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
