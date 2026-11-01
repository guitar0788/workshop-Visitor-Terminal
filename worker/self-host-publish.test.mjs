import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseArgs, validateApiOrigin, readDesign, readAdminToken, execute
} from "../scripts/self-host-publish.mjs";

const origin = "https://my-worker.example.workers.dev";
const token = "s".repeat(64);
const design = { schemaVersion: 1, theme: "pixel", layers: [] };
const opts = (command, extras = {}) => ({
  command, api: origin, slug: "my-counter", ...extras
});
const response = (status, data) => Response.json(data, { status });

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
    const fetchImpl = async (url, init) => {
      seen.push({ url, ...init });
      if (url.endsWith("/design")) return response(200, { slug: "my-counter", updated: true });
      return response(201, { slug: "my-counter" });
    };
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
      fetchImpl: async () => { called++; return response(409, { error: "existing" }); }
    }), /HTTP 409/);
    assert.equal(called, 1);
  });
});

test("create partially succeeds but design failure provides safe recovery", async () => {
  await withDesign(async path => {
    let calls = 0;
    await assert.rejects(() => execute(opts("create", { owner: "tester", design: path }), {
      environment: { WVT_ADMIN_TOKEN: token },
      fetchImpl: async () => ++calls === 1
        ? response(201, { slug: "my-counter" })
        : response(503, { error: "temporarily down" })
    }), /Retry with update/);
    assert.equal(calls, 2);
  });
});

test("inspect is read-only and fails on counter identity mismatch", async () => {
  const fetchImpl = async (url, init) => {
    assert.equal(init.method, "GET");
    return response(200, { slug: "my-counter", hits: 27 });
  };
  assert.match(await execute(opts("inspect"), { environment: { WVT_ADMIN_TOKEN: token }, fetchImpl }), /27/);
  await assert.rejects(() => execute(opts("inspect"), {
    environment: { WVT_ADMIN_TOKEN: token },
    fetchImpl: async () => response(200, { slug: "other", hits: 10 })
  }), /identity/);
});
