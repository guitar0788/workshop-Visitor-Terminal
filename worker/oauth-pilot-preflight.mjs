#!/usr/bin/env node
/**
 * OAuth pilot preflight: request-based checks without authorizing a user,
 * returning any browser ticket, or writing published counters.
 *
 * The sole D1 write is a short-lived OAuth state generated for a preflight.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { APPROVED_ORIGIN, APPROVED_STUDIO } from "./prepare-oauth-pilot.mjs";

if (process.env.STAGING_ORIGIN !== APPROVED_ORIGIN) {
  throw Error("Refusing OAuth preflight for any nonapproved staging origin");
}
const clientId = process.env.GITHUB_CLIENT_ID;
if (!clientId || !/^[A-Za-z0-9_-]{8,128}$/.test(clientId)) {
  throw Error("GitHub OAuth Client ID is missing");
}
const headers = { Origin: new URL(APPROVED_STUDIO).origin };
async function call(path, init = {}) {
  return fetch(APPROVED_ORIGIN + path, {
    cache: "no-store", redirect: "manual",
    signal: AbortSignal.timeout(12000),
    ...init
  });
}
const challenge = createHash("sha256").update("isolated-oauth-pilot-verify").digest("base64url");

const cors = await call("/v1/me", { headers });
assert.equal(cors.status, 401,
  "Expected authenticated API to be enabled, denying unsigned identity");
assert.equal(cors.headers.get("access-control-allow-origin"), headers.Origin);

const hostile = await call("/v1/me", { headers: { Origin: "https://evil.example" } });
assert.equal(hostile.status, 403, "Wrong browser origin must be forbidden");

const options = await call("/v1/auth/github/start", {
  method: "OPTIONS", headers: {
    ...headers,
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "content-type"
  }
});
assert.equal(options.status, 204);
const started = await call("/v1/auth/github/start", {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({ challenge })
});
const body = await started.json();
assert.equal(started.status, 200, "OAuth pilot start must be available");
assert.equal(typeof body.state, "string");
assert.match(body.state, /^[a-f0-9]{64}$/);
const authorize = new URL(body.authorizeUrl);
assert.equal(authorize.origin, "https://github.com");
assert.equal(authorize.pathname, "/login/oauth/authorize");
assert.equal(authorize.searchParams.get("client_id"), clientId);
assert.equal(authorize.searchParams.get("redirect_uri"), APPROVED_ORIGIN +
  "/v1/auth/github/callback");
assert.equal(authorize.searchParams.get("state"), body.state);
assert.equal(authorize.searchParams.get("scope"), "read:user");

console.log("PASS: staging OAuth API enabled for a controlled browser flow.");
console.log("PASS: blocked unauthorized identity, foreign Origin, and verified OAuth redirect.");
console.log("No GitHub login, session creation, or published counter was performed.");
