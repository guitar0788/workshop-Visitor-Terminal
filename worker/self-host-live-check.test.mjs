import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseLiveArgs, assertLiveDestination, runLiveCheck
} from "../scripts/self-host-live-check.mjs";
import { makeConfig } from "../scripts/self-host-setup.mjs";

const REMOTE = "https://live-own-counter.preview-account.workers.dev";
const TOKEN = "d".repeat(96);
const CMD = {
  api: REMOTE,
  owner: "testowner",
  "confirm-worker": "live-own-counter",
  consent: true
};
const DESIGN = "LIVE CHECK INITIAL";
function json(value, status = 200) {
  return Response.json(value, { status });
}

function mockService({ enabled = false, malformed = false, already = false,
    budget = 20000, failAt = "", nextCount = 1 } = {}) {
  const state = { slug: null, count: 0, text: DESIGN, created: false, calls: [], writes: 0 };
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    const isAuth = Boolean(init.headers.Authorization);
    state.calls.push({ path, method: init.method, isAuth, headers: init.headers,
      redirect: init.redirect });
    if (init.redirect !== "error") throw Error("Wrong redirect policy");
    if (path === "/health") return malformed
      ? new Response("<html>", { status: 200, headers: { "Content-Type": "text/html" } })
      : json({ status: "ok", service: "workshop-visitor-terminal", api: "v1" });
    if (path === "/v1/my/counters")
      return json({ error: "Publishing is not enabled" }, enabled ? 200 : 503);
    if (path === "/v1/admin/usage") {
      if (!isAuth) return json({ error: "Unauthorized" }, 401);
      return json({
        utcDay: "2026-11-01",
        admitted: 20000 - budget,
        maxDailyAdmitted: 20000, remaining: budget,
        edgeRateLimitsEnabled: true,
        edgeLimitPerMinutePerCounter: 60,
        edgeLimitPerMinutePerLocation: 120
      });
    }
    if (path.startsWith("/v1/counters/") && path.endsWith(".svg")) {
      if (!state.created) return json({ error: "Counter not found" }, 404);
      if (init.method === "HEAD") return new Response(null, {
        status: 200, headers: { "Content-Type": "image/svg+xml; charset=utf-8" }
      });
      if (failAt === "first-get" && state.count === 0) return json({ error: "error" }, 503);
      state.count = nextCount;
      return new Response("<svg>" + state.text + " " + state.count + "</svg>", {
        status: 200, headers: { "Content-Type": "image/svg+xml; charset=utf-8" }
      });
    }
    if (path === "/v1/admin/counters" && init.method === "POST") {
      state.writes++;
      const body = JSON.parse(init.body);
      state.slug = body.slug;
      if (already) return json({ error: "Already exists" }, 409);
      assert.equal(body.owner, "testowner");
      assert.equal(body.design.schemaVersion, 1);
      state.created = true;
      return json({ slug: state.slug, hits: 0 }, 201);
    }
    if (path === "/v1/admin/counters/" + state.slug && init.method === "GET") {
      return json({ slug: state.slug, hits: state.count });
    }
    if (path === "/v1/admin/counters/" + state.slug + "/design" &&
        init.method === "POST") {
      state.writes++;
      state.text = JSON.parse(init.body).design.layers[0].text;
      return json({ slug: state.slug, updated: true });
    }
    throw Error("Unexpected request " + init.method + " " + path);
  };
  return { state, fetchImpl };
}

async function withConfig(fn) {
  const root = await mkdtemp(join(tmpdir(), "wvt-live-check-"));
  try {
    const template = await readFile("wrangler.selfhost.example.toml", "utf8");
    const config = makeConfig(template, {
      worker: "live-own-counter", database: "private-live-d1",
      "database-id": "12345678-1111-4111-8111-123456789abc"
    }, [88881, 88882]);
    await writeFile(join(root, "wrangler.selfhost.toml"), config);
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("explicit consent is required and CLI never has deployment or local-test flags", () => {
  const command = [
    "--api", REMOTE, "--owner", "testowner", "--confirm-worker", "live-own-counter",
    "--allow-persistent-test-record", "--token-file", ".wvt-admin-token"
  ];
  const args = parseLiveArgs(command);
  assert.equal(args.consent, true);
  assert.equal(args["token-file"], ".wvt-admin-token");
  assert.equal(parseLiveArgs(["--help"]).help, true);
  const invalid = [
    command.filter(a => a !== "--allow-persistent-test-record"),
    [...command, "--allow-persistent-test-record"],
    [...command, "--allow-loopback-test"],
    [...command, "--deploy"],
    [...command, "--api", REMOTE],
    command.map(x => x === "live-own-counter" ? "other-worker" : x),
  ];
  for (const bad of invalid) {
    // Mismatched typed Worker is structurally valid until configuration check.
    if (bad === invalid.at(-1)) continue;
    assert.throws(() => parseLiveArgs(bad));
  }
  assert.throws(() => parseLiveArgs([
    ...command, "--report", "../../secret.txt"
  ]));
});

test("remote target must be own HTTPS workers.dev Worker matching local config", async () => {
  await withConfig(async root => {
    assert.equal(await assertLiveDestination(CMD, { root }), REMOTE);
    for (const invalid of [
      { ...CMD, api: "http://live-own-counter.preview-account.workers.dev" },
      { ...CMD, api: "https://github.com" },
      { ...CMD, api: "https://other.preview-account.workers.dev" },
      { ...CMD, "confirm-worker": "other" },
      { ...CMD, api: "https://workshop-visitor-terminal-staging.fangcui2007.workers.dev" },
      { ...CMD, api: "http://127.0.0.1:8787" }
    ]) await assert.rejects(() => assertLiveDestination(invalid, { root }));
  });
  await assert.rejects(() => assertLiveDestination(CMD, {
    root: join(tmpdir(), "wvt-non-existent-dir-1234")
  }), /valid local self-host configuration/);
});

test("consented live run exercises only its own new counter, HEAD and dedupe without exposing token", async () => {
  await withConfig(async root => {
    const mock = mockService();
    const report = await runLiveCheck(CMD, {
      root, environment: { WVT_ADMIN_TOKEN: TOKEN }, fetchImpl: mock.fetchImpl,
      newSlug: () => "livecheck-123456789abcde"
    });
    assert.equal(report.result, "PASS");
    assert.equal(report.runtime, "REMOTE_SELF_HOST");
    assert.equal(report.independentCloudflareAccountOwnership, "NOT_VERIFIED");
    assert.equal(report.billingIsolation, "NOT_VERIFIED");
    assert(report.diagnosticCounterPersists);
    assert.equal(mock.state.count, 1);
    assert.equal(mock.state.text, "LIVE CHECK UPDATED");
    assert.equal(mock.state.writes, 2, "Only create and design update write to admin D1");
    assert(mock.state.calls.every(x => x.redirect === "error"));
    assert.equal(mock.state.calls.filter(x => x.isAuth).length, 8);
    assert(mock.state.calls.filter(x => x.method === "POST").every(x => x.isAuth));
    assert(mock.state.calls.filter(x => x.path.endsWith(".svg"))
      .every(x => !x.isAuth && !x.headers["CF-Connecting-IP"]),
      "Remote calls must never inject CF-Connecting-IP");
    const serialized = JSON.stringify(report);
    assert(!serialized.includes(TOKEN));
    assert(!serialized.includes(CMD.api));
    assert(!serialized.includes("private-live-d1"));
    const persisted = join(root, "live-report.json");
    const { writeReadinessReport } = await import("../scripts/self-host-readiness.mjs");
    await writeReadinessReport(report, persisted);
    assert.deepEqual(JSON.parse(await readFile(persisted, "utf8")), report);
    await assert.rejects(() => writeReadinessReport(report, persisted), { code: "EEXIST" });
  });
});

test("no write if OAuth publishing is enabled, Worker is spoofed or daily budget exhausted", async () => {
  await withConfig(async root => {
    for (const params of [{ enabled: true }, { malformed: true }, { budget: 1 }]) {
      const service = mockService(params);
      await assert.rejects(() => runLiveCheck(CMD, {
        root, environment: { WVT_ADMIN_TOKEN: TOKEN }, fetchImpl: service.fetchImpl
      }));
      assert.equal(service.state.writes, 0);
    }
  });
});

test("partial failure discloses only diagnostic slug, not bearer tokens or remote payloads", async () => {
  await withConfig(async root => {
    for (const mode of [{ already: true }, { failAt: "first-get" }, { nextCount: 2 }]) {
      const service = mockService(mode);
      await assert.rejects(() => runLiveCheck(CMD, {
        root, environment: { WVT_ADMIN_TOKEN: TOKEN }, fetchImpl: service.fetchImpl,
        newSlug: () => "livecheck-aabbccddeeff11"
      }), error => {
        assert.match(error.message, /diagnostic counter slug: livecheck-aabbccddeeff11/);
        assert(!error.message.includes(TOKEN));
        assert(!error.message.includes(REMOTE));
        return true;
      });
    }
  });
});

test("no consent produces no network requests and no invalid test slug is accepted", async () => {
  const service = mockService();
  await assert.rejects(() => runLiveCheck({ ...CMD, consent: false }, {
    fetchImpl: service.fetchImpl
  }), /consent/);
  assert.equal(service.state.calls.length, 0);
  await withConfig(async root => {
    await assert.rejects(() => runLiveCheck(CMD, {
      root, environment: { WVT_ADMIN_TOKEN: TOKEN }, fetchImpl: service.fetchImpl,
      newSlug: () => "not-an-accepted-slug"
    }), /Unexpected diagnostic counter slug/);
    assert.equal(service.state.writes, 0);
  });
});
