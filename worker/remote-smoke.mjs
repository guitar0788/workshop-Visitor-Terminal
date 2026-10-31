#!/usr/bin/env node
/**
 * Deliberately isolated remote test. Runs ONLY against the fixed staging Worker
 * hostname after an explicitly triggered workflow. No real counter slugs.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateStagingOrigin } from "./prepare-staging.mjs";

const mode = process.argv[2];
if (mode !== "initial" && mode !== "verify") throw Error("Expected initial or verify");
const origin = validateStagingOrigin(process.env.STAGING_ORIGIN ?? "");
const token = process.env.STAGING_ADMIN_TOKEN;
const dir = process.env.RUNNER_TEMP;
if (!token || token.length < 32 || !dir) throw Error("Missing staging test credentials");
const stateFile = join(dir, "wvt-remote-smoke-state.json");

async function call(path, init = {}) {
  return fetch(origin + path, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000)
  });
}

async function admin(path, method = "GET", payload) {
  return call(path, {
    method,
    headers: { Authorization: "Bearer " + token, ...(method === "GET" ?
      {} : { "Content-Type": "application/json" }) },
    ...(method === "GET" ? {} : { body: JSON.stringify(payload) })
  });
}
async function expectJson(response, status) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}

const root = "/v1/admin/counters";
const health = await expectJson(await call("/health"), 200);
assert.equal(health.service, "workshop-visitor-terminal");

if (mode === "initial") {
  const slug = "staging-smoke-" + randomBytes(6).toString("hex");
  const legacySlug = "staging-legacy-" + randomBytes(6).toString("hex");
  const path = "/v1/counters/" + slug + ".svg";
  const details = root + "/" + slug;
  assert.equal((await call(root, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, owner: "guitar0788" })
  })).status, 401, "Unauthenticated counter creation must fail");
  await expectJson(await admin(root, "POST", { slug, owner: "guitar0788" }), 201);
  const head = await call(path, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.match(head.headers.get("content-type") ?? "", /image\/svg\+xml/);
  assert.equal((await expectJson(await admin(details), 200)).hits, 0,
    "HEAD must not increment");

  const first = await call(path);
  assert.equal(first.status, 200);
  assert.match(await first.text(), /<svg\b/);
  assert.equal((await expectJson(await admin(details), 200)).hits, 1,
    "A qualifying Cloudflare image request should count once");

  const duplicate = await Promise.all(Array.from({ length: 5 }, () => call(path)));
  assert(duplicate.every(response => response.status === 200));
  assert.equal((await expectJson(await admin(details), 200)).hits, 1,
    "Concurrent requests from the same source must be deduplicated");

  await expectJson(await admin(root, "POST",
    { slug: legacySlug, owner: "guitar0788" }), 201);
  const legacyPath = root + "/" + legacySlug;
  const legacyPayload = {
    hits: 47,
    source: "https://komarev.com/ghpvc/?username=staging-only-example",
    capturedAt: new Date(Date.now() - 60_000).toISOString()
  };
  await expectJson(await admin(legacyPath + "/legacy", "POST", legacyPayload), 200);
  assert.equal((await admin(legacyPath + "/legacy", "POST", legacyPayload)).status, 409);

  const design = {
    schemaVersion: 1, theme: "pixel", width: 420, height: 220,
    background: "#101820", accent: "#7ee787",
    layers: [
      { id: "test", kind: "text", text: "云端测试 <tag>", x: 12, y: 10,
        width: 350, height: 45, fontSize: 20, color: "#7ee787", visible: true },
      { id: "visits", kind: "count", text: "", x: 12, y: 75,
        width: 350, height: 70, fontSize: 45, color: "#7ee787", visible: true }
    ]
  };
  await expectJson(await admin(details + "/design", "POST", { design }), 200);
  const svg = await (await call(path)).text();
  assert.match(svg, /云端测试 &lt;tag&gt;/, "Custom SVG text must be safely escaped");
  assert.equal((await expectJson(await admin(details), 200)).hits, 1);

  await writeFile(stateFile, JSON.stringify({ slug, legacySlug, hits: 1, baseline: 47 }),
    { mode: 0o600, flag: "wx" });
  console.log("PASS staging round 1: authorization, D1 writes, deduplication, SVG, baseline.");
} else {
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  assert.match(state.slug, /^staging-smoke-[a-f0-9]{12}$/);
  assert.match(state.legacySlug, /^staging-legacy-[a-f0-9]{12}$/);
  const counter = await expectJson(await admin(root + "/" + state.slug), 200);
  const legacy = await expectJson(await admin(root + "/" + state.legacySlug), 200);
  assert.equal(counter.hits, state.hits, "Count must survive staging redeploy");
  assert.equal(legacy.hits, state.baseline, "Legacy baseline must survive staging redeploy");
  assert.match(legacy.baselineSource, /^https:\/\/komarev\.com\//);
  const head = await call("/v1/counters/" + state.slug + ".svg", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal((await expectJson(await admin(root + "/" + state.slug), 200)).hits,
    state.hits, "HEAD must remain read-only after redeploy");
  console.log("PASS staging round 2: D1 count, migrated baseline and SVG survived redeploy.");
}
