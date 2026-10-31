import test from "node:test";
import assert from "node:assert/strict";
import {
  APPROVED_STAGING, validateUsage, fetchStagingUsage, checkStagingSvgLimiter
} from "./verify-budget-staging.mjs";

const secret = "admin-" + "s".repeat(48);
const allowed = { utcDay: "2026-11-01", admitted: 102,
  maxDailyAdmitted: 20_000, remaining: 19_898,
  edgeRateLimitsEnabled: true,
  edgeLimitPerMinutePerCounter: 60, edgeLimitPerMinutePerLocation: 120 };

test("validates global budget, policy, exact remaining number and date", () => {
  assert.deepEqual(validateUsage(allowed), { date: "2026-11-01", used: 102, left: 19_898 });
  for (const bad of [
    { admitted: -1 }, { admitted: 20_001 }, { remaining: 7 },
    { utcDay: "yesterday" }, { maxDailyAdmitted: 100_000 },
    { edgeRateLimitsEnabled: false },
    { edgeLimitPerMinutePerLocation: 900 }, { edgeLimitPerMinutePerCounter: 900 }
  ]) assert.throws(() => validateUsage({ ...allowed, ...bad }));
});

test("checks only allowed worker with authenticated read-only GET", async () => {
  let visited = false;
  const output = await fetchStagingUsage({
    origin: APPROVED_STAGING,
    token: secret,
    fetchImpl: async (input, init) => {
      visited = true;
      assert.equal(String(input), APPROVED_STAGING + "/v1/admin/usage");
      assert.equal(init.method, "GET");
      assert.equal(new Headers(init.headers).get("Authorization"), "Bearer " + secret);
      assert.equal(init.redirect, "manual");
      return Response.json(allowed);
    }
  });
  assert.equal(visited, true);
  assert.equal(output.used, 102);
  for (const url of [
    "https://example.com", "https://workshop-visitor-terminal-staging.other.workers.dev",
    APPROVED_STAGING + "/path"
  ]) {
    await assert.rejects(fetchStagingUsage({
      origin: url, token: secret,
      fetchImpl: async () => { throw Error("Never fetch from wrong origin"); }
    }));
  }
  await assert.rejects(fetchStagingUsage({
    origin: APPROVED_STAGING, token: ""
  }));
});

test("fails closed on error pages without reading or printing their bodies", async () => {
  await assert.rejects(fetchStagingUsage({
    origin: APPROVED_STAGING, token: secret,
    fetchImpl: async () => new Response("<html>token leaked</html>", {
      status: 503, headers: { "Content-Type": "text/html" }
    })
  }), /HTTP 503/);
});
 
test("checks SVG rate bindings with HEAD only and no live counter writes", async () => {
  for (const status of [200, 404, 429]) {
    const seen = [];
    const obtained = await checkStagingSvgLimiter({
      origin: APPROVED_STAGING,
      fetchImpl: async (input, init) => {
        seen.push({ input: String(input), method: init.method, redirect: init.redirect });
        return new Response(null, {
          status, headers: status === 429 ? { "Retry-After": "60" } : {}
        });
      }
    });
    assert.equal(obtained, status);
    assert.deepEqual(seen, [{
      input: APPROVED_STAGING + "/v1/counters/v000000000000000000000000.svg",
      method: "HEAD", redirect: "manual"
    }]);
  }
  for (const status of [301, 401, 403, 500, 503]) {
    await assert.rejects(checkStagingSvgLimiter({
      origin: APPROVED_STAGING,
      fetchImpl: async () => new Response(null, { status })
    }));
  }
  await assert.rejects(checkStagingSvgLimiter({
    origin: "https://wrong.example",
    fetchImpl: async () => { throw Error("Should not send any request"); }
  }));
});
