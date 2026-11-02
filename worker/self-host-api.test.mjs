import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveSelfHostApi } from "../scripts/self-host-api.mjs";
import { parseArgs, execute } from "../scripts/self-host-publish.mjs";
import { parseVerifyArgs, verifySelfHost } from "../scripts/self-host-verify.mjs";
import { parseLiveArgs, runLiveCheck } from "../scripts/self-host-live-check.mjs";
import { makeConfig } from "../scripts/self-host-setup.mjs";

const URL = "https://wvt-friend-mac-01.wvt-friend-mac-01.workers.dev";
const PRIVATE = { WVT_API_URL: URL, WVT_ADMIN_TOKEN: "a".repeat(96) };

test("shared WVT_API_URL works for publish, read-only verify, explicit-consent live check", () => {
  assert.equal(resolveSelfHostApi(undefined, PRIVATE), URL);
  assert.equal(resolveSelfHostApi(URL, {}), URL);
  assert.equal(parseArgs(["inspect", "--slug", "livecheck-abcdef01234567"], PRIVATE).api, URL);
  assert.equal(parseVerifyArgs(["--slug", "livecheck-abcdef01234567"], PRIVATE).api, URL);
  assert.equal(parseLiveArgs([
    "--owner", "testowner",
    "--confirm-worker", "wvt-friend-mac-01",
    "--allow-persistent-test-record",
    "--token-file", ".wvt-admin-token"
  ], PRIVATE).api, URL);
  assert.equal(resolveSelfHostApi("http://127.0.0.1:8787", {}),
    "http://127.0.0.1:8787", "explicit loopback remains supported for CI");
});

test("environment may never pick a credential-bearing, staging, local or mismatched origin", () => {
  for (const value of [
    "", "https://example.com", "http://127.0.0.1:8787",
    "https://workshop-visitor-terminal-staging.fangcui2007.workers.dev/path",
    "https://attacker@own.example.workers.dev",
    "https://other.example.workers.dev?x=1",
    "https://other.example.workers.dev#frag",
    "https://other.example.workers.dev:444",
    "https://other.example.workers.dev/evil",
    "https://other.example.workers.dev.evil.com",
    "https://-other.example.workers.dev",
    "https://other..workers.dev",
    " https://other.example.workers.dev",
    "https://other.example.workers.dev\n",
    "ftp://other.example.workers.dev"
  ]) {
    assert.throws(() => resolveSelfHostApi(undefined, { WVT_API_URL: value }), value);
  }
  for (const value of [
    "https://workshop-visitor-terminal-staging.fangcui2007.workers.dev",
    "https://guitar0788.github.io",
    "https://other.example.workers.dev/secret"
  ]) {
    assert.throws(() => parseArgs(["inspect", "--slug", "x"], { WVT_API_URL: value }));
    assert.throws(() => parseVerifyArgs([], { WVT_API_URL: value }));
    assert.throws(() => parseLiveArgs([
      "--owner", "testowner", "--confirm-worker", "other",
      "--allow-persistent-test-record"
    ], { WVT_API_URL: value }));
  }
});

test("wrong implicit worker name aborts before reading or sending an admin token", async () => {
  const root = await mkdtemp(join(tmpdir(), "wvt-url-reject-"));
  try {
    const template = await readFile("wrangler.selfhost.example.toml", "utf8");
    const config = makeConfig(template, {
      worker: "correct-private-worker", database: "safe-own-d1",
      "database-id": "11111111-2222-4333-8444-555555555555"
    }, [1233451, 1233452]);
    await writeFile(join(root, "wrangler.selfhost.toml"), config);
    const calls = [];
    await assert.rejects(() => runLiveCheck({
      owner: "testowner", "confirm-worker": "correct-private-worker", consent: true
    }, {
      root, environment: PRIVATE,
      fetchImpl: async (...args) => { calls.push(args); throw Error("Must not send"); }
    }), /Typed Worker confirmation/);
    assert.equal(calls.length, 0, "No Cloudflare requests or D1 writes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("implicit origin does not bypass publishing preflight and never sends a token to a lookalike", async () => {
  const calls = [];
  await assert.rejects(() => execute({
    command: "inspect", slug: "my-counter"
  }, {
    environment: PRIVATE,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json({ status: "ok", service: "lookalike", api: "v1" });
    }
  }), /Public Worker safety preflight/);
  assert.equal(calls.length, 1);
  assert(!calls[0].init.headers.Authorization);

  const check = [];
  await assert.rejects(() => verifySelfHost({}, {
    environment: PRIVATE,
    fetchImpl: async (url, init) => {
      check.push({ url, init });
      return Response.json({ status: "ok", service: "not-workshop", api: "v1" });
    }
  }), /identity/);
  assert.equal(check.length, 1);
  assert(!check[0].init.headers.Authorization);
});

test("all three CLI entrypoints document the explicit no-API env fallback", async () => {
  for (const file of ["scripts/self-host-publish.mjs",
    "scripts/self-host-verify.mjs", "scripts/self-host-live-check.mjs"]) {
    const source = await readFile(file, "utf8");
    assert.match(source, /resolveSelfHostApi/);
    assert.match(source, /WVT_API_URL/);
  }
  const archive = await readFile("scripts/build-selfhost-package.mjs", "utf8");
  assert.match(archive, /scripts\/self-host-api\.mjs/);
});
