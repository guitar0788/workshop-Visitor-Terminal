import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseArgs, validateApiOrigin, readDesign, readAdminToken, execute,
  assertSafePublishingTarget, assertLocalWorkerHostname
} from "../scripts/self-host-publish.mjs";
import { makeConfig } from "../scripts/self-host-setup.mjs";

const origin = "https://my-worker.example.workers.dev";
const token = "s".repeat(64);
const design = { schemaVersion: 1, theme: "pixel", layers: [] };
const opts = (command, extras = {}) => ({
  command, api: origin, slug: "my-counter", ...extras
});
const response = (status, data) => Response.json(data, { status });
const preflightResponse = (url, init) => {
  const path = new URL(url).pathname;
  if (!["/health", "/v1/my/counters", "/v1/admin/usage"].includes(path)) {
    return null;
  }
  assert.equal(init.method, "GET");
  assert.equal(init.redirect, "error");
  assert(!init.headers.Authorization, "Anonymous preflight must not expose admin token");
  if (path === "/health") {
    return response(200, { status: "ok", service: "workshop-visitor-terminal", api: "v1" });
  }
  if (path === "/v1/my/counters") {
    return response(503, { error: "Publishing is not enabled" });
  }
  return response(401, { error: "Unauthorized" });
};
const safeFetch = operation => async (url, init) =>
  preflightResponse(url, init) ?? operation(url, init);

async function withDesign(callback) {
  const dir = await mkdtemp(join(tmpdir(), "wvt-selfhost-"));
  const path = join(dir, "design.json");
  try { await writeFile(path, JSON.stringify(design)); await callback(path); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test("parses complete options and rejects duplicates, unknown actions and incomplete inputs", () => {
  assert.equal(parseArgs(["--help"]).command, "help");
  assert.equal(parseArgs(["create", "--slug", "a", "--owner", "bob", "--api", origin, "--design", "a.json"]).command, "create");
  for (const args of [
    [], ["create", "--api", origin, "--slug", "valid", "--design", "a.json"],
    ["update", "--api", origin, "--slug", "A", "--design", "a.json"],
    ["inspect", "--api", origin, "--slug", "a", "--design", "a.json"],
    ["inspect", "--api", origin, "--slug", "a", "--owner", "bob"],
    ["inspect", "--api", origin, "--slug", "a", "--api", origin],
    ["delete", "--api", origin, "--slug", "a"]
  ]) assert.throws(() => parseArgs(args));
});

test("refuses owner staging origin, credentials in URLs, HTTP remotes and path smuggling", () => {
  for (const url of [
    "https://workshop-visitor-terminal-staging.fangcui2007.workers.dev",
    "https://guitar0788.github.io",
    "https://token@example.com",
    "https://example.com/a", "https://example.com/?x=1",
    "http://example.com", "https://example.com/#fragment",
    "ftp://example.com"
  ]) assert.throws(() => validateApiOrigin(url));
  assert.equal(validateApiOrigin("http://127.0.0.1:8791"), "http://127.0.0.1:8791");
  assert.equal(validateApiOrigin(origin), origin);
});

test("accepts only Studio design JSON, never an account export or a huge file", async () => {
  await withDesign(async path => {
    assert.deepEqual(await readDesign(path), design);
    await writeFile(path, JSON.stringify({ formatVersion: 1, counters: [] }));
    await assert.rejects(() => readDesign(path));
    await writeFile(path, "x".repeat(20_001));
    await assert.rejects(() => readDesign(path));
  });
});

test("reads a local admin secret without sending it to stdout", async () => {
  assert.equal(await readAdminToken({ environment: { WVT_ADMIN_TOKEN: token } }), token);
  await assert.rejects(() => readAdminToken({ environment: { WVT_ADMIN_TOKEN: "short" } }));
});

test("create and update send validated design to own host only and output embed link", async () => {
  await withDesign(async path => {
    const seen = [];
    const fetchImpl = safeFetch(async (url, init) => {
      seen.push({ url, ...init });
      if (url.endsWith("/design")) return response(200, { slug: "my-counter", updated: true });
      return response(201, { slug: "my-counter" });
    });
    const result = await execute(opts("create", { owner: "tester", design: path }), {
      environment: { WVT_ADMIN_TOKEN: token }, fetchImpl
    });
    assert.equal(seen.length, 2);
    assert.equal(seen[0].method, "POST");
    assert.equal(seen[0].redirect, "error");
    assert.equal(seen[0].headers.Authorization, `Bearer ${token}`);
    assert.deepEqual(JSON.parse(seen[1].body), { design });
    assert.match(result, /!\[Visitor counter\]\(https:\/\/my-worker\.example\.workers\.dev\/v1\/counters\/my-counter\.svg\)/);
    assert(!result.includes(token));
  });
});

test("create error cannot silently overwrite an existing counter", async () => {
  await withDesign(async path => {
    let called = 0;
    await assert.rejects(() => execute(opts("create", { owner: "tester", design: path }), {
      environment: { WVT_ADMIN_TOKEN: token },
      fetchImpl: safeFetch(async () => { called++; return response(409, { error: "existing" }); })
    }), /HTTP 409/);
    assert.equal(called, 1);
  });
});

test("create partially succeeds but design failure provides safe recovery", async () => {
  await withDesign(async path => {
    let calls = 0;
    await assert.rejects(() => execute(opts("create", { owner: "tester", design: path }), {
      environment: { WVT_ADMIN_TOKEN: token },
      fetchImpl: safeFetch(async () => ++calls === 1
        ? response(201, { slug: "my-counter" })
        : response(503, { error: "temporarily down" }))
    }), /Retry with update/);
    assert.equal(calls, 2);
  });
});

test("inspect is read-only and fails on counter identity mismatch", async () => {
  const fetchImpl = safeFetch(async (url, init) => {
    assert.equal(init.method, "GET");
    return response(200, { slug: "my-counter", hits: 27 });
  });
  assert.match(await execute(opts("inspect"), { environment: { WVT_ADMIN_TOKEN: token }, fetchImpl }), /27/);
  await assert.rejects(() => execute(opts("inspect"), {
    environment: { WVT_ADMIN_TOKEN: token },
    fetchImpl: safeFetch(async () => response(200, { slug: "other", hits: 10 }))
  }), /identity/);
});

test("preflight rejects lookalikes, public OAuth and anonymous admin before any authenticated call", async () => {
  for (const unsafe of [
    { path: "/health", reply: response(200, { status: "ok", service: "other", api: "v1" }) },
    { path: "/v1/my/counters", reply: response(200, { counters: [] }) },
    { path: "/v1/my/counters", reply: response(503, { error: "Service configuration unavailable" }) },
    { path: "/v1/admin/usage", reply: response(200, { admitted: 0 }) },
    { path: "/health", reply: Response.redirect(origin + "/not-health") },
    { path: "/health", reply: new Response("<html>wrong backend</html>", {
      status: 200, headers: { "Content-Type": "text/html" }
    }) }
  ]) {
    let authenticatedCalls = 0;
    const fetchImpl = async (url, init) => {
      if (init.headers.Authorization) authenticatedCalls++;
      if (new URL(url).pathname === unsafe.path) return unsafe.reply.clone();
      return preflightResponse(url, init);
    };
    await assert.rejects(() => execute(opts("inspect"), {
      environment: { WVT_ADMIN_TOKEN: token }, fetchImpl
    }), /safety preflight/);
    assert.equal(authenticatedCalls, 0);
  }
});

test("preflight is anonymous, rejects unsafe network errors and never echoes their details", async () => {
  const fetchImpl = async () => {
    throw Error("secret-example Authorization: Bearer very-secret-DO-NOT-LOG");
  };
  await assert.rejects(() => assertSafePublishingTarget(origin, fetchImpl), err => {
    assert.match(err.message, /safety preflight/);
    assert(!err.message.includes("DO-NOT-LOG"));
    return true;
  });
  await assert.rejects(() => execute(opts("inspect", {
    "token-file": "this-file-was-never-created"
  }), {
    environment: { WVT_ADMIN_TOKEN: token },
    fetchImpl: async () => response(200, { service: "unknown" })
  }), /safety preflight/);
});

test("local self-host configuration prevents wrong workers.dev hostname before reading a secret", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wvt-local-host-"));
  const configPath = join(dir, "wrangler.selfhost.toml");
  try {
    assert.equal(await assertLocalWorkerHostname(origin, { configPath }), false,
      "Old or read-only usage without a generated local config is supported");
    const template = await readFile("wrangler.selfhost.example.toml", "utf8");
    const config = makeConfig(template, {
      worker: "my-worker", database: "private-test-db",
      "database-id": "11111111-2222-4333-8444-555555555555"
    }, [80091, 80092]);
    await writeFile(configPath, config);
    assert.equal(await assertLocalWorkerHostname(origin, { configPath }), true);
    await assert.rejects(
      () => assertLocalWorkerHostname("https://someone-else.example.workers.dev", { configPath }),
      /hostname does not match/);
    // User-owned custom domains cannot be identified from the Worker name.
    // Their Cloudflare binding must be checked manually.
    assert.equal(await assertLocalWorkerHostname("https://counter.example.com", { configPath }), true);
    await writeFile(configPath,
      config.replace('PUBLISHING_ENABLED = "false"', 'PUBLISHING_ENABLED = "true"'));
    await assert.rejects(() => assertLocalWorkerHostname(origin, { configPath }),
      /configuration is invalid/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
