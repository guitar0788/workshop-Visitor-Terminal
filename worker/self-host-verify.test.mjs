import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseVerifyArgs, validateUsage, validateSvgHeadHeaders, verifySelfHost,
  makeReadOnlyVerificationReport, saveReadOnlyVerificationReport
} from "../scripts/self-host-verify.mjs";

const ORIGIN = "https://test-own-worker.example.workers.dev";
const TOKEN = "a".repeat(64);
const usage = {
  utcDay: "2026-11-01", admitted: 42, maxDailyAdmitted: 20_000,
  remaining: 19_958, edgeRateLimitsEnabled: true,
  edgeLimitPerMinutePerCounter: 60, edgeLimitPerMinutePerLocation: 120
};
const SAFE_SVG_HEADERS = {
  "Content-Type": "image/svg+xml; charset=utf-8",
  "Cache-Control": "public, max-age=60",
  "X-Content-Type-Options": "nosniff",
  "Access-Control-Allow-Origin": "*",
  "Cross-Origin-Resource-Policy": "cross-origin"
};
function responses({ publishing = 503, adminAnonymous = 401,
  budget = usage, image = 404, imageHeaders = SAFE_SVG_HEADERS,
  health = 200, errorOnRequest = false } = {}) {
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
        headers: image === 200 ? imageHeaders : {}
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
  assert.deepEqual(result.svgHeaders, {
    contentType: "image/svg+xml", cacheMaxAgeSeconds: 60,
    embeddableResponseHeaders: true
  });
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


test("live README SVG HEAD gate fails closed on unsafe image proxy headers", async () => {
  const invalid = [
    ["missing MIME", { "Content-Type": "text/html" }],
    ["private cache", { "Cache-Control": "private, max-age=60" }],
    ["no-cache", { "Cache-Control": "no-store" }],
    ["zero TTL", { "Cache-Control": "public, max-age=0" }],
    ["excessive TTL", { "Cache-Control": "public, max-age=86400" }],
    ["no nosniff", { "X-Content-Type-Options": "" }],
    ["wrong CORS", { "Access-Control-Allow-Origin": "https://private.example" }],
    ["wrong CORP", { "Cross-Origin-Resource-Policy": "same-origin" }],
    ["cookie", { "Set-Cookie": "session=should-never-be-sent" }],
    ["download", { "Content-Disposition": "attachment; filename=counter.svg" }],
    ["sensitive vary", { "Vary": "Authorization" }]
  ];
  for (const [reason, changed] of invalid) {
    const mock = responses({ image: 200, imageHeaders: {
      ...SAFE_SVG_HEADERS, ...changed
    } });
    await assert.rejects(() => verifySelfHost({
      api: ORIGIN, slug: "public-counter"
    }, { ...auth, ...mock }), /SVG HEAD/,
    "Reject unsafe image response: " + reason);
    assert.equal(mock.calls.at(-1).init.method, "HEAD");
    assert.equal(mock.calls.filter(x => x.init.headers.Authorization).length, 1);
  }
});

test("SVG image metadata validation is local, deterministic and does not claim GitHub proxy acceptance", () => {
  assert.deepEqual(validateSvgHeadHeaders(new Headers(SAFE_SVG_HEADERS)), {
    contentType: "image/svg+xml", cacheMaxAgeSeconds: 60,
    embeddableResponseHeaders: true
  });
  assert.throws(() => validateSvgHeadHeaders(null), /headers are invalid/);
  for (const bad of [
    { "Cache-Control": "public" },
    { "Cache-Control": "public, max-age=not-a-number" },
    { "Cache-Control": "public, max-age=60, private" }
  ]) assert.throws(() => validateSvgHeadHeaders(new Headers({
    ...SAFE_SVG_HEADERS, ...bad
  })), /caching/);
});


test("read-only verification CLI accepts only ignored, local, unique report filenames", () => {
  const safe = parseVerifyArgs(["--api", ORIGIN, "--report", "selfhost-readonly-check1.json"]);
  assert.equal(safe.report, "selfhost-readonly-check1.json");
  for (const path of [
    "../selfhost-readonly-report.json", "logs/selfhost-readonly-report.json",
    "selfhost-readonly-.json", "SELFHOST-READONLY-REPORT.json",
    "selfhost-readonly-report.JSON", "file:///tmp/report.json",
    ".wvt-admin-token", "selfhost-live-result.json", "README.md",
    "selfhost-readonly-../token.json", "selfhost-readonly-a.json?x=y"
  ]) {
    assert.throws(() => parseVerifyArgs(["--api", ORIGIN, "--report", path]),
      /Report must be an ignored/);
  }
  assert.throws(() => parseVerifyArgs(["--api", ORIGIN,
    "--report", "selfhost-readonly-a.json", "--report", "selfhost-readonly-b.json"]));
});

test("successful remote read-only checks produce a minimal sanitized report; existing reports are never replaced", async () => {
  const result = await verifySelfHost({ api: ORIGIN, slug: "demo-private-counter" }, {
    ...auth, ...responses({ image: 200 })
  });
  result.adminSecret = TOKEN;
  result.d1DatabaseId = "11111111-2222-3333-4444-555555555555";
  const summary = makeReadOnlyVerificationReport(result);
  assert.equal(summary.runtime, "REMOTE_READ_ONLY_SELF_HOST");
  assert.equal(summary.releaseGate, "NO_GO_PENDING_INDEPENDENT_ACCEPTANCE");
  assert.equal(summary.checks.knownCounterSvgHeaders, "PASS");
  assert.equal(summary.notVerified.independentCloudflareAccountOwnership, "NOT_VERIFIED");
  assert.equal(summary.notVerified.githubRemoteSvgImageProxyAndCaching, "NOT_TESTED");
  const serialized = JSON.stringify(summary);
  for (const forbidden of [ORIGIN, "demo-private-counter", TOKEN, result.d1DatabaseId,
    "2026-11-01", "42", "19958", "Authorization", "Bearer"]) {
    assert.equal(serialized.includes(forbidden), false, "Leaked private detail into shareable report");
  }

  const dir = await mkdtemp(join(tmpdir(), "wvt-readonly-proof-"));
  const name = "selfhost-readonly-proof.json";
  try {
    assert.deepEqual(await saveReadOnlyVerificationReport(result, name, { directory: dir }), summary);
    const file = join(dir, name);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), summary);
    if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
    await assert.rejects(
      () => saveReadOnlyVerificationReport(result, name, { directory: dir }),
      error => error?.code === "EEXIST"
    );
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), summary);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a missing random SVG produces a visibly weaker report and unsafe claims fail closed", async () => {
  const check = await verifySelfHost({ api: ORIGIN }, { ...auth, ...responses() });
  const report = makeReadOnlyVerificationReport(check);
  assert.equal(report.checks.knownCounterSvgHeaders, "NOT_TESTED");
  assert.equal(report.checks.nonCountingSvgHead, "PASS");
  assert.equal(report.databaseWritesRequested, false);
  assert.throws(() => makeReadOnlyVerificationReport({
    ...check, noDatabaseWrites: false
  }), /successful read-only/);
  assert.throws(() => makeReadOnlyVerificationReport({
    ...check, svgHeaders: { contentType: "image/svg+xml" }
  }), /missing counter/);
  assert.throws(() => makeReadOnlyVerificationReport({
    ...check, checkedSlug: "unknown", svgHeaders: null
  }), /not passed full/);
});
