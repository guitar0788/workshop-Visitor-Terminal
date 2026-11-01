import test from "node:test";
import assert from "node:assert/strict";
import {
  parseVerifyArgs, validateUsage, verifySelfHost
} from "../scripts/self-host-verify.mjs";

const ORIGIN = "https://test-own-worker.example.workers.dev";
const TOKEN = "a".repeat(64);
const usage = {
  utcDay: "2026-11-01", admitted: 42, maxDailyAdmitted: 20_000,
  remaining: 19_958, edgeRateLimitsEnabled: true,
  edgeLimitPerMinutePerCounter: 60, edgeLimitPerMinutePerLocation: 120
};
function responses({ publishing = 503, adminAnonymous = 401,
  budget = usage, image = 404, health = 200, errorOnRequest = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (errorOnRequest) throw Error("unsafe-network-error-DO_NOT_LOG_SECRETS");
    const path = new URL(url).pathname;
    if (path === "/health") {
      return Response.json({ status: "ok", service: "workshop-visitor-terminal", api: "v1" },
        { status: health });
    }
    if (path === "/v1/my/counters") {
      return Response.json({ error: "Publishing is not enabled" }, { status: publishing });
    }
    if (path === "/v1/admin/usage") {
      return init.headers.Authorization
        ? Response.json(budget)
        : Response.json({ error: "Unauthorized" }, { status: adminAnonymous });
    }
    if (path.endsWith(".svg")) {
      return new Response(null, {
        status: image,
        headers: image === 200 ? { "Content-Type": "image/svg+xml" } : {}
      });
    }
    throw Error("Unexpected path: " + path);
  };
  return { calls, fetchImpl };
}
const auth = { environment: { WVT_ADMIN_TOKEN: TOKEN } };

test("parse verifies own HTTPS/loopback URLs, refuses staging and invalid slugs", () => {
  assert.equal(parseVerifyArgs(["--help"]).help, true);
  assert.equal(parseVerifyArgs(["--api", ORIGIN, "--slug", "counter-1"]).slug, "counter-1");
  for (const input of [
    [], ["--api", "https://workshop-visitor-terminal-staging.fangcui2007.workers.dev"],
    ["--api", "http://untrusted.example.com"],
    ["--api", ORIGIN, "--slug", "BAD/slug"],
    ["--api", ORIGIN, "--slug", "a", "--slug", "b"],
    ["--api", ORIGIN, "--unknown", "true"],
    ["--api", ORIGIN, "--token-file"]
  ]) assert.throws(() => parseVerifyArgs(input));
});

test("all checks are read-only, secret sent only to authenticated usage and no existing SVG changed", async () => {
  const mock = responses();
  const result = await verifySelfHost({ api: ORIGIN }, {
    ...auth, ...mock, makeProbeSlug: () => "probe-" + "f".repeat(24)
  });
  assert.deepEqual(result.budget, {
    utcDay: usage.utcDay, admitted: usage.admitted, remaining: usage.remaining
  });
  assert.equal(result.noDatabaseWrites, true);
  assert.deepEqual(mock.calls.map(x => new URL(x.url).pathname), [
    "/health", "/v1/my/counters", "/v1/admin/usage",
    "/v1/admin/usage", "/v1/counters/probe-" + "f".repeat(24) + ".svg"
  ]);
  assert(mock.calls.every(x => ["HEAD", "GET"].includes(x.init.method)));
  assert(mock.calls.every(x => x.init.redirect === "error"));
  assert(mock.calls.every(x => x.init.cache === "no-store"));
  assert.equal(mock.calls.filter(x => x.init.headers.Authorization).length, 1);
  assert.equal(mock.calls[3].init.headers.Authorization, "Bearer " + TOKEN);
  assert.equal(mock.calls[4].init.method, "HEAD");
  assert(mock.calls.slice(0, 3).every(x => !x.init.headers.Authorization));
});

test("optional known slug uses HEAD and verifies real SVG media type", async () => {
  const mock = responses({ image: 200 });
  const result = await verifySelfHost({ api: ORIGIN, slug: "my-counter" },
    { ...auth, ...mock });
  assert.equal(result.checkedSlug, "my-counter");
  assert.equal(mock.calls.at(-1).init.method, "HEAD");
  assert.equal(new URL(mock.calls.at(-1).url).pathname,
    "/v1/counters/my-counter.svg");
});

test("fails closed when publishing is accidentally enabled or anonymous admin is exposed", async () => {
  for (const input of [
    { publishing: 403 },
    { publishing: 200 },
    { adminAnonymous: 200 }
  ]) {
    const mock = responses(input);
    await assert.rejects(() => verifySelfHost({ api: ORIGIN },
      { ...auth, ...mock }), /Publishing gate|Anonymous admin/);
    assert(mock.calls.every(x => !x.init.headers.Authorization),
      "Do not transmit token when prior checks are unsafe");
  }
});

test("rejects malformed, disabled, exhausted-but-corrupt budgets", async () => {
  const invalid = [
    { ...usage, edgeRateLimitsEnabled: false },
    { ...usage, maxDailyAdmitted: 200_000 },
    { ...usage, remaining: 19_999 },
    { ...usage, admitted: -1 },
    { ...usage, admitted: 20_001 },
    { ...usage, edgeLimitPerMinutePerLocation: 999 },
    { ...usage, utcDay: "tomorrow" }
  ];
  for (const budget of invalid) {
    await assert.rejects(
      () => verifySelfHost({ api: ORIGIN }, {
        ...auth, ...responses({ budget })
      }), /budget or SVG rate limits/);
  }
});

test("rejects unavailable SVG, unexpected existing probe and invalid Worker identity", async () => {
  for (const input of [
    { image: 429 }, { image: 503 }, { image: 200 }, { health: 503 }
  ]) {
    await assert.rejects(
      () => verifySelfHost({ api: ORIGIN }, { ...auth, ...responses(input) }),
      /Health|SVG HEAD/);
  }
  await assert.rejects(
    () => verifySelfHost({ api: ORIGIN, slug: "existent" }, {
      ...auth, ...responses({ image: 404 })
    }), /SVG HEAD/);
});

test("fails before any request on maintainer origin and never echoes network errors", async () => {
  let called = 0;
  await assert.rejects(
    () => verifySelfHost({
      api: "https://workshop-visitor-terminal-staging.fangcui2007.workers.dev"
    }, { ...auth, fetchImpl: () => { called++; } }), /root HTTPS origin/);
  assert.equal(called, 0);
  await assert.rejects(
    () => verifySelfHost({ api: ORIGIN }, {
      ...auth, ...responses({ errorOnRequest: true })
    }), error => {
      assert(!error.message.includes("DO_NOT_LOG_SECRETS"));
      assert.match(error.message, /Worker connection failed/);
      return true;
    });
});

test("validates exact budget shape and allows legitimate exhausted budget", () => {
  assert.equal(validateUsage({ ...usage, admitted: 20_000, remaining: 0 }).remaining, 0);
  assert.throws(() => validateUsage(null));
  assert.throws(() => validateUsage({ ...usage, admitted: 1.2 }));
});
