import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseUrlArgs, makeOwnOrigin, inspectLocalOrigin
} from "../scripts/self-host-url.mjs";
import { makeConfig } from "../scripts/self-host-setup.mjs";

const WORKER = "wvt-friend-mac-01";
const ACCOUNT = "wvt-friend-mac-01";
const slug = "livecheck-11223344556677";
const origin = "https://wvt-friend-mac-01.wvt-friend-mac-01.workers.dev";

async function config(extra = "") {
  const template = await readFile("wrangler.selfhost.example.toml", "utf8");
  return makeConfig(template, {
    worker: WORKER, database: "separate-db-name",
    "database-id": "11111111-2222-4333-8444-555555555555"
  }, [1001, 1002]) + extra;
}

test("offline URL reconstructs repeated Worker/account labels without confusing D1 name", async () => {
  let reads = 0;
  const output = await inspectLocalOrigin(parseUrlArgs([
    "--account-subdomain", ACCOUNT
  ]), {
    root: "/synthetic",
    read: async p => {
      reads++;
      assert.equal(p, join("/synthetic", "wrangler.selfhost.toml"));
      return config();
    },
    environment: {}
  });
  assert.equal(reads, 1);
  assert.match(output, /Full Worker origin: https:\/\/wvt-friend-mac-01\.wvt-friend-mac-01\.workers\.dev/);
  assert.match(output, /D1 database name is NOT/);
  assert.match(output, /No slug supplied: no SVG URL was invented/);
  assert.match(output, /self-host-publish\.mjs list/);
  assert(!output.includes("separate-db-name"), "No private D1 name in report");
  assert(!output.includes("11111111-2222"), "No private D1 ID in report");
  assert(!output.includes(".svg"), "No image URL is made without a known slug");
});

test("known existing slug produces exact README Markdown, not sample my-counter", async () => {
  const output = await inspectLocalOrigin(parseUrlArgs([
    "--slug", slug, "--account-subdomain", ACCOUNT
  ]), {
    read: () => config(),
    environment: { WVT_API_URL: origin }
  });
  assert.match(output, new RegExp(
    "GitHub README Markdown: !\\[Visitor counter\\]\\(" +
    origin.replaceAll(".", "\\.") + "/v1/counters/" + slug + "\\.svg\\)"
  ));
  assert.match(output, /offline URL is NOT proof that this counter exists/);
  assert(!output.includes("/my-counter.svg"));
});

test("refuses stale WVT_API_URL and never sends traffic or guesses a subdomain", async () => {
  const good = parseUrlArgs(["--account-subdomain", ACCOUNT]);
  await assert.rejects(() => inspectLocalOrigin(good, {
    read: () => config(),
    environment: { WVT_API_URL: "https://other.other.workers.dev" }
  }), /WVT_API_URL differs/);
  assert.equal(makeOwnOrigin(WORKER, ACCOUNT), origin);
  for (const bad of [
    "https://wvt-friend-mac-01.workers.dev",
    "wvt-friend-mac-01.workers.dev",
    "wvt-friend-mac-01.wvt-friend-mac-01",
    "sub.example.com", "sub/path", "A", "bad--label",
    "bad_label", "sub?q=1", "sub\nCLOUDFLARE_API_TOKEN=evil",
    "a".repeat(64)
  ]) assert.throws(() => parseUrlArgs(["--account-subdomain", bad]));
});

test("CLI rejects malicious/missing/duplicate flags and untrusted counter slugs", () => {
  assert.deepEqual(parseUrlArgs(["--help"]), { help: true });
  for (const args of [
    [], ["--slug", slug], ["--account-subdomain"],
    ["--account-subdomain", ACCOUNT, "--account-subdomain", ACCOUNT],
    ["--account-subdomain", ACCOUNT, "--slug", "my/counter"],
    ["--account-subdomain", ACCOUNT, "--slug", "../config"],
    ["--account-subdomain", ACCOUNT, "--slug", "counter.svg"],
    ["--account-subdomain", ACCOUNT, "--slug", "BAD"],
    ["--account-subdomain", ACCOUNT, "--api", "https://example.com"],
    ["--account-subdomain", ACCOUNT, "--slug", ""]
  ]) assert.throws(() => parseUrlArgs(args));
});

test("missing or modified private configuration is rejected without exposing private values", async () => {
  const args = parseUrlArgs(["--account-subdomain", ACCOUNT]);
  await assert.rejects(() => inspectLocalOrigin(args, {
    read: async () => { throw Error("private path and secret"); },
    environment: {}
  }));
  await assert.rejects(() => inspectLocalOrigin(args, {
    read: async () => (await config()).replace(
      'PUBLISHING_ENABLED = "false"', 'PUBLISHING_ENABLED = "true"'),
    environment: {}
  }), /unsafe/);
  // Older local config without the optional self-host discovery flag is valid.
  const legacyOutput = await inspectLocalOrigin(args, {
    read: async () => (await config()).replace(
      'SELF_HOST_ADMIN_LIST_ENABLED = "true"', ""),
    environment: {}
  });
  assert.match(legacyOutput, /Full Worker origin/);
});
