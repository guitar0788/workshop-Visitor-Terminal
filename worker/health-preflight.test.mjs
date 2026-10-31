import test from "node:test";
import assert from "node:assert/strict";
import { describeResponse, waitForStagingHealth } from "./health-preflight.mjs";

const origin = "https://workshop-visitor-terminal-staging.fangcui2007.workers.dev";
const health = { status: "ok", service: "workshop-visitor-terminal", api: "v1" };
const res = (status, type, body, ray) =>
  new Response(body, {
    status,
    headers: { "content-type": type, ...(ray ? { "cf-ray": ray } : {}) }
  });

test("waits through a temporary Cloudflare HTML response until staging is ready", async () => {
  let calls = 0;
  const paths = [];
  const result = await waitForStagingHealth(origin, {
    attempts: 3, delayMs: 0, pause: async () => {},
    fetchImpl: async (url, opts) => {
      paths.push({ url, opts });
      calls++;
      return calls === 1
        ? res(404, "text/html", "<!DOCTYPE html><title>Not Found</title>")
        : res(200, "application/json", JSON.stringify(health));
    }
  });
  assert.equal(result.attempt, 2);
  assert.equal(calls, 2);
  assert(paths.every(x => x.url === origin + "/health"));
  assert(paths.every(x => x.opts.method === "GET"));
  assert(paths.every(x => !("Authorization" in x.opts.headers)));
});

test("reports an HTML error title and status without emitting full HTML", async () => {
  const response = res(403, "text/html; charset=UTF-8",
    "<!DOCTYPE html><title>Access denied</title><div>private details never printed</div>",
    "1234-SJC");
  const message = describeResponse(response, await response.text());
  assert.match(message, /HTTP 403/);
  assert.match(message, /text\/html/);
  assert.match(message, /Access denied/);
  assert.match(message, /1234-SJC/);
  assert(!message.includes("private details"));
});

test("fails after bounded retries without any write requests or secret values", async () => {
  let calls = 0;
  await assert.rejects(
    waitForStagingHealth(origin, {
      attempts: 2, delayMs: 0, pause: async () => {},
      fetchImpl: async () => {
        calls++;
        return res(503, "text/html", "<title>Cloudflare unavailable</title>");
      }
    }),
    error => {
      assert.match(error.message, /HTTP 503/);
      assert.match(error.message, /Cloudflare unavailable/);
      assert.match(error.message, /No staging counters were created/);
      return true;
    }
  );
  assert.equal(calls, 2);
});

test("rejects a 200 HTML challenge and a JSON response from the wrong service", async () => {
  for (const response of [
    res(200, "text/html", "<title>Sign in</title>"),
    res(200, "application/json", '{"status":"ok","service":"unrelated"}')
  ]) {
    await assert.rejects(
      waitForStagingHealth(origin, {
        attempts: 1,
        fetchImpl: async () => response
      }),
      /not become ready/
    );
  }
});

test("rejects arbitrary hosts before sending requests", async () => {
  let called = false;
  await assert.rejects(waitForStagingHealth("https://www.example.com", {
    fetchImpl: async () => {
      called = true;
      return res(200, "application/json", JSON.stringify(health));
    }
  }));
  assert.equal(called, false);
});
